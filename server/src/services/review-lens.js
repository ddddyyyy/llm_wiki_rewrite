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

function reviewKeyForIngestReview(item) {
  return `ingest-review:${item.type}:${item.sourcePath}:${item.title}`
}

function reviewKeyForLintFinding(item) {
  return `lint-finding:${item.findingType || "issue"}:${item.path || ""}:${item.title || item.label || ""}`
}

function reviewKeyForGraphInsight(item) {
  return `graph-insight:${item.insightType || "issue"}:${item.insightId || item.path || item.title || item.label || ""}`
}

function labelForIngestReview(item) {
  const prefixMap = {
    contradiction: "内容冲突",
    duplicate: "疑似重复",
    "missing-page": "缺少页面",
    suggestion: "后续建议",
  }
  return `${prefixMap[item.type] || "提取复核"}：${item.title}`
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
  if (key.startsWith("ingest-review:")) {
    const parts = key.split(":")
    return `已处理提取复核：${parts.slice(3).join(":") || key}`
  }
  if (key.startsWith("lint-finding:")) {
    return `已处理检查项：${key.split(":").slice(3).join(":") || key}`
  }
  if (key.startsWith("graph-insight:")) {
    return `已处理图谱洞察：${key.split(":").slice(3).join(":") || key}`
  }
  return key
}

function normalizeQueuedReviewItem(payload = {}) {
  const kind = String(payload.kind || "").trim() || "manual-review"
  const label = String(payload.label || "").trim() || "待处理事项"
  const title = String(payload.title || payload.label || "").trim() || label
  const path = String(payload.path || "").trim()
  const detail = String(payload.detail || "").trim()
  const prompt = String(payload.prompt || "").trim()
  const reviewType = String(payload.reviewType || "").trim()
  const insightType = String(payload.insightType || "").trim()
  const findingType = String(payload.findingType || "").trim()
  const insightId = String(payload.insightId || "").trim()
  const sourcePath = String(payload.sourcePath || "").trim()
  const searchQueries = Array.isArray(payload.searchQueries)
    ? payload.searchQueries.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 4)
    : []
  const affectedPages = Array.isArray(payload.affectedPages)
    ? payload.affectedPages.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6)
    : []

  let key = String(payload.key || "").trim()
  if (!key) {
    if (kind === "lint-finding") {
      key = reviewKeyForLintFinding({ findingType, path, title, label })
    } else if (kind === "graph-insight") {
      key = reviewKeyForGraphInsight({ insightType, insightId, path, title, label })
    } else {
      key = `manual-review:${kind}:${path}:${title}`
    }
  }

  return {
    key,
    kind,
    label,
    title,
    path,
    detail,
    prompt,
    reviewType,
    insightType,
    findingType,
    insightId,
    sourcePath,
    searchQueries,
    affectedPages,
  }
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
  const sourceLike = rawFiles.filter((file) => /\.(md|txt|markdown|pdf|doc|docx|pptx|xlsx|csv)$/i.test(file.name))
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
  const ingestReviewItems = []
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
      for (const review of entry.reviewItems || []) {
        ingestReviewItems.push({
          kind: "ingest-review",
          key: reviewKeyForIngestReview(review),
          label: labelForIngestReview(review),
          path: review.affectedPages?.[0] || review.sourcePath || "",
          sourcePath: review.sourcePath || entry.sourcePath,
          reviewType: review.type,
          title: review.title,
          detail: review.description || "",
          affectedPages: Array.isArray(review.affectedPages) ? review.affectedPages : [],
          searchQueries: Array.isArray(review.searchQueries) ? review.searchQueries : [],
          options: Array.isArray(review.options) ? review.options : [],
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
    ...ingestReviewItems,
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

  const customOpenReviewItems = reviewState
    .filter((item) => item?.status === "open" && item?.key && item?.kind)
    .map((item) => ({
      key: item.key,
      kind: item.kind,
      label: item.label || item.title || formatReviewLabelFromKey(item.key),
      title: item.title || item.label || "",
      path: item.path || "",
      detail: item.detail || "",
      prompt: item.prompt || "",
      sourcePath: item.sourcePath || "",
      reviewType: item.reviewType || "",
      insightType: item.insightType || "",
      findingType: item.findingType || "",
      affectedPages: Array.isArray(item.affectedPages) ? item.affectedPages : [],
      searchQueries: Array.isArray(item.searchQueries) ? item.searchQueries : [],
    }))

  const unresolvedReviewItems = [
    ...reviewItems.filter((item) => !resolvedKeys.has(item.key)),
    ...customOpenReviewItems,
  ].filter((item, index, list) => list.findIndex((candidate) => candidate.key === item.key) === index)

  const resolvedReviewItems = reviewState
    .filter((item) => item?.status === "resolved" && item?.key)
    .map((item) => ({
      key: item.key,
      kind: "resolved",
      label: item.label || formatReviewLabelFromKey(item.key),
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

export async function queueReviewItem(projectId, payload, deps) {
  const current = await loadReviewState(projectId, deps)
  const item = normalizeQueuedReviewItem(payload)
  const next = [
    ...current.filter((entry) => entry.key !== item.key),
    {
      ...item,
      status: "open",
      queuedAt: new Date().toISOString(),
    },
  ]
  await saveReviewState(projectId, next, deps)
  return { ok: true, item: { ...item, status: "open" } }
}
