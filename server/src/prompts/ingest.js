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
    targetLanguage === "en"
      ? "- If it likely already exists, name the most likely existing wiki page / slug that should be updated"
      : "- 如果它很可能已存在，请指出最可能应该复用或更新的现有 wiki 页面 / slug",
    "",
    "## Key Concepts",
    targetLanguage === "en"
      ? "List theories, methods, techniques, and phenomena. For each:"
      : "列出关键理论、方法、技术和现象。对每一项说明：",
    targetLanguage === "en" ? "- Name and brief definition" : "- 名称与简短定义",
    targetLanguage === "en" ? "- Why it matters in this source" : "- 它在本来源中的重要性",
    targetLanguage === "en" ? "- Whether it likely already exists in the wiki" : "- 是否很可能已经存在于 wiki 中",
    targetLanguage === "en"
      ? "- If it likely already exists, name the most likely existing wiki page / slug that should be updated"
      : "- 如果它很可能已存在，请指出最可能应该复用或更新的现有 wiki 页面 / slug",
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
    "5. An updated wiki/overview.md — a high-level summary of what the entire wiki covers, updated to reflect the newly ingested source",
    "6. Optionally create query/comparison/synthesis pages only when they are clearly justified by the source",
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
    `source_path: \"${sourcePath}\"`,
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
    "- Reuse the exact existing wiki slug/path when the analysis indicates an entity or concept already exists; update that page instead of inventing a near-duplicate filename",
    "- If the index suggests two names refer to the same entity or concept, prefer updating the best matching existing page and add aliases/cross-links in the body rather than creating another sibling page",
    "- Only create a brand-new entity or concept page when the topic is genuinely distinct, not merely a paraphrase, abbreviation variant, or translation variant of an existing page",
    "- Do not write outside wiki/",
    "- Prefer high recall for materially important entities and concepts: if an entity or concept is central to understanding the source, create or update a dedicated page instead of only mentioning it in the source summary",
    "- Do not collapse multiple important entities or concepts into a single source summary page when they deserve their own pages",
    "- Create entity/concept pages for items that are central, repeatedly referenced, define the source's scope, or are necessary for answering likely downstream questions",
    "- If an entity or concept already likely exists, prefer updating that existing page with new detail; do not silently omit the new information, and do not create a duplicate page unless the distinction is explicit and material",
    "- It is acceptable to generate several entity and concept pages from one source when the source is dense and conceptually rich",
    "- The source summary page must preserve concrete facts, scope, caveats, and the most important supporting details from the original source",
    "- wiki/index.md must remain a usable navigation index, not just a dump of titles",
    "- wiki/overview.md should describe how the new source changes the overall project picture, not merely repeat the source summary",
    "",
    "## Optional Review Blocks",
    targetLanguage === "en"
      ? "After all FILE blocks, you MAY emit REVIEW blocks for cases that need human judgment."
      : "在所有 FILE blocks 之后，如果存在需要人工判断的情况，你可以输出 REVIEW blocks。",
    targetLanguage === "en"
      ? "Use REVIEW blocks when the source reveals a likely duplicate, contradiction, missing dedicated page, or a meaningful follow-up suggestion."
      : "当来源暴露出疑似重复、冲突、缺少专门页面，或值得跟进的建议时，请使用 REVIEW blocks。",
    targetLanguage === "en"
      ? "Do NOT create trivial reviews. Only create them when they would help keep the wiki coherent."
      : "不要输出琐碎的 review，只有在它们确实有助于保持 wiki 一致性时才输出。",
    "",
    "Allowed review types:",
    "- contradiction",
    "- duplicate",
    "- missing-page",
    "- suggestion",
    "",
    "REVIEW block template:",
    "```",
    "---REVIEW: type | Title---",
    "Short description of the issue or suggestion.",
    "OPTIONS: Create Page | Skip",
    "PAGES: wiki/path/one.md, wiki/path/two.md",
    "SEARCH: query 1 | query 2 | query 3",
    "---END REVIEW---",
    "```",
    "",
    targetLanguage === "en"
      ? "Use the PAGES line when specific existing or proposed wiki pages are involved."
      : "当某些现有或建议的 wiki 页面与该事项直接相关时，请填写 PAGES 行。",
    targetLanguage === "en"
      ? "Use the SEARCH line only for missing-page or suggestion reviews when it would help future research."
      : "只有在 missing-page 或 suggestion 类型、且确实有助于后续研究时，才填写 SEARCH 行。",
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
    "Your ENTIRE response consists of FILE blocks, followed optionally by REVIEW blocks. Nothing else.",
    "If REVIEW blocks are needed, place them AFTER all FILE blocks and before the response ends.",
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
    "5. If you emit REVIEW blocks, do not place any ordinary prose outside FILE/REVIEW blocks",
  ].join("\n")
}
