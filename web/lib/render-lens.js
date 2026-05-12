function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

export function renderLens({ els, state, onOpenFile, onRunIngest, onReviewAction, onAskQuestion, setStatus }) {
  els.lensQueries.innerHTML = ""
  els.lensReview.innerHTML = ""
  for (const button of els.lensTabButtons || []) {
    const active = button.dataset.lensTab === state.lensTab
    button.classList.toggle("active", active)
    button.setAttribute("aria-pressed", active ? "true" : "false")
  }
  els.lensQueries.hidden = state.lensTab !== "queries"
  els.lensReview.hidden = state.lensTab !== "review"

  if (!state.selectedProjectId) {
    els.lensQueries.innerHTML = `<p class="empty">请选择一个项目来查看开放问题和待处理项。</p>`
    els.lensReview.innerHTML = ""
    return
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
      if (item.detail) {
        const detail = document.createElement("p")
        detail.className = "lens-detail"
        detail.textContent = item.detail
        row.appendChild(detail)
      }
      if (item.searchQueries?.length) {
        const search = document.createElement("p")
        search.className = "lens-detail lens-detail-muted"
        search.textContent = `建议检索：${item.searchQueries.join(" | ")}`
        row.appendChild(search)
      }
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

      if (item.kind === "ingest-review" && item.searchQueries?.length) {
        const askButton = document.createElement("button")
        askButton.type = "button"
        askButton.className = "mini-button"
        askButton.textContent = "带入问答"
        askButton.addEventListener("click", () => {
          onAskQuestion(item.searchQueries[0] || item.title || item.label)
          setStatus("已将提取复核问题载入问答框")
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
}
