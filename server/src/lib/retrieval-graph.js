import path from "node:path"
import { extractFrontmatterRelated, extractWikilinks } from "./knowledge.js"
import { readFrontmatterValue, titleFromFileName } from "./text.js"

const WEIGHTS = {
  directLink: 3.0,
  sourceOverlap: 4.0,
  commonNeighbor: 1.5,
  typeAffinity: 1.0,
}

const TYPE_AFFINITY = {
  entity: { concept: 1.2, entity: 0.8, source: 1.0, synthesis: 1.0, query: 0.8 },
  concept: { entity: 1.2, concept: 0.8, source: 1.0, synthesis: 1.2, query: 1.0 },
  source: { entity: 1.0, concept: 1.0, source: 0.5, query: 0.8, synthesis: 1.0 },
  query: { concept: 1.0, entity: 0.8, synthesis: 1.0, source: 0.8, query: 0.5 },
  synthesis: { concept: 1.2, entity: 1.0, source: 1.0, query: 1.0, synthesis: 0.8 },
}

function sectionTypeForPath(filePath) {
  if (filePath === "wiki/overview.md") return "overview"
  if (filePath === "wiki/index.md") return "index"
  if (filePath.startsWith("wiki/sources/")) return "source"
  if (filePath.startsWith("wiki/concepts/")) return "concept"
  if (filePath.startsWith("wiki/entities/")) return "entity"
  if (filePath.startsWith("wiki/queries/")) return "query"
  if (filePath.startsWith("wiki/comparisons/")) return "comparison"
  if (filePath.startsWith("wiki/synthesis/")) return "synthesis"
  return "page"
}

function normalizeLookup(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "-")
}

function resolveTarget(raw, nodeIds) {
  if (nodeIds.has(raw)) return raw
  const normalized = normalizeLookup(raw)
  for (const id of nodeIds) {
    const idLower = id.toLowerCase()
    if (idLower === normalized) return id
    if (normalizeLookup(id) === normalized) return id
  }
  return null
}

function getNeighbors(node) {
  const neighbors = new Set()
  for (const id of node.outLinks) neighbors.add(id)
  for (const id of node.inLinks) neighbors.add(id)
  return neighbors
}

function getNodeDegree(node) {
  return node.outLinks.size + node.inLinks.size
}

function parseSources(contents) {
  const raw = readFrontmatterValue(contents, "sources")
  if (!raw) return []
  const trimmed = raw.trim()
  if (!trimmed.startsWith("[")) return [trimmed.replace(/^["']|["']$/g, "")]
  return trimmed
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
}

export async function buildRetrievalGraph(projectId, deps) {
  const { ensureInsideProject, collectFiles, readProjectFile } = deps
  const wikiRoot = ensureInsideProject(projectId, "wiki").fullPath
  const files = await collectFiles(wikiRoot).catch(() => [])
  const markdownFiles = files
    .filter((file) => file.path.endsWith(".md") && file.path !== "log.md")

  const rawNodes = []
  for (const file of markdownFiles) {
    const wikiPath = `wiki/${file.path}`
    const { contents } = await readProjectFile(projectId, wikiPath).catch(() => ({ contents: "" }))
    const id = path.basename(wikiPath, ".md")
    rawNodes.push({
      id,
      title: readFrontmatterValue(contents, "title") || titleFromFileName(wikiPath),
      type: readFrontmatterValue(contents, "type") || sectionTypeForPath(wikiPath),
      path: wikiPath,
      sources: parseSources(contents),
      rawLinks: [...new Set([...extractWikilinks(contents), ...extractFrontmatterRelated(contents)])],
    })
  }

  const nodeIds = new Set(rawNodes.map((node) => node.id))
  const outLinksMap = new Map()
  const inLinksMap = new Map()
  for (const id of nodeIds) {
    outLinksMap.set(id, new Set())
    inLinksMap.set(id, new Set())
  }

  for (const raw of rawNodes) {
    for (const target of raw.rawLinks) {
      const resolved = resolveTarget(path.basename(target), nodeIds)
      if (!resolved || resolved === raw.id) continue
      outLinksMap.get(raw.id).add(resolved)
      inLinksMap.get(resolved).add(raw.id)
    }
  }

  const nodes = new Map()
  for (const raw of rawNodes) {
    nodes.set(raw.id, {
      ...raw,
      outLinks: outLinksMap.get(raw.id) || new Set(),
      inLinks: inLinksMap.get(raw.id) || new Set(),
    })
  }
  return { nodes }
}

export function calculateRelevance(nodeA, nodeB, graph) {
  if (!nodeA || !nodeB || nodeA.id === nodeB.id) return 0
  const forwardLinks = nodeA.outLinks.has(nodeB.id) ? 1 : 0
  const backwardLinks = nodeB.outLinks.has(nodeA.id) ? 1 : 0
  const directLinkScore = (forwardLinks + backwardLinks) * WEIGHTS.directLink

  const sourcesA = new Set(nodeA.sources)
  let sharedSourceCount = 0
  for (const source of nodeB.sources) {
    if (sourcesA.has(source)) sharedSourceCount += 1
  }
  const sourceOverlapScore = sharedSourceCount * WEIGHTS.sourceOverlap

  const neighborsA = getNeighbors(nodeA)
  const neighborsB = getNeighbors(nodeB)
  let adamicAdar = 0
  for (const neighborId of neighborsA) {
    if (!neighborsB.has(neighborId)) continue
    const neighbor = graph.nodes.get(neighborId)
    if (!neighbor) continue
    const degree = getNodeDegree(neighbor)
    adamicAdar += 1 / Math.log(Math.max(degree, 2))
  }
  const commonNeighborScore = adamicAdar * WEIGHTS.commonNeighbor

  const affinityMap = TYPE_AFFINITY[nodeA.type] || {}
  const typeAffinityScore = (affinityMap[nodeB.type] ?? 0.5) * WEIGHTS.typeAffinity
  return directLinkScore + sourceOverlapScore + commonNeighborScore + typeAffinityScore
}

export function getRelatedNodes(nodeId, graph, limit = 5) {
  const sourceNode = graph.nodes.get(nodeId)
  if (!sourceNode) return []
  const scored = []
  for (const [id, node] of graph.nodes.entries()) {
    if (id === nodeId) continue
    const relevance = calculateRelevance(sourceNode, node, graph)
    if (relevance > 0) scored.push({ node, relevance })
  }
  scored.sort((a, b) => b.relevance - a.relevance)
  return scored.slice(0, limit)
}
