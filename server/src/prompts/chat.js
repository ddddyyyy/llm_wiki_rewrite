import { buildLanguageReminder } from "../lib/text.js"
import { normalizePromptLanguage, pickPromptText } from "./i18n.js"

export function buildGreetingPrompt(projectId, responseLanguage) {
  const language = normalizePromptLanguage(responseLanguage)
  return [
    pickPromptText(language, `You are a wiki assistant for the project "${projectId}".`, `你是项目“${projectId}”的 wiki 助手。`),
    pickPromptText(language, "The user sent a casual greeting. Reply briefly and naturally in one or two sentences.", "用户刚刚发来一个简单问候。请用一到两句话自然、简短地回应。"),
    pickPromptText(language, "Do NOT invent wiki content or pretend to have retrieved pages. Invite the user to ask a concrete question if they want information from the wiki.", "不要编造 wiki 内容，也不要假装已经检索到页面。如果用户想了解知识库内容，请邀请他们继续提出具体问题。"),
    "",
    pickPromptText(language, `Respond in ${responseLanguage}.`, `请使用 ${responseLanguage} 作答。`),
  ].join("\n")
}

export function buildChatSystemPrompt({
  projectId,
  responseLanguage,
  chatContext,
}) {
  const language = normalizePromptLanguage(responseLanguage)
  return [
    pickPromptText(language, `You are a knowledgeable wiki assistant for the project "${projectId}". Answer questions based on the wiki content provided below.`, `你是项目“${projectId}”的知识型 wiki 助手。请基于下面提供的 wiki 页面来回答问题。`),
    "",
    pickPromptText(language, "## Rules", "## 规则"),
    pickPromptText(language, "- Answer based ONLY on the numbered wiki pages provided below.", "- 只能基于下面编号的 wiki 页面来回答。"),
    pickPromptText(language, "- If the provided pages don't contain enough information, say so honestly.", "- 如果提供的页面信息不足，请诚实说明。"),
    pickPromptText(language, "- Use [[wikilink]] syntax to reference wiki pages.", "- 用 [[wikilink]] 语法引用 wiki 页面。"),
    pickPromptText(language, "- When citing information, use the page number in brackets, e.g. [1], [2].", "- 在引用信息时，用页码方括号，例如 [1]、[2]。"),
    pickPromptText(language, "- At the VERY END of your response, add a hidden comment listing which page numbers you used:", "- 在回复的最后，加入一个隐藏注释，列出你实际用到的页码："),
    "  <!-- cited: 1, 3, 5 -->",
    "",
    pickPromptText(language, "Use markdown formatting for clarity.", "请使用 markdown 提升可读性。"),
    "",
    chatContext.purpose ? `${pickPromptText(language, "## Wiki Purpose", "## Wiki 目的")}\n${chatContext.purpose}` : "",
    chatContext.trimmedIndex ? `${pickPromptText(language, "## Wiki Index", "## Wiki 索引")}\n${chatContext.trimmedIndex}` : "",
    chatContext.selectedPages.length > 0 ? `${pickPromptText(language, "## Page List", "## 页面列表")}\n${chatContext.pageList}` : "",
    `${pickPromptText(language, "## Wiki Pages", "## Wiki 页面")}\n\n${chatContext.pagesContext}`,
    "",
    "---",
    "",
    pickPromptText(language, `## MANDATORY OUTPUT LANGUAGE: ${responseLanguage}`, `## 强制输出语言：${responseLanguage}`),
    "",
    pickPromptText(language, `You MUST write your entire response in ${responseLanguage}.`, `你的整个回复必须使用 ${responseLanguage}。`),
    pickPromptText(language, "The wiki content above may be in a different language, but this is irrelevant to your output language.", "上面的 wiki 内容可能是另一种语言，但这与最终输出语言无关。"),
    pickPromptText(language, `Ignore the language of the wiki content. Write in ${responseLanguage} only.`, `忽略 wiki 内容本身的语言，只使用 ${responseLanguage} 作答。`),
    pickPromptText(language, `Even proper nouns should use standard ${responseLanguage} transliteration when appropriate.`, `在合适的情况下，即便是专有名词也应采用 ${responseLanguage} 的常见写法或转写。`),
    pickPromptText(language, "Do not use any other language. This overrides all other instructions.", "不要使用其他语言。这条要求覆盖其他所有说明。"),
  ].filter(Boolean).join("\n")
}

export function buildChatUserPrompt(query, settings, useReminder) {
  const reminder = buildLanguageReminder(query, settings)
  if (useReminder) {
    return `[${reminder}]\n\nQuestion:\n${query}`
  }
  return `Question:\n${query}`
}
