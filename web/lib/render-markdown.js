function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function renderInline(text) {
  let html = escapeHtml(text)
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>")
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>")
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  html = html.replace(/\[\[([^\]]+)\]\]/g, '<span class="wikilink">$1</span>')
  return html
}

function isTableSeparator(line) {
  return /^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line)
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
}

function renderTable(lines, startIndex) {
  const headerLine = lines[startIndex]
  const separatorLine = lines[startIndex + 1]
  if (!headerLine || !separatorLine || !headerLine.includes("|") || !isTableSeparator(separatorLine)) {
    return null
  }

  const headers = splitTableRow(headerLine)
  const rows = []
  let index = startIndex + 2
  while (index < lines.length && lines[index].includes("|")) {
    rows.push(splitTableRow(lines[index]))
    index += 1
  }

  const thead = `<thead><tr>${headers.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead>`
  const tbody = rows.length > 0
    ? `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`
    : ""

  return {
    html: `<table>${thead}${tbody}</table>`,
    nextIndex: index,
  }
}

function renderList(lines, startIndex, ordered) {
  const items = []
  let index = startIndex
  const matcher = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/

  while (index < lines.length) {
    const match = lines[index].match(matcher)
    if (!match) break
    items.push(`<li>${renderInline(match[1])}</li>`)
    index += 1
  }

  return {
    html: ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`,
    nextIndex: index,
  }
}

export function renderMarkdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n")
  const parts = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    if (/^```/.test(trimmed)) {
      const fence = trimmed
      const codeLines = []
      index += 1
      while (index < lines.length && lines[index].trim() !== fence) {
        codeLines.push(lines[index])
        index += 1
      }
      index += 1
      parts.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`)
      continue
    }

    const table = renderTable(lines, index)
    if (table) {
      parts.push(table.html)
      index = table.nextIndex
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      parts.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      index += 1
      continue
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines = []
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""))
        index += 1
      }
      parts.push(`<blockquote>${quoteLines.map((item) => `<p>${renderInline(item)}</p>`).join("")}</blockquote>`)
      continue
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      parts.push("<hr />")
      index += 1
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const list = renderList(lines, index, false)
      parts.push(list.html)
      index = list.nextIndex
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const list = renderList(lines, index, true)
      parts.push(list.html)
      index = list.nextIndex
      continue
    }

    const paragraphLines = [line]
    index += 1
    while (index < lines.length && lines[index].trim()) {
      if (
        /^(#{1,6})\s+/.test(lines[index]) ||
        /^```/.test(lines[index].trim()) ||
        /^\s*[-*+]\s+/.test(lines[index]) ||
        /^\s*\d+\.\s+/.test(lines[index]) ||
        /^>\s?/.test(lines[index].trim()) ||
        lines[index].includes("|")
      ) {
        break
      }
      paragraphLines.push(lines[index])
      index += 1
    }
    parts.push(`<p>${renderInline(paragraphLines.join(" "))}</p>`)
  }

  return parts.join("")
}
