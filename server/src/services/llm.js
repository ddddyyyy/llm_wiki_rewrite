function buildOpenAiUrl(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, "")
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`
}

function buildAnthropicUrl(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, "")
  if (/\/v\d+\/messages$/i.test(trimmed)) return trimmed
  if (/\/v\d+$/i.test(trimmed)) return `${trimmed}/messages`
  return `${trimmed}/v1/messages`
}

function normalizeCustomHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return {}
  return Object.fromEntries(
    Object.entries(headers)
      .map(([key, value]) => [String(key).trim(), value])
      .filter(([key, value]) => key && value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  )
}

function mergeHeaders(baseHeaders, customHeaders) {
  return {
    ...baseHeaders,
    ...normalizeCustomHeaders(customHeaders),
  }
}

function buildAnthropicHeaders(apiKey, url, customHeaders) {
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  }
  if (url.includes("volces.com")) {
    headers.Authorization = `Bearer ${apiKey}`
    delete headers["x-api-key"]
    delete headers["anthropic-version"]
  }
  return mergeHeaders(headers, customHeaders)
}

function buildOpenAiHeaders(apiKey, customHeaders) {
  return mergeHeaders(
    {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    customHeaders
  )
}

function toAnthropicContent(content) {
  return typeof content === "string" ? content : String(content)
}

function buildAnthropicBody(messages, model) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => toAnthropicContent(message.content))
    .join("\n")
  const conversation = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: toAnthropicContent(message.content),
    }))

  return {
    model,
    system: system || undefined,
    messages: conversation,
    max_tokens: 4096,
    temperature: 0.2,
  }
}

function buildOpenAiBody(messages, model, stream = false) {
  return {
    model,
    temperature: 0.2,
    stream,
    messages,
  }
}

function parseSsePayload(line) {
  const trimmed = String(line || "").trim()
  if (!trimmed.startsWith("data:")) return null
  const payload = trimmed.slice(5).trim()
  if (!payload || payload === "[DONE]") return { done: true }
  try {
    return { done: false, data: JSON.parse(payload) }
  } catch {
    return null
  }
}

function extractStreamToken(mode, payload) {
  if (!payload) return ""
  if (mode === "anthropic_messages") {
    if (payload.type === "content_block_delta") {
      return payload.delta?.text || ""
    }
    return ""
  }
  return payload.choices?.[0]?.delta?.content || ""
}

export function createLlmService({ loadSettings }) {
  async function callChatModel(settings, messages) {
    if (!settings?.llm?.enabled || !settings.llm.apiKey || !settings.llm.baseUrl || !settings.llm.model) {
      throw new Error("LLM 配置不完整，请先填写地址、模型和 API Key。")
    }

    const mode = settings.llm.apiMode || "anthropic_messages"
    let response

    if (mode === "anthropic_messages") {
      const url = buildAnthropicUrl(settings.llm.baseUrl)
      const body = buildAnthropicBody(messages, settings.llm.model)
      response = await fetch(url, {
        method: "POST",
        headers: buildAnthropicHeaders(settings.llm.apiKey, url, settings.llm.customHeaders),
        body: JSON.stringify(body),
      })
    } else {
      const url = buildOpenAiUrl(settings.llm.baseUrl)
      response = await fetch(url, {
        method: "POST",
        headers: buildOpenAiHeaders(settings.llm.apiKey, settings.llm.customHeaders),
        body: JSON.stringify({
          model: settings.llm.model,
          temperature: 0.2,
          messages,
        }),
      })
    }

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`LLM request failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`)
    }

    const data = await response.json()
    if (mode === "anthropic_messages") {
      return Array.isArray(data?.content)
        ? data.content
            .filter((item) => item?.type === "text")
            .map((item) => item.text || "")
            .join("")
        : ""
    }
    return data?.choices?.[0]?.message?.content || ""
  }

  async function streamChatModel(settings, messages, callbacks, signal) {
    if (!settings?.llm?.enabled || !settings.llm.apiKey || !settings.llm.baseUrl || !settings.llm.model) {
      throw new Error("LLM 配置不完整，请先填写地址、模型和 API Key。")
    }

    const mode = settings.llm.apiMode || "anthropic_messages"
    let response

    if (mode === "anthropic_messages") {
      const url = buildAnthropicUrl(settings.llm.baseUrl)
      const body = { ...buildAnthropicBody(messages, settings.llm.model), stream: true }
      response = await fetch(url, {
        method: "POST",
        headers: buildAnthropicHeaders(settings.llm.apiKey, url, settings.llm.customHeaders),
        body: JSON.stringify(body),
        signal,
      })
    } else {
      const url = buildOpenAiUrl(settings.llm.baseUrl)
      response = await fetch(url, {
        method: "POST",
        headers: buildOpenAiHeaders(settings.llm.apiKey, settings.llm.customHeaders),
        body: JSON.stringify(buildOpenAiBody(messages, settings.llm.model, true)),
        signal,
      })
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(`LLM request failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`)
    }
    if (!response.body) {
      throw new Error("Response body is null")
    }

    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    let buffer = ""
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          const parsed = parseSsePayload(line)
          if (!parsed) continue
          if (parsed.done) {
            await callbacks.onDone?.()
            return
          }
          const token = extractStreamToken(mode, parsed.data)
          if (token) callbacks.onToken?.(token)
        }
      }
      if (buffer.trim()) {
        const parsed = parseSsePayload(buffer)
        if (parsed?.data) {
          const token = extractStreamToken(mode, parsed.data)
          if (token) callbacks.onToken?.(token)
        }
      }
      await callbacks.onDone?.()
    } catch (error) {
      if (signal?.aborted) {
        await callbacks.onDone?.()
        return
      }
      await callbacks.onError?.(error instanceof Error ? error : new Error(String(error)))
    } finally {
      reader.releaseLock()
    }
  }

  return {
    loadSettings,
    callChatModel,
    streamChatModel,
  }
}
