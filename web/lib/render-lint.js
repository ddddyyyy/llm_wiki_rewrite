function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

export function renderLintView({
  els,
  state,
  onOpenFile,
  onQueueReviewItem,
  onAskQuestion,
}) {
  els.lintSummary.innerHTML = ""
  els.lintList.innerHTML = ""

  if (!state.selectedProjectId) {
    els.lintSummary.innerHTML = `<p class="empty">请选择一个项目后再运行检查。</p>`
    return
  }

  const summary = state.lint?.summary || {
    total: 0,
    warnings: 0,
    infos: 0,
    pagesChecked: 0,
  }
  const findings = state.lint?.findings || []

  els.lintSummary.innerHTML = `
    <div class="lint-metrics">
      <div class="lint-metric">
        <strong>${summary.total}</strong>
        <span>问题总数</span>
      </div>
      <div class="lint-metric">
        <strong>${summary.warnings}</strong>
        <span>警告</span>
      </div>
      <div class="lint-metric">
        <strong>${summary.infos}</strong>
        <span>提示</span>
      </div>
      <div class="lint-metric">
        <strong>${summary.pagesChecked}</strong>
        <span>检查页面</span>
      </div>
    </div>
  `

  if (findings.length === 0) {
    els.lintList.innerHTML = `<p class="empty">当前没有发现结构性问题。点击“运行检查”可以重新扫描。</p>`
    return
  }

  for (const finding of findings) {
    const article = document.createElement("article")
    article.className = `lint-card ${finding.severity}`
    article.innerHTML = `
      <div class="lint-card-head">
        <div>
          <strong>${escapeHtml(finding.label)}</strong>
          <div class="item-meta">${escapeHtml(finding.page)}</div>
        </div>
        <span class="lint-badge ${escapeHtml(finding.severity)}">${escapeHtml(finding.severity === "warning" ? "警告" : "提示")}</span>
      </div>
      <p class="lint-detail">${escapeHtml(finding.detail)}</p>
      <div class="lint-actions">
        <button type="button" class="mini-button lint-open-button">打开页面</button>
        <button type="button" class="mini-button lint-review-button">加入复核</button>
        <button type="button" class="mini-button lint-ask-button">带入问答</button>
      </div>
    `
    article.querySelector(".lint-open-button")?.addEventListener("click", () => void onOpenFile(finding.page))
    article.querySelector(".lint-review-button")?.addEventListener("click", () => void onQueueReviewItem?.({
      kind: "lint-finding",
      findingType: finding.type,
      title: finding.label,
      label: `检查项：${finding.label}`,
      path: finding.page,
      detail: finding.detail,
      prompt: `请结合知识库分析这个检查项：${finding.label}。目标页面是 ${finding.page}。已知情况：${finding.detail}`,
    }))
    article.querySelector(".lint-ask-button")?.addEventListener("click", () => {
      onAskQuestion?.(`请结合知识库分析这个检查项：${finding.label}。目标页面是 ${finding.page}。已知情况：${finding.detail}`)
    })
    els.lintList.appendChild(article)
  }

}
