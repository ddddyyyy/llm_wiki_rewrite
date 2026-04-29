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
}) {
  els.lintSummary.innerHTML = ""
  els.lintInsights.innerHTML = ""
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
  const insights = state.lint?.insights || {
    isolatedNodes: [],
    sparseClusters: [],
    bridgeNodes: [],
  }

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
      <div class="lint-metric">
        <strong>${summary.bridgeNodes || 0}</strong>
        <span>关键桥梁页</span>
      </div>
      <div class="lint-metric">
        <strong>${summary.sparseClusters || 0}</strong>
        <span>连接偏弱簇</span>
      </div>
    </div>
  `

  const insightNodes = [
    ...(insights.bridgeNodes || []).map((node) => ({
      kind: "bridge",
      node,
    })),
    ...(insights.sparseClusters || []).map((cluster) => ({
      kind: "cluster",
      cluster,
    })),
    ...(insights.isolatedNodes || []).map((node) => ({
      kind: "isolated",
      node,
    })),
  ]
  if (insightNodes.length > 0) {
    for (const item of insightNodes) {
      const article = document.createElement("article")
      article.className = "lint-card info"

      if (item.kind === "bridge") {
        const node = item.node
        article.innerHTML = `
          <div class="lint-card-head">
            <div>
              <strong>关键桥梁页</strong>
              <div class="item-meta">${escapeHtml(node.path)}</div>
            </div>
            <span class="lint-badge info">洞察</span>
          </div>
          <p class="lint-detail">“${escapeHtml(node.title)}” 连接了多条知识路径，适合优先维护成中枢页面。</p>
          <div class="lint-actions">
            <button type="button" class="mini-button lint-open-primary">打开页面</button>
          </div>
        `
        article.querySelector(".lint-open-primary")?.addEventListener("click", () => void onOpenFile(node.path))
      }

      if (item.kind === "cluster") {
        const cluster = item.cluster
        const lead = cluster.members?.slice(0, 3).map((member) => member.title).join("、") || "这组页面"
        article.innerHTML = `
          <div class="lint-card-head">
            <div>
              <strong>连接偏弱的知识簇</strong>
              <div class="item-meta">${cluster.nodeCount} 个页面 · cohesion ${cluster.cohesion.toFixed(2)}</div>
            </div>
            <span class="lint-badge info">洞察</span>
          </div>
          <p class="lint-detail">当前这组页面内部互链偏少，像“${escapeHtml(lead)}”这类主题建议补充互相引用或增加综合页。</p>
          <div class="lint-chip-row">
            ${(cluster.members || []).slice(0, 4).map((member) => `
              <button type="button" class="mini-button lint-open-member" data-path="${escapeHtml(member.path)}">${escapeHtml(member.title)}</button>
            `).join("")}
          </div>
        `
        for (const button of article.querySelectorAll(".lint-open-member")) {
          button.addEventListener("click", () => void onOpenFile(button.dataset.path))
        }
      }

      if (item.kind === "isolated") {
        const node = item.node
        article.innerHTML = `
          <div class="lint-card-head">
            <div>
              <strong>孤立知识页</strong>
              <div class="item-meta">${escapeHtml(node.path)}</div>
            </div>
            <span class="lint-badge info">洞察</span>
          </div>
          <p class="lint-detail">“${escapeHtml(node.title)}” 当前几乎没有和其他页面形成连接，适合补充相关页引用或把它并入综合页。</p>
          <div class="lint-actions">
            <button type="button" class="mini-button lint-open-primary">打开页面</button>
          </div>
        `
        article.querySelector(".lint-open-primary")?.addEventListener("click", () => void onOpenFile(node.path))
      }

      els.lintInsights.appendChild(article)
    }
  }

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
      </div>
    `
    article.querySelector(".lint-open-button")?.addEventListener("click", () => void onOpenFile(finding.page))
    els.lintList.appendChild(article)
  }

}
