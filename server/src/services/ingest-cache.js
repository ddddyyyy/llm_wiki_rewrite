import { createHash } from "node:crypto"

function hashContent(content) {
  return createHash("sha256").update(String(content || ""), "utf8").digest("hex")
}

function normalizeStoredEntry(sourcePath, entry = {}) {
  return {
    hash: String(entry.hash || ""),
    timestamp: Number(entry.timestamp || Date.now()),
    sourcePath: String(entry.sourcePath || sourcePath || ""),
    filesWritten: Array.isArray(entry.filesWritten) ? entry.filesWritten.filter(Boolean) : [],
    reviewItems: Array.isArray(entry.reviewItems) ? entry.reviewItems : [],
    warnings: Array.isArray(entry.warnings) ? entry.warnings : [],
  }
}

export function createIngestCacheService({ projectService, projectFs }) {
  const { readProjectFile, writeProjectFile } = projectService
  const { exists, ensureInsideProject } = projectFs
  const cacheFilePath = ".llm-wiki/ingest-cache.json"

  async function loadCache(projectId) {
    try {
      const { contents } = await readProjectFile(projectId, cacheFilePath)
      const parsed = JSON.parse(contents)
      const entries = parsed && typeof parsed.entries === "object" ? parsed.entries : {}
      return {
        entries: Object.fromEntries(
          Object.entries(entries).map(([sourcePath, entry]) => [sourcePath, normalizeStoredEntry(sourcePath, entry)]),
        ),
      }
    } catch {
      return { entries: {} }
    }
  }

  async function saveCache(projectId, cache) {
    await writeProjectFile(projectId, cacheFilePath, `${JSON.stringify(cache, null, 2)}\n`)
  }

  async function checkIngestCache(projectId, sourcePath, sourceContent) {
    const normalizedSourcePath = String(sourcePath || "").trim()
    if (!normalizedSourcePath) return null
    const cache = await loadCache(projectId)
    const entry = cache.entries[normalizedSourcePath]
    if (!entry) return null
    if (entry.hash !== hashContent(sourceContent)) return null

    for (const filePath of entry.filesWritten) {
      const resolved = ensureInsideProject(projectId, filePath)
      if (!(await exists(resolved.fullPath))) {
        return null
      }
    }

    return entry
  }

  async function saveIngestCache(projectId, sourcePath, sourceContent, payload = {}) {
    const normalizedSourcePath = String(sourcePath || "").trim()
    if (!normalizedSourcePath) return
    const cache = await loadCache(projectId)
    cache.entries[normalizedSourcePath] = normalizeStoredEntry(normalizedSourcePath, {
      ...payload,
      sourcePath: normalizedSourcePath,
      hash: hashContent(sourceContent),
      timestamp: Date.now(),
    })
    await saveCache(projectId, cache)
  }

  async function removeFromIngestCache(projectId, sourcePath) {
    const normalizedSourcePath = String(sourcePath || "").trim()
    if (!normalizedSourcePath) return
    const cache = await loadCache(projectId)
    if (!cache.entries[normalizedSourcePath]) return
    delete cache.entries[normalizedSourcePath]
    await saveCache(projectId, cache)
  }

  return {
    checkIngestCache,
    saveIngestCache,
    removeFromIngestCache,
  }
}
