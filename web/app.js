import {
  KNOWLEDGE_SECTIONS,
} from "./lib/formatters.js"
import { createApiClient } from "./lib/api.js"
import { renderChatMessages, renderConversations } from "./lib/render-chat.js"
import { renderGraphView } from "./lib/render-graph.js"
import { renderKnowledgeList, renderKnowledgeTabs } from "./lib/render-knowledge.js"
import { renderMarkdownToHtml } from "./lib/render-markdown.js"
import { renderLens } from "./lib/render-lens.js"
import { renderLintView } from "./lib/render-lint.js"
import { renderProjects, renderTree } from "./lib/render-projects.js"
import { renderSearchResults } from "./lib/render-search.js"
import { renderShell } from "./lib/render-shell.js"
import { renderSourcesWorkspace as renderSourcesWorkspaceView } from "./lib/render-sources.js"
import { createWorkspaceActions } from "./lib/workspace-actions.js"

const state = {
  activeView: "wiki",
  projects: [],
  selectedProjectId: null,
  selectedPath: null,
  currentContents: "",
  currentFileMode: "text",
  currentDownloadUrl: "",
  knowledge: null,
  graph: null,
  lint: null,
  lens: null,
  importHistory: [],
  graphPreviewPath: null,
  graphPreviewContents: "",
  graphPreviewMode: "empty",
  graphPreviewDownloadUrl: "",
  sourcesPreviewPath: null,
  sourcesPreviewContents: "",
  sourcesPreviewMode: "empty",
  sourcesPreviewDownloadUrl: "",
  graphNodePositions: {},
  lastQuestion: "",
  conversations: [],
  selectedConversationId: null,
  chatMessagesData: [],
  chatPending: false,
  chatStreamingText: "",
  activeChatReferencePath: null,
  activeKnowledgeSection: "overview",
  searchQuery: "",
  searchResults: [],
  treeNodes: [],
  sourceTreeScope: "raw",
  graphTypeFilter: "all",
  graphSelectedNodeId: null,
  graphNeighborOnly: true,
  lensTab: "queries",
  sourcesBatchIndex: 0,
  tasks: [],
  taskPollTimer: null,
  expandedTreePaths: new Set(),
  modal: {
    open: false,
    title: "",
    body: "",
    confirmLabel: "确认",
    danger: false,
    resolver: null,
  },
}

const api = createApiClient()

const els = {
  appShell: document.querySelector(".app-shell"),
  workspaceShell: document.querySelector(".workspace-shell"),
  projectsPanel: document.querySelector(".projects-panel"),
  projectsPanelHome: document.querySelector("#projects-panel-home"),
  projectsPanelSources: document.querySelector("#projects-panel-sources"),
  navButtons: Array.from(document.querySelectorAll(".nav-button")),
  activeProjectName: document.querySelector("#active-project-name"),
  activeProjectMeta: document.querySelector("#active-project-meta"),
  activeViewTitle: document.querySelector("#active-view-title"),
  headerSourceActions: document.querySelector("#header-source-actions"),
  workspaceBody: document.querySelector("#workspace-body"),
  contextPane: document.querySelector("#context-pane"),
  sidebarKnowledge: document.querySelector("#sidebar-knowledge"),
  sourceScopeTabs: Array.from(document.querySelectorAll(".source-scope-tab")),
  sidebarSearch: document.querySelector("#sidebar-search"),
  sidebarReview: document.querySelector("#sidebar-review"),
  sidebarChat: document.querySelector("#sidebar-chat"),
  detailProjects: document.querySelector("#detail-projects"),
  detailEditor: document.querySelector("#detail-editor"),
  detailSources: document.querySelector("#detail-sources"),
  detailGraph: document.querySelector("#detail-graph"),
  detailLint: document.querySelector("#detail-lint"),
  detailChat: document.querySelector("#detail-chat"),
  detailSettings: document.querySelector("#detail-settings"),
  projectList: document.querySelector("#project-list"),
  treeRoot: document.querySelector("#tree-root"),
  newProjectName: document.querySelector("#new-project-name"),
  createProjectButton: document.querySelector("#create-project-button"),
  uploadButton: document.querySelector("#upload-button"),
  uploadInput: document.querySelector("#upload-input"),
  uploadLabel: document.querySelector("#upload-label"),
  uploadFolderButton: document.querySelector("#upload-folder-button"),
  uploadFolderInput: document.querySelector("#upload-folder-input"),
  uploadFolderLabel: document.querySelector("#upload-folder-label"),
  knowledgeTabs: document.querySelector("#knowledge-tabs"),
  knowledgeList: document.querySelector("#knowledge-list"),
  searchInput: document.querySelector("#search-input"),
  searchButton: document.querySelector("#search-button"),
  searchResults: document.querySelector("#search-results"),
  lensQueries: document.querySelector("#lens-queries"),
  lensReview: document.querySelector("#lens-review"),
  lensTabButtons: Array.from(document.querySelectorAll(".lens-tab")),
  sourcesSummaryTotal: document.querySelector("#sources-summary-total"),
  sourcesSummaryRunning: document.querySelector("#sources-summary-running"),
  sourcesSummaryDone: document.querySelector("#sources-summary-done"),
  sourcesSummaryError: document.querySelector("#sources-summary-error"),
  sourcesRecordCopy: document.querySelector("#sources-records-copy"),
  sourcesRecordBatchNav: document.querySelector("#sources-record-batch-nav"),
  sourcesBatchPrev: document.querySelector("#sources-batch-prev"),
  sourcesBatchIndicator: document.querySelector("#sources-batch-indicator"),
  sourcesBatchNext: document.querySelector("#sources-batch-next"),
  sourcesBatchRun: document.querySelector("#sources-batch-run"),
  sourcesBatchDiscard: document.querySelector("#sources-batch-discard"),
  sourcesImportHistory: document.querySelector("#sources-import-history"),
  llmBaseUrl: document.querySelector("#llm-base-url"),
  llmModel: document.querySelector("#llm-model"),
  llmApiKey: document.querySelector("#llm-api-key"),
  llmApiMode: document.querySelector("#llm-api-mode"),
  llmMaxContextSize: document.querySelector("#llm-max-context-size"),
  llmEnabled: document.querySelector("#llm-enabled"),
  outputLanguage: document.querySelector("#output-language"),
  chatResponseMode: document.querySelector("#chat-response-mode"),
  searchProvider: document.querySelector("#search-provider"),
  searchApiKey: document.querySelector("#search-api-key"),
  embeddingEnabled: document.querySelector("#embedding-enabled"),
  embeddingEndpoint: document.querySelector("#embedding-endpoint"),
  embeddingApiKey: document.querySelector("#embedding-api-key"),
  embeddingModel: document.querySelector("#embedding-model"),
  embeddingMaxChunkChars: document.querySelector("#embedding-max-chunk-chars"),
  embeddingOverlapChunkChars: document.querySelector("#embedding-overlap-chunk-chars"),
  saveSettingsButton: document.querySelector("#save-settings-button"),
  saveButton: document.querySelector("#save-button"),
  reingestSourceButton: document.querySelector("#reingest-source-button"),
  deleteSourceButton: document.querySelector("#delete-source-button"),
  currentPath: document.querySelector("#current-path"),
  downloadPanel: document.querySelector("#download-panel"),
  downloadCopy: document.querySelector("#download-copy"),
  downloadLink: document.querySelector("#download-link"),
  editor: document.querySelector("#editor"),
  editorGrid: document.querySelector("#editor-grid"),
  graphSummary: document.querySelector("#graph-summary"),
  graphStage: document.querySelector("#graph-stage"),
  graphLegend: document.querySelector("#graph-legend"),
  graphPreviewPath: document.querySelector("#graph-preview-path"),
  graphPreviewPanel: document.querySelector("#graph-preview-panel"),
  graphPreviewDownload: document.querySelector("#graph-preview-download"),
  graphPreviewDownloadCopy: document.querySelector("#graph-preview-download-copy"),
  graphPreviewDownloadLink: document.querySelector("#graph-preview-download-link"),
  sourcesPreviewPath: document.querySelector("#sources-preview-path"),
  sourcesPreviewPanel: document.querySelector("#sources-preview-panel"),
  sourcesPreviewDownload: document.querySelector("#sources-preview-download"),
  sourcesPreviewDownloadCopy: document.querySelector("#sources-preview-download-copy"),
  sourcesPreviewDownloadLink: document.querySelector("#sources-preview-download-link"),
  graphTypeFilter: document.querySelector("#graph-type-filter"),
  graphNeighborOnly: document.querySelector("#graph-neighbor-only"),
  runLintButton: document.querySelector("#run-lint-button"),
  lintSummary: document.querySelector("#lint-summary"),
  lintList: document.querySelector("#lint-list"),
  preview: document.querySelector("#preview"),
  chatMessages: document.querySelector("#chat-messages"),
  chatConversationList: document.querySelector("#chat-conversation-list"),
  newConversationButton: document.querySelector("#new-conversation-button"),
  chatInput: document.querySelector("#chat-input"),
  chatSendButton: document.querySelector("#chat-send-button"),
  statusBar: document.querySelector("#status-bar"),
  modalRoot: document.querySelector("#modal-root"),
  modalBackdrop: document.querySelector("#modal-backdrop"),
  confirmModal: document.querySelector("#confirm-modal"),
  confirmModalTitle: document.querySelector("#confirm-modal-title"),
  confirmModalBody: document.querySelector("#confirm-modal-body"),
  confirmModalCancel: document.querySelector("#confirm-modal-cancel"),
  confirmModalConfirm: document.querySelector("#confirm-modal-confirm"),
}

function setStatus(message) {
  els.statusBar.textContent = message
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function closeConfirmModal(result = false) {
  if (typeof state.modal.resolver === "function") {
    const resolver = state.modal.resolver
    state.modal.resolver = null
    resolver(result)
  }
  state.modal.open = false
  state.modal.title = ""
  state.modal.body = ""
  state.modal.confirmLabel = "确认"
  state.modal.danger = false
  renderConfirmModal()
}

function renderConfirmModal() {
  els.modalRoot.hidden = !state.modal.open
  els.confirmModalTitle.textContent = state.modal.title || "确认操作"
  els.confirmModalBody.innerHTML = String(state.modal.body || "")
    .split("\n")
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("")
    || "<p>请确认是否继续。</p>"
  els.confirmModalConfirm.textContent = state.modal.confirmLabel || "确认"
  els.confirmModalConfirm.classList.toggle("danger-button", Boolean(state.modal.danger))
  els.confirmModalConfirm.classList.toggle("primary-button", !state.modal.danger)
  if (state.modal.open) {
    queueMicrotask(() => els.confirmModalConfirm.focus())
  }
}

function confirmAction({
  title = "确认操作",
  body = "",
  confirmLabel = "确认",
  danger = false,
} = {}) {
  if (state.modal.open) {
    closeConfirmModal(false)
  }
  state.modal.open = true
  state.modal.title = title
  state.modal.body = body
  state.modal.confirmLabel = confirmLabel
  state.modal.danger = danger
  renderConfirmModal()
  return new Promise((resolve) => {
    state.modal.resolver = resolve
  })
}

function isMarkdownPath(filePath) {
  return /\.(md|markdown)$/i.test(String(filePath || ""))
}

function updateEditor() {
  els.editor.value = state.currentContents
  if (isMarkdownPath(state.selectedPath)) {
    els.preview.innerHTML = state.currentContents
      ? renderMarkdownToHtml(state.currentContents)
      : "<p>这里会显示 Markdown 预览。</p>"
    els.preview.classList.add("markdown-rendered")
  } else {
    els.preview.textContent = state.currentContents || "这里会显示预览。"
    els.preview.classList.remove("markdown-rendered")
  }
  els.currentPath.textContent = state.selectedPath || "未选择文件"
  const isTextMode = state.currentFileMode === "text"
  const deletableSource = Boolean(state.selectedProjectId && String(state.selectedPath || "").startsWith("raw/sources/"))
  const reingestableSource = Boolean(
    state.selectedProjectId
    && /\.(md|txt|markdown|pdf|doc|docx|pptx|xlsx|csv)$/i.test(String(state.selectedPath || ""))
    && String(state.selectedPath || "").startsWith("raw/sources/"),
  )
  els.saveButton.disabled = !(isTextMode && state.selectedProjectId && state.selectedPath)
  els.reingestSourceButton.hidden = !reingestableSource
  els.deleteSourceButton.hidden = !deletableSource
  els.editorGrid.hidden = !isTextMode
  els.downloadPanel.hidden = isTextMode
  if (!isTextMode) {
    els.downloadLink.href = state.currentDownloadUrl || "#"
    els.downloadLink.setAttribute("download", state.selectedPath?.split("/").pop() || "download")
    els.downloadCopy.textContent = `当前文件 ${state.selectedPath || ""} 不支持网页预览，请直接下载查看。`
  }
}

function updateGraphPreview() {
  els.graphPreviewPath.textContent = state.graphPreviewPath || "点击图谱节点查看内容"
  const hasSelection = Boolean(state.graphPreviewPath)
  if (!hasSelection) {
    els.graphPreviewPanel.hidden = false
    els.graphPreviewPanel.textContent = "这里会显示节点对应页面的内容。"
    els.graphPreviewPanel.classList.remove("markdown-rendered")
    els.graphPreviewDownload.hidden = true
    return
  }
  const isTextMode = state.graphPreviewMode === "text"
  els.graphPreviewPanel.hidden = !isTextMode
  els.graphPreviewDownload.hidden = isTextMode

  if (isTextMode) {
    if (isMarkdownPath(state.graphPreviewPath)) {
      els.graphPreviewPanel.innerHTML = state.graphPreviewContents
        ? renderMarkdownToHtml(state.graphPreviewContents)
        : "<p>这里会显示节点对应页面的内容。</p>"
      els.graphPreviewPanel.classList.add("markdown-rendered")
    } else {
      els.graphPreviewPanel.textContent = state.graphPreviewContents || "这里会显示节点对应页面的内容。"
      els.graphPreviewPanel.classList.remove("markdown-rendered")
    }
    return
  }

  els.graphPreviewDownloadLink.href = state.graphPreviewDownloadUrl || "#"
  els.graphPreviewDownloadLink.setAttribute("download", state.graphPreviewPath?.split("/").pop() || "download")
  els.graphPreviewDownloadCopy.textContent = state.graphPreviewPath
    ? `当前节点 ${state.graphPreviewPath} 不支持网页预览，请直接下载查看。`
    : "当前节点内容不可直接预览，请下载查看。"
}

function updateSourcesPreview() {
  els.sourcesPreviewPath.textContent = state.sourcesPreviewPath || "点击文件名查看内容"
  const hasSelection = Boolean(state.sourcesPreviewPath)
  if (!hasSelection) {
    els.sourcesPreviewPanel.hidden = false
    els.sourcesPreviewPanel.textContent = "这里会显示来源文件内容。"
    els.sourcesPreviewPanel.classList.remove("markdown-rendered")
    els.sourcesPreviewDownload.hidden = true
    return
  }
  const isTextMode = state.sourcesPreviewMode === "text"
  els.sourcesPreviewPanel.hidden = !isTextMode
  els.sourcesPreviewDownload.hidden = isTextMode

  if (isTextMode) {
    if (isMarkdownPath(state.sourcesPreviewPath)) {
      els.sourcesPreviewPanel.innerHTML = state.sourcesPreviewContents
        ? renderMarkdownToHtml(state.sourcesPreviewContents)
        : "<p>这里会显示来源文件内容。</p>"
      els.sourcesPreviewPanel.classList.add("markdown-rendered")
    } else {
      els.sourcesPreviewPanel.textContent = state.sourcesPreviewContents || "这里会显示来源文件内容。"
      els.sourcesPreviewPanel.classList.remove("markdown-rendered")
    }
    return
  }

  els.sourcesPreviewDownloadLink.href = state.sourcesPreviewDownloadUrl || "#"
  els.sourcesPreviewDownloadLink.setAttribute("download", state.sourcesPreviewPath?.split("/").pop() || "download")
  els.sourcesPreviewDownloadCopy.textContent = state.sourcesPreviewPath
    ? `当前来源 ${state.sourcesPreviewPath} 不支持网页预览，请直接下载查看。`
    : "当前来源文件不可直接预览，请下载查看。"
}

function updateUploadState() {
  const enabled = Boolean(state.selectedProjectId)
  els.uploadButton.classList.toggle("disabled", !enabled)
  els.uploadFolderButton.classList.toggle("disabled", !enabled)
  els.uploadInput.disabled = !enabled
  els.uploadFolderInput.disabled = !enabled
  els.searchInput.disabled = !enabled
  els.searchButton.disabled = !enabled
  els.chatSendButton.disabled = !enabled || (!state.chatPending && !els.chatInput.value.trim())
  els.chatSendButton.textContent = state.chatPending ? "停止" : "提问"
}

function resizeChatInput() {
  els.chatInput.style.height = "auto"
  els.chatInput.style.height = `${Math.min(Math.max(els.chatInput.scrollHeight, 56), 200)}px`
}

let workspaceActions

function renderChrome() {
  renderShell({ els, state })
}

function ensureViewData(view) {
  if (view === "graph" && state.selectedProjectId && !state.graph) {
    return workspaceActions.loadGraph()
  }
  if (view === "review" && state.selectedProjectId && !state.lens) {
    return workspaceActions.loadLens()
  }
  if (view === "lint" && state.selectedProjectId && !state.lint) {
    return workspaceActions.loadLint()
  }
  if (view === "chat" && state.selectedProjectId && !state.selectedConversationId) {
    return workspaceActions.loadConversations()
  }
  return Promise.resolve()
}

async function selectView(view) {
  state.activeView = view
  renderProjectsPanel()
  updateEditor()
  renderGraphPanel()
  await ensureViewData(view)
}

function focusQuestion(question) {
  state.activeView = "chat"
  renderChrome()
  els.chatInput.value = question
  resizeChatInput()
  els.chatInput.focus()
}

function renderKnowledgePanel() {
  renderKnowledgeTabs({
    els,
    state,
    sections: KNOWLEDGE_SECTIONS,
    onChangeSection: (key) => {
      state.activeKnowledgeSection = key
      renderKnowledgePanel()
    },
  })
  renderKnowledgeList({ els, state, onOpenFile: workspaceActions.openFile })
}

function renderSearchPanel() {
  renderSearchResults({
    els,
    state,
    onOpenFile: workspaceActions.openFile,
    onAskQuestion: focusQuestion,
  })
}

function renderSourcesWorkspace() {
  renderSourcesWorkspaceView({
    els,
    state,
    onPreviewFile: workspaceActions.previewSourceFile,
    onReingestSource: workspaceActions.reingestSource,
    onRunBatchIngest: workspaceActions.runBatchIngest,
    onDiscardBatchPending: workspaceActions.discardBatchPending,
    onChangeBatchIndex: (direction) => {
      const count = Array.isArray(state.importHistory) ? state.importHistory.length : 0
      if (count <= 1) return
      if (direction === "prev") {
        state.sourcesBatchIndex = Math.max(0, state.sourcesBatchIndex - 1)
      } else if (direction === "next") {
        state.sourcesBatchIndex = Math.min(count - 1, state.sourcesBatchIndex + 1)
      }
      renderSourcesWorkspace()
    },
  })
  updateSourcesPreview()
}

function renderSourceTreePanel() {
  for (const button of els.sourceScopeTabs) {
    button.classList.toggle("active", button.dataset.scope === state.sourceTreeScope)
  }
  const filteredNodes = workspaceActions.filterTreeNodes(state.treeNodes, state.sourceTreeScope)
  els.treeRoot.innerHTML = ""
  if (!state.selectedProjectId) {
    els.treeRoot.innerHTML = `<p class="empty">请先创建项目或选择一个已有项目。</p>`
    return
  }
  if (filteredNodes.length === 0) {
    els.treeRoot.innerHTML = `<p class="empty">当前分组下还没有文件。</p>`
    return
  }
  els.treeRoot.appendChild(renderTree({
    nodes: filteredNodes,
    state,
    onOpenFile: workspaceActions.openFile,
    onToggleDir: workspaceActions.toggleDir,
  }))
}

function renderGraphPanel() {
  renderGraphView({
    els,
    state,
    onOpenFile: workspaceActions.openFile,
    onPreviewNode: workspaceActions.previewGraphNode,
  })
  updateGraphPreview()
}

function renderLintPanel() {
  renderLintView({
    els,
    state,
    onOpenFile: workspaceActions.openFile,
  })
}

function renderChatPanel() {
  renderConversations({
    els,
    state,
    onCreateConversation: workspaceActions.createConversation,
    onSelectConversation: workspaceActions.selectConversation,
    onDeleteConversation: workspaceActions.deleteConversation,
  })
  renderChatMessages({
    els,
    state,
    onSaveSynthesis: workspaceActions.saveSynthesisFromChat,
    onOpenReference: workspaceActions.openFile,
    onHighlightReference: workspaceActions.highlightChatReference,
    onRegenerateMessage: workspaceActions.regenerateLastAnswer,
  })
  updateUploadState()
}

function renderLensPanel() {
  renderLens({
    els,
    state,
    onOpenFile: workspaceActions.openFile,
    onRunIngest: workspaceActions.runIngest,
    onReviewAction: workspaceActions.reviewAction,
    onAskQuestion: focusQuestion,
    setStatus,
  })
}

function renderProjectsPanel() {
  renderProjects({
    els,
    state,
    onSelectProject: workspaceActions.handleProjectSelect,
    onDeleteProject: workspaceActions.deleteProject,
  })
  renderChrome()
}

workspaceActions = createWorkspaceActions({
  api,
  state,
  els,
  setStatus,
  confirmAction,
  updateEditor,
  updateUploadState,
  renderProjectsPanel,
  renderKnowledgePanel,
  renderSearchPanel,
  renderSourceTreePanel,
  renderSourcesWorkspace,
  renderGraphPanel,
  renderLintPanel,
  renderLensPanel,
  renderChatPanel,
  renderShell: renderChrome,
  renderTree,
})

workspaceActions.bind(workspaceActions)

els.createProjectButton.addEventListener("click", () => void workspaceActions.createProject())
els.saveButton.addEventListener("click", () => void workspaceActions.saveFile())
els.reingestSourceButton.addEventListener("click", () => {
  if (state.selectedPath) void workspaceActions.reingestSource(state.selectedPath)
})
els.deleteSourceButton.addEventListener("click", () => {
  if (state.selectedPath) void workspaceActions.deleteSource(state.selectedPath)
})
els.uploadInput.addEventListener("change", () => void workspaceActions.uploadFiles())
els.uploadFolderInput.addEventListener("change", () => void workspaceActions.uploadFiles("folder"))
els.searchButton.addEventListener("click", () => void workspaceActions.runSearch())
els.chatSendButton.addEventListener("click", () => void workspaceActions.askChat())
els.chatInput.addEventListener("input", () => {
  resizeChatInput()
  updateUploadState()
})
els.chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault()
    if (!els.chatSendButton.disabled) {
      void workspaceActions.askChat()
    }
  }
})
els.saveSettingsButton.addEventListener("click", () => void workspaceActions.saveSettings())
els.confirmModalCancel.addEventListener("click", () => closeConfirmModal(false))
els.confirmModalConfirm.addEventListener("click", () => closeConfirmModal(true))
els.modalBackdrop.addEventListener("click", () => closeConfirmModal(false))
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.modal.open) {
    event.preventDefault()
    closeConfirmModal(false)
  }
})
els.graphTypeFilter.addEventListener("change", () => {
  state.graphTypeFilter = els.graphTypeFilter.value
  renderGraphPanel()
})
els.graphNeighborOnly.addEventListener("change", () => {
  state.graphNeighborOnly = els.graphNeighborOnly.checked
  renderGraphPanel()
})
els.runLintButton.addEventListener("click", () => void workspaceActions.loadLint(true))
els.searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault()
    void workspaceActions.runSearch()
  }
})
for (const button of els.sourceScopeTabs) {
  button.addEventListener("click", () => {
    state.sourceTreeScope = button.dataset.scope
    renderSourceTreePanel()
  })
}
for (const button of els.lensTabButtons) {
  button.addEventListener("click", () => {
    state.lensTab = button.dataset.lensTab || "queries"
    renderLensPanel()
  })
}
els.editor.addEventListener("input", () => {
  state.currentContents = els.editor.value
  updateEditor()
})

for (const button of els.navButtons) {
  button.addEventListener("click", () => void selectView(button.dataset.view))
}

await workspaceActions.refreshProjects()
await workspaceActions.loadSettings()
await workspaceActions.loadKnowledge()
await workspaceActions.loadGraph()
await workspaceActions.loadLint()
await workspaceActions.loadLens()
await workspaceActions.loadImportHistory()
await workspaceActions.loadTree()
await workspaceActions.loadTasks()
await workspaceActions.loadConversations()
workspaceActions.restartTaskPolling()
els.graphNeighborOnly.checked = state.graphNeighborOnly
updateUploadState()
updateEditor()
resizeChatInput()
renderChrome()
renderKnowledgePanel()
renderSourceTreePanel()
renderSourcesWorkspace()
renderSearchPanel()
renderGraphPanel()
renderLintPanel()
renderLensPanel()
renderChatPanel()
