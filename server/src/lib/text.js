import path from "node:path"

export function slugify(input) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function unicodeSlugify(input) {
  return String(input || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
}

export function fingerprint(input) {
  let hash = 7
  for (const char of String(input || "")) {
    hash = (hash * 31 + char.codePointAt(0)) >>> 0
  }
  return hash.toString(36)
}

export function makeSafeSlug(input, prefix = "item") {
  const slug = slugify(input)
  if (slug) return slug
  return `${prefix}-${fingerprint(input)}`
}

export function makeSafeWikiSlug(input, prefix = "page") {
  const slug = unicodeSlugify(input)
  if (slug) return slug
  return `${prefix}-${fingerprint(input)}`
}

export function slugifyFileStem(input) {
  return makeSafeWikiSlug(String(input || "").replace(/\.[^.]+$/, ""), "source")
}

export function formatDate(value = new Date()) {
  return value.toISOString().slice(0, 10)
}

export function titleFromFileName(filePath) {
  const stem = path.basename(filePath).replace(/\.[^.]+$/, "")
  return stem
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function stripMarkdownExtension(value) {
  return String(value || "").replace(/\.md$/i, "")
}

export function detectPrimaryLanguage(content) {
  const text = String(content || "")
  const cjkMatches = text.match(/[\u3400-\u9fff]/g) || []
  const latinMatches = text.match(/[A-Za-z]/g) || []
  if (latinMatches.length > cjkMatches.length * 3 && latinMatches.length > 120) {
    return "en"
  }
  return "zh-CN"
}

export function languageInstruction(language) {
  if (language === "en") {
    return "The source document is primarily English. Use English for the analysis, generated wiki pages, and any synthesized knowledge text."
  }
  return "源文档不是明显的英文文档。请使用简体中文输出分析、生成的 wiki 页面和综合知识内容；如果页面标题本身是中文，文件名可以直接使用中文，不必转成拼音。"
}

export function resolveOutputLanguage(settings, content = "") {
  const configured = settings?.output?.language || "auto"
  if (configured !== "auto") return configured
  return detectPrimaryLanguage(content) === "en" ? "English" : "Chinese"
}

export function outputLanguageInstruction(language) {
  const value = String(language || "Chinese")
  if (value === "English") {
    return "Use English for all generated content."
  }
  if (value === "Chinese") {
    return "请使用简体中文输出所有生成内容。"
  }
  return `Use ${value} for all generated content.`
}

export function buildLanguageReminder(fallbackText = "", settings = null) {
  const lang = resolveOutputLanguage(settings || {}, fallbackText)
  return `REMINDER: All output must be in ${lang}. Do not use any other language.`
}

const MAX_GREETING_LEN = 20
const TRAILING_PUNCT = /[\s!！。.?？~,，、;；:：\u3002\uFF01\uFF1F]+$/u
const GREETING_PATTERNS = [
  /^(hi|hello|hey|yo|sup|howdy|hiya|heya|hullo)( there| y'all| you| folks| everyone)?$/,
  /^good (morning|afternoon|evening|day|night)$/,
  /^(what'?s up|wassup|whaddup)$/,
  /^greetings$/,
  /^(你好|您好|大家好|嗨|哈喽|哈啰|哈囉|哈罗|喂)[啊呀吖呢么呗哦哈]?$/,
  /^(早|早啊|早安|早上好|中午好|下午好|晚上好|晚安)[啊呀吖呢么呗哦哈]?$/,
  /^(在吗|在嗎|在不在|有人吗|有人嗎|有人在吗|有人在嗎)$/,
  /^(こんにちは|こんばんは|おはよう|おはようございます|やあ|どうも|はじめまして)$/,
  /^(안녕|안녕하세요|안녕하십니까)$/,
  /^(hola|bonjour|salut|coucou|hallo|servus|hej|hejsan|ciao|saluton|ola|olá|privet|привет)$/,
]

export function isGreeting(text) {
  if (!text) return false
  const normalized = String(text)
    .trim()
    .replace(TRAILING_PUNCT, "")
    .trim()
    .toLowerCase()
  if (!normalized || normalized.length > MAX_GREETING_LEN) return false
  return GREETING_PATTERNS.some((re) => re.test(normalized))
}

export function normalizeGeneratedMarkdown(content) {
  let normalized = String(content || "").trim()
  const fencedMatch = normalized.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/)
  if (fencedMatch) {
    normalized = fencedMatch[1].trim()
  }
  normalized = normalized.replace(/202X-XX-XX/g, formatDate())
  return normalized.trimEnd() + "\n"
}

export function readFrontmatterValue(content, key) {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return ""
  const field = new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m").exec(match[1])
  if (!field) return ""
  return field[1].replace(/^["']|["']$/g, "").trim()
}
