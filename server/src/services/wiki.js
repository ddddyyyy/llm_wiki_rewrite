import path from "node:path"
import { stripFrontmatter } from "../lib/knowledge.js"
import {
  detectPrimaryLanguage,
  formatDate,
  makeSafeWikiSlug,
  readFrontmatterValue,
  stripMarkdownExtension,
  titleFromFileName,
} from "../lib/text.js"

function readFrontmatterList(content, key) {
  const match = String(content || "").match(/^---\n([\s\S]*?)\n---/)
  if (!match) return []
  const frontmatter = match[1]
  const inline = frontmatter.match(new RegExp(`^${key}:\\s*\\[(.*?)\\]\\s*$`, "m"))
  if (inline) {
    return inline[1]
      .split(",")
      .map((item) => item.replace(/^["'\s]+|["'\s]+$/g, ""))
      .filter(Boolean)
  }
  const lines = frontmatter.split("\n")
  const values = []
  let inField = false
  for (const line of lines) {
    if (new RegExp(`^${key}:\\s*$`).test(line.trim())) {
      inField = true
      continue
    }
    if (!inField) continue
    if (!/^\s*-\s+/.test(line)) break
    const item = line.replace(/^\s*-\s+/, "").replace(/^["']|["']$/g, "").trim()
    if (item) values.push(item)
  }
  return values
}

export async function rebuildWikiIndex(projectId, deps) {
  const { ensureInsideProject, collectFiles, writeProjectFile } = deps
  const wikiRoot = ensureInsideProject(projectId, "wiki").fullPath
  const files = await collectFiles(wikiRoot)
  const sections = {
    实体: [],
    概念: [],
    来源: [],
    问题: [],
    对比: [],
    综合: [],
  }

  for (const file of files) {
    if (!file.path.endsWith(".md")) continue
    if (file.path === "index.md" || file.path === "log.md" || file.path === "overview.md") continue
    const wikiPath = `wiki/${file.path}`
    const title = titleFromFileName(wikiPath)
    if (file.path.startsWith("entities/")) sections.实体.push(`- [[${path.basename(file.path, ".md")}]] - ${title}`)
    if (file.path.startsWith("concepts/")) sections.概念.push(`- [[${path.basename(file.path, ".md")}]] - ${title}`)
    if (file.path.startsWith("sources/")) sections.来源.push(`- [[${path.basename(file.path, ".md")}]] - ${title}`)
    if (file.path.startsWith("queries/")) sections.问题.push(`- [[${path.basename(file.path, ".md")}]] - ${title}`)
    if (file.path.startsWith("comparisons/")) sections.对比.push(`- [[${path.basename(file.path, ".md")}]] - ${title}`)
    if (file.path.startsWith("synthesis/")) sections.综合.push(`- [[${path.basename(file.path, ".md")}]] - ${title}`)
  }

  const content = `# Wiki 索引

## 实体
${sections.实体.join("\n") || ""}

## 概念
${sections.概念.join("\n") || ""}

## 来源
${sections.来源.join("\n") || ""}

## 问题
${sections.问题.join("\n") || ""}

## 对比
${sections.对比.join("\n") || ""}

## 综合
${sections.综合.join("\n") || ""}
`
  await writeProjectFile(projectId, "wiki/index.md", content.trimEnd() + "\n")
}

export async function buildKnowledgeView(projectId, deps) {
  const { ensureInsideProject, collectFiles, readProjectFile, snippetAround } = deps
  const wikiRoot = ensureInsideProject(projectId, "wiki").fullPath
  const files = await collectFiles(wikiRoot)
  const sections = {
    overview: [],
    index: [],
    sources: [],
    concepts: [],
    entities: [],
    queries: [],
    comparisons: [],
    synthesis: [],
  }

  for (const file of files) {
    if (!file.path.endsWith(".md")) continue
    const wikiPath = `wiki/${file.path}`
    const { contents } = await readProjectFile(projectId, wikiPath)
    const title = readFrontmatterValue(contents, "title") || titleFromFileName(wikiPath)
    const created = readFrontmatterValue(contents, "created")
    const updated = readFrontmatterValue(contents, "updated")
    const item = {
      path: wikiPath,
      title,
      created,
      updated,
      sourcePath: readFrontmatterValue(contents, "source_path") || "",
      sourceFiles: readFrontmatterList(contents, "sources"),
      summary: snippetAround(stripFrontmatter(contents), ""),
    }

    if (wikiPath === "wiki/overview.md") sections.overview.push(item)
    else if (wikiPath === "wiki/index.md") sections.index.push(item)
    else if (wikiPath.startsWith("wiki/sources/")) sections.sources.push(item)
    else if (wikiPath.startsWith("wiki/concepts/")) sections.concepts.push(item)
    else if (wikiPath.startsWith("wiki/entities/")) sections.entities.push(item)
    else if (wikiPath.startsWith("wiki/queries/")) sections.queries.push(item)
    else if (wikiPath.startsWith("wiki/comparisons/")) sections.comparisons.push(item)
    else if (wikiPath.startsWith("wiki/synthesis/")) sections.synthesis.push(item)
  }

  for (const values of Object.values(sections)) {
    values.sort((a, b) => a.title.localeCompare(b.title))
  }

  return { sections }
}

export async function appendLog(projectId, line, deps) {
  const { readProjectFile, writeProjectFile } = deps
  const current = await readProjectFile(projectId, "wiki/log.md")
  const next = `${current.contents.trimEnd()}\n- ${formatDate()}: ${line}\n`
  await writeProjectFile(projectId, "wiki/log.md", next)
}

export async function createSynthesisFromAnswer(projectId, payload, deps) {
  const { writeProjectFile } = deps
  const question = String(payload.question || "").trim()
  const answer = String(payload.answer || "").trim()
  const references = Array.isArray(payload.references) ? payload.references : []
  if (!question) throw new Error("Question is required to create a synthesis page")
  if (!answer) throw new Error("Answer is required to create a synthesis page")

  const title = String(payload.title || question).trim().replace(/\?+$/, "") || "Chat Synthesis"
  const preferredLanguage = detectPrimaryLanguage(`${question}\n${answer}`)
  const slug = makeSafeWikiSlug(title, "synthesis")
  const synthesisPath = `wiki/synthesis/${slug}.md`
  const related = references.map((item) => String(item.path || "").trim()).filter(Boolean)
  const sources = [...new Set(
    references
      .map((item) => path.basename(String(item.path || "")))
      .filter((item) => item.endsWith(".md"))
  )]
  const relatedYaml = related.length > 0 ? related.map((item) => `  - "${item}"`).join("\n") : ""
  const sourcesYaml = sources.length > 0 ? sources.map((item) => `"${item}"`).join(", ") : ""
  const headingQuestion = preferredLanguage === "en" ? "Origin Question" : "原始问题"
  const headingAnswer = preferredLanguage === "en" ? "Synthesized Answer" : "综合回答"
  const headingContext = preferredLanguage === "en" ? "Linked Context" : "关联上下文"
  const fallbackTitle = preferredLanguage === "en" ? "Chat Synthesis" : "问答综合"
  const finalTitle = title || fallbackTitle
  const content = `---
type: synthesis
title: ${finalTitle}
created: ${formatDate()}
updated: ${formatDate()}
tags: ["chat-synthesis", "follow-up"]
related:
${relatedYaml || "  - \"wiki/overview.md\""}
sources: [${sourcesYaml}]
---

# ${finalTitle}

## ${headingQuestion}

${question}

## ${headingAnswer}

${answer}

## ${headingContext}

${related.length > 0 ? related.map((item) => `- [[${stripMarkdownExtension(item)}]]`).join("\n") : "- [[wiki/overview]]"}
`

  await writeProjectFile(projectId, synthesisPath, content.trimEnd() + "\n")
  await rebuildWikiIndex(projectId, deps)
  await appendLog(
    projectId,
    preferredLanguage === "en"
      ? `Created synthesis page ${synthesisPath} from chat answer`
      : `已根据聊天回答生成综合页 ${synthesisPath}`,
    deps,
  )
  return { ok: true, path: synthesisPath, title: finalTitle }
}
