function summarizeUploadBatch(files, uploaded) {
  const originalPaths = (Array.isArray(files) ? files : [])
    .map((file) => String(file?.path || "").replace(/^\/+/, "").trim())
    .filter(Boolean)

  const kind = originalPaths.some((item) => item.includes("/")) ? "folder" : "files"
  const roots = [...new Set(
    originalPaths.map((item) => item.includes("/") ? item.split("/")[0] : item)
  )]

  return {
    id: `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    createdAt: new Date().toISOString(),
    totalFiles: uploaded.length,
    roots,
    items: originalPaths.slice(0, 12),
    sourcePaths: uploaded.slice(),
  }
}

function normalizeBatch(batch) {
  const items = Array.isArray(batch?.items) ? batch.items.filter(Boolean) : []
  const sourcePaths = Array.isArray(batch?.sourcePaths) && batch.sourcePaths.length > 0
    ? batch.sourcePaths.filter(Boolean)
    : items.map((item) => item.startsWith("raw/") ? item : `raw/sources/${item}`)
  return {
    id: batch?.id || `import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind: batch?.kind || "files",
    createdAt: batch?.createdAt || new Date().toISOString(),
    totalFiles: Number(batch?.totalFiles || sourcePaths.length || items.length || 0),
    roots: Array.isArray(batch?.roots) ? batch.roots.filter(Boolean) : [],
    items,
    sourcePaths,
  }
}

function batchSignature(batch) {
  const sourcePaths = Array.isArray(batch?.sourcePaths) ? batch.sourcePaths.filter(Boolean) : []
  const items = Array.isArray(batch?.items) ? batch.items.filter(Boolean) : []
  const kind = String(batch?.kind || "files")
  return JSON.stringify({
    kind,
    sourcePaths: [...new Set(sourcePaths)].sort(),
    items: [...new Set(items)].sort(),
  })
}

export function createImportHistoryService({ projectService }) {
  async function loadImportHistory(projectId) {
    try {
      const { contents } = await projectService.readProjectFile(projectId, ".llm-wiki/import-history.json")
      const parsed = JSON.parse(contents)
      return Array.isArray(parsed) ? parsed.map(normalizeBatch) : []
    } catch {
      return []
    }
  }

  async function saveImportHistory(projectId, history) {
    await projectService.writeProjectFile(
      projectId,
      ".llm-wiki/import-history.json",
      `${JSON.stringify(history, null, 2)}\n`,
    )
  }

  async function recordImportBatch(projectId, files, uploaded) {
    const batch = summarizeUploadBatch(files, uploaded)
    const current = await loadImportHistory(projectId)
    const signature = batchSignature(batch)
    const deduped = current.filter((entry) => batchSignature(entry) !== signature)
    const next = [batch, ...deduped].slice(0, 12)
    await saveImportHistory(projectId, next)
    return normalizeBatch(batch)
  }

  return {
    loadImportHistory,
    recordImportBatch,
  }
}
