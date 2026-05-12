import { formatDate } from "./text.js"

const UNION_FIELDS = ["sources", "tags", "related"]
const LOCKED_FIELDS = ["type", "title", "created"]
const BODY_SHRINK_THRESHOLD = 0.7

export async function mergePageContent(newContent, existingContent, merger, options) {
  if (!existingContent) return newContent
  if (newContent === existingContent) return existingContent

  const arrayMerged = mergeArrayFieldsIntoContent(newContent, existingContent, UNION_FIELDS)
  const existingParsed = parseFrontmatter(existingContent)
  const arrayMergedParsed = parseFrontmatter(arrayMerged)

  if (existingParsed.body.trim() === arrayMergedParsed.body.trim()) {
    return arrayMerged
  }

  let llmOutput = ""
  try {
    llmOutput = await merger(existingContent, arrayMerged, options?.sourceFileName || "", options?.signal)
  } catch (error) {
    console.warn(
      `[page-merge] LLM merge failed for ${options?.pagePath || "(unknown page)"}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return arrayMerged
  }

  const llmParsed = parseFrontmatter(llmOutput)
  if (!llmParsed.frontmatter) {
    console.warn(`[page-merge] LLM merge for ${options?.pagePath || "(unknown page)"} returned no frontmatter, falling back`)
    return arrayMerged
  }

  const oldBodyLen = existingParsed.body.length
  const newBodyLen = arrayMergedParsed.body.length
  const llmBodyLen = llmParsed.body.length
  const minThreshold = Math.max(oldBodyLen, newBodyLen) * BODY_SHRINK_THRESHOLD
  if (llmBodyLen < minThreshold) {
    console.warn(
      `[page-merge] LLM merge for ${options?.pagePath || "(unknown page)"} was too short (${llmBodyLen} < ${Math.floor(minThreshold)}), falling back`,
    )
    return arrayMerged
  }

  let finalContent = llmOutput
  for (const field of LOCKED_FIELDS) {
    const existingValue = existingParsed.frontmatter[field]
    if (typeof existingValue === "string" && existingValue.trim()) {
      finalContent = setFrontmatterScalar(finalContent, field, existingValue)
    }
  }
  finalContent = mergeArrayFieldsIntoContent(finalContent, arrayMerged, UNION_FIELDS)
  finalContent = setFrontmatterScalar(finalContent, "updated", formatDate())
  return finalContent
}

export function parseFrontmatter(content) {
  const match = String(content || "").match(/^(---\n)([\s\S]*?)(\n---)([\s\S]*)$/)
  if (!match) {
    return {
      frontmatter: null,
      body: String(content || ""),
      raw: String(content || ""),
    }
  }

  const frontmatterText = match[2]
  const body = match[4].replace(/^\n/, "")
  const frontmatter = {}

  for (const line of frontmatterText.split("\n")) {
    const scalarMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!scalarMatch) continue
    const key = scalarMatch[1]
    const rawValue = scalarMatch[2].trim()
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      frontmatter[key] = parseInlineArray(rawValue)
    } else {
      frontmatter[key] = stripWrappingQuotes(rawValue)
    }
  }

  return {
    frontmatter,
    body,
    raw: String(content || ""),
  }
}

function parseInlineArray(rawValue) {
  const inner = rawValue.slice(1, -1).trim()
  if (!inner) return []
  return inner
    .split(",")
    .map((item) => stripWrappingQuotes(item.trim()))
    .filter(Boolean)
}

function stripWrappingQuotes(value) {
  return String(value || "").replace(/^["']|["']$/g, "").trim()
}

function mergeArrayFieldsIntoContent(primaryContent, secondaryContent, fields) {
  const primary = parseFrontmatter(primaryContent)
  const secondary = parseFrontmatter(secondaryContent)
  if (!primary.frontmatter || !secondary.frontmatter) return primaryContent

  let next = primaryContent
  for (const field of fields) {
    const values = [
      ...(Array.isArray(secondary.frontmatter[field]) ? secondary.frontmatter[field] : []),
      ...(Array.isArray(primary.frontmatter[field]) ? primary.frontmatter[field] : []),
    ]
    const merged = [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))]
    next = setFrontmatterArray(next, field, merged)
  }
  return next
}

function setFrontmatterArray(content, fieldName, values) {
  const match = content.match(/^(---\n)([\s\S]*?)(\n---)([\s\S]*)$/)
  if (!match) return content
  const [, opener, body, closer, tail] = match
  const escaped = escapeRegex(fieldName)
  const newLine = `${fieldName}: [${values.map((value) => `"${value}"`).join(", ")}]`
  const linePattern = new RegExp(`^${escaped}:\\s*\\[(.*?)\\]\\s*$`, "m")
  const updatedBody = linePattern.test(body)
    ? body.replace(linePattern, newLine)
    : `${body}\n${newLine}`
  return `${opener}${updatedBody}${closer}${tail}`
}

function setFrontmatterScalar(content, fieldName, value) {
  const match = content.match(/^(---\n)([\s\S]*?)(\n---)([\s\S]*)$/)
  if (!match) return content
  const [, opener, body, closer, tail] = match
  const escaped = escapeRegex(fieldName)
  const safeValue = needsQuotes(value) ? JSON.stringify(value) : value
  const newLine = `${fieldName}: ${safeValue}`
  const linePattern = new RegExp(`^${escaped}:\\s*(?!\\[)([^\\n]*)$`, "m")
  const updatedBody = linePattern.test(body)
    ? body.replace(linePattern, newLine)
    : `${body}\n${newLine}`
  return `${opener}${updatedBody}${closer}${tail}`
}

function needsQuotes(value) {
  return /[:#[\]{}",]/.test(String(value || ""))
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
