import path from "node:path"
import { fileURLToPath } from "node:url"
import { snippetAround } from "./lib/knowledge.js"
import { createProjectLockService } from "./lib/project-lock.js"
import { createProjectFs } from "./lib/project-fs.js"
import { createDocumentExtractor } from "./services/document-extractor.js"
import { createIngestService } from "./services/ingest.js"
import { createImportHistoryService } from "./services/import-history.js"
import { createGraphService } from "./services/graph.js"
import { createIngestCacheService } from "./services/ingest-cache.js"
import { createKnowledgeBaseService } from "./services/knowledge-base.js"
import { createLlmService } from "./services/llm.js"
import { createLintService } from "./services/lint.js"
import { createProjectService } from "./services/projects.js"
import { createConversationService } from "./services/conversations.js"
import { createSourceTextCacheService } from "./services/source-text-cache.js"
import {
  buildProjectLens,
  queueReviewItem,
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
  const dataRoot = process.env.DATA_ROOT
    ? path.resolve(process.env.DATA_ROOT)
    : path.join(workspaceRoot, "data")
  return {
    workspaceRoot,
    dataRoot,
    projectsRoot: path.join(dataRoot, "projects"),
    publicRoot: path.join(workspaceRoot, "web"),
    settingsPath: path.join(dataRoot, "settings.json"),
    tasksPath: path.join(dataRoot, "tasks.json"),
    port: Number(process.env.PORT || 4000),
    host: process.env.HOST || "127.0.0.1",
  }
}

export function createAppServices(runtime) {
  const projectFs = createProjectFs(runtime.projectsRoot)
  const projectLockService = createProjectLockService()
  const documentExtractor = createDocumentExtractor()
  const settingsService = createSettingsService({ settingsPath: runtime.settingsPath, fs: projectFs })
  const taskService = createTaskService({ tasksPath: runtime.tasksPath, fs: projectFs })
  const projectService = createProjectService({ projectFs })
  const importHistoryService = createImportHistoryService({ projectService })
  const conversationService = createConversationService({ projectFs, projectService })
  const ingestCacheService = createIngestCacheService({ projectService, projectFs })
  const sourceTextCacheService = createSourceTextCacheService({ projectFs, projectService, documentExtractor })
  const llmService = createLlmService({ loadSettings: settingsService.loadSettings })
  const sourceManagerService = createSourceManagerService({ projectFs, projectService, sourceTextCacheService, ingestCacheService })

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
    queueReviewItem: (projectId, payload) => queueReviewItem(projectId, payload, reviewLensDeps),
    resolveReviewItem: (projectId, key) => resolveReviewItem(projectId, key, reviewLensDeps),
    reopenReviewItem: (projectId, key) => reopenReviewItem(projectId, key, reviewLensDeps),
  }

  const ingestService = createIngestService({
    loadSettings: settingsService.loadSettings,
    callChatModel: llmService.callChatModel,
    documentExtractor,
    ingestCacheService,
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

  function normalizeSourcePath(sourcePath) {
    const normalized = String(sourcePath || "").trim().replace(/\\/g, "/").replace(/^\/+/, "")
    if (!normalized) return ""
    return normalized.startsWith("raw/") ? normalized : `raw/sources/${normalized}`
  }

  async function findImportBatchForSource(projectId, sourcePath) {
    const normalizedSourcePath = normalizeSourcePath(sourcePath)
    if (!normalizedSourcePath) return null
    const batches = await importHistoryService.loadImportHistory(projectId)
    return batches.find((batch) =>
      Array.isArray(batch?.sourcePaths)
      && batch.sourcePaths.some((item) => normalizeSourcePath(item) === normalizedSourcePath)
    ) || null
  }

  async function collectRemainingBatchSourcePaths(projectId, batch) {
    const requestedPaths = [...new Set(
      (Array.isArray(batch?.sourcePaths) ? batch.sourcePaths : [])
        .map(normalizeSourcePath)
        .filter(Boolean),
    )]
    if (requestedPaths.length === 0) return []

    const rawSourcesRoot = projectService.ensureInsideProject(projectId, "raw/sources").fullPath
    const existingSourcePaths = new Set()
    if (await projectFs.exists(rawSourcesRoot)) {
      const rawFiles = await projectFs.collectFiles(rawSourcesRoot)
      for (const file of rawFiles) {
        existingSourcePaths.add(normalizeSourcePath(`raw/sources/${file.path}`))
      }
    }

    const knowledge = await wikiService.buildKnowledgeView(projectId)
    const completedSourcePaths = new Set()
    const completedSourceNames = new Set()
    for (const item of knowledge.sections.sources || []) {
      const itemSourcePath = normalizeSourcePath(item?.sourcePath || "")
      if (itemSourcePath) completedSourcePaths.add(itemSourcePath)
      for (const sourceFile of Array.isArray(item?.sourceFiles) ? item.sourceFiles : []) {
        const fileName = path.basename(String(sourceFile || "").trim())
        if (fileName) completedSourceNames.add(fileName)
      }
    }

    return requestedPaths.filter((candidatePath) => {
      if (!existingSourcePaths.has(candidatePath)) return false
      if (completedSourcePaths.has(candidatePath)) return false
      const fileName = path.basename(candidatePath)
      if (completedSourceNames.has(fileName)) return false
      return true
    })
  }

  async function startIngestTask(projectId, options = {}) {
    await taskService.loadTaskStore()
    const requestedSourcePaths = Array.isArray(options.sourcePaths)
      ? options.sourcePaths.map((item) => String(item || "").trim()).filter(Boolean)
      : []
    const isBatchScoped = requestedSourcePaths.length > 0
    const normalizedRequestedPaths = [...new Set(requestedSourcePaths)].sort()
    const existingTask = taskService.findProjectTask(projectId, (task) => {
      if (!["queued", "running"].includes(task.status)) return false
      const taskPaths = [...new Set(Array.isArray(task.sourcePaths) ? task.sourcePaths.filter(Boolean) : [])].sort()
      if (isBatchScoped) {
        return task.type === "ingest-batch" && JSON.stringify(taskPaths) === JSON.stringify(normalizedRequestedPaths)
      }
      return task.type === "ingest"
    })
    if (existingTask) {
      return existingTask
    }
    const task = taskService.createTask(projectId, isBatchScoped ? "ingest-batch" : "ingest")
    if (options.batchId) {
      taskService.updateTask(task.id, { batchId: options.batchId, sourcePaths: normalizedRequestedPaths })
    } else if (isBatchScoped) {
      taskService.updateTask(task.id, { sourcePaths: normalizedRequestedPaths })
    }
    await taskService.persistTaskStore()

    void (async () => {
      try {
        if (projectLockService.hasActiveLock(projectId)) {
          taskService.updateTask(task.id, {
            status: "queued",
            stage: "queued",
            message: "当前项目已有提取任务在运行，等待上一个任务完成...",
            error: null,
          })
          await taskService.persistTaskStore()
        }
        const result = await projectLockService.withProjectLock(projectId, async () =>
          ingestService.ingestProjectWithProgress(projectId, async (progress) => {
            taskService.updateTask(task.id, {
              status: "running",
              stage: progress.stage,
              message: progress.message,
              file: progress.file || null,
              error: null,
            })
            await taskService.persistTaskStore()
          }, { sourcePaths: normalizedRequestedPaths }),
        )
        taskService.updateTask(task.id, {
          status: "done",
          stage: "done",
          message: isBatchScoped
            ? `已提取本批 ${result.ingested.length} 个源文件，跳过 ${result.skipped.length} 个。`
            : `已提取 ${result.ingested.length} 个源文件，跳过 ${result.skipped.length} 个。`,
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
        if (projectLockService.hasActiveLock(projectId)) {
          taskService.updateTask(task.id, {
            status: "queued",
            stage: "queued",
            message: "当前项目已有提取任务在运行，等待上一个任务完成...",
            error: null,
          })
          await taskService.persistTaskStore()
        }
        const result = await projectLockService.withProjectLock(projectId, async () =>
          ingestService.reingestSourceWithProgress(projectId, sourcePath, async (progress) => {
            taskService.updateTask(task.id, {
              status: "running",
              stage: progress.stage,
              message: progress.message,
              file: progress.file || sourcePath,
              error: null,
            })
            await taskService.persistTaskStore()
          }),
        )
        const batch = await findImportBatchForSource(projectId, sourcePath)
        let resumedTask = null
        if (batch) {
          const remainingSourcePaths = await collectRemainingBatchSourcePaths(projectId, batch)
          if (remainingSourcePaths.length > 0) {
            resumedTask = await startIngestTask(projectId, {
              batchId: batch.id,
              sourcePaths: remainingSourcePaths,
            })
          }
        }
        taskService.updateTask(task.id, {
          status: "done",
          stage: "done",
          message: resumedTask
            ? `已重新提取 ${sourcePath}，并继续本批剩余 ${Array.isArray(resumedTask.sourcePaths) ? resumedTask.sourcePaths.length : 0} 个文件。`
            : `已重新提取 ${sourcePath}`,
          result: resumedTask
            ? {
              ...result,
              resumedTaskId: resumedTask.id,
              resumedSourcePaths: Array.isArray(resumedTask.sourcePaths) ? resumedTask.sourcePaths : [],
            }
            : result,
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
    projectLockService,
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
