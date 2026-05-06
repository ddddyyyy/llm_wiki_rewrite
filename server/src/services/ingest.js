import {
  outputLanguageInstruction,
  readFrontmatterValue,
  resolveOutputLanguage,
  slugifyFileStem,
  titleFromFileName,
} from "../lib/text.js"
import { parseFileBlocks } from "../lib/knowledge.js"
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
        }),
      },
      {
        role: "user",
        content: [
          promptLanguage === "en" ? "Analyze this source document:" : "请分析这个来源文档：",
          "",
          promptLanguage === "en" ? `**File:** ${file.name}` : `**文件：** ${file.name}`,
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
    if (blocks.length === 0) {
      throw new Error(`Generation produced no valid FILE blocks for ${sourcePath}`)
    }
    const wroteIndex = blocks.some((block) => block.path === "wiki/index.md")
    const written = []
    onProgress({ stage: "writing", message: `正在写入 ${blocks.length} 个知识文件：${file.path}...`, file: file.path })
    for (const block of blocks) {
      await writeProjectFile(projectId, block.path, block.content)
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
}
