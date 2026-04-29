import path from "node:path"

export function createSourceTextCacheService({
  projectFs,
  projectService,
  documentExtractor,
}) {
  const {
    ensureInsideProject,
    exists,
    mkdir,
    readFile,
    rm,
    stat,
    writeFile,
  } = projectFs
  const { updateProjectTimestamp } = projectService

  function isSourcePath(relativePath) {
    return String(relativePath || "").startsWith("raw/sources/")
  }

  function cachePathForSource(relativePath) {
    const normalized = String(relativePath || "").replace(/^raw\/sources\//, "")
    return `.llm-wiki/source-text-cache/${normalized}.txt`
  }

  async function loadCachedText(projectId, sourcePath) {
    if (!isSourcePath(sourcePath)) return null
    const sourceResolved = ensureInsideProject(projectId, sourcePath)
    const cacheResolved = ensureInsideProject(projectId, cachePathForSource(sourcePath))
    if (!(await exists(cacheResolved.fullPath))) return null

    const [sourceStats, cacheStats] = await Promise.all([
      stat(sourceResolved.fullPath).catch(() => null),
      stat(cacheResolved.fullPath).catch(() => null),
    ])
    if (!sourceStats || !cacheStats) return null
    if (cacheStats.mtimeMs < sourceStats.mtimeMs) return null

    const text = await readFile(cacheResolved.fullPath, "utf8")
    return {
      path: cacheResolved.normalized,
      text: String(text || ""),
    }
  }

  async function saveCachedText(projectId, sourcePath, text) {
    if (!isSourcePath(sourcePath)) return null
    const cacheResolved = ensureInsideProject(projectId, cachePathForSource(sourcePath))
    await mkdir(path.dirname(cacheResolved.fullPath), { recursive: true })
    await writeFile(cacheResolved.fullPath, String(text || ""), "utf8")
    await updateProjectTimestamp(projectId)
    return {
      ok: true,
      path: cacheResolved.normalized,
    }
  }

  async function ensureCachedText(projectId, sourcePath) {
    const cached = await loadCachedText(projectId, sourcePath)
    if (cached?.text?.trim()) return cached
    if (!documentExtractor) return null

    const sourceResolved = ensureInsideProject(projectId, sourcePath)
    const { text } = await documentExtractor.extractText(sourceResolved.fullPath)
    if (!String(text || "").trim()) return null
    await saveCachedText(projectId, sourcePath, text)
    return loadCachedText(projectId, sourcePath)
  }

  async function deleteCachedText(projectId, sourcePath) {
    if (!isSourcePath(sourcePath)) return
    const cacheResolved = ensureInsideProject(projectId, cachePathForSource(sourcePath))
    await rm(cacheResolved.fullPath, { force: true })
  }

  return {
    cachePathForSource,
    loadCachedText,
    saveCachedText,
    ensureCachedText,
    deleteCachedText,
  }
}
