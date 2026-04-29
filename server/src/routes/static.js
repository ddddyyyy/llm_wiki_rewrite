import path from "node:path"
import { readFile } from "node:fs/promises"
import { staticContentType, text } from "../lib/http.js"

export function createStaticHandler({ publicRoot, exists }) {
  return async function handleStatic(req, res) {
    const requested = req.url === "/" ? "/index.html" : req.url
    const cleanRequest = requested.replace(/^\/+/, "")
    const assetPath = path.join(publicRoot, cleanRequest)
    if (await exists(assetPath)) {
      const content = await readFile(assetPath)
      text(res, 200, content, staticContentType(assetPath))
      return true
    }
    return false
  }
}
