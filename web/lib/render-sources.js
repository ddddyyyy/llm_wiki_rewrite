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

function formatTaskStage(value) {
  const mapping = {
    queued: "排队中",
    scanning: "扫描中",
    reading: "读取中",
    analyzing: "分析中",
    generating: "生成中",
    writing: "写入中",
    finalizing: "收尾中",
    done: "已完成",
    failed: "失败",
  }
  return mapping[value] || value || ""
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

function fileNameFromPath(value) {
  return String(value || "").split("/").pop() || ""
}

function isSourceCompleted(sourcePath, sourcePageSourcePaths, sourcePageSourceNames) {
  return sourcePageSourcePaths.has(sourcePath) || sourcePageSourceNames.has(fileNameFromPath(sourcePath))
}

function summarizeBatchStatus(sourcePaths, treeFilePaths, sourcePageSourcePaths, sourcePageSourceNames) {
  const allPaths = (Array.isArray(sourcePaths) ? sourcePaths : []).filter(Boolean)
  let pending = 0
  let completed = 0
  let canceled = 0

  for (const sourcePath of allPaths) {
    if (isSourceCompleted(sourcePath, sourcePageSourcePaths, sourcePageSourceNames)) {
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

function statusTone(status) {
  switch (status) {
    case "running":
      return "is-running"
    case "queued":
      return "is-queued"
    case "done":
      return "is-done"
    case "error":
      return "is-error"
    case "canceled":
      return "is-canceled"
    default:
      return ""
  }
}

function findLatestRelevantTask(tasks, sourcePath) {
  const allTasks = Array.isArray(tasks) ? tasks : []
  return allTasks.find((task) => {
    if (!task) return false
    if (String(task.sourcePath || "") === sourcePath) return true
    if (Array.isArray(task.sourcePaths) && task.sourcePaths.includes(sourcePath)) return true
    return false
  }) || null
}

function findActiveProjectIngestTask(tasks) {
  const allTasks = Array.isArray(tasks) ? tasks : []
  return allTasks.find((task) => {
    if (!task || !["queued", "running"].includes(task.status)) return false
    return task.type === "ingest" || task.type === "ingest-batch"
  }) || null
}

function findLatestBatchTask(tasks, batchId) {
  if (!batchId) return null
  const allTasks = Array.isArray(tasks) ? tasks : []
  return allTasks.find((task) => task?.batchId === batchId) || null
}

function normalizeSourceTaskPath(value) {
  const path = String(value || "").trim().replace(/^\/+/, "")
  if (!path) return ""
  return path.startsWith("raw/sources/") ? path : `raw/sources/${path}`
}

function summarizeSourceItemState(sourcePath, batchStatus, treeFilePaths, sourcePageSourcePaths, sourcePageSourceNames, task) {
  if (!treeFilePaths.has(sourcePath)) {
    return { label: "已取消", tone: "canceled", canReingest: false }
  }
  if (task?.status === "running") {
    if (normalizeSourceTaskPath(task.file) === sourcePath) {
      return { label: "提取中", tone: "running", canReingest: false }
    }
    if (Array.isArray(task.sourcePaths) && task.sourcePaths.includes(sourcePath)) {
      return { label: "等待本批", tone: "queued", canReingest: false }
    }
  }
  if (task?.status === "queued") {
    return { label: "排队中", tone: "queued", canReingest: false }
  }
  if (task?.status === "error" && (normalizeSourceTaskPath(task.file) === sourcePath || normalizeSourceTaskPath(task.sourcePath) === sourcePath)) {
    return { label: "提取失败", tone: "error", canReingest: false }
  }
  if (isSourceCompleted(sourcePath, sourcePageSourcePaths, sourcePageSourceNames)) {
    return { label: "已完成", tone: "done", canReingest: true }
  }
  if (batchStatus.label === "已取消") {
    return { label: "已取消", tone: "canceled", canReingest: false }
  }
  return { label: "待处理", tone: "queued", canReingest: true }
}

export function renderSourcesWorkspace({
  els,
  state,
  onPreviewFile,
  onReingestSource,
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
  const sourcePageSourcePaths = new Set()
  const sourcePageSourceNames = new Set()
  for (const item of state.knowledge?.sections?.sources || []) {
    const sourcePath = String(item.sourcePath || "").trim()
    if (sourcePath) {
      sourcePageSourcePaths.add(sourcePath)
      sourcePageSourceNames.add(fileNameFromPath(sourcePath))
    }
    for (const sourceFile of Array.isArray(item.sourceFiles) ? item.sourceFiles : []) {
      const sourceName = fileNameFromPath(sourceFile)
      if (sourceName) sourcePageSourceNames.add(sourceName)
    }
  }
  const activeIngestTask = findActiveProjectIngestTask(tasks)

  els.sourcesImportHistory.innerHTML = ""
  if (batches.length === 0) {
    els.sourcesBatchIndicator.textContent = "0 / 0"
    els.sourcesBatchPrev.disabled = true
    els.sourcesBatchNext.disabled = true
    els.sourcesBatchRun.hidden = true
    els.sourcesBatchDiscard.hidden = true
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
    const items = Array.isArray(batch.items) ? batch.items : []
    const batchSourcePaths = Array.isArray(batch.sourcePaths) ? batch.sourcePaths : []
    const pendingSourcePaths = batchSourcePaths.filter((sourcePath) => {
      if (!treeFilePaths.has(sourcePath)) return false
      return !isSourceCompleted(sourcePath, sourcePageSourcePaths, sourcePageSourceNames)
    })
    const batchStatus = summarizeBatchStatus(batchSourcePaths, treeFilePaths, sourcePageSourcePaths, sourcePageSourceNames)
    const batchTask = findLatestBatchTask(tasks, batch.id)
    const activeBatchTask = batchTask && ["queued", "running"].includes(batchTask.status) ? batchTask : null
    const shouldReflectGenericIngest = !activeBatchTask && activeIngestTask?.type === "ingest" && pendingSourcePaths.length > 0
    const canShowBatchActions = Boolean(batchTask?.status === "error" && pendingSourcePaths.length > 0)
    const effectiveBatchStatus = shouldReflectGenericIngest
      ? {
          ...batchStatus,
          label: activeIngestTask?.status === "running" ? "提取中" : "排队中",
        }
      : activeBatchTask
        ? {
            ...batchStatus,
            label: activeBatchTask.status === "running" ? "提取中" : "排队中",
          }
        : batchStatus
    els.sourcesBatchRun.hidden = !canShowBatchActions
    els.sourcesBatchDiscard.hidden = !canShowBatchActions
    els.sourcesBatchRun.disabled = !canShowBatchActions
    els.sourcesBatchDiscard.disabled = !canShowBatchActions
    els.sourcesBatchRun.onclick = () => {
      if (!canShowBatchActions) return
      void onRunBatchIngest?.(batch, pendingSourcePaths)
    }
    els.sourcesBatchDiscard.onclick = () => {
      if (!canShowBatchActions) return
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
        <span class="import-batch-status-badge">${escapeHtml(effectiveBatchStatus.label)}</span>
        <span class="item-meta">
          待处理 ${escapeHtml(batchStatus.pending)} · 已完成 ${escapeHtml(batchStatus.completed)} · 已取消 ${escapeHtml(batchStatus.canceled)}
        </span>
      </div>
      <div class="import-batch-items">
        ${items.map((item) => {
          const targetPath = item.startsWith("raw/") ? item : `raw/sources/${item}`
          const existsInTree = treeFilePaths.has(targetPath)
          const task = activeBatchTask || findLatestRelevantTask(tasks, targetPath)
          const itemCompleted = isSourceCompleted(targetPath, sourcePageSourcePaths, sourcePageSourceNames)
          const itemState = itemCompleted
            ? { label: "已完成", tone: "done", canReingest: true }
            : summarizeSourceItemState(targetPath, batchStatus, treeFilePaths, sourcePageSourcePaths, sourcePageSourceNames, task)
          const activeState = shouldReflectGenericIngest && itemState.label === "待处理"
            ? {
                label: activeIngestTask?.status === "running" && normalizeSourceTaskPath(activeIngestTask.file) === targetPath ? "提取中" : "排队中",
                tone: activeIngestTask?.status === "running" && normalizeSourceTaskPath(activeIngestTask.file) === targetPath ? "running" : "queued",
                canReingest: false,
                stage: formatTaskStage(activeIngestTask?.stage),
              }
            : {
                ...itemState,
                stage: formatTaskStage(task?.stage),
              }
          const detailLabel = activeState.label === "提取中" && activeState.stage ? activeState.stage : activeState.label
          return `
            <div class="import-batch-item-row">
              <button type="button" class="import-batch-item">${escapeHtml(item)}</button>
              <div class="import-batch-item-side">
                <span class="import-batch-file-status ${escapeHtml(statusTone(activeState.tone))}">${escapeHtml(detailLabel)}</span>
                <button
                  type="button"
                  class="mini-button import-batch-reingest"
                  data-path="${escapeHtml(targetPath)}"
                  ${existsInTree && activeState.canReingest ? "" : "hidden disabled"}
                >重新提取</button>
              </div>
            </div>
          `
        }).join("")}
      </div>
    `
    items.forEach((item, index) => {
      article.querySelectorAll(".import-batch-item")[index]?.addEventListener("click", () => {
        const targetPath = item.startsWith("raw/") ? item : `raw/sources/${item}`
        void onPreviewFile?.(targetPath)
      })
      article.querySelectorAll(".import-batch-reingest")[index]?.addEventListener("click", () => {
        const targetPath = item.startsWith("raw/") ? item : `raw/sources/${item}`
        void onReingestSource?.(targetPath)
      })
    })
    els.sourcesImportHistory.appendChild(article)
  }
}
