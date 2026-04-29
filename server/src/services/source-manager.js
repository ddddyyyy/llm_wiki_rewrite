import path from "node:path"
import { appendLog, rebuildWikiIndex } from "./wiki.js"
import { formatDate } from "../lib/text.js"

function parseSourcesField(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return []
  const frontmatter = match[1]
  const inline = frontmatter.match(/^sources:\s*\[(.*?)\]\s*$/m)
  if (inline) {
    return inline[1]
      .split(",")
      .map((item) => item.replace(/^["'\s]+|["'\s]+$/g, ""))
      .filter(Boolean)
  }
  const lines = frontmatter.split("\n")
  const sources = []
  let inSources = false
  for (const line of lines) {
    if (/^sources:\s*$/.test(line.trim())) {
      inSources = true
      continue
    }
    if (!inSources) continue
    if (!/^\s*-\s+/.test(line)) break
    const item = line.replace(/^\s*-\s+/, "").replace(/^["']|["']$/g, "").trim()
    if (item) sources.push(item)
  }
  return sources
}

function writeSourcesField(content, nextSources) {
  const sourceLines = nextSources.map((item) => `  - "${item}"`)
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return content
  const frontmatter = match[1]
  const lines = frontmatter.split("\n")
  const output = []
  let replaced = false
  let skipping = false
  for (const line of lines) {
    if (/^sources:\s*(\[.*\])?\s*$/.test(line.trim())) {
      if (!replaced) {
        output.push("sources:")
        output.push(...sourceLines)
        replaced = true
      }
      skipping = true
      continue
    }
    if (skipping) {
      if (/^\s*-\s+/.test(line)) continue
      skipping = false
    }
    output.push(line)
  }
  if (!replaced) {
    output.push("sources:")
    output.push(...sourceLines)
  }
  return content.replace(/^---\n[\s\S]*?\n---/, `---\n${output.join("\n")}\n---`)
}

function rewriteUpdatedField(content) {
  const stamp = `updated: ${formatDate()}`
  if (/^updated:\s*.+$/m.test(content)) {
    return content.replace(/^updated:\s*.+$/m, stamp)
  }
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return content
  return content.replace(/^---\n([\s\S]*?)\n---/, `---\n${match[1]}\n${stamp}\n---`)
}

async function removeEmptyAncestors(fullPath, projectRoot, deps) {
  const { readdir, rm } = deps
  let current = path.dirname(fullPath)
  while (current.startsWith(projectRoot) && current !== projectRoot) {
    const entries = await readdir(current).catch(() => [])
    if (entries.length > 0) break
    await rm(current, { recursive: true, force: true })
    current = path.dirname(current)
  }
}

export function createSourceManagerService({
  projectFs,
  projectService,
  sourceTextCacheService,
}) {
  const {
    ensureInsideProject,
    collectFiles,
    exists,
    readFile,
    readdir,
    rm,
    unlink,
  } = projectFs
  const {
    readProjectFile,
    writeProjectFile,
    updateProjectTimestamp,
  } = projectService

  const wikiDeps = {
    ensureInsideProject,
    collectFiles,
    readProjectFile,
    writeProjectFile,
  }

  async function collectRawFilesForDeletion(projectId, relativePath) {
    const { fullPath, normalized, projectRoot } = ensureInsideProject(projectId, relativePath)
    if (!normalized.startsWith("raw/sources/")) {
      throw new Error("只能删除 raw/sources 下的来源文件")
    }
    const stats = await projectFs.stat(fullPath).catch(() => null)
    if (!stats) throw new Error("来源文件不存在")
    if (stats.isDirectory()) {
      const nested = await collectFiles(fullPath, normalized)
      return {
        projectRoot,
        targets: nested.filter((file) => !file.path.split("/").some((part) => part.startsWith("."))),
        directoryPath: normalized,
      }
    }
    return {
      projectRoot,
      targets: [{ path: normalized, fullPath, name: path.basename(normalized) }],
      directoryPath: null,
    }
  }

  async function cleanupWikiPagesForSource(projectId, sourceFileName) {
    const wikiRoot = ensureInsideProject(projectId, "wiki").fullPath
    const wikiFiles = await collectFiles(wikiRoot, "wiki")
    const deletedWikiPaths = []
    const rewrittenWikiPaths = []

    for (const file of wikiFiles) {
      if (!file.path.endsWith(".md")) continue
      if (["wiki/index.md", "wiki/log.md", "wiki/overview.md"].includes(file.path)) continue
      const content = await readFile(file.fullPath, "utf8")
      const pageSources = parseSourcesField(content)
      if (!pageSources.includes(sourceFileName)) continue
      if (pageSources.length <= 1) {
        await rm(file.fullPath, { force: true })
        deletedWikiPaths.push(file.path)
        continue
      }
      const nextSources = pageSources.filter((item) => item !== sourceFileName)
      const rewritten = rewriteUpdatedField(writeSourcesField(content, nextSources))
      await writeProjectFile(projectId, file.path, rewritten)
      rewrittenWikiPaths.push(file.path)
    }

    return { deletedWikiPaths, rewrittenWikiPaths }
  }

  async function deleteSource(projectId, relativePath) {
    const { projectRoot, targets, directoryPath } = await collectRawFilesForDeletion(projectId, relativePath)
    if (targets.length === 0 && directoryPath) {
      await rm(ensureInsideProject(projectId, directoryPath).fullPath, { recursive: true, force: true })
      await updateProjectTimestamp(projectId)
      return {
        ok: true,
        deletedSources: [],
        deletedWikiPaths: [],
        rewrittenWikiPaths: [],
      }
    }

    const deletedSources = []
    const deletedWikiSet = new Set()
    const rewrittenWikiSet = new Set()

    for (const target of targets) {
      if ((await exists(target.fullPath)) && !target.name.startsWith(".")) {
        await unlink(target.fullPath)
        await sourceTextCacheService.deleteCachedText(projectId, target.path)
        deletedSources.push(target.path)
        const { deletedWikiPaths, rewrittenWikiPaths } = await cleanupWikiPagesForSource(projectId, path.basename(target.path))
        for (const wikiPath of deletedWikiPaths) deletedWikiSet.add(wikiPath)
        for (const wikiPath of rewrittenWikiPaths) rewrittenWikiSet.add(wikiPath)
        await removeEmptyAncestors(target.fullPath, projectRoot, { readdir, rm })
      }
    }

    if (directoryPath) {
      const { fullPath } = ensureInsideProject(projectId, directoryPath)
      const entries = await readdir(fullPath).catch(() => [])
      if (entries.length === 0) {
        await rm(fullPath, { recursive: true, force: true })
      }
    }

    await rebuildWikiIndex(projectId, wikiDeps)
    if (deletedSources.length > 0) {
      const logLine = `已删除 ${deletedSources.length} 个来源文件，移除 ${deletedWikiSet.size} 个知识页，更新 ${rewrittenWikiSet.size} 个关联页`
      await appendLog(projectId, logLine, wikiDeps)
      await updateProjectTimestamp(projectId)
    }

    return {
      ok: true,
      deletedSources,
      deletedWikiPaths: Array.from(deletedWikiSet).sort(),
      rewrittenWikiPaths: Array.from(rewrittenWikiSet).sort(),
    }
  }

  return {
    deleteSource,
  }
}
