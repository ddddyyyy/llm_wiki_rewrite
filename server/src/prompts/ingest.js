import path from "node:path"
import { languageInstruction } from "../lib/text.js"

export function buildAnalysisPrompt({ schema, purpose, index, overview, sourcePath, sourceContent, targetLanguage, folderContext }) {
  return [
    targetLanguage === "en"
      ? "You are an expert research analyst. Read the source document and produce a structured analysis."
      : "你是一个专家级研究分析助手。请阅读源文档并产出结构化分析。",
    languageInstruction(targetLanguage),
    "",
    targetLanguage === "en" ? "Your analysis should cover:" : "分析应覆盖以下方面：",
    "",
    "## Key Entities",
    targetLanguage === "en"
      ? "List people, organizations, products, datasets, and tools mentioned. For each:"
      : "列出文中提到的人物、组织、产品、数据集和工具。对每一项说明：",
    targetLanguage === "en" ? "- Name and type" : "- 名称与类型",
    targetLanguage === "en" ? "- Role in the source (central vs. peripheral)" : "- 在来源中的角色（核心还是次要）",
    targetLanguage === "en" ? "- Whether it likely already exists in the wiki (check the index)" : "- 是否很可能已经存在于 wiki 中（结合 index 判断）",
    "",
    "## Key Concepts",
    targetLanguage === "en"
      ? "List theories, methods, techniques, and phenomena. For each:"
      : "列出关键理论、方法、技术和现象。对每一项说明：",
    targetLanguage === "en" ? "- Name and brief definition" : "- 名称与简短定义",
    targetLanguage === "en" ? "- Why it matters in this source" : "- 它在本来源中的重要性",
    targetLanguage === "en" ? "- Whether it likely already exists in the wiki" : "- 是否很可能已经存在于 wiki 中",
    "",
    "## Main Arguments & Findings",
    targetLanguage === "en" ? "- What are the core claims or results?" : "- 核心论点或结论是什么？",
    targetLanguage === "en" ? "- What evidence supports them?" : "- 有哪些证据支撑？",
    targetLanguage === "en" ? "- How strong is the evidence?" : "- 这些证据的强度如何？",
    "",
    "## Connections to Existing Wiki",
    targetLanguage === "en" ? "- What existing pages does this source relate to?" : "- 这个来源与哪些现有页面相关？",
    targetLanguage === "en" ? "- Does it strengthen, challenge, or extend existing knowledge?" : "- 它是在强化、挑战，还是扩展现有知识？",
    "",
    "## Contradictions & Tensions",
    targetLanguage === "en" ? "- Does anything in this source conflict with existing wiki content?" : "- 来源内容是否与现有 wiki 冲突？",
    targetLanguage === "en" ? "- Are there internal tensions or caveats?" : "- 是否存在内部张力、限制或保留条件？",
    "",
    "## Recommendations",
    targetLanguage === "en" ? "- What wiki pages should be created or updated?" : "- 应创建或更新哪些 wiki 页面？",
    targetLanguage === "en" ? "- What should be emphasized vs. de-emphasized?" : "- 哪些内容该强调，哪些应弱化？",
    targetLanguage === "en" ? "- Any open questions worth flagging for the user?" : "- 有哪些值得提醒用户关注的开放问题？",
    "",
    targetLanguage === "en"
      ? "Be thorough but concise. Focus on what is genuinely important."
      : "请尽量全面，但保持简洁，只关注真正重要的内容。",
    "",
    targetLanguage === "en"
      ? "If folder context is available, use it as a hint for categorization — folder structure often reflects the user's organizational intent."
      : "如果能从路径或目录结构中看出分类意图，请把它当作辅助线索使用。",
    "",
    folderContext ? `## Folder Context\n${folderContext}` : "",
    "",
    purpose ? `## Wiki Purpose (for context)\n${purpose}` : "",
    schema ? `## Wiki Schema\n${schema}` : "",
    index ? `## Current Wiki Index (for checking existing content)\n${index}` : "",
    overview ? `## Current Wiki Overview\n${overview}` : "",
    "",
    `## Source Path\n${sourcePath}`,
    "",
    "## Source Content",
    sourceContent,
  ].join("\n")
}

export function buildGenerationPrompt({ schema, purpose, index, overview, sourcePath, sourceContent, targetLanguage, folderContext }) {
  const sourceFileName = path.basename(sourcePath)
  const sourceBaseName = sourceFileName.replace(/\.[^.]+$/, "")
  return [
    targetLanguage === "en"
      ? "You are a wiki maintainer. Based on the analysis provided, generate wiki files."
      : "你是一个 wiki 维护者。请根据分析结果生成 wiki 文件。",
    languageInstruction(targetLanguage),
    "",
    "## IMPORTANT: Source File",
    targetLanguage === "en"
      ? `The original source file is: **${sourceFileName}**`
      : `原始来源文件是：**${sourceFileName}**`,
    targetLanguage === "en"
      ? `All wiki pages generated from this source MUST include this filename in their frontmatter \`sources\` field.`
      : `所有由该来源生成的 wiki 页面，都必须在 frontmatter 的 \`sources\` 字段中包含这个原始文件名。`,
    "",
    "## What to generate",
    "",
    `1. A source summary page at **wiki/sources/${sourceBaseName}.md** (MUST use this exact path)`,
    "2. Entity pages in wiki/entities/ for key entities identified in the analysis",
    "3. Concept pages in wiki/concepts/ for key concepts identified in the analysis",
    "4. An updated wiki/index.md — add new entries to existing categories, preserve all existing entries",
    "5. A log entry for wiki/log.md (just the new entry to append, format: ## [YYYY-MM-DD] ingest | Title)",
    "6. An updated wiki/overview.md — a high-level summary of what the entire wiki covers, updated to reflect the newly ingested source",
    "",
    "## Frontmatter Rules (CRITICAL)",
    "",
    targetLanguage === "en"
      ? "Every page MUST have YAML frontmatter with these fields:"
      : "每个页面都必须包含以下 YAML frontmatter 字段：",
    "```yaml",
    "---",
    "type: source | entity | concept | comparison | query | synthesis | overview",
    "title: Human-readable title",
    "created: YYYY-MM-DD",
    "updated: YYYY-MM-DD",
    "tags: []",
    "related: []",
    `sources: [\"${sourceFileName}\"]`,
    "---",
    "```",
    "",
    targetLanguage === "en"
      ? `The \`sources\` field MUST always contain "${sourceFileName}" — this links the wiki page back to the original uploaded document.`
      : `\`sources\` 字段必须始终包含 "${sourceFileName}"，用来把 wiki 页面关联回原始上传文档。`,
    "",
    "Other rules:",
    "- Use [[wikilink]] syntax for cross-references between pages",
    "- 如果页面标题主要是中文，文件名可以直接使用中文；不要把中文标题转成拼音",
    "- 如果页面标题主要是英文或混合英文术语，可以继续使用 kebab-case 文件名",
    "- Follow the analysis recommendations on what to emphasize",
    "- If the analysis found connections to existing pages, add cross-references",
    "- Do not write outside wiki/",
    "",
    purpose ? `## Wiki Purpose\n${purpose}` : "",
    schema ? `## Wiki Schema\n${schema}` : "",
    folderContext ? `## Folder Context\n${folderContext}` : "",
    index ? `## Current Wiki Index (preserve all existing entries, add new ones)\n${index}` : "",
    overview ? `## Current Overview (update this to reflect the new source)\n${overview}` : "",
    "",
    "## Original Source Content",
    sourceContent,
    "",
    "## Output Format (MUST FOLLOW EXACTLY — this is how the parser reads your response)",
    "",
    "Your ENTIRE response consists only of FILE blocks. Nothing else.",
    "",
    "FILE block template:",
    "```",
    "---FILE: wiki/path/to/page.md---",
    "(complete file content with YAML frontmatter)",
    "---END FILE---",
    "```",
    "",
    "Strict output requirements:",
    "1. The very first characters of your response must be ---FILE:",
    "2. No preamble, no explanation, no markdown fences around the whole response",
    "3. No trailing commentary after the last ---END FILE---",
    "4. If you produce wiki/index.md or wiki/overview.md, output their full updated contents",
  ].join("\n")
}
