import {
  outputLanguageInstruction,
  readFrontmatterValue,
  resolveOutputLanguage,
  slugifyFileStem,
  titleFromFileName,
} from "../lib/text.js"
import { parseFileBlocks } from "../lib/knowledge.js"
import { mergePageContent } from "../lib/page-merge.js"
import { parseReviewBlocks } from "../lib/review-blocks.js"
import { buildAnalysisPrompt, buildGenerationPrompt } from "../prompts/ingest.js"

export function createIngestService({
  loadSettings,
  callChatModel,
  documentExtractor,
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

  function parseSourcesField(content) {
    const match = String(content || "").match(/^---\n([\s\S]*?)\n---/)
    if (!match) return []
    const frontmatter = match[1]
    const inline = frontmatter.match(/^sources:\s*\[(.*?)\]\s*$/m)
    if (inline) {
      return inline[1]
        .split(",")
        .map((item) => item.replace(/^["'\s]+|["'\s]+$/g, ""))
        .filter(Boolean)
    }
    const lines = frontmatter.split("\n")
    const sources = []
    let inSources = false
    for (const line of lines) {
      if (/^sources:\s*$/.test(line.trim())) {
        inSources = true
        continue
      }
      if (!inSources) continue
      if (!/^\s*-\s+/.test(line)) break
      const item = line.replace(/^\s*-\s+/, "").replace(/^["']|["']$/g, "").trim()
      if (item) sources.push(item)
    }
    return sources
  }

  async function shouldSkipExistingSourcePage(projectId, wikiRelative, sourcePath) {
    const wikiFull = ensureInsideProject(projectId, wikiRelative).fullPath
    if (!(await exists(wikiFull))) return false
    const { contents } = await readProjectFile(projectId, wikiRelative)
    const pageSources = parseSourcesField(contents)
    const sourceFileName = sourcePath.split("/").pop() || sourcePath
    const recordedRawPath = readFrontmatterValue(contents, "source_path")
    if (pageSources.length === 0 && !recordedRawPath) return false
    return pageSources.includes(sourceFileName) || recordedRawPath === sourcePath
  }

  async function loadProjectContext(projectId) {
    const [schema, purpose, index, overview] = await Promise.all([
      readProjectFile(projectId, "schema.md").then((item) => item.contents).catch(() => ""),
      readProjectFile(projectId, "purpose.md").then((item) => item.contents).catch(() => ""),
      readProjectFile(projectId, "wiki/index.md").then((item) => item.contents).catch(() => ""),
      readProjectFile(projectId, "wiki/overview.md").then((item) => item.contents).catch(() => ""),
    ])
    return { schema, purpose, index, overview }
  }

  async function ingestSourceFile(projectId, file, projectContext, settings, onProgress = () => {}, options = {}) {
    const { force = false } = options
    const slug = slugifyFileStem(file.name)
    const wikiRelative = `wiki/sources/${slug}.md`
    const sourcePath = `raw/sources/${file.path}`
    const folderContext = file.path.includes("/") ? file.path.split("/").slice(0, -1).join("/") : ""

    onProgress({ stage: "reading", message: `正在读取 ${file.path}...`, file: file.path })

    if (!force && await shouldSkipExistingSourcePage(projectId, wikiRelative, sourcePath)) {
      if (needsPersistedExtractedText(file.name)) {
        const cached = await sourceTextCacheService.loadCachedText(projectId, sourcePath)
        if (!cached?.text?.trim()) {
          const { text: raw } = await documentExtractor.extractText(file.fullPath)
          if (raw.trim()) {
            await sourceTextCacheService.saveCachedText(projectId, sourcePath, raw)
          }
        }
      }
      return {
        skipped: true,
        sourcePath,
        wikiPath: wikiRelative,
      }
    }

    const { text: raw, chars } = await documentExtractor.extractText(file.fullPath)
    if (!raw.trim()) {
      return {
        skipped: true,
        sourcePath,
        wikiPath: wikiRelative,
      }
    }
    await sourceTextCacheService.saveCachedText(projectId, sourcePath, raw)
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
    return {
      skipped: false,
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
      const promptLanguage = outputLanguage === "English" ? "en" : "zh-CN"
      return callChatModel(settings, [
        {
          role: "system",
          content: [
            promptLanguage === "en"
              ? "You are merging two versions of the same wiki page into one coherent document."
              : "你正在把同一个 wiki 页面的两个版本合并成一个连贯的文档。",
            promptLanguage === "en"
              ? "Both versions describe the same entity / concept / source topic; one is already on disk, the other was just generated from a different source document."
              : "两个版本描述的是同一个实体、概念或来源主题；一个已经存在于磁盘中，另一个刚刚由不同来源文档生成。",
            "",
            promptLanguage === "en" ? "Output ONE merged version that:" : "请输出一个合并后的版本，要求：",
            promptLanguage === "en"
              ? "- Preserves every factual claim from both versions; do not silently drop content"
              : "- 保留两个版本中的事实信息，不要静默丢失内容",
            promptLanguage === "en"
              ? "- Eliminates redundancy when both versions state the same fact"
              : "- 对重复表述做去重",
            promptLanguage === "en"
              ? "- Reorganizes sections so the structure is logical for the merged topic"
              : "- 重新组织章节，使结构更适合合并后的主题",
            promptLanguage === "en"
              ? "- Keeps [[wikilink]] references intact"
              : "- 保留 [[wikilink]] 交叉链接",
            "",
            promptLanguage === "en" ? "Output requirements:" : "输出要求：",
            promptLanguage === "en"
              ? "- The first line must be `---`"
              : "- 第一行必须是 `---`",
            promptLanguage === "en"
              ? "- Output the complete file: YAML frontmatter + body"
              : "- 输出完整文件：YAML frontmatter + 正文",
            promptLanguage === "en"
              ? "- No preamble, no explanatory prose"
              : "- 不要写前言或解释性文字",
            promptLanguage === "en"
              ? "- The caller will deterministically rewrite `sources`, `tags`, `related`, and `updated`; your job is to produce the best merged page"
              : "- 调用方会确定性地重写 `sources`、`tags`、`related` 和 `updated`；你的任务是产出最佳的合并页面",
            outputLanguageInstruction(outputLanguage),
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            promptLanguage === "en"
              ? `## Existing version on disk`
              : "## 磁盘中的现有版本",
            "",
            existingContent,
            "",
            "---",
            "",
            promptLanguage === "en"
              ? `## Newly generated version (from ${sourceFileName})`
              : `## 新生成的版本（来自 ${sourceFileName}）`,
            "",
            incomingContent,
            "",
            "---",
            "",
            promptLanguage === "en"
              ? "Now output the merged file. Start with `---` on the first line."
              : "现在请直接输出合并后的完整文件，第一行从 `---` 开始。",
          ].join("\n"),
        },
      ])
    }
  }
}
