async function request(input, init) {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`)
  }
  return data
}

async function requestStream(input, init, callbacks = {}) {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  })
  if (!response.ok) {
    let message = `Request failed: ${response.status}`
    try {
      const data = await response.json()
      message = data.error || message
    } catch {
      // noop
    }
    throw new Error(message)
  }
  if (!response.body) {
    throw new Error("Streaming response body is empty")
  }

  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let buffer = ""
  let eventName = "message"

  function flushBlock(block) {
    const lines = String(block || "").split("\n")
    const dataLines = []
    eventName = "message"
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim() || "message"
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim())
      }
    }
    if (!dataLines.length) return
    let payload = {}
    try {
      payload = JSON.parse(dataLines.join("\n"))
    } catch {
      payload = { raw: dataLines.join("\n") }
    }
    callbacks.onEvent?.(eventName, payload)
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split("\n\n")
    buffer = blocks.pop() || ""
    for (const block of blocks) {
      flushBlock(block)
    }
  }

  if (buffer.trim()) {
    flushBlock(buffer)
  }
}

export function createApiClient() {
  function buildDownloadUrl(projectId, relativePath) {
    const params = new URLSearchParams({ path: relativePath })
    return `/api/projects/${encodeURIComponent(projectId)}/download?${params.toString()}`
  }

  return {
    listProjects: () => request("/api/projects"),
    loadSettings: () => request("/api/settings"),
    saveSettings: (payload) => request("/api/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
    createProject: (payload) => request("/api/projects", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    deleteProject: (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    }),
    loadKnowledge: (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}/knowledge`),
    loadGraph: (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}/graph`),
    loadLint: (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}/lint`),
    loadLens: (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}/lens`),
    loadImportHistory: (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}/import-history`),
    loadTasks: (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}/tasks`),
    loadTree: (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}/tree`),
    listConversations: (projectId) => request(`/api/projects/${encodeURIComponent(projectId)}/conversations`),
    createConversation: (projectId, payload = {}) => request(`/api/projects/${encodeURIComponent(projectId)}/conversations`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    deleteConversation: (projectId, conversationId) => request(`/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
    }),
    regenerateConversation: (projectId, conversationId, signal) => request(`/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/regenerate`, {
      method: "POST",
      body: JSON.stringify({}),
      signal,
    }),
    loadConversation: (projectId, conversationId) => request(`/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}`),
    openFile: (projectId, relativePath) => {
      const params = new URLSearchParams({ path: relativePath })
      return request(`/api/projects/${encodeURIComponent(projectId)}/file?${params.toString()}`)
    },
    buildDownloadUrl,
    saveFile: (projectId, payload) => request(`/api/projects/${encodeURIComponent(projectId)}/file`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
    uploadFiles: (projectId, files) => request(`/api/projects/${encodeURIComponent(projectId)}/upload-files`, {
      method: "POST",
      body: JSON.stringify({ files }),
    }),
    deleteSource: (projectId, relativePath) => {
      const params = new URLSearchParams({ path: relativePath })
      return request(`/api/projects/${encodeURIComponent(projectId)}/sources?${params.toString()}`, {
        method: "DELETE",
      })
    },
    startIngest: (projectId, payload = {}) => request(`/api/projects/${encodeURIComponent(projectId)}/ingest`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    reingestSource: (projectId, sourcePath) => request(`/api/projects/${encodeURIComponent(projectId)}/reingest-source`, {
      method: "POST",
      body: JSON.stringify({ path: sourcePath }),
    }),
    searchProject: (projectId, query) => {
      const params = new URLSearchParams({ q: query })
      return request(`/api/projects/${encodeURIComponent(projectId)}/search?${params.toString()}`)
    },
    askChat: (projectId, question, conversationId, signal) => request(`/api/projects/${encodeURIComponent(projectId)}/chat`, {
      method: "POST",
      body: JSON.stringify({ question, conversationId }),
      signal,
    }),
    streamChat: (projectId, question, conversationId, callbacks, signal) => requestStream(`/api/projects/${encodeURIComponent(projectId)}/chat-stream`, {
      method: "POST",
      body: JSON.stringify({ question, conversationId }),
      signal,
    }, callbacks),
    reviewAction: (projectId, key, action) => request(`/api/projects/${encodeURIComponent(projectId)}/review-items/action`, {
      method: "POST",
      body: JSON.stringify({ key, action }),
    }),
    saveSynthesisFromChat: (projectId, payload) => request(`/api/projects/${encodeURIComponent(projectId)}/synthesis-from-chat`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
    regenerateConversationStream: (projectId, conversationId, callbacks, signal) => requestStream(`/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/regenerate-stream`, {
      method: "POST",
      body: JSON.stringify({}),
      signal,
    }, callbacks),
  }
}
