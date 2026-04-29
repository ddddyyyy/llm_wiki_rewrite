import { analyzeGraphInsights } from "../lib/graph-insights.js"
import { buildWikiGraphModel } from "../lib/wiki-graph-model.js"

export function createLintService({ projectFs, projectService }) {
  const { ensureInsideProject, collectFiles } = projectFs
  const { readProjectFile } = projectService

  async function runProjectLint(projectId) {
    const model = await buildWikiGraphModel(projectId, {
      ensureInsideProject,
      collectFiles,
      readProjectFile,
    })
    const insights = analyzeGraphInsights(model.nodes, model.edges)

    const findings = []
    for (const page of model.pages) {
      const inbound = model.inboundCounts.get(page.path) || 0
      if (inbound === 0) {
        findings.push({
          type: "orphan",
          severity: "info",
          page: page.path,
          label: "孤立页面",
          detail: "当前没有其他 wiki 页面链接到这一页。",
        })
      }

      if (page.outlinks.length === 0) {
        findings.push({
          type: "no-outlinks",
          severity: "info",
          page: page.path,
          label: "缺少外链",
          detail: "这一页还没有指向其他 wiki 页面的 [[wikilink]]。",
        })
      }
    }

    for (const broken of model.brokenLinks) {
      findings.push({
        type: "broken-link",
        severity: "warning",
        page: broken.page,
        label: "断链",
        detail: `找不到链接目标：[[${broken.target}]]`,
      })
    }

    for (const cluster of insights.sparseClusters.slice(0, 4)) {
      findings.push({
        type: "sparse-cluster",
        severity: "info",
        page: cluster.members[0]?.path || "wiki/index.md",
        label: "知识簇连接偏弱",
        detail: `这组页面共有 ${cluster.nodeCount} 页，内部连接密度仅 ${cluster.cohesion.toFixed(2)}，建议补充互链或中间页。`,
      })
    }

    findings.sort((a, b) => {
      const severityOrder = { warning: 0, info: 1 }
      return (severityOrder[a.severity] - severityOrder[b.severity]) || a.page.localeCompare(b.page)
    })

    return {
      findings,
      insights: {
        isolatedNodes: insights.isolatedNodes.slice(0, 6),
        sparseClusters: insights.sparseClusters.slice(0, 4),
        bridgeNodes: insights.bridgeNodes.slice(0, 4),
      },
      summary: {
        total: findings.length,
        warnings: findings.filter((item) => item.severity === "warning").length,
        infos: findings.filter((item) => item.severity === "info").length,
        pagesChecked: model.pages.length,
        bridgeNodes: insights.bridgeNodes.length,
        sparseClusters: insights.sparseClusters.length,
      },
    }
  }

  return {
    runProjectLint,
  }
}
