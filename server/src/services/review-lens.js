import { slugifyFileStem, titleFromFileName } from "../lib/text.js"

function reviewKeyForMissingSource(item) {
  return `missing-source-page:${item.path}`
}

function reviewKeyForWarning(item) {
  return `warning:${item.path}:${item.label}`
}

function reviewKeyForQuery(item) {
  return `query-follow-up:${item.path}`
}

function formatReviewLabelFromKey(key) {
  if (typeof key !== "string" || key.length === 0) return "已处理事项"
  if (key.startsWith("missing-source-page:")) {
    const target = key.slice("missing-source-page:".length)
    return `已处理来源覆盖项：${titleFromFileName(target)}`
  }
  if (key.startsWith("warning:")) {
    const parts = key.split(":")
    return `已处理警告：${parts.slice(2).join(":") || parts[1] || key}`
  }
  if (key.startsWith("query-follow-up:")) {
    const target = key.slice("query-follow-up:".length)
    return `已处理后续问题：${titleFromFileName(target)}`
  }
  return key
}

export async function loadReviewState(projectId, deps) {
  const { readProjectFile } = deps
  try {
    const { contents } = await readProjectFile(projectId, ".llm-wiki/review.json")
    const parsed = JSON.parse(contents)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function saveReviewState(projectId, items, deps) {
  const { writeProjectFile } = deps
  await writeProjectFile(projectId, ".llm-wiki/review.json", JSON.stringify(items, null, 2) + "\n")
}

export async function buildProjectLens(projectId, deps) {
  const {
    buildKnowledgeView,
    ensureInsideProject,
    collectFiles,
    loadTaskStore,
    listProjectTasks,
  } = deps

  const knowledge = await buildKnowledgeView(projectId)
  const rawRoot = ensureInsideProject(projectId, "raw/sources").fullPath
  const rawFiles = await collectFiles(rawRoot).catch(() => [])
  const sourceLike = rawFiles.filter((file) => /\.(md|txt|markdown|pdf|docx|pptx|xlsx|csv)$/i.test(file.name))
  const sourcePages = knowledge.sections.sources || []
  const sourcePagePaths = new Set(sourcePages.map((item) => item.path))
  const orphanSources = []

  for (const file of sourceLike) {
    const wikiPath = `wiki/sources/${slugifyFileStem(file.name)}.md`
    if (!sourcePagePaths.has(wikiPath)) {
      orphanSources.push({
        path: `raw/sources/${file.path}`,
        title: titleFromFileName(file.path),
        expectedWikiPath: wikiPath,
      })
    }
  }

  await loadTaskStore()
  const tasks = listProjectTasks(projectId)
  const warningItems = []
  for (const task of tasks) {
    if (!task?.result?.ingested) continue
    for (const entry of task.result.ingested) {
      for (const warning of entry.warnings || []) {
        warningItems.push({
          kind: "warning",
          label: warning,
          path: entry.sourcePath,
        })
      }
    }
  }

  const reviewItems = [
    ...orphanSources.map((item) => ({
      key: reviewKeyForMissingSource(item),
      kind: "missing-source-page",
      label: `来源文件尚未入库：${item.title}`,
      path: item.path,
      expectedWikiPath: item.expectedWikiPath,
    })),
    ...warningItems.map((item) => ({
      ...item,
      key: reviewKeyForWarning(item),
    })),
    ...(knowledge.sections.queries || []).map((item) => ({
      key: reviewKeyForQuery(item),
      kind: "query-follow-up",
      label: `后续问题：${item.title}`,
      path: item.path,
      prompt: item.title.endsWith("?") ? item.title : `${item.title}?`,
    })),
  ]

  const reviewState = await loadReviewState(projectId, deps)
  const resolvedKeys = new Set(
    reviewState
      .filter((item) => item?.status === "resolved" && item?.key)
      .map((item) => item.key),
  )

  const unresolvedReviewItems = reviewItems.filter((item) => !resolvedKeys.has(item.key))
  const resolvedReviewItems = reviewState
    .filter((item) => item?.status === "resolved" && item?.key)
    .map((item) => ({
      key: item.key,
      kind: "resolved",
      label: formatReviewLabelFromKey(item.key),
      path: item.path || "",
      resolvedAt: item.resolvedAt || "",
    }))

  const queryPrompts = (knowledge.sections.queries || []).map((item) => ({
    path: item.path,
    title: item.title,
    prompt: item.title.endsWith("?") ? item.title : `${item.title}?`,
  }))

  return {
    metrics: {
      rawSourceCount: sourceLike.length,
      sourcePageCount: sourcePages.length,
      conceptCount: (knowledge.sections.concepts || []).length,
      queryCount: (knowledge.sections.queries || []).length,
      reviewCount: unresolvedReviewItems.length,
    },
    queries: queryPrompts,
    reviewItems: unresolvedReviewItems.slice(0, 12),
    resolvedReviewItems: resolvedReviewItems.slice(0, 12),
  }
}

export async function resolveReviewItem(projectId, key, deps) {
  const current = await loadReviewState(projectId, deps)
  const next = [
    ...current.filter((item) => item.key !== key),
    {
      key,
      status: "resolved",
      resolvedAt: new Date().toISOString(),
    },
  ]
  await saveReviewState(projectId, next, deps)
  return { ok: true, key, status: "resolved" }
}

export async function reopenReviewItem(projectId, key, deps) {
  const current = await loadReviewState(projectId, deps)
  const next = current.filter((item) => item.key !== key)
  await saveReviewState(projectId, next, deps)
  return { ok: true, key, status: "open" }
}
