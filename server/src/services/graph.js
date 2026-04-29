import { analyzeGraphInsights } from "../lib/graph-insights.js"
import { buildWikiGraphModel } from "../lib/wiki-graph-model.js"

export function createGraphService({ projectFs, projectService }) {
  const { ensureInsideProject, collectFiles } = projectFs
  const { readProjectFile } = projectService

  async function buildProjectGraph(projectId) {
    const model = await buildWikiGraphModel(projectId, {
      ensureInsideProject,
      collectFiles,
      readProjectFile,
    })

    const insights = analyzeGraphInsights(model.nodes, model.edges)
    return {
      nodes: model.nodes,
      edges: model.edges,
      stats: {
        nodeCount: model.nodes.length,
        edgeCount: model.edges.length,
        componentCount: insights.components.length,
        typeCounts: model.nodes.reduce((acc, node) => {
          acc[node.type] = (acc[node.type] || 0) + 1
          return acc
        }, {}),
      },
      insights,
    }
  }

  return {
    buildProjectGraph,
  }
}
