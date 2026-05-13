const TYPE_COLORS = {
  overview: "#d9bb7a",
  source: "#8fd3a6",
  concept: "#f08da7",
  entity: "#c5a3ff",
  other: "#b7bdc9",
}

const TYPE_LABELS = {
  other: "Other",
  overview: "Overview",
  source: "Source",
  concept: "Concept",
  entity: "Entity",
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

function clientPointToSvg(event, svg, width, height) {
  if (typeof svg.createSVGPoint === "function") {
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const ctm = svg.getScreenCTM()
    if (ctm) {
      const transformed = point.matrixTransform(ctm.inverse())
      return { x: transformed.x, y: transformed.y }
    }
  }
  const rect = svg.getBoundingClientRect()
  return {
    x: ((event.clientX - rect.left) / rect.width) * width,
    y: ((event.clientY - rect.top) / rect.height) * height,
  }
}

function formatEdgeWeight(weight) {
  const value = Number(weight || 0)
  if (!Number.isFinite(value)) return "1.0"
  if (Math.abs(value - Math.round(value)) < 0.001) return `${Math.round(value)}.0`
  return value.toFixed(1)
}

function renderGraphInsights({
  els,
  insights,
  onOpenFile,
  onQueueReviewItem,
  onAskQuestion,
}) {
  if (!els.graphInsights) return
  const cards = []

  for (const node of (insights.bridgeNodes || []).slice(0, 2)) {
    cards.push({
      key: `bridge:${node.path}`,
      title: `桥梁页：${node.title}`,
      detail: `它连接了多个知识区块，连接数 ${node.degree || 0}。补强这一页，通常能同时改善检索和问答。`,
      path: node.path,
      prompt: `请分析为什么 ${node.title} 会成为知识图谱里的桥梁页，并建议我该如何补强它。`,
      queuePayload: {
        kind: "graph-insight",
        insightType: "bridge-node",
        insightId: node.path,
        title: node.title,
        label: `图谱洞察：桥梁页 ${node.title}`,
        path: node.path,
        detail: `连接数 ${node.degree || 0}，是当前图谱里的关键桥梁页。`,
        prompt: `请分析为什么 ${node.title} 会成为知识图谱里的桥梁页，并建议我该如何补强它。`,
      },
    })
  }

  for (const node of (insights.isolatedNodes || []).slice(0, 2)) {
    cards.push({
      key: `isolated:${node.path}`,
      title: `孤立趋势：${node.title}`,
      detail: `这页当前连接很少（连接数 ${node.degree || 0}），容易在知识库里“存在但不好用”。`,
      path: node.path,
      prompt: `请分析 ${node.title} 为什么在图谱里连接偏少，并建议我该补哪些链接或补充页。`,
      queuePayload: {
        kind: "graph-insight",
        insightType: "isolated-node",
        insightId: node.path,
        title: node.title,
        label: `图谱洞察：连接偏少 ${node.title}`,
        path: node.path,
        detail: `连接数 ${node.degree || 0}，当前较为孤立。`,
        prompt: `请分析 ${node.title} 为什么在图谱里连接偏少，并建议我该补哪些链接或补充页。`,
      },
    })
  }

  for (const cluster of (insights.sparseClusters || []).slice(0, 1)) {
    const memberTitles = (cluster.members || []).slice(0, 3).map((item) => item.title).join("、")
    const primaryPath = cluster.members?.[0]?.path || ""
    cards.push({
      key: `cluster:${cluster.id}`,
      title: `连接偏弱簇`,
      detail: `这组页面彼此主题接近，但互相链接还比较少。成员包括：${memberTitles || "未命名页面"}。`,
      path: primaryPath,
      prompt: `请分析这组知识页为什么会形成连接偏弱簇，并建议我优先补哪些页面间的关系：${memberTitles || "当前簇成员"}`,
      queuePayload: {
        kind: "graph-insight",
        insightType: "sparse-cluster",
        insightId: cluster.id,
        title: "连接偏弱簇",
        label: "图谱洞察：连接偏弱簇",
        path: primaryPath,
        detail: `成员包括：${memberTitles || "未命名页面"}。当前 cohesion=${Number(cluster.cohesion || 0).toFixed(2)}。`,
        prompt: `请分析这组知识页为什么会形成连接偏弱簇，并建议我优先补哪些页面间的关系：${memberTitles || "当前簇成员"}`,
        affectedPages: (cluster.members || []).map((item) => item.path).filter(Boolean),
      },
    })
  }

  if (!cards.length) {
    els.graphInsights.innerHTML = `<p class="empty">当前图谱还没有足够明显的后续洞察。</p>`
    return
  }

  els.graphInsights.innerHTML = ""
  for (const card of cards) {
    const article = document.createElement("article")
    article.className = "graph-insight-card"
    article.innerHTML = `
      <div class="graph-insight-head">
        <strong>${escapeHtml(card.title)}</strong>
        ${card.path ? `<span class="item-meta">${escapeHtml(card.path)}</span>` : ""}
      </div>
      <p class="graph-insight-detail">${escapeHtml(card.detail)}</p>
      <div class="graph-insight-actions">
        ${card.path ? `<button type="button" class="mini-button graph-insight-open">打开</button>` : ""}
        <button type="button" class="mini-button graph-insight-review">加入复核</button>
        <button type="button" class="mini-button graph-insight-ask">带入问答</button>
      </div>
    `
    article.querySelector(".graph-insight-open")?.addEventListener("click", () => void onOpenFile?.(card.path))
    article.querySelector(".graph-insight-review")?.addEventListener("click", () => void onQueueReviewItem?.(card.queuePayload))
    article.querySelector(".graph-insight-ask")?.addEventListener("click", () => onAskQuestion?.(card.prompt))
    els.graphInsights.appendChild(article)
  }
}

export function renderGraphView({ els, state, onOpenFile, onPreviewNode, onQueueReviewItem, onAskQuestion }) {
  els.graphStage.innerHTML = ""
  els.graphSummary.innerHTML = ""
  if (els.graphInsights) {
    els.graphInsights.innerHTML = ""
  }

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

  const typeOptions = ["all", ...Object.keys(TYPE_LABELS)]
  els.graphTypeFilter.innerHTML = typeOptions
    .map((type) => `<option value="${escapeHtml(type)}"${state.graphTypeFilter === type ? " selected" : ""}>${type === "all" ? "全部类型" : escapeHtml(TYPE_LABELS[type] || type)}</option>`)
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
  const laidOut = layoutNodes(filteredNodes, width, height).map((node) => ({
    ...node,
    ...(state.graphNodePositions?.[node.id] || {}),
  }))
  const byId = new Map(laidOut.map((node) => [node.id, node]))
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
  svg.setAttribute("class", "graph-svg")
  const edgeRecords = []
  const nodeElements = new Map()
  const positionById = new Map(laidOut.map((node) => [node.id, { x: node.x, y: node.y }]))

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
    const edgeRecord = { edge, line, sourceId: edge.source, targetId: edge.target, label: null }

    if (selectedNodeId && isActive) {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text")
      label.setAttribute("x", String((source.x + target.x) / 2))
      label.setAttribute("y", String((source.y + target.y) / 2 - 4))
      label.setAttribute("text-anchor", "middle")
      label.setAttribute("fill", "rgba(68, 82, 104, 0.82)")
      label.setAttribute("font-size", "10")
      label.textContent = formatEdgeWeight(edge.weight)
      svg.appendChild(label)
      edgeRecord.label = label
    }
    edgeRecords.push(edgeRecord)
  }

  const syncNodePosition = (nodeId, x, y) => {
    const position = positionById.get(nodeId)
    if (!position) return
    position.x = x
    position.y = y
    const elements = nodeElements.get(nodeId)
    if (elements) {
      elements.circle.setAttribute("cx", String(x))
      elements.circle.setAttribute("cy", String(y))
      elements.label.setAttribute("x", String(x))
      elements.label.setAttribute("y", String(y + elements.radius + 14))
    }
    for (const record of edgeRecords) {
      if (record.sourceId !== nodeId && record.targetId !== nodeId) continue
      const sourcePosition = positionById.get(record.sourceId)
      const targetPosition = positionById.get(record.targetId)
      if (!sourcePosition || !targetPosition) continue
      record.line.setAttribute("x1", String(sourcePosition.x))
      record.line.setAttribute("y1", String(sourcePosition.y))
      record.line.setAttribute("x2", String(targetPosition.x))
      record.line.setAttribute("y2", String(targetPosition.y))
      if (record.label) {
        record.label.setAttribute("x", String((sourcePosition.x + targetPosition.x) / 2))
        record.label.setAttribute("y", String((sourcePosition.y + targetPosition.y) / 2 - 4))
      }
    }
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
    let dragMoved = false
    group.addEventListener("click", (event) => {
      if (dragMoved) {
        dragMoved = false
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (event.detail === 2) {
        void onOpenFile(node.path)
        return
      }
      const nextSelected = state.graphSelectedNodeId === node.id ? null : node.id
      state.graphSelectedNodeId = nextSelected
      void onPreviewNode?.(nextSelected ? node.path : null)
      renderGraphView({ els, state, onOpenFile, onPreviewNode })
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
    nodeElements.set(node.id, { circle, label, radius: node.r })

    group.addEventListener("pointerdown", (event) => {
      event.preventDefault()
      event.stopPropagation()
      const currentSvg = () => els.graphStage.querySelector("svg") || svg
      const startPoint = clientPointToSvg(event, currentSvg(), width, height)
      const offsetX = startPoint.x - node.x
      const offsetY = startPoint.y - node.y
      let moved = false
      const move = (moveEvent) => {
        const point = clientPointToSvg(moveEvent, currentSvg(), width, height)
        const nextX = Math.max(24, Math.min(width - 24, point.x - offsetX))
        const nextY = Math.max(24, Math.min(height - 24, point.y - offsetY))
        if (!moved) {
          const deltaX = Math.abs(nextX - node.x)
          const deltaY = Math.abs(nextY - node.y)
          if (deltaX < 1 && deltaY < 1) return
          moved = true
          dragMoved = true
        }
        state.graphNodePositions = {
          ...(state.graphNodePositions || {}),
          [node.id]: {
            x: nextX,
            y: nextY,
          },
        }
        syncNodePosition(node.id, nextX, nextY)
      }
      const up = () => {
        window.removeEventListener("pointermove", move)
        window.removeEventListener("pointerup", up)
        if (moved) {
          renderGraphView({ els, state, onOpenFile, onPreviewNode })
        }
      }
      window.addEventListener("pointermove", move)
      window.addEventListener("pointerup", up)
    })
    svg.appendChild(group)
  }

  els.graphStage.appendChild(svg)

  els.graphLegend.innerHTML = Object.entries(TYPE_COLORS)
    .map(([type, color]) => `<span class="graph-legend-item"><i style="background:${color}"></i>${escapeHtml(TYPE_LABELS[type] || type)}</span>`)
    .join("")

  renderGraphInsights({
    els,
    insights,
    onOpenFile,
    onQueueReviewItem,
    onAskQuestion,
  })
}
