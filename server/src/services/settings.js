import path from "node:path"

export function createSettingsService({ settingsPath, fs }) {
  const { mkdir, readFile, writeFile } = fs

  function defaultSettings() {
    return {
      llm: {
        provider: process.env.LLM_PROVIDER || "custom",
        baseUrl: process.env.LLM_BASE_URL || "https://ark.cn-beijing.volces.com/api/coding",
        apiKey: process.env.LLM_API_KEY || "",
        model: process.env.LLM_MODEL || "Doubao-Seed-2.0-Code",
        apiMode: process.env.LLM_API_MODE || "anthropic_messages",
        maxContextSize: Number(process.env.LLM_MAX_CONTEXT_SIZE || 204800),
        enabled: Boolean(process.env.LLM_API_KEY),
      },
      output: {
        language: process.env.OUTPUT_LANGUAGE || "auto",
      },
      chat: {
        responseMode: process.env.CHAT_RESPONSE_MODE || "stream",
      },
      search: {
        provider: process.env.SEARCH_PROVIDER || "none",
        apiKey: process.env.SEARCH_API_KEY || "",
      },
      embedding: {
        enabled: process.env.EMBEDDING_ENABLED === "true",
        endpoint: process.env.EMBEDDING_ENDPOINT || "",
        apiKey: process.env.EMBEDDING_API_KEY || "",
        model: process.env.EMBEDDING_MODEL || "",
        maxChunkChars: Number(process.env.EMBEDDING_MAX_CHUNK_CHARS || 1000),
        overlapChunkChars: Number(process.env.EMBEDDING_OVERLAP_CHUNK_CHARS || 200),
      },
    }
  }

  function mergeSettings(base, next) {
    return {
      ...base,
      ...next,
      llm: {
        ...base.llm,
        ...(next.llm || {}),
      },
      output: {
        ...base.output,
        ...(next.output || {}),
      },
      chat: {
        ...(base.chat || {}),
        ...(next.chat || {}),
      },
      search: {
        ...base.search,
        ...(next.search || {}),
      },
      embedding: {
        ...base.embedding,
        ...(next.embedding || {}),
      },
    }
  }

  async function saveSettings(settings) {
    await mkdir(path.dirname(settingsPath), { recursive: true })
    await writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8")
  }

  async function loadSettings() {
    try {
      const current = JSON.parse(await readFile(settingsPath, "utf8"))
      const next = mergeSettings(defaultSettings(), current)
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        await saveSettings(next)
      }
      return next
    } catch {
      const settings = defaultSettings()
      await saveSettings(settings)
      return settings
    }
  }

  async function updateSettings(body) {
    const current = await loadSettings()
    const next = mergeSettings(mergeSettings(defaultSettings(), current), body || {})
    await saveSettings(next)
    return next
  }

  return {
    defaultSettings,
    mergeSettings,
    loadSettings,
    saveSettings,
    updateSettings,
  }
}
