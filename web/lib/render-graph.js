const TYPE_COLORS = {
  overview: "#d9bb7a",
  index: "#9ecbff",
  source: "#8fd3a6",
  concept: "#f08da7",
  entity: "#c5a3ff",
  query: "#ffb86b",
  comparison: "#7ad7d1",
  synthesis: "#f4e58d",
  page: "#b7bdc9",
}

const EDGE_STYLES = {
  active: "rgba(88, 104, 127, 0.54)",
  idle: "rgba(125, 140, 160, 0.22)",
  dimmedOpacity: "0.12",
}

const NODE_LABEL_COLOR = "#314255"
const NODE_STROKE_COLOR = "rgba(255,255,255,0.95)"

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function layoutNodes(nodes, width, height) {
  const centerX = width / 2
  const centerY = height / 2
  const ring = Math.min(width, height) * 0.34
  return nodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1)
    const radius = ring + (node.degree || 0) * 4
    return {
      ...node,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      r: Math.max(7, 8 + Math.min(node.degree || 0, 8)),
      color: TYPE_COLORS[node.type] || TYPE_COLORS.page,
    }
  })
}

export function renderGraphView({ els, state, onOpenFile }) {
  els.graphStage.innerHTML = ""
  els.graphSummary.innerHTML = ""
  els.graphInsights.innerHTML = ""

  if (state.activeView !== "graph") {
    return
  }

  if (!state.selectedProjectId) {
    els.graphStage.innerHTML = `<p class="empty">请选择一个项目来查看关系图。</p>`
    return
  }

  if (!state.graph) {
    els.graphStage.innerHTML = `<p class="empty">正在加载关系图...</p>`
    return
  }

  const { nodes = [], edges = [], stats = {}, insights = {} } = state.graph
  if (nodes.length === 0) {
    els.graphStage.innerHTML = `<p class="empty">当前项目还没有足够的 wiki 页面来构建关系图。</p>`
    return
  }

  const summaryParts = [
    `节点 ${stats.nodeCount || 0}`,
    `连线 ${stats.edgeCount || 0}`,
    `簇 ${stats.componentCount || 0}`,
  ]
  els.graphSummary.textContent = summaryParts.join(" · ")

  const typeOptions = ["all", ...Object.keys(stats.typeCounts || {})]
  els.graphTypeFilter.innerHTML = typeOptions
    .map((type) => `<option value="${escapeHtml(type)}"${state.graphTypeFilter === type ? " selected" : ""}>${type === "all" ? "全部类型" : escapeHtml(type)}</option>`)
    .join("")

  const filteredNodes = nodes.filter((node) => state.graphTypeFilter === "all" || node.type === state.graphTypeFilter)
  const allowed = new Set(filteredNodes.map((node) => node.id))
  const filteredEdges = edges.filter((edge) => allowed.has(edge.source) && allowed.has(edge.target))
  if (filteredNodes.length === 0) {
    els.graphStage.innerHTML = `<p class="empty">当前筛选条件下没有节点。</p>`
    els.graphLegend.innerHTML = ""
    return
  }

  const width = 920
  const height = 620
  const laidOut = layoutNodes(filteredNodes, width, height)
  const byId = new Map(laidOut.map((node) => [node.id, node]))
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
  svg.setAttribute("class", "graph-svg")

  const selectedNodeId = state.graphSelectedNodeId
  const neighborIds = new Set()
  if (selectedNodeId) {
    for (const edge of filteredEdges) {
      if (edge.source === selectedNodeId) neighborIds.add(edge.target)
      if (edge.target === selectedNodeId) neighborIds.add(edge.source)
    }
  }

  for (const edge of filteredEdges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target) continue
    const isActive = !selectedNodeId || edge.source === selectedNodeId || edge.target === selectedNodeId
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line")
    line.setAttribute("x1", String(source.x))
    line.setAttribute("y1", String(source.y))
    line.setAttribute("x2", String(target.x))
    line.setAttribute("y2", String(target.y))
    line.setAttribute("stroke", isActive ? EDGE_STYLES.active : EDGE_STYLES.idle)
    line.setAttribute("stroke-width", String(isActive ? Math.min(4.8, 1.6 + edge.weight * 0.75) : 1.4))
    line.setAttribute("opacity", state.graphNeighborOnly && selectedNodeId && !isActive ? EDGE_STYLES.dimmedOpacity : "1")
    svg.appendChild(line)
  }

  for (const node of laidOut) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g")
    group.setAttribute("class", "graph-node")
    const isSelected = node.id === selectedNodeId
    const isNeighbor = neighborIds.has(node.id)
    const shouldDim = selectedNodeId && !isSelected && !isNeighbor && state.graphNeighborOnly
    if (isSelected) group.classList.add("is-active")
    if (shouldDim) group.classList.add("is-dim")
    group.style.cursor = "pointer"
    group.addEventListener("click", (event) => {
      if (event.detail === 2) {
        void onOpenFile(node.path)
        return
      }
      state.graphSelectedNodeId = state.graphSelectedNodeId === node.id ? null : node.id
      renderGraphView({ els, state, onOpenFile })
    })

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle")
    circle.setAttribute("cx", String(node.x))
    circle.setAttribute("cy", String(node.y))
    circle.setAttribute("r", String(node.r))
    circle.setAttribute("fill", node.color)
    circle.setAttribute("stroke", NODE_STROKE_COLOR)
    circle.setAttribute("stroke-width", "2")
    group.appendChild(circle)

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text")
    label.setAttribute("x", String(node.x))
    label.setAttribute("y", String(node.y + node.r + 14))
    label.setAttribute("text-anchor", "middle")
    label.setAttribute("fill", NODE_LABEL_COLOR)
    label.setAttribute("font-size", "11")
    label.textContent = node.title.length > 22 ? `${node.title.slice(0, 22)}…` : node.title
    group.appendChild(label)

    const title = document.createElementNS("http://www.w3.org/2000/svg", "title")
    title.textContent = `${node.title}\n${node.path}\n类型：${node.type}\n连接数：${node.degree || 0}`
    group.appendChild(title)
    svg.appendChild(group)
  }

  els.graphStage.appendChild(svg)

  els.graphLegend.innerHTML = Object.entries(TYPE_COLORS)
    .filter(([type]) => Object.keys(stats.typeCounts || {}).includes(type))
    .map(([type, color]) => `<span class="graph-legend-item"><i style="background:${color}"></i>${escapeHtml(type)}</span>`)
    .join("")

  const insightItems = [
    ...(insights.bridgeNodes || []).slice(0, 3).map((node) => ({ kind: "bridge", node })),
    ...(insights.sparseClusters || []).slice(0, 2).map((cluster) => ({ kind: "cluster", cluster })),
    ...(insights.surprisingConnections || []).slice(0, 2).map((edge) => ({ kind: "edge", edge })),
    ...(insights.isolatedNodes || []).slice(0, 2).map((node) => ({ kind: "isolated", node })),
  ]

  for (const item of insightItems) {
    const article = document.createElement("article")
    article.className = "graph-insight-card"

    if (item.kind === "bridge") {
      const node = item.node
      article.innerHTML = `
        <strong>关键桥梁页</strong>
        <p>${escapeHtml(node.title)} 连接较多页面，适合做总览或中枢页。</p>
        <div class="item-meta">${escapeHtml(node.path)}</div>
        <div class="graph-insight-actions">
          <button type="button" class="mini-button graph-open-page">打开页面</button>
        </div>
      `
      article.querySelector(".graph-open-page")?.addEventListener("click", () => void onOpenFile(node.path))
    }

    if (item.kind === "cluster") {
      const cluster = item.cluster
      const sample = cluster.members?.slice(0, 3).map((member) => member.title).join("、") || "该知识簇"
      article.innerHTML = `
        <strong>连接偏弱的知识簇</strong>
        <p>${escapeHtml(sample)} 这组页面之间的内部连接密度偏低，建议补链或增加综合页。</p>
        <div class="item-meta">${cluster.nodeCount} 个页面 · cohesion ${cluster.cohesion.toFixed(2)}</div>
        <div class="graph-insight-chip-row">
          ${(cluster.members || []).slice(0, 4).map((member) => `
            <button type="button" class="mini-button graph-open-member" data-path="${escapeHtml(member.path)}">${escapeHtml(member.title)}</button>
          `).join("")}
        </div>
      `
      for (const button of article.querySelectorAll(".graph-open-member")) {
        button.addEventListener("click", () => void onOpenFile(button.dataset.path))
      }
    }

    if (item.kind === "edge") {
      const edge = item.edge
      article.innerHTML = `
        <strong>值得关注的连接</strong>
        <p>${escapeHtml(edge.source.title)} ↔ ${escapeHtml(edge.target.title)}</p>
        <div class="item-meta">${escapeHtml((edge.reasons || []).join(" · "))}</div>
        <div class="graph-insight-actions">
          <button type="button" class="mini-button graph-open-source">打开左侧页面</button>
          <button type="button" class="mini-button graph-open-target">打开右侧页面</button>
        </div>
      `
      article.querySelector(".graph-open-source")?.addEventListener("click", () => void onOpenFile(edge.source.path))
      article.querySelector(".graph-open-target")?.addEventListener("click", () => void onOpenFile(edge.target.path))
    }

    if (item.kind === "isolated") {
      const node = item.node
      article.innerHTML = `
        <strong>孤立知识页</strong>
        <p>${escapeHtml(node.title)} 当前连接很少，适合补充相关页引用或写入综合页。</p>
        <div class="item-meta">${escapeHtml(node.path)}</div>
        <div class="graph-insight-actions">
          <button type="button" class="mini-button graph-open-page">打开页面</button>
        </div>
      `
      article.querySelector(".graph-open-page")?.addEventListener("click", () => void onOpenFile(node.path))
    }

    els.graphInsights.appendChild(article)
  }
}
