import { renderMarkdownToHtml } from "./render-markdown.js"

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function formatConversationTime(value) {
  if (!value) return ""
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ""
    const now = new Date()
    const sameDay = date.toDateString() === now.toDateString()
    if (sameDay) {
      return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
    }
    return `${date.getMonth() + 1}-${date.getDate()}`
  } catch {
    return ""
  }
}

function formatMessageTime(value) {
  if (!value) return ""
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ""
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
  } catch {
    return ""
  }
}

function normalizeReferenceTitle(item) {
  if (!item?.path) return "未命名页面"
  const parts = String(item.path).split("/")
  return parts[parts.length - 1].replace(/\.md$/i, "")
}

function wireCitationLinks(container, references, onHighlightReference) {
  if (!container || !Array.isArray(references) || references.length === 0) return
  const citationMap = new Map(
    references
      .filter((item) => item?.path)
      .map((item) => [Number(item.citation), item]),
  )
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const targets = []
  let current = walker.nextNode()
  while (current) {
    const parentTag = current.parentElement?.tagName?.toLowerCase()
    if (parentTag !== "code" && parentTag !== "pre" && /\[(\d+)\]/.test(current.textContent || "")) {
      targets.push(current)
    }
    current = walker.nextNode()
  }

  for (const textNode of targets) {
    const text = textNode.textContent || ""
    const fragment = document.createDocumentFragment()
    let lastIndex = 0
    const regex = /\[(\d+)\]/g
    let match = regex.exec(text)
    while (match) {
      const start = match.index
      const end = regex.lastIndex
      if (start > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)))
      }
      const referenceIndex = Number(match[1]) - 1
      const reference = citationMap.get(Number(match[1])) || references[referenceIndex]
      if (reference?.path) {
        const button = document.createElement("button")
        button.type = "button"
        button.className = "chat-citation"
        button.textContent = `[${match[1]}]`
        button.title = reference.title || normalizeReferenceTitle(reference)
        button.addEventListener("click", () => void onHighlightReference(reference.path))
        fragment.appendChild(button)
      } else {
        fragment.appendChild(document.createTextNode(match[0]))
      }
      lastIndex = end
      match = regex.exec(text)
    }
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
    }
    textNode.parentNode?.replaceChild(fragment, textNode)
  }
}

function renderConversationEmpty(els, message) {
  els.chatConversationList.innerHTML = `<div class="chat-empty">${message}</div>`
}

export function renderConversations({
  els,
  state,
  onCreateConversation,
  onSelectConversation,
  onDeleteConversation,
}) {
  els.newConversationButton.onclick = () => void onCreateConversation()
  els.chatConversationList.innerHTML = ""
  if (!state.selectedProjectId) {
    renderConversationEmpty(els, "请先选择一个项目。")
    return
  }
  if (!state.conversations?.length) {
    renderConversationEmpty(els, "还没有聊天记录。新建一个对话，我们就可以从这里继续。")
    return
  }

  for (const conversation of state.conversations) {
    const item = document.createElement("article")
    item.className = `conversation-card ${conversation.id === state.selectedConversationId ? "active" : ""}`

    const mainButton = document.createElement("button")
    mainButton.type = "button"
    mainButton.className = "conversation-main"
    mainButton.innerHTML = `
      <strong>${escapeHtml(conversation.title || "新对话")}</strong>
      <span class="conversation-meta">
        <span>${escapeHtml(formatConversationTime(conversation.updatedAt) || conversation.id)}</span>
        <span>${escapeHtml(String(conversation.messageCount || 0))} 条消息</span>
      </span>
    `
    mainButton.addEventListener("click", () => void onSelectConversation(conversation.id))

    const deleteButton = document.createElement("button")
    deleteButton.type = "button"
    deleteButton.className = "conversation-delete"
    deleteButton.textContent = "删除"
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation()
      void onDeleteConversation(conversation)
    })

    item.appendChild(mainButton)
    item.appendChild(deleteButton)
    els.chatConversationList.appendChild(item)
  }
}

function buildReferences(references, activePath, onOpenReference, onHighlightReference) {
  if (!Array.isArray(references) || references.length === 0) return null
  const wrapper = document.createElement("div")
  wrapper.className = "chat-refs"

  const title = document.createElement("div")
  title.className = "chat-refs-title"
  title.textContent = "参考页面"
  wrapper.appendChild(title)

  const list = document.createElement("div")
  list.className = "chat-ref-list"
  for (const item of references) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = `chat-ref-chip ${item.path === activePath ? "active" : ""}`
    button.textContent = item.citation ? `[${item.citation}] ${item.title || normalizeReferenceTitle(item)}` : (item.title || normalizeReferenceTitle(item))
    button.title = item.path || ""
    button.addEventListener("click", async () => {
      onHighlightReference(item.path)
      await onOpenReference(item.path)
    })
    list.appendChild(button)
  }
  wrapper.appendChild(list)
  return wrapper
}

function buildMessageActions(message, isLastAssistant, onSaveSynthesis, onRegenerateMessage) {
  if (message.role !== "assistant") return null
  const actions = document.createElement("div")
  actions.className = "chat-actions"

  const copyButton = document.createElement("button")
  copyButton.type = "button"
  copyButton.className = "mini-button"
  copyButton.textContent = "复制回答"
  copyButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(message.content || "")
    copyButton.textContent = "已复制"
    window.setTimeout(() => {
      copyButton.textContent = "复制回答"
    }, 1200)
  })
  actions.appendChild(copyButton)

  if (message.meta?.canSaveSynthesis) {
    const saveButton = document.createElement("button")
    saveButton.type = "button"
    saveButton.className = "mini-button"
    saveButton.textContent = "保存为综合页"
    saveButton.addEventListener("click", () => void onSaveSynthesis(message.meta))
    actions.appendChild(saveButton)
  }

  if (isLastAssistant) {
    const regenerateButton = document.createElement("button")
    regenerateButton.type = "button"
    regenerateButton.className = "mini-button"
    regenerateButton.textContent = "重新生成"
    regenerateButton.addEventListener("click", () => void onRegenerateMessage())
    actions.appendChild(regenerateButton)
  }

  return actions
}

export function renderChatMessages({
  els,
  state,
  onSaveSynthesis,
  onOpenReference,
  onHighlightReference,
  onRegenerateMessage,
}) {
  els.chatMessages.innerHTML = ""
  const messages = Array.isArray(state.chatMessagesData) ? state.chatMessagesData : []
  if (messages.length === 0 && !state.chatPending) {
    els.chatMessages.innerHTML = `
      <div class="chat-empty chat-empty--panel">
        <strong>从一个明确的问题开始</strong>
        <p>可以问项目结论、概念关系、下一步研究方向，或者让系统帮你把现有知识页串起来。</p>
      </div>
    `
    return
  }

  const lastAssistantIndex = [...messages].map((item) => item.role).lastIndexOf("assistant")
  for (const [messageIndex, message] of messages.entries()) {
    const article = document.createElement("article")
    article.className = `chat-message ${message.role}`

    const bubble = document.createElement("div")
    bubble.className = "chat-bubble"

    const head = document.createElement("div")
    head.className = "chat-message-head"
    head.innerHTML = `
      <span class="chat-avatar">${message.role === "user" ? "你" : "AI"}</span>
      <div class="chat-message-meta">
        <strong>${message.role === "user" ? "你的问题" : "知识库回答"}</strong>
        <span>${escapeHtml(formatMessageTime(message.timestamp || message.createdAt) || "")}</span>
      </div>
    `
    bubble.appendChild(head)

    const body = document.createElement("div")
    body.className = `chat-message-body ${message.role === "assistant" ? "markdown-rendered" : ""}`
    if (message.role === "assistant") {
      body.innerHTML = renderMarkdownToHtml(message.content || "")
      wireCitationLinks(body, message.references || [], onHighlightReference)
    } else {
      body.innerHTML = `<p>${escapeHtml(message.content || "").replaceAll("\n", "<br />")}</p>`
    }
    bubble.appendChild(body)

    const refs = buildReferences(message.references, state.activeChatReferencePath, onOpenReference, onHighlightReference)
    if (refs) bubble.appendChild(refs)

    const actions = buildMessageActions(
      message,
      messageIndex === lastAssistantIndex,
      onSaveSynthesis,
      onRegenerateMessage,
    )
    if (actions) bubble.appendChild(actions)

    article.appendChild(bubble)
    els.chatMessages.appendChild(article)
  }

  if (state.chatPending) {
    const pending = document.createElement("article")
    pending.className = "chat-message assistant pending"
    const streamingBody = String(state.chatStreamingText || "").trim()
    pending.innerHTML = `
      <div class="chat-bubble">
        <div class="chat-message-head">
          <span class="chat-avatar">AI</span>
          <div class="chat-message-meta">
            <strong>知识库回答</strong>
            <span>正在生成</span>
          </div>
        </div>
        <div class="chat-message-body ${streamingBody ? "markdown-rendered" : ""}">
          ${
            streamingBody
              ? renderMarkdownToHtml(streamingBody)
              : '<p class="chat-thinking">正在检索知识页并组织回答…</p>'
          }
        </div>
      </div>
    `
    els.chatMessages.appendChild(pending)
  }

  els.chatMessages.scrollTop = els.chatMessages.scrollHeight
}
