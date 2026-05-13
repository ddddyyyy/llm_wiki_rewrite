import {
  isGreeting,
  readFrontmatterValue,
  resolveOutputLanguage,
  titleFromFileName,
} from "../lib/text.js"
import {
  snippetAround,
  stripFrontmatter,
} from "../lib/knowledge.js"
import {
  buildChatContext,
  buildFallbackResults,
  buildSearchTerms,
  dedupeAdjacentCitations,
  parseCitedPageNumbers,
  stripCitationComment,
} from "../lib/chat-context.js"
import { buildChatSystemPrompt, buildChatUserPrompt, buildGreetingPrompt } from "../prompts/chat.js"

export function createKnowledgeBaseService({
  projectFs,
  projectService,
  loadSettings,
  callChatModel,
  sourceTextCacheService,
}) {
  const { ensureInsideProject, collectFiles, readFile } = projectFs
  const { readProjectFile } = projectService
  const MAX_HISTORY_MESSAGES = 10
  const TEXT_SOURCE_EXTS = /\.(md|txt|markdown|csv)$/i
  const BINARY_SOURCE_EXTS = /\.(pdf|doc|docx|pptx|xlsx)$/i
  const FILENAME_EXACT_BONUS = 200
  const PHRASE_IN_TITLE_BONUS = 50
  const PHRASE_IN_CONTENT_PER_OCC = 20
  const MAX_PHRASE_OCC_COUNTED = 10
  const TITLE_TOKEN_WEIGHT = 5
  const CONTENT_TOKEN_WEIGHT = 1
  const TRIM_PUNCT_RE =
    /^[\s,，。！？、；：""''（）()\-_/\\·~～…]+|[\s,，。！？、；：""''（）()\-_/\\·~～…]+$/g

  function tokenMatchScore(text, tokens) {
    const lower = String(text || "").toLowerCase()
    let score = 0
    for (const token of tokens) {
      if (lower.includes(token)) score += 1
    }
    return score
  }

  function countOccurrences(haystackLower, needleLower) {
    if (!needleLower) return 0
    let count = 0
    let position = 0
    while (true) {
      const nextIndex = haystackLower.indexOf(needleLower, position)
      if (nextIndex === -1) break
      count += 1
      position = nextIndex + needleLower.length
    }
    return count
  }

  async function readChatContextFile(projectId, filePath) {
    if (String(filePath || "").startsWith("wiki/")) {
      const { contents } = await readProjectFile(projectId, filePath)
      return {
        contents,
        title: readFrontmatterValue(contents, "title") || titleFromFileName(filePath),
      }
    }

    if (String(filePath || "").startsWith("raw/sources/")) {
      if (TEXT_SOURCE_EXTS.test(filePath)) {
        const resolved = ensureInsideProject(projectId, filePath)
        const contents = await readFile(resolved.fullPath, "utf8")
        return {
          contents,
          title: titleFromFileName(filePath),
        }
      }
      if (BINARY_SOURCE_EXTS.test(filePath)) {
        const cached = await sourceTextCacheService.ensureCachedText(projectId, filePath)
        if (cached?.text?.trim()) {
          return {
            contents: String(cached.text || ""),
            title: titleFromFileName(filePath),
          }
        }
      }
    }

    throw new Error(`Unsupported chat context file: ${filePath}`)
  }

  function rawSourceScoreBonus(filePath) {
    if (/\.(pdf|doc|docx)$/i.test(filePath)) return -3
    if (/\.(pptx|xlsx)$/i.test(filePath)) return -5
    return -4
  }

  async function searchProject(projectId, query) {
    const terms = buildSearchTerms(query)
    if (terms.length === 0) return { results: [] }
    const queryPhrase = String(query || "").trim().toLowerCase().replace(TRIM_PUNCT_RE, "")

    const projectRoot = ensureInsideProject(projectId).projectRoot
    const files = await collectFiles(projectRoot)
    const results = []

    const searchable = files.filter((file) => {
      if (file.path === "wiki/log.md") return false
      if (file.path.startsWith(".llm-wiki/source-text-cache/")) return false
      if (file.path.startsWith(".llm-wiki/")) return false
      if (file.path.startsWith("wiki/")) return /\.(md|txt|markdown)$/i.test(file.name)
      if (file.path.startsWith("raw/sources/")) return TEXT_SOURCE_EXTS.test(file.name) || BINARY_SOURCE_EXTS.test(file.name)
      return false
    })

    for (const file of searchable) {
      let contents = ""
      if (TEXT_SOURCE_EXTS.test(file.name) || file.path.startsWith("wiki/")) {
        contents = await readFile(file.fullPath, "utf8")
      } else if (BINARY_SOURCE_EXTS.test(file.name)) {
        const cached = await sourceTextCacheService.loadCachedText(projectId, file.path)
        contents = cached?.text || ""
      }
      if (!String(contents || "").trim()) continue
      const title = readFrontmatterValue(contents, "title") || titleFromFileName(file.path)
      const fileStem = file.name.replace(/\.[^.]+$/, "").toLowerCase()
      const titleText = `${title} ${file.name}`
      const titleLower = titleText.toLowerCase()
      const contentLower = String(contents || "").toLowerCase()
      const filenameExact = Boolean(queryPhrase) && fileStem === queryPhrase
      const titleHasPhrase = Boolean(queryPhrase) && titleLower.includes(queryPhrase)
      const contentPhraseOcc = Math.min(
        countOccurrences(contentLower, queryPhrase),
        MAX_PHRASE_OCC_COUNTED,
      )
      const titleTokenScore = tokenMatchScore(titleText, terms)
      const contentTokenScore = tokenMatchScore(contents, terms)
      let score =
        (filenameExact ? FILENAME_EXACT_BONUS : 0)
        + (titleHasPhrase ? PHRASE_IN_TITLE_BONUS : 0)
        + contentPhraseOcc * PHRASE_IN_CONTENT_PER_OCC
        + titleTokenScore * TITLE_TOKEN_WEIGHT
        + contentTokenScore * CONTENT_TOKEN_WEIGHT
      if (score === 0) continue
      if (file.path.startsWith("wiki/")) score += 4
      if (file.path.startsWith("wiki/sources/")) score += 2
      if (file.path.startsWith("raw/sources/")) score += rawSourceScoreBonus(file.path)
      results.push({
        path: file.path,
        title,
        created: readFrontmatterValue(contents, "created"),
        updated: readFrontmatterValue(contents, "updated"),
        score,
        titleMatch: filenameExact || titleHasPhrase || titleTokenScore > 0,
        snippet: snippetAround(stripFrontmatter(contents), query),
      })
    }

    results.sort((a, b) => {
      const titleMatchDiff = Number(Boolean(b.titleMatch)) - Number(Boolean(a.titleMatch))
      if (titleMatchDiff !== 0) return titleMatchDiff
      if (b.score !== a.score) return b.score - a.score
      return a.path.localeCompare(b.path)
    })
    return { results: results.slice(0, 8) }
  }

  async function chatProject(projectId, question, options = {}) {
    const turn = await prepareChatTurn(projectId, question, options)
    if (turn.immediate) {
      return turn.immediate
    }
    const rawAnswer = await callChatModel(turn.settings, turn.llmMessages)
    return finalizeChatAnswer(rawAnswer, turn.selectedPages)
  }

  async function prepareChatTurn(projectId, question, options = {}) {
    const query = String(question || "").trim()
    if (!query) throw new Error("请输入问题")
    const settings = await loadSettings()
    if (!settings?.llm?.enabled) {
      throw new Error("请先启用并配置 LLM，才能进行问答。")
    }
    const historyMessages = Array.isArray(options.historyMessages)
      ? options.historyMessages
          .filter((item) => item && (item.role === "user" || item.role === "assistant"))
          .slice(-MAX_HISTORY_MESSAGES)
          .map((item) => ({
            role: item.role,
            content: String(item.content || ""),
          }))
      : []
    const responseLanguage = resolveOutputLanguage(settings, query)
    const greetingOnly = isGreeting(query)
    if (greetingOnly) {
      return {
        settings,
        query,
        historyMessages,
        selectedPages: [],
        llmMessages: [
          {
            role: "system",
            content: buildGreetingPrompt(projectId, responseLanguage),
          },
          ...historyMessages,
          {
            role: "user",
            content: query,
          },
        ],
      }
    }

    let { results } = await searchProject(projectId, query)
    const fallbackLanguage = responseLanguage
    if (results.length === 0) {
      results = await buildFallbackResults(projectId, { ensureInsideProject, collectFiles, readFile })
    }
    if (results.length === 0) {
      return {
        settings,
        query,
        historyMessages,
        selectedPages: [],
        immediate: {
          answer: fallbackLanguage === "English"
            ? "I could not find matching wiki or source content for that question yet. Try ingesting source files first, or ask with terms that appear in the project."
            : "暂时还没有找到能回答这个问题的 wiki 或源文件内容。可以先运行知识提取，或者换成项目里已经出现过的关键词再试。",
          references: [],
        },
      }
    }

    const chatContext = await buildChatContext(projectId, query, results, settings, {
      ensureInsideProject,
      collectFiles,
      readProjectFile,
      readChatContextFile,
    })
    const systemMessage = {
      role: "system",
      content: buildChatSystemPrompt({
        projectId,
        query,
        responseLanguage,
        chatContext,
      }),
    }
    const llmMessages = [systemMessage, ...historyMessages]
    llmMessages.push({
      role: "user",
      content: buildChatUserPrompt(query, settings, historyMessages.length > 0),
    })
    return {
      settings,
      query,
      historyMessages,
      selectedPages: chatContext.selectedPages,
      llmMessages,
    }
  }

  function finalizeChatAnswer(rawAnswer, selectedPages = []) {
    const normalizedAnswer = dedupeAdjacentCitations(rawAnswer)
    const citedNumbers = parseCitedPageNumbers(normalizedAnswer, selectedPages.length)
    const references = citedNumbers.length > 0
      ? citedNumbers
        .map((value) => {
          const page = selectedPages[value - 1]
          if (!page) return null
          return {
            citation: value,
            path: page.path,
            title: page.title,
          }
        })
        .filter(Boolean)
      : selectedPages.slice(0, 4).map((page, index) => ({
        citation: index + 1,
        path: page.path,
        title: page.title,
      }))
    const answer = stripCitationComment(normalizedAnswer)
    return { answer, references }
  }

  return {
    searchProject,
    chatProject,
    prepareChatTurn,
    finalizeChatAnswer,
  }
}
