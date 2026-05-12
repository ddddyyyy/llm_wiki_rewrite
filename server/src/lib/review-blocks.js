const REVIEW_BLOCK_REGEX = /---REVIEW:\s*(\w[\w-]*)\s*\|\s*(.+?)\s*---\n([\s\S]*?)---END REVIEW---/g

const ALLOWED_TYPES = new Set(["contradiction", "duplicate", "missing-page", "suggestion"])

export function parseReviewBlocks(text, sourcePath) {
  const items = []
  const matches = String(text || "").matchAll(REVIEW_BLOCK_REGEX)

  for (const match of matches) {
    const rawType = String(match[1] || "").trim().toLowerCase()
    const title = String(match[2] || "").trim()
    const body = String(match[3] || "").trim()
    if (!title || !body) continue

    const type = ALLOWED_TYPES.has(rawType) ? rawType : "suggestion"
    const optionsMatch = body.match(/^OPTIONS:\s*(.+)$/m)
    const affectedPagesMatch = body.match(/^PAGES:\s*(.+)$/m)
    const searchMatch = body.match(/^SEARCH:\s*(.+)$/m)

    const options = optionsMatch
      ? optionsMatch[1].split("|").map((value) => value.trim()).filter(Boolean)
      : ["Create Page", "Skip"]
    const affectedPages = affectedPagesMatch
      ? affectedPagesMatch[1].split(",").map((value) => value.trim()).filter(Boolean)
      : []
    const searchQueries = searchMatch
      ? searchMatch[1].split("|").map((value) => value.trim()).filter(Boolean)
      : []

    const description = body
      .replace(/^OPTIONS:.*$/gm, "")
      .replace(/^PAGES:.*$/gm, "")
      .replace(/^SEARCH:.*$/gm, "")
      .trim()

    items.push({
      type,
      title,
      description,
      sourcePath,
      affectedPages,
      searchQueries,
      options,
    })
  }

  return items
}
