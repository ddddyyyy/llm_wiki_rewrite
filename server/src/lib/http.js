export function json(res, status, payload) {
  if (res.writableEnded) return
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(payload))
}

export function text(res, status, payload, contentType = "text/plain; charset=utf-8") {
  if (res.writableEnded) return
  if (res.headersSent) {
    res.end()
    return
  }
  res.writeHead(status, { "Content-Type": contentType })
  res.end(payload)
}

export async function readBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

export function staticContentType(assetPath) {
  if (assetPath.endsWith(".html")) return "text/html; charset=utf-8"
  if (assetPath.endsWith(".js")) return "text/javascript; charset=utf-8"
  if (assetPath.endsWith(".css")) return "text/css; charset=utf-8"
  if (assetPath.endsWith(".json")) return "application/json; charset=utf-8"
  return "application/octet-stream"
}

export function startSse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  })
}

export function writeSseEvent(res, event, payload) {
  if (res.writableEnded) return
  if (event) {
    res.write(`event: ${event}\n`)
  }
  const body = JSON.stringify(payload ?? {})
  res.write(`data: ${body}\n\n`)
}
