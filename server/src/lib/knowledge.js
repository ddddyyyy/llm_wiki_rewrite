import {
  normalizeGeneratedMarkdown,
} from "./text.js"

export function normalizeTextForSearch(value) {
  return value
    .toLowerCase()
    .replace(/[`*_#>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function snippetAround(content, query) {
  const plain = content.replace(/\r/g, "").replace(/\n+/g, "\n")
  if (!query) return plain.slice(0, 320)
  const lower = plain.toLowerCase()
  const needle = query.toLowerCase()
  const index = lower.indexOf(needle)
  if (index === -1) return plain.slice(0, 320)
  const start = Math.max(0, index - 120)
  const end = Math.min(plain.length, index + needle.length + 160)
  let snippet = plain.slice(start, end).replace(/\n/g, " ")
  if (start > 0) snippet = `...${snippet}`
  if (end < plain.length) snippet = `${snippet}...`
  return snippet
}

export function stripFrontmatter(content) {
  return String(content || "").replace(/^---\n[\s\S]*?\n---\n*/, "").trim()
}

export function extractWikilinks(content) {
  const matches = content.matchAll(/\[\[([^\]]+)\]\]/g)
  const links = []
  for (const match of matches) {
    const raw = (match[1] || "").trim()
    if (!raw) continue
    const target = raw
      .replace(/^wiki\//, "")
      .replace(/\.md$/i, "")
      .split("|")[0]
      .trim()
    if (target) links.push(target)
  }
  return [...new Set(links)]
}

export function extractFrontmatterRelated(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return []
  const frontmatter = match[1]
  const inline = frontmatter.match(/^related:\s*\[(.*?)\]\s*$/m)
  if (inline) {
    return inline[1]
      .split(",")
      .map((item) => item.replace(/^["'\s]+|["'\s]+$/g, ""))
      .filter(Boolean)
      .map((item) => item.replace(/^wiki\//, "").replace(/\.md$/i, ""))
  }
  const lines = frontmatter.split("\n")
  const related = []
  let inRelated = false
  for (const line of lines) {
    if (/^related:\s*$/.test(line.trim())) {
      inRelated = true
      continue
    }
    if (!inRelated) continue
    if (!/^\s*-\s+/.test(line)) break
    const item = line.replace(/^\s*-\s+/, "").replace(/^["']|["']$/g, "").trim()
    if (!item) continue
    related.push(item.replace(/^wiki\//, "").replace(/\.md$/i, ""))
  }
  return related
}

function candidateWikiPathsFromSlug(slug) {
  return [
    `wiki/sources/${slug}.md`,
    `wiki/concepts/${slug}.md`,
    `wiki/entities/${slug}.md`,
    `wiki/queries/${slug}.md`,
    `wiki/comparisons/${slug}.md`,
    `wiki/synthesis/${slug}.md`,
    `wiki/${slug}.md`,
  ]
}

export async function resolveRelatedWikiPaths(projectId, content, deps) {
  const { readProjectFile } = deps
  const slugs = [...new Set([
    ...extractFrontmatterRelated(content),
    ...extractWikilinks(content),
  ])]
  const resolved = []
  for (const slug of slugs) {
    for (const candidate of candidateWikiPathsFromSlug(slug)) {
      try {
        await readProjectFile(projectId, candidate)
        resolved.push(candidate)
        break
      } catch {
        // keep trying
      }
    }
  }
  return [...new Set(resolved)]
}

function isSafeIngestPath(targetPath) {
  if (typeof targetPath !== "string" || targetPath.trim().length === 0) return false
  if (/[\x00-\x1f]/.test(targetPath)) return false
  if (targetPath.startsWith("/") || targetPath.startsWith("\\")) return false
  if (/^[a-zA-Z]:/.test(targetPath)) return false
  const normalized = targetPath.replace(/\\/g, "/")
  if (!normalized.startsWith("wiki/")) return false
  if (normalized.split("/").some((segment) => segment === "..")) return false
  return true
}

export function parseFileBlocks(text) {
  const normalized = text.replace(/\r\n/g, "\n")
  const lines = normalized.split("\n")
  const blocks = []
  const warnings = []
  const opener = /^---\s*FILE:\s*(.+?)\s*---\s*$/i
  const closer = /^---\s*END\s+FILE\s*---\s*$/i
  const fence = /^\s{0,3}(```+|~~~+)/

  let index = 0
  while (index < lines.length) {
    const match = opener.exec(lines[index])
    if (!match) {
      index += 1
      continue
    }

    const targetPath = match[1].trim().replace(/\\/g, "/")
    index += 1

    let fenceMarker = null
    let fenceLength = 0
    let closed = false
    const content = []

    while (index < lines.length) {
      const line = lines[index]
      const fenceMatch = fence.exec(line)
      if (fenceMatch) {
        const run = fenceMatch[1]
        const char = run[0]
        const len = run.length
        if (fenceMarker === null) {
          fenceMarker = char
          fenceLength = len
        } else if (char === fenceMarker && len >= fenceLength) {
          fenceMarker = null
          fenceLength = 0
        }
        content.push(line)
        index += 1
        continue
      }

      if (fenceMarker === null && closer.test(line)) {
        closed = true
        index += 1
        break
      }

      content.push(line)
      index += 1
    }

    if (!closed) {
      warnings.push(`已丢弃未闭合的 FILE 区块：${targetPath || "（空路径）"}`)
      continue
    }
    if (!isSafeIngestPath(targetPath)) {
      warnings.push(`已丢弃不安全的 FILE 路径：${targetPath}`)
      continue
    }

    blocks.push({
      path: targetPath,
      content: normalizeGeneratedMarkdown(content.join("\n")),
    })
  }

  return { blocks, warnings }
}
