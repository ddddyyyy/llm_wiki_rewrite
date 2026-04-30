import { createServer } from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createApiHandler } from "./routes/api.js"
import { createStaticHandler } from "./routes/static.js"
import { createAppServices, createRuntimeConfig } from "./bootstrap.js"
import { json } from "./lib/http.js"

const runtime = createRuntimeConfig()
const services = createAppServices(runtime)
const handleApi = createApiHandler(services)
const handleStatic = createStaticHandler({
  publicRoot: runtime.publicRoot,
  exists: services.projectFs.exists,
})

export async function handleRequest(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  if (req.method === "OPTIONS") {
    res.writeHead(204)
    res.end()
    return
  }

  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res)
      return
    }

    const served = await handleStatic(req, res)
    if (served) return

    json(res, 404, { error: "Not found" })
  } catch (error) {
    if (res.writableEnded) return
    if (res.headersSent) {
      res.end()
      return
    }
    json(res, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

export function startServer() {
  return createServer(handleRequest).listen(runtime.port, runtime.host, () => {
    console.log(`LLM Wiki server listening on http://${runtime.host}:${runtime.port}`)
  })
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : ""
const currentModulePath = fileURLToPath(import.meta.url)

if (entryPath && currentModulePath === entryPath) {
  startServer()
}
