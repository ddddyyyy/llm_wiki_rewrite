function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function formatImportTime(value) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function renderSourcesWorkspace({
  els,
  state,
  onOpenFile,
  onRunBatchIngest,
  onDiscardBatchPending,
  onRemovePendingSource,
}) {
  const tasks = state.tasks || []
  const running = tasks.filter((task) => task.status === "running" || task.status === "queued").length
  const done = tasks.filter((task) => task.status === "done").length
  const error = tasks.filter((task) => task.status === "error").length
  els.sourcesSummaryTotal.textContent = String(tasks.length)
  els.sourcesSummaryRunning.textContent = String(running)
  els.sourcesSummaryDone.textContent = String(done)
  els.sourcesSummaryError.textContent = String(error)

  const batches = state.importHistory || []
  els.sourcesImportHistory.innerHTML = ""
  if (batches.length === 0) {
    els.sourcesImportHistory.innerHTML = `<p class="empty">还没有导入记录。你可以直接上传文件，或者一次导入整个文件夹。</p>`
    return
  }

  for (const batch of batches.slice(0, 1)) {
    const article = document.createElement("article")
    article.className = "import-batch-card"
    const roots = Array.isArray(batch.roots) && batch.roots.length > 0
      ? batch.roots.join("、")
      : "未命名批次"
    const items = Array.isArray(batch.items) ? batch.items.slice(0, 4) : []
    const pendingSourcePaths = (Array.isArray(batch.sourcePaths) ? batch.sourcePaths : []).filter((sourcePath) => {
      const pendingItems = state.lens?.reviewItems || []
      return pendingItems.some((item) => item.kind === "missing-source-page" && item.path === sourcePath)
    })
    article.innerHTML = `
      <div class="import-batch-head">
        <div>
          <strong>${escapeHtml(batch.kind === "folder" ? "文件夹导入" : "文件导入")}</strong>
          <div class="item-meta">${escapeHtml(formatImportTime(batch.createdAt))}</div>
        </div>
        <span class="import-batch-count">${escapeHtml(batch.totalFiles || 0)} 个文件</span>
      </div>
      <div class="import-batch-roots">${escapeHtml(roots)}</div>
      <div class="item-meta">待处理：${escapeHtml(pendingSourcePaths.length)} 个文件</div>
      <div class="import-batch-items">
        ${items.map((item) => `<button type="button" class="import-batch-item">${escapeHtml(item)}</button>`).join("")}
      </div>
      <div class="import-batch-actions">
        <button type="button" class="mini-button import-batch-run"${pendingSourcePaths.length === 0 ? " disabled" : ""}>只提取本批</button>
        <button type="button" class="mini-button import-batch-discard"${pendingSourcePaths.length === 0 ? " disabled" : ""}>取消本批待处理</button>
      </div>
    `
    items.forEach((item, index) => {
      article.querySelectorAll(".import-batch-item")[index]?.addEventListener("click", () => {
        const targetPath = item.startsWith("raw/") ? item : `raw/sources/${item}`
        void onOpenFile(targetPath)
      })
    })
    article.querySelector(".import-batch-run")?.addEventListener("click", () => {
      if (pendingSourcePaths.length === 0) return
      void onRunBatchIngest?.(batch, pendingSourcePaths)
    })
    article.querySelector(".import-batch-discard")?.addEventListener("click", () => {
      if (pendingSourcePaths.length === 0) return
      void onDiscardBatchPending?.(batch, pendingSourcePaths)
    })
    els.sourcesImportHistory.appendChild(article)
  }

  const pendingItems = (state.lens?.reviewItems || []).filter((item) => item.kind === "missing-source-page")
  els.sourcesPendingList.innerHTML = ""
  if (pendingItems.length === 0) {
    els.sourcesPendingList.innerHTML = `<p class="empty">当前没有待处理来源文件。</p>`
    return
  }

  for (const item of pendingItems.slice(0, 8)) {
    const row = document.createElement("div")
    row.className = "sources-pending-item"
    row.innerHTML = `
      <button type="button" class="sources-pending-open">${escapeHtml(item.title || item.path)}</button>
      <button type="button" class="mini-button sources-pending-remove">移除</button>
    `
    row.querySelector(".sources-pending-open")?.addEventListener("click", () => void onOpenFile?.(item.path))
    row.querySelector(".sources-pending-remove")?.addEventListener("click", () => void onRemovePendingSource?.(item.path))
    els.sourcesPendingList.appendChild(row)
  }
}
