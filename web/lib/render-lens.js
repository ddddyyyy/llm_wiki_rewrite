function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

export function renderLens({ els, state, onOpenFile, onRunIngest, onReviewAction, onAskQuestion, setStatus }) {
  els.lensMetrics.innerHTML = ""
  els.lensQueries.innerHTML = ""
  els.lensReview.innerHTML = ""
  els.lensResolvedReview.innerHTML = ""

  if (!state.selectedProjectId) {
    els.lensMetrics.innerHTML = `<p class="empty">请选择一个项目来查看它的知识流转情况。</p>`
    return
  }

  const metrics = state.lens?.metrics
  if (!metrics) {
    els.lensMetrics.innerHTML = `<p class="empty">正在加载项目透镜...</p>`
  } else {
    const metricEntries = [
      ["原始来源", metrics.rawSourceCount],
      ["来源页面", metrics.sourcePageCount],
      ["概念页面", metrics.conceptCount],
      ["开放问题", metrics.queryCount],
      ["待处理项", metrics.reviewCount],
    ]
    for (const [label, value] of metricEntries) {
      const card = document.createElement("article")
      card.className = "lens-metric"
      card.innerHTML = `<strong>${value}</strong><span>${escapeHtml(label)}</span>`
      els.lensMetrics.appendChild(card)
    }
  }

  const queries = state.lens?.queries || []
  if (queries.length === 0) {
    els.lensQueries.innerHTML = `<p class="empty">暂时还没有开放问题页面。</p>`
  } else {
    for (const item of queries.slice(0, 6)) {
      const row = document.createElement("div")
      row.className = "lens-item"
      row.innerHTML = `<strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.path)}</span>`
      const actions = document.createElement("div")
      actions.className = "lens-actions"

      const openButton = document.createElement("button")
      openButton.type = "button"
      openButton.className = "mini-button"
      openButton.textContent = "打开"
      openButton.addEventListener("click", () => void onOpenFile(item.path))

      const askButton = document.createElement("button")
      askButton.type = "button"
      askButton.className = "mini-button"
      askButton.textContent = "提问"
      askButton.addEventListener("click", () => {
        onAskQuestion(item.prompt)
        setStatus(`已将问题载入问答框：${item.title}`)
      })

      actions.appendChild(openButton)
      actions.appendChild(askButton)
      row.appendChild(actions)
      els.lensQueries.appendChild(row)
    }
  }

  const reviewItems = state.lens?.reviewItems || []
  if (reviewItems.length === 0) {
    els.lensReview.innerHTML = `<p class="empty">当前没有需要优先处理的事项。</p>`
  } else {
    for (const item of reviewItems.slice(0, 8)) {
      const row = document.createElement("div")
      row.className = "lens-item"
      row.innerHTML = `<strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.path || item.expectedWikiPath || "")}</span>`
      const actions = document.createElement("div")
      actions.className = "lens-actions"

      if (item.path) {
        const openButton = document.createElement("button")
        openButton.type = "button"
        openButton.className = "mini-button"
        openButton.textContent = item.path.startsWith("wiki/") ? "打开" : "查看"
        openButton.addEventListener("click", () => void onOpenFile(item.path))
        actions.appendChild(openButton)
      }

      if (item.kind === "missing-source-page") {
        const ingestButton = document.createElement("button")
        ingestButton.type = "button"
        ingestButton.className = "mini-button"
        ingestButton.textContent = "运行提取"
        ingestButton.addEventListener("click", () => void onRunIngest())
        actions.appendChild(ingestButton)
      }

      if (item.kind === "query-follow-up") {
        const askButton = document.createElement("button")
        askButton.type = "button"
        askButton.className = "mini-button"
        askButton.textContent = "提问"
        askButton.addEventListener("click", () => {
          onAskQuestion(item.prompt || item.label)
          setStatus("已将后续问题载入问答框")
        })
        actions.appendChild(askButton)
      }

      const resolveButton = document.createElement("button")
      resolveButton.type = "button"
      resolveButton.className = "mini-button"
      resolveButton.textContent = "标记完成"
      resolveButton.addEventListener("click", () => void onReviewAction(item.key, "resolve"))
      actions.appendChild(resolveButton)

      row.appendChild(actions)
      els.lensReview.appendChild(row)
    }
  }

  const resolvedItems = state.lens?.resolvedReviewItems || []
  if (resolvedItems.length === 0) {
    els.lensResolvedReview.innerHTML = `<p class="empty">还没有已处理的事项。</p>`
  } else {
    for (const item of resolvedItems.slice(0, 8)) {
      const row = document.createElement("div")
      row.className = "lens-item resolved"
      row.innerHTML = `
        <strong>${escapeHtml(item.label)}</strong>
        <span>${escapeHtml(item.resolvedAt || "")}</span>
      `
      const actions = document.createElement("div")
      actions.className = "lens-actions"

      const reopenButton = document.createElement("button")
      reopenButton.type = "button"
      reopenButton.className = "mini-button"
      reopenButton.textContent = "重新打开"
      reopenButton.addEventListener("click", () => void onReviewAction(item.key, "reopen"))
      actions.appendChild(reopenButton)

      row.appendChild(actions)
      els.lensResolvedReview.appendChild(row)
    }
  }
}
