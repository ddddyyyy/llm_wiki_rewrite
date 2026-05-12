import {
  outputLanguageInstruction,
  resolveOutputLanguage,
  stripMarkdownExtension,
  slugifyFileStem,
  titleFromFileName,
} from "../lib/text.js"
import { parseFileBlocks, stripFrontmatter } from "../lib/knowledge.js"
import { mergePageContent } from "../lib/page-merge.js"
import { parseReviewBlocks } from "../lib/review-blocks.js"
import { buildAnalysisPrompt, buildGenerationPrompt } from "../prompts/ingest.js"
import { buildPageMergeMessages } from "../prompts/page-merge.js"

export function createIngestService({
  loadSettings,
  callChatModel,
  documentExtractor,
  ingestCacheService,
  sourceTextCacheService,
  projectFs,
  projectService,
  wikiServiceDeps,
  rebuildWikiIndex,
  appendLog,
}) {
  const { ensureInsideProject, collectFiles, exists } = projectFs
  const { readProjectFile, writeProjectFile } = projectService
  const isSupportedSource = (fileName) => /\.(md|txt|markdown|pdf|docx|pptx|xlsx|csv)$/i.test(fileName)
  const needsPersistedExtractedText = (fileName) => /\.(pdf|docx|pptx|xlsx)$/i.test(fileName)
  const MAX_EXISTING_PAGE_SNIPPET_CHARS = 2500
  const MAX_EXISTING_PAGES_CONTEXT_CHARS = 10000
  const MAX_EXISTING_PAGES = 4

  async function loadProjectContext(projectId) {
    const [schema, purpose, index, overview] = await Promise.all([
      readProjectFile(projectId, "schema.md").then((item) => item.contents).catch(() => ""),
      readProjectFile(projectId, "purpose.md").then((item) => item.contents).catch(() => ""),
      readProjectFile(projectId, "wiki/index.md").then((item) => item.contents).catch(() => ""),
      readProjectFile(projectId, "wiki/overview.md").then((item) => item.contents).catch(() => ""),
    ])
    return { schema, purpose, index, overview }
  }

  function normalizeForMatch(value) {
    return String(value || "").toLowerCase()
  }

  function extractLookupTerms(text) {
    const normalized = String(text || "")
    const matches = normalized.match(/[\p{Script=Han}]{2,}|[A-Za-z][A-Za-z0-9_-]{2,}/gu) || []
    return [...new Set(matches.map((item) => item.trim().toLowerCase()).filter((item) => item.length >= 2))].slice(0, 48)
  }

  async function buildExistingPagesContext(projectId, sourcePath, fileName, analysis, raw) {
    const wikiRoot = ensureInsideProject(projectId, "wiki").fullPath
    const wikiFiles = await collectFiles(wikiRoot)
    const fileStem = stripMarkdownExtension(fileName).toLowerCase()
    const lookupTerms = new Set([
      ...extractLookupTerms(analysis),
      ...extractLookupTerms(fileName),
      ...extractLookupTerms(raw.slice(0, 4000)),
    ])
    const candidates = []

    for (const file of wikiFiles) {
      if (!file.path.endsWith(".md")) continue
      if (["index.md", "overview.md", "log.md"].includes(file.path)) continue
      const wikiPath = `wiki/${file.path}`
      const { contents } = await readProjectFile(projectId, wikiPath)
      const title = titleFromFileName(file.path)
      const body = stripFrontmatter(contents)
      const haystack = normalizeForMatch(`${file.path}\n${title}\n${body.slice(0, 3000)}`)
      let score = 0
      const slug = stripMarkdownExtension(file.name).toLowerCase()
      if (slug && analysis.toLowerCase().includes(slug)) score += 6
      if (title && analysis.toLowerCase().includes(title.toLowerCase())) score += 8
      if (fileStem && slug === fileStem) score += 4
      for (const term of lookupTerms) {
        if (!term) continue
        if (title.toLowerCase().includes(term)) score += 3
        else if (haystack.includes(term)) score += 1
      }
      if (contents.includes(`source_path: "${sourcePath}"`) || contents.includes(`source_path: ${sourcePath}`)) {
        score += 5
      }
      if (score <= 0) continue
      candidates.push({
        path: wikiPath,
        title,
        score,
        content: contents,
      })
    }

    candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    const selected = []
    let totalChars = 0
    for (const candidate of candidates) {
      if (selected.length >= MAX_EXISTING_PAGES) break
      const snippet = candidate.content.slice(0, MAX_EXISTING_PAGE_SNIPPET_CHARS).trim()
      if (!snippet) continue
      const block = `---EXISTING PAGE: ${candidate.path}---\n${snippet}\n---END EXISTING PAGE---`
      if (totalChars + block.length > MAX_EXISTING_PAGES_CONTEXT_CHARS && selected.length > 0) break
      selected.push(block)
      totalChars += block.length
    }

    return selected.join("\n\n")
  }

  async function ingestSourceFile(projectId, file, projectContext, settings, onProgress = () => {}, options = {}) {
    const { force = false } = options
    const slug = slugifyFileStem(file.name)
    const wikiRelative = `wiki/sources/${slug}.md`
    const sourcePath = `raw/sources/${file.path}`
    const folderContext = file.path.includes("/") ? file.path.split("/").slice(0, -1).join("/") : ""

    onProgress({ stage: "reading", message: `正在读取 ${file.path}...`, file: file.path })

    const { text: raw, chars } = await documentExtractor.extractText(file.fullPath)
    if (!raw.trim()) {
      return {
        skipped: true,
        sourcePath,
        wikiPath: wikiRelative,
      }
    }
    await sourceTextCacheService.saveCachedText(projectId, sourcePath, raw)
    const cachedIngest = !force
      ? await ingestCacheService.checkIngestCache(projectId, sourcePath, raw)
      : null
    if (cachedIngest) {
      onProgress({
        stage: "finalizing",
        message: `来源未变化，已复用缓存结果：${file.path}...`,
        file: file.path,
      })
      return {
        skipped: false,
        cached: true,
        sourcePath,
        wikiPath: wikiRelative,
        title: titleFromFileName(file.path),
        sourceChars: chars,
        written: cachedIngest.filesWritten,
        warnings: cachedIngest.warnings,
        reviewItems: cachedIngest.reviewItems,
      }
    }
    const outputLanguage = resolveOutputLanguage(settings, raw)

    onProgress({ stage: "analyzing", message: `正在分析 ${file.path}...`, file: file.path })
    const truncatedSource = raw.slice(0, 50000)
    const promptLanguage = outputLanguage === "English" ? "en" : "zh-CN"
    const analysis = await callChatModel(settings, [
      {
        role: "system",
        content: buildAnalysisPrompt({
          schema: projectContext.schema,
          purpose: projectContext.purpose,
          index: projectContext.index,
          overview: projectContext.overview,
          sourcePath,
          sourceContent: truncatedSource,
          targetLanguage: promptLanguage,
          folderContext,
        }),
      },
      {
        role: "user",
        content: [
          promptLanguage === "en" ? "Analyze this source document:" : "请分析这个来源文档：",
          "",
          promptLanguage === "en" ? `**File:** ${file.name}` : `**文件：** ${file.name}`,
          ...(folderContext
            ? ["", promptLanguage === "en" ? `**Folder context:** ${folderContext}` : `**目录上下文：** ${folderContext}`]
            : []),
          "",
          "---",
          "",
          truncatedSource,
        ].join("\n"),
      },
    ])

    onProgress({ stage: "generating", message: `正在为 ${file.path} 生成知识页...`, file: file.path })
    const existingPagesContext = await buildExistingPagesContext(projectId, sourcePath, file.name, analysis, raw)
    const generation = await callChatModel(settings, [
      {
        role: "system",
        content: buildGenerationPrompt({
          schema: projectContext.schema,
          purpose: projectContext.purpose,
          index: projectContext.index,
          overview: projectContext.overview,
          sourcePath,
          sourceContent: truncatedSource,
          targetLanguage: promptLanguage,
          folderContext,
          existingPagesContext,
        }),
      },
      {
        role: "user",
        content: [
          promptLanguage === "en"
            ? `Source document to process: **${file.name}**`
            : `待处理的来源文档：**${file.name}**`,
          "",
          promptLanguage === "en"
            ? "The Stage 1 analysis below is CONTEXT to inform your output. Do NOT echo its tables, bullet points, or prose."
            : "下面的第一阶段分析仅作为生成时的上下文，请不要回显其中的表格、要点或段落。",
          promptLanguage === "en"
            ? "Your output must be FILE blocks as specified in the system prompt — nothing else."
            : "你的输出必须严格遵循 system prompt 中定义的 FILE blocks 格式，不要输出其他内容。",
          "",
          promptLanguage === "en"
            ? "## Stage 1 Analysis (context only — do not repeat)"
            : "## 第一阶段分析（仅作上下文，请勿重复）",
          "",
          analysis,
          "",
          promptLanguage === "en" ? "## Original Source Content" : "## 原始来源内容",
          "",
          truncatedSource,
          "",
          "---",
          "",
          promptLanguage === "en"
            ? `Now emit the FILE blocks for the wiki files derived from **${file.name}**.`
            : `现在请直接输出由 **${file.name}** 派生的 wiki FILE blocks。`,
          promptLanguage === "en"
            ? "Your response MUST begin with `---FILE:` as the very first characters. No preamble. Start immediately."
            : "你的回复必须以 `---FILE:` 作为最开头的字符，不要写前言，不要解释，直接开始。",
          outputLanguageInstruction(outputLanguage),
        ].join("\n"),
      },
    ])

    const { blocks, warnings } = parseFileBlocks(generation)
    const reviewItems = parseReviewBlocks(generation, sourcePath)
    if (blocks.length === 0) {
      throw new Error(`Generation produced no valid FILE blocks for ${sourcePath}`)
    }
    const wroteIndex = blocks.some((block) => block.path === "wiki/index.md")
    const written = []
    onProgress({ stage: "writing", message: `正在写入 ${blocks.length} 个知识文件：${file.path}...`, file: file.path })
    for (const block of blocks) {
      const contentToWrite = await resolveWriteContent(projectId, block.path, block.content, settings, sourcePath)
      await writeProjectFile(projectId, block.path, contentToWrite)
      written.push(block.path)
    }
    if (!wroteIndex) {
      await rebuildWikiIndex(projectId, wikiServiceDeps)
    }
    if (written.length > 0) {
      await ingestCacheService.saveIngestCache(projectId, sourcePath, raw, {
        filesWritten: written,
        reviewItems,
        warnings,
      })
    }
    return {
      skipped: false,
      cached: false,
      sourcePath,
      wikiPath: wikiRelative,
      title: titleFromFileName(file.path),
      sourceChars: chars,
      written,
      analysis,
      warnings,
      reviewItems,
    }
  }

  async function ingestProjectWithProgress(projectId, onProgress = () => {}, options = {}) {
    const settings = await loadSettings()
    if (!settings?.llm?.enabled) {
      throw new Error("请先启用并配置 LLM，才能运行知识提取。")
    }
    onProgress({ stage: "scanning", message: "正在扫描源文件..." })
    const sourceRoot = ensureInsideProject(projectId, "raw/sources").fullPath
    const files = await collectFiles(sourceRoot)
    const requestedSourcePaths = new Set(
      (Array.isArray(options.sourcePaths) ? options.sourcePaths : [])
        .map((item) => String(item || "").trim().replace(/^\/+/, ""))
        .filter((item) => item.startsWith("raw/sources/")),
    )
    const sourceFiles = files.filter((file) => {
      if (!isSupportedSource(file.name)) return false
      if (requestedSourcePaths.size === 0) return true
      return requestedSourcePaths.has(`raw/sources/${file.path}`)
    })
    const ingested = []
    const skipped = []

    for (const file of sourceFiles) {
      const projectContext = await loadProjectContext(projectId)
      const result = await ingestSourceFile(projectId, file, projectContext, settings, onProgress, { force: false })
      if (result.skipped) skipped.push(file.path)
      else ingested.push(result)
    }

    if (ingested.length > 0) {
      onProgress({ stage: "finalizing", message: "正在更新日志和项目状态..." })
      await appendLog(projectId, `已提取 ${ingested.length} 个源文件，并写入 wiki/sources`, wikiServiceDeps)
    }
    return { ok: true, ingested, skipped }
  }

  async function reingestSourceWithProgress(projectId, sourceRelativePath, onProgress = () => {}) {
    const settings = await loadSettings()
    if (!settings?.llm?.enabled) {
      throw new Error("请先启用并配置 LLM，才能运行知识提取。")
    }
    const normalizedSource = String(sourceRelativePath || "").trim().replace(/^\/+/, "")
    if (!normalizedSource.startsWith("raw/sources/")) {
      throw new Error("只能重新提取 raw/sources 下的来源文件")
    }
    const resolved = ensureInsideProject(projectId, normalizedSource)
    if (!(await exists(resolved.fullPath))) {
      throw new Error("来源文件不存在")
    }
    const file = {
      name: resolved.normalized.split("/").pop() || resolved.normalized,
      path: resolved.normalized.replace(/^raw\/sources\//, ""),
      fullPath: resolved.fullPath,
    }
    if (!isSupportedSource(file.name)) {
      throw new Error("当前文件类型暂不支持重新提取")
    }

    const projectContext = await loadProjectContext(projectId)
    const result = await ingestSourceFile(projectId, file, projectContext, settings, onProgress, { force: true })
    if (result.skipped) {
      throw new Error("未能从该来源文件提取出可用文本")
    }
    onProgress({ stage: "finalizing", message: "正在更新日志和项目状态...", file: file.path })
    await appendLog(projectId, `已重新提取来源文件 ${normalizedSource}`, wikiServiceDeps)
    return { ok: true, result }
  }

  return {
    ingestProjectWithProgress,
    reingestSourceWithProgress,
  }

  async function resolveWriteContent(projectId, relativePath, incomingContent, settings, sourceFilePath) {
    if (shouldOverwriteWholePage(relativePath)) {
      return incomingContent
    }

    let existingContent = null
    try {
      const existing = await readProjectFile(projectId, relativePath)
      existingContent = existing.contents
    } catch {
      existingContent = null
    }
    if (!existingContent) return incomingContent

    return mergePageContent(
      incomingContent,
      existingContent,
      buildPageMerger(settings),
      {
        sourceFileName: sourceFilePath.split("/").pop() || sourceFilePath,
        pagePath: relativePath,
      },
    )
  }

  function shouldOverwriteWholePage(relativePath) {
    return (
      relativePath === "wiki/index.md"
      || relativePath.endsWith("/index.md")
      || relativePath === "wiki/overview.md"
      || relativePath.endsWith("/overview.md")
      || relativePath === "wiki/log.md"
      || relativePath.endsWith("/log.md")
    )
  }

  function buildPageMerger(settings) {
    return async (existingContent, incomingContent, sourceFileName) => {
      const outputLanguage = resolveOutputLanguage(settings, `${existingContent}\n${incomingContent}`)
      return callChatModel(settings, buildPageMergeMessages({
        existingContent,
        incomingContent,
        sourceFileName,
        outputLanguage,
      }))
    }
  }
}
