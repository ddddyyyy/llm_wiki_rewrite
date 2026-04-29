import path from "node:path"
import { fingerprint } from "../lib/text.js"

function messageId(conversationId, role, content) {
  return `${role}-${fingerprint(`${conversationId}:${content}:${Date.now()}`)}`
}

function conversationTitleFromQuestion(question) {
  const text = String(question || "").trim().replace(/\s+/g, " ")
  if (!text) return "新对话"
  return text.slice(0, 48)
}

function findLastExchange(messages) {
  let assistantIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") {
      assistantIndex = index
      break
    }
  }
  if (assistantIndex <= 0) {
    throw new Error("当前会话还没有可重新生成的回答")
  }
  const userMessage = messages[assistantIndex - 1]
  if (!userMessage || userMessage.role !== "user") {
    throw new Error("未找到与回答对应的问题")
  }
  return {
    assistantIndex,
    userMessage,
    assistantMessage: messages[assistantIndex],
    previousMessages: messages.slice(0, assistantIndex - 1),
  }
}

export function createConversationService({
  projectFs,
  projectService,
}) {
  const { mkdir, readFile, writeFile } = projectFs
  const { ensureInsideProject, updateProjectTimestamp } = projectService

  async function readJsonOrDefault(fullPath, fallback) {
    try {
      return JSON.parse(await readFile(fullPath, "utf8"))
    } catch {
      return fallback
    }
  }

  async function saveJson(fullPath, value) {
    await mkdir(path.dirname(fullPath), { recursive: true })
    await writeFile(fullPath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  }

  function conversationListPath(projectId) {
    return ensureInsideProject(projectId, ".llm-wiki/conversations.json").fullPath
  }

  function conversationMessagePath(projectId, conversationId) {
    return ensureInsideProject(projectId, `.llm-wiki/chats/${conversationId}.json`).fullPath
  }

  async function listConversations(projectId) {
    const items = await readJsonOrDefault(conversationListPath(projectId), [])
    return {
      conversations: items.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")),
    }
  }

  async function loadConversation(projectId, conversationId) {
    const list = await readJsonOrDefault(conversationListPath(projectId), [])
    const conversation = list.find((item) => item.id === conversationId)
    if (!conversation) throw new Error("会话不存在")
    const messages = await readJsonOrDefault(conversationMessagePath(projectId, conversationId), [])
    return { conversation, messages }
  }

  async function createConversation(projectId, payload = {}) {
    const listPath = conversationListPath(projectId)
    const list = await readJsonOrDefault(listPath, [])
    const id = payload.id || `chat-${fingerprint(`${projectId}:${Date.now()}:${Math.random()}`)}`
    const now = new Date().toISOString()
    const conversation = {
      id,
      title: String(payload.title || "新对话").trim() || "新对话",
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
    }
    list.unshift(conversation)
    await saveJson(listPath, list)
    await saveJson(conversationMessagePath(projectId, id), [])
    await updateProjectTimestamp(projectId)
    return { conversation, messages: [] }
  }

  async function deleteConversation(projectId, conversationId) {
    const listPath = conversationListPath(projectId)
    const list = await readJsonOrDefault(listPath, [])
    const conversation = list.find((item) => item.id === conversationId)
    if (!conversation) throw new Error("会话不存在")

    const nextList = list.filter((item) => item.id !== conversationId)
    await saveJson(listPath, nextList)
    try {
      await projectFs.rm(conversationMessagePath(projectId, conversationId), { force: true })
    } catch {
      // noop
    }
    await updateProjectTimestamp(projectId)
    return {
      ok: true,
      conversationId,
      deleted: conversation,
      conversations: nextList,
    }
  }

  async function appendExchange(projectId, conversationId, payload) {
    const listPath = conversationListPath(projectId)
    const list = await readJsonOrDefault(listPath, [])
    let conversation = list.find((item) => item.id === conversationId)
    if (!conversation) {
      const created = await createConversation(projectId, { id: conversationId, title: payload.question })
      conversation = created.conversation
    }

    const messagePath = conversationMessagePath(projectId, conversationId)
    const messages = await readJsonOrDefault(messagePath, [])
    const timestamp = Date.now()
    const userMessage = {
      id: messageId(conversationId, "user", payload.question),
      role: "user",
      content: payload.question,
      timestamp,
    }
    const assistantMessage = {
      id: messageId(conversationId, "assistant", payload.answer),
      role: "assistant",
      content: payload.answer,
      timestamp: timestamp + 1,
      references: Array.isArray(payload.references) ? payload.references : [],
    }
    const nextMessages = [...messages, userMessage, assistantMessage].slice(-100)
    await saveJson(messagePath, nextMessages)

    const nextTitle = conversation.messageCount === 0
      ? conversationTitleFromQuestion(payload.question)
      : conversation.title
    const nextConversation = {
      ...conversation,
      title: nextTitle,
      updatedAt: new Date().toISOString(),
      messageCount: nextMessages.length,
      lastQuestion: payload.question,
    }
    const nextList = [
      nextConversation,
      ...list.filter((item) => item.id !== conversationId),
    ]
    await saveJson(listPath, nextList)
    await updateProjectTimestamp(projectId)

    return {
      conversation: nextConversation,
      messages: nextMessages,
    }
  }

  async function removeLastExchange(projectId, conversationId) {
    const listPath = conversationListPath(projectId)
    const list = await readJsonOrDefault(listPath, [])
    const conversation = list.find((item) => item.id === conversationId)
    if (!conversation) throw new Error("会话不存在")

    const messagePath = conversationMessagePath(projectId, conversationId)
    const messages = await readJsonOrDefault(messagePath, [])
    if (!messages.length) {
      throw new Error("当前会话还没有可重新生成的回答")
    }

    const exchange = findLastExchange(messages)
    const nextMessages = exchange.previousMessages
    await saveJson(messagePath, nextMessages)

    const nextConversation = {
      ...conversation,
      updatedAt: new Date().toISOString(),
      messageCount: nextMessages.length,
      lastQuestion: exchange.userMessage.content,
    }
    const nextList = [
      nextConversation,
      ...list.filter((item) => item.id !== conversationId),
    ]
    await saveJson(listPath, nextList)
    await updateProjectTimestamp(projectId)

    return {
      conversation: nextConversation,
      removedQuestion: exchange.userMessage.content,
      messages: nextMessages,
    }
  }

  async function previewRegenerate(projectId, conversationId) {
    const list = await readJsonOrDefault(conversationListPath(projectId), [])
    const conversation = list.find((item) => item.id === conversationId)
    if (!conversation) throw new Error("会话不存在")
    const messages = await readJsonOrDefault(conversationMessagePath(projectId, conversationId), [])
    const exchange = findLastExchange(messages)
    return {
      conversation,
      removedQuestion: exchange.userMessage.content,
      removedAnswer: exchange.assistantMessage?.content || "",
      messages: exchange.previousMessages,
      currentMessages: messages,
    }
  }

  async function replaceLastExchange(projectId, conversationId, payload) {
    const listPath = conversationListPath(projectId)
    const list = await readJsonOrDefault(listPath, [])
    const conversation = list.find((item) => item.id === conversationId)
    if (!conversation) throw new Error("会话不存在")

    const messagePath = conversationMessagePath(projectId, conversationId)
    const messages = await readJsonOrDefault(messagePath, [])
    const exchange = findLastExchange(messages)
    const timestamp = Date.now()
    const userMessage = {
      id: messageId(conversationId, "user", payload.question),
      role: "user",
      content: payload.question,
      timestamp,
    }
    const assistantMessage = {
      id: messageId(conversationId, "assistant", payload.answer),
      role: "assistant",
      content: payload.answer,
      timestamp: timestamp + 1,
      references: Array.isArray(payload.references) ? payload.references : [],
    }
    const nextMessages = [...exchange.previousMessages, userMessage, assistantMessage].slice(-100)
    await saveJson(messagePath, nextMessages)

    const nextConversation = {
      ...conversation,
      title: conversation.title || conversationTitleFromQuestion(payload.question),
      updatedAt: new Date().toISOString(),
      messageCount: nextMessages.length,
      lastQuestion: payload.question,
    }
    const nextList = [
      nextConversation,
      ...list.filter((item) => item.id !== conversationId),
    ]
    await saveJson(listPath, nextList)
    await updateProjectTimestamp(projectId)

    return {
      conversation: nextConversation,
      messages: nextMessages,
    }
  }

  return {
    listConversations,
    loadConversation,
    createConversation,
    deleteConversation,
    appendExchange,
    removeLastExchange,
    previewRegenerate,
    replaceLastExchange,
  }
}
