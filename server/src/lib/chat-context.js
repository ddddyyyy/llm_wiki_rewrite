import {
  normalizeTextForSearch,
  resolveRelatedWikiPaths,
  snippetAround,
  stripFrontmatter,
} from "./knowledge.js"
import { readFrontmatterValue, titleFromFileName } from "./text.js"
import { buildRetrievalGraph, getRelatedNodes } from "./retrieval-graph.js"

const STOP_WORDS = new Set([
  "的", "是", "了", "什么", "在", "有", "和", "与", "对", "从",
  "the", "is", "a", "an", "what", "how", "are", "was", "were",
  "do", "does", "did", "be", "been", "being", "have", "has", "had",
  "it", "its", "in", "on", "at", "to", "for", "of", "with", "by",
  "this", "that", "these", "those",
])

export function buildSearchTerms(query) {
  const normalized = normalizeTextForSearch(query)
  const wordTerms = normalized
    .split(/[\s,，。！？、；：""''（）()\-_/\\·~～…]+/)
    .filter((token) => token.length > 1)
    .filter((token) => !STOP_WORDS.has(token))

  const cjkOnly = String(query || "").replace(/[^\u3400-\u9fff]/g, "")
  const grams = new Set()
  const chars = new Set()
  for (let index = 0; index < cjkOnly.length - 1; index += 1) {
    grams.add(cjkOnly.slice(index, index + 2))
  }
  if (cjkOnly.length > 0) {
    if (grams.size === 0) grams.add(cjkOnly)
    for (const char of cjkOnly) {
      if (!STOP_WORDS.has(char)) chars.add(char)
    }
  }

  const exactPhrase = normalized.trim()
  return [...new Set([...wordTerms, ...grams, ...chars, ...(exactPhrase ? [exactPhrase] : [])])]
}

export function computeContextBudget(maxContextSize = 204800) {
  const maxCtx = Math.max(8000, Number(maxContextSize) || 204800)
  const indexBudget = Math.max(1200, Math.floor(maxCtx * 0.05))
  const pageBudget = Math.max(12000, Math.floor(maxCtx * 0.32))
  const maxPageSize = Math.max(2200, Math.min(8000, Math.floor(pageBudget * 0.55)))
  return { maxCtx, indexBudget, pageBudget, maxPageSize }
}

export function trimIndexByQuery(rawIndex, query, indexBudget) {
  const content = String(rawIndex || "")
  if (!content || content.length <= indexBudget) return content

  const tokens = buildSearchTerms(query)
  const lines = content.split("\n")
  const kept = []
  let size = 0

  for (const line of lines) {
    const lower = line.toLowerCase()
    const isHeader = line.startsWith("##")
    const isRelevant = tokens.some((token) => lower.includes(token.toLowerCase()))
    if (!isHeader && !isRelevant) continue
    if (size + line.length + 1 > indexBudget) continue
    kept.push(line)
    size += line.length + 1
  }

  const next = kept.join("\n")
  if (!next) return content.slice(0, indexBudget)
  return next.length < content.length ? `${next}\n\n[...index trimmed to relevant entries...]` : next
}

function filePriority(filePath) {
  if (filePath === "wiki/overview.md") return 100
  if (filePath === "wiki/index.md") return 95
  if (filePath.startsWith("wiki/sources/")) return 82
  if (filePath.startsWith("wiki/concepts/")) return 78
  if (filePath.startsWith("wiki/entities/")) return 74
  if (filePath.startsWith("wiki/queries/")) return 70
  if (filePath.startsWith("wiki/synthesis/")) return 66
  if (filePath.startsWith("wiki/")) return 52
  return 10
}

export async function buildFallbackResults(projectId, deps) {
  const { ensureInsideProject, collectFiles, readFile } = deps
  const projectRoot = ensureInsideProject(projectId).projectRoot
  const files = await collectFiles(projectRoot)
  const wikiFiles = files
    .filter((file) => /\.md$/i.test(file.name) && file.path.startsWith("wiki/") && file.path !== "wiki/log.md")
    .sort((a, b) => filePriority(b.path) - filePriority(a.path) || a.path.localeCompare(b.path))
    .slice(0, 8)

  const results = []
  for (const file of wikiFiles) {
    const contents = await readFile(file.fullPath, "utf8")
    results.push({
      path: file.path,
      title: readFrontmatterValue(contents, "title") || titleFromFileName(file.path),
      created: readFrontmatterValue(contents, "created"),
      updated: readFrontmatterValue(contents, "updated"),
      score: filePriority(file.path),
      titleMatch: file.path === "wiki/overview.md" || file.path === "wiki/index.md",
      snippet: snippetAround(stripFrontmatter(contents), ""),
    })
  }
  return results
}

export async function buildChatContext(projectId, query, searchResults, settings, deps) {
  const {
    ensureInsideProject,
    collectFiles,
    readProjectFile,
    readChatContextFile,
  } = deps
  const budgets = computeContextBudget(settings?.llm?.maxContextSize)
  const [rawIndex, purpose, overview] = await Promise.all([
    readProjectFile(projectId, "wiki/index.md").then((item) => item.contents).catch(() => ""),
    readProjectFile(projectId, "purpose.md").then((item) => item.contents).catch(() => ""),
    readProjectFile(projectId, "wiki/overview.md").then((item) => item.contents).catch(() => ""),
  ])

  const wikiResults = searchResults
    .filter((item) => item.path.startsWith("wiki/"))
    .sort((a, b) => {
      const titleMatchDiff = Number(Boolean(b.titleMatch)) - Number(Boolean(a.titleMatch))
      if (titleMatchDiff !== 0) return titleMatchDiff
      const priorityDiff = filePriority(b.path) - filePriority(a.path)
      if (priorityDiff !== 0) return priorityDiff
      const scoreDiff = (b.score || 0) - (a.score || 0)
      if (scoreDiff !== 0) return scoreDiff
      return a.path.localeCompare(b.path)
    })
  const wikiLimit = wikiResults.length > 0 ? 5 : 0
  const reservedWiki = wikiResults.slice(0, wikiLimit)
  const topResults = [...reservedWiki]
  const seedResults = topResults.filter((item) => item.path.startsWith("wiki/")).slice(0, 4)

  const graph = await buildRetrievalGraph(projectId, { ensureInsideProject, collectFiles, readProjectFile })
  const graphExpansions = []
  const expandedIds = new Set()
  const searchHitPaths = new Set(topResults.map((item) => item.path))
  for (const result of topResults) {
    const nodeId = pathBasenameWithoutExtension(result.path)
    const related = getRelatedNodes(nodeId, graph, 3)
    for (const { node, relevance } of related) {
      if (relevance < 2.0) continue
      if (searchHitPaths.has(node.path)) continue
      if (expandedIds.has(node.id)) continue
      expandedIds.add(node.id)
      graphExpansions.push({ title: node.title, path: node.path, relevance })
    }
  }
  graphExpansions.sort((a, b) => b.relevance - a.relevance)

  const relatedCandidates = []
  const relatedSeen = new Set()
  for (const item of seedResults.filter((result) => result.path.startsWith("wiki/"))) {
    const full = await readProjectFile(projectId, item.path).then((r) => r.contents).catch(() => item.snippet || "")
    const relatedPaths = await resolveRelatedWikiPaths(projectId, full, { readProjectFile })
    for (const relatedPath of relatedPaths) {
      if (relatedSeen.has(relatedPath)) continue
      relatedSeen.add(relatedPath)
      relatedCandidates.push(relatedPath)
    }
  }

  const selectedPages = []
  const selectedPaths = new Set()
  let usedChars = 0

  async function tryAddPage(pagePath, priority = 0) {
    if (!pagePath || selectedPaths.has(pagePath) || usedChars >= budgets.pageBudget) return false
    try {
      const { contents, title } = await readChatContextFile(projectId, pagePath)
      const truncated = contents.length > budgets.maxPageSize
        ? `${contents.slice(0, budgets.maxPageSize)}\n\n[...truncated...]`
        : contents
      if (usedChars + truncated.length > budgets.pageBudget) return false
      selectedPaths.add(pagePath)
      usedChars += truncated.length
      selectedPages.push({
        path: pagePath,
        title: title || readFrontmatterValue(contents, "title") || titleFromFileName(pagePath),
        content: truncated,
        priority,
      })
      return true
    } catch {
      return false
    }
  }

  await tryAddPage("wiki/overview.md", -1)
  for (const result of reservedWiki.filter((item) => item.titleMatch)) {
    await tryAddPage(result.path, 0)
  }
  for (const result of reservedWiki.filter((item) => !item.titleMatch)) {
    await tryAddPage(result.path, 1)
  }
  for (const expansion of graphExpansions) {
    await tryAddPage(expansion.path, 2)
  }
  for (const relatedPath of relatedCandidates) {
    await tryAddPage(relatedPath, 3)
  }
  if (selectedPages.length === 0) {
    await tryAddPage("wiki/index.md", 5)
  }

  const pagesContext = selectedPages.length > 0
    ? selectedPages.map((page, index) => `### [${index + 1}] ${page.title}\nPath: ${page.path}\n\n${page.content}`).join("\n\n---\n\n")
    : "(No wiki pages or source excerpts found)"

  const pageList = selectedPages.map((page, index) => `[${index + 1}] ${page.title} (${page.path})`).join("\n")

  return {
    purpose,
    overview,
    rawIndex,
    trimmedIndex: trimIndexByQuery(rawIndex, query, budgets.indexBudget),
    selectedPages,
    pagesContext,
    pageList,
  }
}

function pathBasenameWithoutExtension(filePath) {
  return String(filePath || "").split("/").pop()?.replace(/\.md$/i, "") || ""
}

export function parseCitedPageNumbers(answer, maxPage) {
  const match = String(answer || "").match(/<!--\s*cited:\s*([0-9,\s]+)\s*-->/i)
  if (!match) return []
  return match[1]
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= maxPage)
}

export function stripCitationComment(answer) {
  return String(answer || "").replace(/\n?\s*<!--\s*cited:\s*([0-9,\s]+)\s*-->\s*$/i, "").trim()
}
