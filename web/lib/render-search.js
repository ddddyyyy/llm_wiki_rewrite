import { formatPageMeta } from "./formatters.js"

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

export function renderSearchResults({ els, state, onOpenFile, onAskQuestion }) {
  els.searchResults.innerHTML = ""
  if (!state.selectedProjectId) {
    els.searchResults.innerHTML = `<p class="empty">请选择一个项目后再搜索。</p>`
    return
  }
  if (!state.searchQuery) {
    els.searchResults.innerHTML = `<p class="empty">输入关键词后，可以快速定位知识页和原始资料。</p>`
    return
  }
  if (state.searchResults.length === 0) {
    els.searchResults.innerHTML = `<p class="empty">没有找到匹配结果，可以换个关键词试试。</p>`
    return
  }
  for (const item of state.searchResults) {
    const meta = formatPageMeta(item)
    const row = document.createElement("div")
    row.className = "search-item"
    row.innerHTML = `
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.path)}</span>
      ${meta ? `<div class="item-meta">${escapeHtml(meta)}</div>` : ""}
      <p>${escapeHtml(item.snippet || "")}</p>
    `
    const actions = document.createElement("div")
    actions.className = "lens-actions"

    const openButton = document.createElement("button")
    openButton.type = "button"
    openButton.className = "mini-button"
    openButton.textContent = "打开"
    openButton.addEventListener("click", () => void onOpenFile(item.path))
    actions.appendChild(openButton)

    const askButton = document.createElement("button")
    askButton.type = "button"
    askButton.className = "mini-button"
    askButton.textContent = "围绕此页提问"
    askButton.addEventListener("click", () => onAskQuestion(`${state.searchQuery}\n\n请优先参考：${item.path}`))
    actions.appendChild(askButton)

    row.appendChild(actions)
    els.searchResults.appendChild(row)
  }
}
