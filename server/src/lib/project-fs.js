import { mkdir, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

export function createProjectFs(projectsRoot) {
  function projectRootFor(projectId) {
    return path.join(projectsRoot, projectId)
  }

  function ensureInsideProject(projectId, relativePath = "") {
    const projectRoot = projectRootFor(projectId)
    const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "")
    const fullPath = path.resolve(projectRoot, normalized)
    const relativeToRoot = path.relative(projectRoot, fullPath)
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      throw new Error("Invalid project path")
    }
    return { projectRoot, fullPath, normalized: normalized.replace(/\\/g, "/") }
  }

  async function exists(fullPath) {
    try {
      await stat(fullPath)
      return true
    } catch {
      return false
    }
  }

  async function collectFiles(fullPath, relativeBase = "") {
    const entries = await readdir(fullPath, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
      const childRelative = relativeBase ? `${relativeBase}/${entry.name}` : entry.name
      const childFull = path.join(fullPath, entry.name)
      if (entry.isDirectory()) {
        files.push(...(await collectFiles(childFull, childRelative)))
      } else {
        files.push({
          name: entry.name,
          path: childRelative.replace(/\\/g, "/"),
          fullPath: childFull,
        })
      }
    }
    return files
  }

  async function buildTree(fullPath, relativeBase = "") {
    const entries = await readdir(fullPath, { withFileTypes: true })
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    const result = []
    for (const entry of entries) {
      const childRelative = relativeBase ? `${relativeBase}/${entry.name}` : entry.name
      const childFull = path.join(fullPath, entry.name)
      if (entry.isDirectory()) {
        result.push({
          name: entry.name,
          path: childRelative,
          isDir: true,
          children: await buildTree(childFull, childRelative),
        })
      } else {
        result.push({
          name: entry.name,
          path: childRelative,
          isDir: false,
        })
      }
    }
    return result
  }

  return {
    projectsRoot,
    projectRootFor,
    ensureInsideProject,
    exists,
    collectFiles,
    buildTree,
    mkdir,
    readFile,
    writeFile,
    readdir,
    rm,
    stat,
    unlink,
  }
}
