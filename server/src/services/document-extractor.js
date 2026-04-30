import { readFile } from "node:fs/promises"
import JSZip from "jszip"

let pdfJsModulePromise = null

function cleanText(value = "") {
  const text = String(value || "").replace(/\r/g, "")
  return text.replace(/\n{3,}/g, "\n\n").trim()
}

function decodeXmlEntities(value = "") {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
}

function stripXml(value = "") {
  return decodeXmlEntities(String(value || "").replace(/<[^>]+>/g, ""))
}

function extractTagTexts(xml = "", tagPattern) {
  const texts = []
  const regex = new RegExp(`<${tagPattern}\\b[^>]*>([\\s\\S]*?)<\\/${tagPattern}>`, "g")
  for (const match of xml.matchAll(regex)) {
    const text = cleanText(stripXml(match[1]))
    if (text) texts.push(text)
  }
  return texts
}

function cellRefToColumn(ref = "") {
  const letters = String(ref || "").match(/[A-Z]+/i)?.[0] || ""
  let column = 0
  for (const char of letters.toUpperCase()) {
    column = column * 26 + (char.charCodeAt(0) - 64)
  }
  return column
}

function getXmlAttribute(tagSource = "", attributeName) {
  return String(tagSource || "").match(new RegExp(`\\b${attributeName}="([^"]*)"`, "i"))?.[1] || ""
}

async function readPdf(filePath) {
  const { getDocument } = await loadPdfJsModule()
  const data = new Uint8Array(await readFile(filePath))
  const pdf = await getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    disableWorker: true,
  }).promise

  const parts = []
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index)
    const content = await page.getTextContent()
    const lines = []
    let currentLine = []
    let lastY = null
    for (const item of content.items || []) {
      if (!("str" in item)) continue
      const value = cleanText(item.str || "")
      if (!value) continue
      const y = Array.isArray(item.transform) ? item.transform[5] : null
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 3 && currentLine.length) {
        lines.push(currentLine.join(" ").replace(/\s+/g, " ").trim())
        currentLine = []
      }
      currentLine.push(value)
      lastY = y
    }
    if (currentLine.length) {
      lines.push(currentLine.join(" ").replace(/\s+/g, " ").trim())
    }
    const text = cleanText(lines.join("\n"))
    if (text) {
      parts.push(`## 第 ${index} 页\n\n${text}`)
    }
  }
  return parts.join("\n\n")
}

async function loadPdfJsModule() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = (async () => {
      if (!globalThis.DOMMatrix) {
        const geometry = await import("../../../vendor/pdfjs/geometry.cjs")
        globalThis.DOMMatrix = geometry.DOMMatrix
        globalThis.DOMPoint = globalThis.DOMPoint || geometry.DOMPoint
        globalThis.DOMRect = globalThis.DOMRect || geometry.DOMRect
      }
      if (!globalThis.ImageData) {
        globalThis.ImageData = class ImageData {
          constructor(data = [], width = 0, height = 0) {
            this.data = data
            this.width = width
            this.height = height
          }
        }
      }
      if (!globalThis.Path2D) {
        globalThis.Path2D = class Path2D {
          addPath() {}
        }
      }
      const originalWarn = console.warn
      console.warn = (...args) => {
        const text = args.map((item) => String(item || "")).join(" ")
        if (text.includes('Cannot load "@napi-rs/canvas" package')) return
        originalWarn(...args)
      }
      try {
        return await import("../../../vendor/pdfjs/legacy/build/pdf.mjs")
      } finally {
        console.warn = originalWarn
      }
    })()
  }
  return pdfJsModulePromise
}

async function openZip(filePath) {
  return JSZip.loadAsync(await readFile(filePath))
}

async function readZipText(zip, entryPath) {
  const file = zip.file(entryPath)
  if (!file) return ""
  return file.async("string")
}

async function readDocx(filePath) {
  const zip = await openZip(filePath)
  const documentXml = await readZipText(zip, "word/document.xml")
  if (!documentXml) return ""

  const blocks = []
  for (const match of documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const text = extractTagTexts(match[0], "w:t").join("")
    const cleaned = cleanText(text)
    if (cleaned) blocks.push(cleaned)
  }
  return blocks.join("\n\n")
}

async function readPptx(filePath) {
  const zip = await openZip(filePath)
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  const parts = []
  for (let index = 0; index < slideNames.length; index += 1) {
    const slideXml = await readZipText(zip, slideNames[index])
    const texts = extractTagTexts(slideXml, "a:t")
    if (texts.length) {
      parts.push(`## 第 ${index + 1} 页\n\n${texts.join("\n")}`)
    }
  }
  return parts.join("\n\n")
}

async function readXlsx(filePath) {
  const zip = await openZip(filePath)
  const workbookXml = await readZipText(zip, "xl/workbook.xml")
  if (!workbookXml) return ""
  const workbookRelsXml = await readZipText(zip, "xl/_rels/workbook.xml.rels")

  const relMap = new Map()
  for (const match of workbookRelsXml.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const relTag = match[0]
    const relId = getXmlAttribute(relTag, "Id")
    const target = getXmlAttribute(relTag, "Target")
      .replace(/^\.\.\//, "")
      .replace(/^\/+/, "")
    if (!relId || !target) continue
    relMap.set(relId, target.startsWith("xl/") ? target : `xl/${target}`)
  }

  const sharedStringsXml = await readZipText(zip, "xl/sharedStrings.xml")
  const sharedStrings = []
  for (const match of sharedStringsXml.matchAll(/<si\b[\s\S]*?<\/si>/g)) {
    const text = extractTagTexts(match[0], "t").join("")
    sharedStrings.push(cleanText(text))
  }

  const sheetEntries = []
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*\/>/g)) {
    const sheetTag = match[0]
    const sheetName = getXmlAttribute(sheetTag, "name")
    const relId = getXmlAttribute(sheetTag, "r:id")
    const sheetPath = relMap.get(relId)
    if (sheetPath) {
      sheetEntries.push({ name: decodeXmlEntities(sheetName), path: sheetPath })
    }
  }

  const sections = []
  for (const sheet of sheetEntries) {
    const sheetXml = await readZipText(zip, sheet.path)
    if (!sheetXml) continue
    const rows = [`# 工作表：${sheet.name}`]

    for (const rowMatch of sheetXml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
      const cells = []
      let currentColumn = 1
      for (const cellMatch of rowMatch[0].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cellMatch[1] || ""
        const inner = cellMatch[2] || ""
        const ref = attrs.match(/\br="([^"]+)"/)?.[1] || ""
        const targetColumn = cellRefToColumn(ref)
        if (targetColumn > currentColumn) {
          while (currentColumn < targetColumn) {
            cells.push("")
            currentColumn += 1
          }
        }
        const type = attrs.match(/\bt="([^"]+)"/)?.[1] || ""
        let text = ""
        if (type === "s") {
          const index = Number.parseInt(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "", 10)
          text = Number.isFinite(index) ? sharedStrings[index] || "" : ""
        } else if (type === "inlineStr") {
          text = extractTagTexts(inner, "t").join("")
        } else {
          text = stripXml(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "")
        }
        cells.push(cleanText(text))
        currentColumn += 1
      }
      if (cells.some(Boolean)) {
        rows.push(cells.join(" | "))
      }
    }

    if (rows.length > 1) {
      sections.push(rows.join("\n"))
    }
  }

  return sections.join("\n\n")
}

async function readTextLike(filePath) {
  const buffer = await readFile(filePath)
  for (const encoding of ["utf-8", "gb18030", "gbk", "latin1"]) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: false })
      let text = decoder.decode(buffer)
      if (encoding === "utf-8" && text.charCodeAt(0) === 0xFEFF) {
        text = text.slice(1)
      }
      if (cleanText(text)) return text
    } catch {
      // try next encoding
    }
  }
  return buffer.toString("utf8")
}

export function createDocumentExtractor() {
  async function extractText(filePath) {
    const suffix = String(filePath || "").toLowerCase().match(/\.[^.]+$/)?.[0] || ""
    let text = ""

    if (suffix === ".pdf") {
      text = await readPdf(filePath)
    } else if (suffix === ".docx") {
      text = await readDocx(filePath)
    } else if (suffix === ".xlsx") {
      text = await readXlsx(filePath)
    } else if (suffix === ".pptx") {
      text = await readPptx(filePath)
    } else if ([".md", ".markdown", ".txt", ".csv"].includes(suffix)) {
      text = await readTextLike(filePath)
    } else {
      throw new Error(`unsupported file type: ${suffix}`)
    }

    const normalizedText = cleanText(text)
    return {
      text: normalizedText,
      chars: normalizedText.length,
    }
  }

  return {
    extractText,
  }
}
