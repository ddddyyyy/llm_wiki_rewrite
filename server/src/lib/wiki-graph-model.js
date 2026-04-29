import path from "node:path"
import { extractFrontmatterRelated, extractWikilinks } from "./knowledge.js"
import { readFrontmatterValue, titleFromFileName } from "./text.js"

function sectionTypeForPath(filePath) {
  if (filePath === "wiki/overview.md") return "overview"
  if (filePath === "wiki/index.md") return "index"
  if (filePath.startsWith("wiki/sources/")) return "source"
  if (filePath.startsWith("wiki/concepts/")) return "concept"
  if (filePath.startsWith("wiki/entities/")) return "entity"
  if (filePath.startsWith("wiki/queries/")) return "query"
  if (filePath.startsWith("wiki/comparisons/")) return "comparison"
  if (filePath.startsWith("wiki/synthesis/")) return "synthesis"
  return "page"
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

export async function buildWikiGraphModel(projectId, deps) {
  const { ensureInsideProject, collectFiles, readProjectFile } = deps
  const wikiRoot = ensureInsideProject(projectId, "wiki").fullPath
  const files = await collectFiles(wikiRoot).catch(() => [])
  const markdownFiles = files.filter((file) => file.path.endsWith(".md") && file.path !== "log.md")

  const nodesByPath = new Map()
  const slugToPath = new Map()
  const contentsByPath = new Map()
  const pages = []

  for (const file of markdownFiles) {
    const wikiPath = `wiki/${file.path}`
    const { contents } = await readProjectFile(projectId, wikiPath)
    contentsByPath.set(wikiPath, contents)
    const slug = path.basename(wikiPath, ".md")
    const shortPath = file.path
    const basename = String(path.basename(shortPath))
      .replace(/\.md$/i, "")
      .trim()
      .toLowerCase()
    const outlinks = [...new Set([...extractWikilinks(contents), ...extractFrontmatterRelated(contents)])]

    slugToPath.set(slug, wikiPath)
    nodesByPath.set(wikiPath, {
      id: wikiPath,
      path: wikiPath,
      slug,
      title: readFrontmatterValue(contents, "title") || titleFromFileName(wikiPath),
      type: readFrontmatterValue(contents, "type") || sectionTypeForPath(wikiPath),
      created: readFrontmatterValue(contents, "created"),
      updated: readFrontmatterValue(contents, "updated"),
      degree: 0,
    })
    pages.push({
      path: wikiPath,
      shortPath,
      slug: slug.toLowerCase(),
      basename,
      outlinks,
      contents,
    })
  }

  const edgeMap = new Map()
  const brokenLinks = []
  const addEdge = (source, target, kind) => {
    if (!source || !target || source === target) return
    const left = source < target ? source : target
    const right = source < target ? target : source
    const key = `${left}::${right}`
    const current = edgeMap.get(key)
    if (current) {
      current.kinds.add(kind)
      current.weight += 1
      return
    }
    edgeMap.set(key, {
      id: key,
      source: left,
      target: right,
      kinds: new Set([kind]),
      weight: 1,
    })
  }

  for (const page of pages) {
    const contents = page.contents || ""
    for (const slug of page.outlinks) {
      const direct = slugToPath.get(path.basename(slug))
      if (direct && nodesByPath.has(direct)) {
        addEdge(page.path, direct, "link")
        continue
      }
      let resolved = false
      for (const candidate of candidateWikiPathsFromSlug(slug)) {
        if (nodesByPath.has(candidate)) {
          addEdge(page.path, candidate, "link")
          resolved = true
          break
        }
      }
      if (!resolved) {
        brokenLinks.push({
          page: page.path,
          target: slug,
        })
      }
    }

    const sourcesRaw = readFrontmatterValue(contents, "sources")
    if (!sourcesRaw) continue
    for (const other of pages) {
      if (other.path === page.path) continue
      const otherSources = readFrontmatterValue(other.contents || "", "sources")
      if (otherSources && otherSources === sourcesRaw) {
        addEdge(page.path, other.path, "source-overlap")
      }
    }
  }

  const edges = [...edgeMap.values()].map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    kind: [...edge.kinds].join("+"),
    weight: edge.weight,
  }))

  const inboundCounts = new Map()
  for (const edge of edges) {
    inboundCounts.set(edge.source, (inboundCounts.get(edge.source) || 0) + 1)
    inboundCounts.set(edge.target, (inboundCounts.get(edge.target) || 0) + 1)
  }

  for (const edge of edges) {
    const source = nodesByPath.get(edge.source)
    const target = nodesByPath.get(edge.target)
    if (source) source.degree += 1
    if (target) target.degree += 1
  }

  const nodes = [...nodesByPath.values()].sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title))
  return {
    nodes,
    edges,
    pages,
    contentsByPath,
    inboundCounts,
    brokenLinks,
  }
}
