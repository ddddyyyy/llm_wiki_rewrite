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

function slugifySourceStem(relativePath) {
  return String(relativePath || "")
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || ""
}

function collectFilePaths(nodes, into = new Set()) {
  for (const node of nodes || []) {
    if (!node) continue
    if (node.isDir) {
      collectFilePaths(node.children || [], into)
    } else if (node.path) {
      into.add(node.path)
    }
  }
  return into
}

function summarizeBatchStatus(sourcePaths, treeFilePaths, sourcePagePaths) {
  const allPaths = (Array.isArray(sourcePaths) ? sourcePaths : []).filter(Boolean)
  let pending = 0
  let completed = 0
  let canceled = 0

  for (const sourcePath of allPaths) {
    const expectedSourcePagePath = `wiki/sources/${slugifySourceStem(sourcePath)}.md`
    if (sourcePagePaths.has(expectedSourcePagePath)) {
      completed += 1
    } else if (treeFilePaths.has(sourcePath)) {
      pending += 1
    } else {
      canceled += 1
    }
  }

  let label = "待处理"
  if (allPaths.length === 0) {
    label = "空批次"
  } else if (completed === allPaths.length) {
    label = "已完成"
  } else if (canceled === allPaths.length) {
    label = "已取消"
  } else if (pending === allPaths.length) {
    label = "待处理"
  } else {
    label = "部分完成"
  }

  return {
    total: allPaths.length,
    pending,
    completed,
    canceled,
    label,
  }
}

export function renderSourcesWorkspace({
  els,
  state,
  onOpenFile,
  onRunBatchIngest,
  onDiscardBatchPending,
  onChangeBatchIndex,
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
  const batchIndex = Math.min(Math.max(state.sourcesBatchIndex || 0, 0), Math.max(batches.length - 1, 0))
  const treeFilePaths = collectFilePaths(state.treeNodes || [])
  const sourcePagePaths = new Set((state.knowledge?.sections?.sources || []).map((item) => item.path))

  els.sourcesImportHistory.innerHTML = ""
  if (batches.length === 0) {
    els.sourcesBatchIndicator.textContent = "0 / 0"
    els.sourcesBatchPrev.disabled = true
    els.sourcesBatchNext.disabled = true
    els.sourcesBatchRun.disabled = true
    els.sourcesBatchDiscard.disabled = true
    els.sourcesImportHistory.innerHTML = `<p class="empty">还没有导入记录。你可以直接上传文件，或者一次导入整个文件夹。</p>`
  } else {
    els.sourcesBatchIndicator.textContent = `${batchIndex + 1} / ${batches.length}`
    els.sourcesBatchPrev.disabled = batchIndex <= 0
    els.sourcesBatchNext.disabled = batchIndex >= batches.length - 1
    els.sourcesBatchPrev.onclick = () => void onChangeBatchIndex?.("prev")
    els.sourcesBatchNext.onclick = () => void onChangeBatchIndex?.("next")

    const batch = batches[batchIndex]
    const article = document.createElement("article")
    article.className = "import-batch-card"
    const roots = Array.isArray(batch.roots) && batch.roots.length > 0
      ? batch.roots.join("、")
      : "未命名批次"
    const items = Array.isArray(batch.items) ? batch.items.slice(0, 4) : []
    const pendingSourcePaths = (Array.isArray(batch.sourcePaths) ? batch.sourcePaths : []).filter((sourcePath) => {
      if (!treeFilePaths.has(sourcePath)) return false
      const expectedSourcePagePath = `wiki/sources/${slugifySourceStem(sourcePath)}.md`
      return !sourcePagePaths.has(expectedSourcePagePath)
    })
    const batchStatus = summarizeBatchStatus(batch.sourcePaths, treeFilePaths, sourcePagePaths)
    els.sourcesBatchRun.disabled = pendingSourcePaths.length === 0
    els.sourcesBatchDiscard.disabled = pendingSourcePaths.length === 0
    els.sourcesBatchRun.onclick = () => {
      if (pendingSourcePaths.length === 0) return
      void onRunBatchIngest?.(batch, pendingSourcePaths)
    }
    els.sourcesBatchDiscard.onclick = () => {
      if (pendingSourcePaths.length === 0) return
      void onDiscardBatchPending?.(batch, pendingSourcePaths)
    }
    article.innerHTML = `
      <div class="import-batch-head">
        <div>
          <strong>${escapeHtml(batch.kind === "folder" ? "文件夹导入" : "文件导入")}</strong>
          <div class="item-meta">${escapeHtml(formatImportTime(batch.createdAt))}</div>
        </div>
        <span class="import-batch-count">${escapeHtml(batch.totalFiles || 0)} 个文件</span>
      </div>
      <div class="import-batch-roots">${escapeHtml(roots)}</div>
      <div class="import-batch-status-row">
        <span class="import-batch-status-badge">${escapeHtml(batchStatus.label)}</span>
        <span class="item-meta">
          待处理 ${escapeHtml(batchStatus.pending)} · 已完成 ${escapeHtml(batchStatus.completed)} · 已取消 ${escapeHtml(batchStatus.canceled)}
        </span>
      </div>
      <div class="import-batch-items">
        ${items.map((item) => `<button type="button" class="import-batch-item">${escapeHtml(item)}</button>`).join("")}
      </div>
    `
    items.forEach((item, index) => {
      article.querySelectorAll(".import-batch-item")[index]?.addEventListener("click", () => {
        const targetPath = item.startsWith("raw/") ? item : `raw/sources/${item}`
        void onOpenFile(targetPath)
      })
    })
    els.sourcesImportHistory.appendChild(article)
  }
}
