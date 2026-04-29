import { formatPageMeta } from "./formatters.js"

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

export function renderKnowledgeTabs({ els, state, sections, onChangeSection }) {
  els.knowledgeTabs.innerHTML = ""
  for (const [key, label] of sections) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = `knowledge-tab ${state.activeKnowledgeSection === key ? "active" : ""}`
    const count = state.knowledge?.sections?.[key]?.length || 0
    button.textContent = `${label} ${count > 0 ? `(${count})` : ""}`.trim()
    button.addEventListener("click", () => onChangeSection(key))
    els.knowledgeTabs.appendChild(button)
  }
}

export function renderKnowledgeList({ els, state, onOpenFile }) {
  els.knowledgeList.innerHTML = ""
  if (!state.selectedProjectId) {
    els.knowledgeList.innerHTML = `<p class="empty">请选择一个项目来浏览知识库。</p>`
    return
  }
  const items = state.knowledge?.sections?.[state.activeKnowledgeSection] || []
  if (items.length === 0) {
    els.knowledgeList.innerHTML = `<p class="empty">这个分类下暂时还没有页面。</p>`
    return
  }
  for (const item of items) {
    const meta = formatPageMeta(item)
    const button = document.createElement("button")
    button.type = "button"
    button.className = `knowledge-card ${state.selectedPath === item.path ? "active" : ""}`
    button.innerHTML = `
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.path)}</span>
      ${meta ? `<div class="item-meta">${escapeHtml(meta)}</div>` : ""}
      <p>${escapeHtml(item.summary)}</p>
    `
    button.addEventListener("click", () => void onOpenFile(item.path))
    els.knowledgeList.appendChild(button)
  }
}
