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
  }
}

export function createImportHistoryService({ projectService }) {
  async function loadImportHistory(projectId) {
    try {
      const { contents } = await projectService.readProjectFile(projectId, ".llm-wiki/import-history.json")
      const parsed = JSON.parse(contents)
      return Array.isArray(parsed) ? parsed : []
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
    const next = [batch, ...current].slice(0, 12)
    await saveImportHistory(projectId, next)
    return batch
  }

  return {
    loadImportHistory,
    recordImportBatch,
  }
}
