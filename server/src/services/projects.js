import path from "node:path"
import {
  makeSafeSlug,
} from "../lib/text.js"
import {
  PROJECT_DIRS,
  DEFAULT_SCHEMA,
  DEFAULT_PURPOSE,
  DEFAULT_INDEX,
  DEFAULT_OVERVIEW,
  buildLog,
} from "../../../shared/project-templates.js"

export function createProjectService({ projectFs }) {
  const {
    projectsRoot,
    projectRootFor,
    ensureInsideProject,
    exists,
    buildTree,
    mkdir,
    readFile,
    rm,
    writeFile,
    readdir,
  } = projectFs

  function hasHiddenSegment(relativePath) {
    return String(relativePath || "")
      .replace(/^raw\/sources\//, "")
      .split("/")
      .some((segment) => segment.startsWith("."))
  }

  async function updateProjectTimestamp(projectId) {
    const metadataPath = path.join(projectRootFor(projectId), ".llm-wiki/project.json")
    try {
      const metadata = JSON.parse(await readFile(metadataPath, "utf8"))
      metadata.updatedAt = new Date().toISOString()
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8")
    } catch {
      // Best-effort only.
    }
  }

  async function readProjectFile(projectId, relativePath) {
    const { fullPath, normalized } = ensureInsideProject(projectId, relativePath)
    const contents = await readFile(fullPath, "utf8")
    return { path: normalized, contents }
  }

  async function resolveProjectFile(projectId, relativePath) {
    const { fullPath, normalized } = ensureInsideProject(projectId, relativePath)
    return { fullPath, path: normalized }
  }

  async function writeProjectFile(projectId, relativePath, contents) {
    const { fullPath, normalized } = ensureInsideProject(projectId, relativePath)
    await mkdir(path.dirname(fullPath), { recursive: true })
    await writeFile(fullPath, contents, "utf8")
    await updateProjectTimestamp(projectId)
    return { ok: true, path: normalized }
  }

  async function uploadProjectFiles(projectId, files) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error("No files provided")
    }
    const uploaded = []
    const skippedHidden = []
    for (const file of files) {
      const relativePath = String(file.path || "").trim()
      if (!relativePath) continue
      if (hasHiddenSegment(relativePath)) {
        skippedHidden.push(relativePath)
        continue
      }
      const base64 = String(file.base64 || "")
      const targetPath = relativePath.startsWith("raw/")
        ? relativePath
        : `raw/sources/${relativePath}`
      const { fullPath, normalized } = ensureInsideProject(projectId, targetPath)
      await mkdir(path.dirname(fullPath), { recursive: true })
      await writeFile(fullPath, Buffer.from(base64, "base64"))
      uploaded.push(normalized)
    }

    await updateProjectTimestamp(projectId)
    return { ok: true, uploaded, skippedHidden }
  }

  async function listProjects() {
    await mkdir(projectsRoot, { recursive: true })
    const entries = await readdir(projectsRoot, { withFileTypes: true })
    const projects = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const root = path.join(projectsRoot, entry.name)
      const metadataPath = path.join(root, ".llm-wiki/project.json")
      let metadata = null
      try {
        metadata = JSON.parse(await readFile(metadataPath, "utf8"))
      } catch {
        metadata = null
      }
      if (!metadata) continue
      projects.push(metadata)
    }
    projects.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    return projects
  }

  async function createProject(body) {
    const name = String(body.name || "").trim()
    if (!name) throw new Error("项目名称不能为空")
    const slug = body.slug ? makeSafeSlug(body.slug, "project") : makeSafeSlug(name, "project")
    const projectRoot = projectRootFor(slug)
    if (await exists(projectRoot)) {
      throw new Error(`项目已存在：${slug}`)
    }

    for (const dir of PROJECT_DIRS) {
      await mkdir(path.join(projectRoot, dir), { recursive: true })
    }

    const date = new Date().toISOString().slice(0, 10)
    const metadata = {
      id: slug,
      name,
      rootPath: projectRoot,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await writeFile(path.join(projectRoot, "schema.md"), body.schema || DEFAULT_SCHEMA, "utf8")
    await writeFile(path.join(projectRoot, "purpose.md"), body.purpose || DEFAULT_PURPOSE, "utf8")
    await writeFile(path.join(projectRoot, "wiki/index.md"), DEFAULT_INDEX, "utf8")
    await writeFile(path.join(projectRoot, "wiki/log.md"), buildLog(date), "utf8")
    await writeFile(path.join(projectRoot, "wiki/overview.md"), DEFAULT_OVERVIEW, "utf8")
    await writeFile(path.join(projectRoot, ".llm-wiki/project.json"), JSON.stringify(metadata, null, 2), "utf8")
    await writeFile(path.join(projectRoot, ".llm-wiki/review.json"), "[]\n", "utf8")
    await writeFile(path.join(projectRoot, ".llm-wiki/conversations.json"), "[]\n", "utf8")
    await writeFile(path.join(projectRoot, ".llm-wiki/import-history.json"), "[]\n", "utf8")

    return metadata
  }

  async function deleteProject(projectId) {
    const projectRoot = projectRootFor(projectId)
    if (!(await exists(projectRoot))) {
      throw new Error(`项目不存在：${projectId}`)
    }
    await rm(projectRoot, { recursive: true, force: true })
    return { ok: true, projectId }
  }

  return {
    ensureInsideProject,
    exists,
    buildTree,
    readProjectFile,
    resolveProjectFile,
    writeProjectFile,
    uploadProjectFiles,
    listProjects,
    createProject,
    deleteProject,
    updateProjectTimestamp,
  }
}
