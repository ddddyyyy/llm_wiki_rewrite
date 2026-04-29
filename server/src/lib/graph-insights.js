const STRUCTURAL_PATHS = new Set(["wiki/index.md", "wiki/overview.md", "wiki/log.md"])

function buildAdjacency(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.id, new Set()]))
  for (const edge of edges) {
    adjacency.get(edge.source)?.add(edge.target)
    adjacency.get(edge.target)?.add(edge.source)
  }
  return adjacency
}

function buildComponents(nodes, adjacency) {
  const visited = new Set()
  const components = []

  for (const node of nodes) {
    if (visited.has(node.id)) continue
    const queue = [node.id]
    const ids = []
    visited.add(node.id)

    while (queue.length > 0) {
      const current = queue.shift()
      ids.push(current)
      for (const next of adjacency.get(current) || []) {
        if (visited.has(next)) continue
        visited.add(next)
        queue.push(next)
      }
    }
    components.push(ids)
  }

  return components
}

function componentCohesion(componentIds, edges) {
  if (componentIds.length <= 1) return 0
  const nodeSet = new Set(componentIds)
  let internalEdges = 0
  for (const edge of edges) {
    if (nodeSet.has(edge.source) && nodeSet.has(edge.target)) {
      internalEdges += 1
    }
  }
  const possibleEdges = (componentIds.length * (componentIds.length - 1)) / 2
  return possibleEdges > 0 ? internalEdges / possibleEdges : 0
}

function articulationPointIds(nodes, edges) {
  const adjacency = buildAdjacency(nodes, edges)
  const disc = new Map()
  const low = new Map()
  const parent = new Map()
  const articulation = new Set()
  let time = 0

  function dfs(nodeId) {
    disc.set(nodeId, time)
    low.set(nodeId, time)
    time += 1
    let childCount = 0

    for (const next of adjacency.get(nodeId) || []) {
      if (!disc.has(next)) {
        parent.set(next, nodeId)
        childCount += 1
        dfs(next)
        low.set(nodeId, Math.min(low.get(nodeId), low.get(next)))

        if (!parent.has(nodeId) && childCount > 1) {
          articulation.add(nodeId)
        }
        if (parent.has(nodeId) && low.get(next) >= disc.get(nodeId)) {
          articulation.add(nodeId)
        }
      } else if (next !== parent.get(nodeId)) {
        low.set(nodeId, Math.min(low.get(nodeId), disc.get(next)))
      }
    }
  }

  for (const node of nodes) {
    if (!disc.has(node.id)) dfs(node.id)
  }
  return articulation
}

export function analyzeGraphInsights(nodes, edges) {
  const adjacency = buildAdjacency(nodes, edges)
  const components = buildComponents(nodes, adjacency)
  const articulationIds = articulationPointIds(nodes, edges)
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))

  const isolatedNodes = nodes
    .filter((node) => !STRUCTURAL_PATHS.has(node.path))
    .filter((node) => (adjacency.get(node.id)?.size || 0) <= 1)
    .map((node) => ({
      path: node.path,
      title: node.title,
      degree: node.degree || 0,
      type: node.type,
    }))

  const sparseClusters = components
    .filter((ids) => ids.length >= 3)
    .map((ids) => {
      const cohesion = componentCohesion(ids, edges)
      const members = ids.map((id) => nodeMap.get(id)).filter(Boolean)
      return {
        id: ids.slice().sort().join("::"),
        nodeCount: ids.length,
        cohesion,
        members: members.map((node) => ({
          path: node.path,
          title: node.title,
          type: node.type,
          degree: node.degree || 0,
        })),
      }
    })
    .filter((cluster) => cluster.cohesion < 0.34)
    .sort((a, b) => a.cohesion - b.cohesion || b.nodeCount - a.nodeCount)

  const bridgeNodes = nodes
    .filter((node) => articulationIds.has(node.id))
    .filter((node) => !STRUCTURAL_PATHS.has(node.path))
    .map((node) => ({
      path: node.path,
      title: node.title,
      type: node.type,
      degree: node.degree || 0,
    }))
    .sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title))

  const surprisingConnections = edges
    .map((edge) => {
      const source = nodeMap.get(edge.source)
      const target = nodeMap.get(edge.target)
      if (!source || !target) return null
      if (STRUCTURAL_PATHS.has(source.path) || STRUCTURAL_PATHS.has(target.path)) return null
      let score = 0
      const reasons = []
      if (source.type !== target.type) {
        score += 2
        reasons.push(`连接了 ${source.type} 和 ${target.type}`)
      }
      if (edge.kind.includes("source-overlap")) {
        score += 1
        reasons.push("共享同一来源")
      }
      if ((source.degree || 0) <= 2 || (target.degree || 0) <= 2) {
        score += 1
        reasons.push("其中一端连接较少")
      }
      if (score < 2) return null
      return {
        id: edge.id,
        source: { path: source.path, title: source.title, type: source.type },
        target: { path: target.path, title: target.title, type: target.type },
        reasons,
        score,
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 6)

  return {
    isolatedNodes,
    sparseClusters,
    bridgeNodes,
    surprisingConnections,
    components: components.map((ids) => ({
      id: ids.slice().sort().join("::"),
      nodeCount: ids.length,
      cohesion: componentCohesion(ids, edges),
    })),
  }
}
