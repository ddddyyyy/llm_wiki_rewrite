import { outputLanguageInstruction } from "../lib/text.js"
import { normalizePromptLanguage, pickPromptText } from "./i18n.js"

export function buildPageMergeMessages({ existingContent, incomingContent, sourceFileName, outputLanguage }) {
  const language = normalizePromptLanguage(outputLanguage)
  return [
    {
      role: "system",
      content: [
        pickPromptText(language, "You are merging two versions of the same wiki page into one coherent document.", "你正在把同一个 wiki 页面的两个版本合并成一个连贯的文档。"),
        pickPromptText(language, "Both versions describe the same entity, concept, or source topic. One is already on disk; the other was just generated from a different source document.", "两个版本描述的是同一个实体、概念或来源主题。一个已经存在于磁盘中，另一个刚刚由不同来源文档生成。"),
        "",
        pickPromptText(language, "Output one merged version that:", "请输出一个合并后的版本，要求："),
        pickPromptText(language, "- Preserves factual claims from both versions; do not silently drop content.", "- 保留两个版本中的事实信息，不要静默丢失内容。"),
        pickPromptText(language, "- Removes redundancy where both versions say the same thing.", "- 对重复表述做去重。"),
        pickPromptText(language, "- Reorganizes sections so the structure is logical for the merged topic.", "- 重新组织章节，使结构更适合合并后的主题。"),
        pickPromptText(language, "- Keeps [[wikilink]] references intact.", "- 保留 [[wikilink]] 交叉链接。"),
        "",
        pickPromptText(language, "Output requirements:", "输出要求："),
        pickPromptText(language, "- The first line must be `---`.", "- 第一行必须是 `---`。"),
        pickPromptText(language, "- Output the complete file: YAML frontmatter plus body.", "- 输出完整文件：YAML frontmatter 加正文。"),
        pickPromptText(language, "- No preamble or explanatory prose.", "- 不要写前言或解释性文字。"),
        pickPromptText(language, "- The caller will deterministically rewrite `sources`, `tags`, `related`, and `updated`; your job is to produce the best merged page.", "- 调用方会确定性地重写 `sources`、`tags`、`related` 和 `updated`；你的任务是产出最佳的合并页面。"),
        outputLanguageInstruction(outputLanguage),
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `${pickPromptText(language, "## Existing version on disk", "## 磁盘中的现有版本")}`,
        "",
        existingContent,
        "",
        "---",
        "",
        `${pickPromptText(language, `## Newly generated version (from ${sourceFileName})`, `## 新生成的版本（来自 ${sourceFileName}）`)}`,
        "",
        incomingContent,
        "",
        "---",
        "",
        pickPromptText(language, "Now output the merged file. Start with `---` on the first line.", "现在请直接输出合并后的完整文件，第一行从 `---` 开始。"),
      ].join("\n"),
    },
  ]
}
