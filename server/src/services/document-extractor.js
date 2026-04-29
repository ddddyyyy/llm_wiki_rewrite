import { access } from "node:fs/promises"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const BUNDLED_PYTHON = "/Users/madongyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"

export function createDocumentExtractor({ workspaceRoot }) {
  const scriptPath = path.join(workspaceRoot, "server/scripts/extract_document.py")

  async function resolvePython() {
    const candidates = [
      process.env.LLM_WIKI_PYTHON,
      BUNDLED_PYTHON,
      "python3",
    ].filter(Boolean)

    for (const candidate of candidates) {
      try {
        if (candidate.includes("/")) {
          await access(candidate)
        }
        return candidate
      } catch {
        // try next
      }
    }
    throw new Error("未找到可用的 Python 解释器，无法解析 PDF / Office 文件。")
  }

  async function extractText(filePath) {
    const python = await resolvePython()
    const { stdout } = await execFileAsync(python, [scriptPath, filePath], {
      maxBuffer: 20 * 1024 * 1024,
    })
    const parsed = JSON.parse(stdout || "{}")
    if (!parsed.ok) {
      throw new Error(parsed.error || "文档解析失败")
    }
    return {
      text: String(parsed.text || ""),
      chars: Number(parsed.chars || 0),
    }
  }

  return {
    extractText,
  }
}
