import path from "node:path"
import { fileURLToPath } from "node:url"
import { snippetAround } from "./lib/knowledge.js"
import { createProjectFs } from "./lib/project-fs.js"
import { createDocumentExtractor } from "./services/document-extractor.js"
import { createIngestService } from "./services/ingest.js"
import { createImportHistoryService } from "./services/import-history.js"
import { createGraphService } from "./services/graph.js"
import { createKnowledgeBaseService } from "./services/knowledge-base.js"
import { createLlmService } from "./services/llm.js"
import { createLintService } from "./services/lint.js"
import { createProjectService } from "./services/projects.js"
import { createConversationService } from "./services/conversations.js"
import { createSourceTextCacheService } from "./services/source-text-cache.js"
import {
  buildProjectLens,
  reopenReviewItem,
  resolveReviewItem,
} from "./services/review-lens.js"
import { createSourceManagerService } from "./services/source-manager.js"
import { createSettingsService } from "./services/settings.js"
import { createTaskService } from "./services/tasks.js"
import {
  appendLog,
  buildKnowledgeView,
  createSynthesisFromAnswer,
  rebuildWikiIndex,
} from "./services/wiki.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export function createRuntimeConfig() {
  const workspaceRoot = path.resolve(__dirname, "../..")
  return {
    workspaceRoot,
    projectsRoot: path.join(workspaceRoot, "data/projects"),
    publicRoot: path.join(workspaceRoot, "web"),
    settingsPath: path.join(workspaceRoot, "data/settings.json"),
    tasksPath: path.join(workspaceRoot, "data/tasks.json"),
    port: Number(process.env.PORT || 4000),
    host: process.env.HOST || "127.0.0.1",
  }
}

export function createAppServices(runtime) {
  const projectFs = createProjectFs(runtime.projectsRoot)
  const documentExtractor = createDocumentExtractor({ workspaceRoot: runtime.workspaceRoot })
  const settingsService = createSettingsService({ settingsPath: runtime.settingsPath, fs: projectFs })
  const taskService = createTaskService({ tasksPath: runtime.tasksPath, fs: projectFs })
  const projectService = createProjectService({ projectFs })
  const importHistoryService = createImportHistoryService({ projectService })
  const conversationService = createConversationService({ projectFs, projectService })
  const sourceTextCacheService = createSourceTextCacheService({ projectFs, projectService, documentExtractor })
  const llmService = createLlmService({ loadSettings: settingsService.loadSettings })
  const sourceManagerService = createSourceManagerService({ projectFs, projectService, sourceTextCacheService })

  const wikiServiceDeps = {
    ensureInsideProject: projectService.ensureInsideProject,
    collectFiles: projectFs.collectFiles,
    readProjectFile: projectService.readProjectFile,
    writeProjectFile: projectService.writeProjectFile,
    snippetAround,
  }

  const wikiService = {
    buildKnowledgeView: (projectId) => buildKnowledgeView(projectId, wikiServiceDeps),
    rebuildWikiIndex: (projectId) => rebuildWikiIndex(projectId, wikiServiceDeps),
    appendLog: (projectId, line) => appendLog(projectId, line, wikiServiceDeps),
    createSynthesisFromAnswer: (projectId, payload) => createSynthesisFromAnswer(projectId, payload, wikiServiceDeps),
  }

  const reviewLensDeps = {
    buildKnowledgeView: wikiService.buildKnowledgeView,
    ensureInsideProject: projectService.ensureInsideProject,
    collectFiles: projectFs.collectFiles,
    loadTaskStore: taskService.loadTaskStore,
    listProjectTasks: taskService.listProjectTasks,
    readProjectFile: projectService.readProjectFile,
    writeProjectFile: projectService.writeProjectFile,
    snippetAround,
  }

  const reviewService = {
    buildProjectLens: (projectId) => buildProjectLens(projectId, reviewLensDeps),
    resolveReviewItem: (projectId, key) => resolveReviewItem(projectId, key, reviewLensDeps),
    reopenReviewItem: (projectId, key) => reopenReviewItem(projectId, key, reviewLensDeps),
  }

  const ingestService = createIngestService({
    loadSettings: settingsService.loadSettings,
    callChatModel: llmService.callChatModel,
    documentExtractor,
    sourceTextCacheService,
    projectFs,
    projectService,
    wikiServiceDeps,
    rebuildWikiIndex,
    appendLog,
  })

  const knowledgeBaseService = createKnowledgeBaseService({
    projectFs,
    projectService,
    loadSettings: settingsService.loadSettings,
    callChatModel: llmService.callChatModel,
    sourceTextCacheService,
  })
  const lintService = createLintService({
    projectFs,
    projectService,
  })
  const graphService = createGraphService({
    projectFs,
    projectService,
  })

  async function startIngestTask(projectId) {
    await taskService.loadTaskStore()
    const task = taskService.createTask(projectId, "ingest")
    await taskService.persistTaskStore()

    void (async () => {
      try {
        const result = await ingestService.ingestProjectWithProgress(projectId, async (progress) => {
          taskService.updateTask(task.id, {
            status: "running",
            stage: progress.stage,
            message: progress.message,
            file: progress.file || null,
            error: null,
          })
          await taskService.persistTaskStore()
        })
        taskService.updateTask(task.id, {
          status: "done",
          stage: "done",
          message: `已提取 ${result.ingested.length} 个源文件，跳过 ${result.skipped.length} 个。`,
          result,
        })
        await taskService.persistTaskStore()
      } catch (error) {
        taskService.updateTask(task.id, {
          status: "error",
          stage: "failed",
          message: error instanceof Error ? error.message : String(error),
          error: error instanceof Error ? error.message : String(error),
        })
        await taskService.persistTaskStore()
      }
    })()

    return task
  }

  async function startSourceIngestTask(projectId, sourcePath) {
    await taskService.loadTaskStore()
    const task = taskService.createTask(projectId, "reingest-source")
    taskService.updateTask(task.id, {
      file: sourcePath,
      sourcePath,
      message: "排队中",
    })
    await taskService.persistTaskStore()

    void (async () => {
      try {
        const result = await ingestService.reingestSourceWithProgress(projectId, sourcePath, async (progress) => {
          taskService.updateTask(task.id, {
            status: "running",
            stage: progress.stage,
            message: progress.message,
            file: progress.file || sourcePath,
            error: null,
          })
          await taskService.persistTaskStore()
        })
        taskService.updateTask(task.id, {
          status: "done",
          stage: "done",
          message: `已重新提取 ${sourcePath}`,
          result,
        })
        await taskService.persistTaskStore()
      } catch (error) {
        taskService.updateTask(task.id, {
          status: "error",
          stage: "failed",
          message: error instanceof Error ? error.message : String(error),
          error: error instanceof Error ? error.message : String(error),
        })
        await taskService.persistTaskStore()
      }
    })()

    return task
  }

  return {
    projectFs,
    documentExtractor,
    settingsService,
    taskService,
    projectService,
    importHistoryService,
    conversationService,
    sourceTextCacheService,
    llmService,
    wikiService,
    reviewService,
    ingestService,
    knowledgeBaseService,
    lintService,
    graphService,
    sourceManagerService,
    startIngestTask,
    startSourceIngestTask,
  }
}
