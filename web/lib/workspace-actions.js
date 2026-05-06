import { renderTasks } from "./render-tasks.js"

export function createWorkspaceActions(deps) {
  const {
    api,
    state,
    els,
    setStatus,
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
    renderShell,
    renderTree,
    formatTaskType,
    formatTaskStatus,
    formatTaskStage,
  } = deps

  let actions = null
  let activeChatAbortController = null
  const PREVIEWABLE_TEXT_EXTENSIONS = new Set(["md", "markdown", "txt", "csv"])

  function hydrateChatMessages(messages) {
    let lastUserQuestion = ""
    return (Array.isArray(messages) ? messages : []).map((message) => {
      if (message.role === "user") {
        lastUserQuestion = message.content
        return message
      }
      if (message.role === "assistant") {
        return {
          ...message,
          meta: {
            canSaveSynthesis: true,
            title: lastUserQuestion || "问答综合",
            question: lastUserQuestion || "请补充问题",
            answer: message.content,
            references: message.references || [],
          },
        }
      }
      return message
    })
  }

  function bind(nextActions) {
    actions = nextActions
  }

  function resetStreamingState() {
    state.chatPending = false
    state.chatStreamingText = ""
    activeChatAbortController = null
    updateUploadState()
  }

  function isPreviewableTextFile(relativePath) {
    const ext = String(relativePath || "").split(".").pop()?.toLowerCase() || ""
    return PREVIEWABLE_TEXT_EXTENSIONS.has(ext)
  }

  function isVisibleUploadPath(relativePath) {
    return !String(relativePath || "")
      .split("/")
      .some((segment) => segment.startsWith("."))
  }

  function applyDefaultTreeExpansion(nodes) {
    if (state.expandedTreePaths.size > 0) return
    const defaults = new Set()
    const walk = (items, depth = 0) => {
      for (const node of items || []) {
        if (!node.isDir) continue
        if (depth === 0 || node.path === "raw" || node.path === "raw/sources" || node.path === "wiki") {
          defaults.add(node.path)
        }
        if (node.children?.length) walk(node.children, depth + 1)
      }
    }
    walk(nodes)
    state.expandedTreePaths = defaults
  }

  function knowledgeSectionForPath(relativePath) {
    const value = String(relativePath || "")
    if (value === "wiki/overview.md") return "overview"
    if (value === "wiki/index.md") return "index"
    if (value.startsWith("wiki/sources/")) return "sources"
    if (value.startsWith("wiki/concepts/")) return "concepts"
    if (value.startsWith("wiki/entities/")) return "entities"
    if (value.startsWith("wiki/queries/")) return "queries"
    if (value.startsWith("wiki/comparisons/")) return "comparisons"
    if (value.startsWith("wiki/synthesis/")) return "synthesis"
    return null
  }

  function resetProjectWorkspaceState() {
    state.selectedPath = null
    state.currentContents = ""
    state.currentFileMode = "text"
    state.currentDownloadUrl = ""
    state.knowledge = null
    state.graph = null
    state.graphPreviewPath = null
    state.graphPreviewContents = ""
    state.graphPreviewMode = "empty"
    state.graphPreviewDownloadUrl = ""
    state.graphNodePositions = {}
    state.lint = null
    state.lens = null
    state.importHistory = []
    state.sourcesBatchIndex = 0
    state.searchResults = []
    state.treeNodes = []
    state.tasks = []
    state.taskIndex = 0
    state.conversations = []
    state.selectedConversationId = null
    state.chatMessagesData = []
    state.chatPending = false
    state.chatStreamingText = ""
    state.activeChatReferencePath = null
    state.expandedTreePaths = new Set()
  }

  async function handleProjectSelect(projectId) {
    state.selectedProjectId = projectId
    state.searchQuery = ""
    resetProjectWorkspaceState()
    renderProjectsPanel()
    updateEditor()
    updateUploadState()
    renderShell()
    await actions.loadKnowledge()
    await actions.loadGraph()
    await actions.loadLint()
    await actions.loadLens()
    await actions.loadImportHistory()
    await actions.loadTree()
    await actions.loadTasks()
    await actions.loadConversations()
    renderSourcesWorkspace()
    renderSearchPanel()
    actions.restartTaskPolling()
  }

  async function refreshProjects() {
    const response = await api.listProjects()
    state.projects = response.projects
    if (!state.selectedProjectId && state.projects[0]) {
      state.selectedProjectId = state.projects[0].id
    }
    renderProjectsPanel()
    updateUploadState()
    renderShell()
  }

  async function loadKnowledge() {
    if (!state.selectedProjectId) {
      state.knowledge = null
      renderKnowledgePanel()
      return
    }
    state.knowledge = await api.loadKnowledge(state.selectedProjectId)
    renderKnowledgePanel()
  }

  async function loadGraph() {
    if (!state.selectedProjectId) {
      state.graph = null
      renderGraphPanel()
      return
    }
    state.graph = await api.loadGraph(state.selectedProjectId)
    renderGraphPanel()
  }

  async function loadLint(force = false) {
    if (!state.selectedProjectId) {
      state.lint = null
      renderLintPanel()
      return
    }
    if (!force && state.lint) {
      renderLintPanel()
      return
    }
    setStatus("正在运行知识库检查...")
    state.lint = await api.loadLint(state.selectedProjectId)
    renderLintPanel()
    setStatus(`检查完成：发现 ${state.lint.summary?.total || 0} 个问题`)
  }

  async function loadLens() {
    if (!state.selectedProjectId) {
      state.lens = null
      renderLensPanel()
      return
    }
    state.lens = await api.loadLens(state.selectedProjectId)
    renderLensPanel()
  }

  async function loadImportHistory() {
    if (!state.selectedProjectId) {
      state.importHistory = []
      state.sourcesBatchIndex = 0
      renderSourcesWorkspace()
      return
    }
    const response = await api.loadImportHistory(state.selectedProjectId)
    state.importHistory = response.batches || []
    state.sourcesBatchIndex = Math.min(
      Math.max(state.sourcesBatchIndex, 0),
      Math.max(state.importHistory.length - 1, 0),
    )
    renderSourcesWorkspace()
  }

  async function reviewAction(key, action) {
    if (!state.selectedProjectId) return
    await api.reviewAction(state.selectedProjectId, key, action)
    await loadLens()
  }

  async function saveSynthesisFromChat(meta) {
    if (!state.selectedProjectId) return
    setStatus("正在保存综合页...")
    const response = await api.saveSynthesisFromChat(state.selectedProjectId, {
      title: meta.title,
      question: meta.question,
      answer: meta.answer,
      references: meta.references || [],
    })
    await loadKnowledge()
    await loadGraph()
    await loadLens()
    await loadTree()
    setStatus(`已保存综合页：${response.path}`)
  }

  async function loadTasks() {
    if (!state.selectedProjectId) {
      state.tasks = []
      state.taskIndex = 0
      renderTasks({
        els,
        state,
        formatTaskType,
        formatTaskStatus,
        formatTaskStage,
        onRetryTask: retryTask,
        onChangeTaskIndex: changeTaskIndex,
      })
      renderSourcesWorkspace()
      return
    }
    const previous = state.tasks
    state.tasks = (await api.loadTasks(state.selectedProjectId)).tasks
    state.taskIndex = Math.min(
      Math.max(state.taskIndex || 0, 0),
      Math.max(state.tasks.length - 1, 0),
    )
    renderTasks({
      els,
      state,
      formatTaskType,
      formatTaskStatus,
      formatTaskStage,
      onRetryTask: retryTask,
      onChangeTaskIndex: changeTaskIndex,
    })
    renderSourcesWorkspace()
    const hadRunning = previous.some((task) => task.status === "running" || task.status === "queued")
    const hasRunning = state.tasks.some((task) => task.status === "running" || task.status === "queued")
    if (hadRunning && !hasRunning) {
      await refreshProjects()
      await loadKnowledge()
      await loadGraph()
      await loadLens()
      await loadTree()
    }
  }

  function changeTaskIndex(direction) {
    const count = Array.isArray(state.tasks) ? state.tasks.length : 0
    if (count <= 1) return
    if (direction === "prev") {
      state.taskIndex = Math.max(0, (state.taskIndex || 0) - 1)
    } else if (direction === "next") {
      state.taskIndex = Math.min(count - 1, (state.taskIndex || 0) + 1)
    }
    renderTasks({
      els,
      state,
      formatTaskType,
      formatTaskStatus,
      formatTaskStage,
      onRetryTask: retryTask,
      onChangeTaskIndex: changeTaskIndex,
    })
  }

  async function loadConversations() {
    if (!state.selectedProjectId) {
      state.conversations = []
      state.selectedConversationId = null
      state.chatMessagesData = []
      state.chatPending = false
      state.chatStreamingText = ""
      state.activeChatReferencePath = null
      renderChatPanel()
      return
    }
    const response = await api.listConversations(state.selectedProjectId)
    state.conversations = response.conversations || []
    if (!state.selectedConversationId && state.conversations[0]) {
      state.selectedConversationId = state.conversations[0].id
      await selectConversation(state.selectedConversationId)
      return
    }
    renderChatPanel()
  }

  async function createConversation() {
    if (!state.selectedProjectId) return
    const response = await api.createConversation(state.selectedProjectId, { title: "新对话" })
    state.conversations = [response.conversation, ...state.conversations.filter((item) => item.id !== response.conversation.id)]
    state.selectedConversationId = response.conversation.id
    state.chatMessagesData = response.messages || []
    state.chatPending = false
    state.chatStreamingText = ""
    state.activeChatReferencePath = null
    state.activeView = "chat"
    renderShell()
    renderChatPanel()
    setStatus("已创建新对话")
  }

  async function selectConversation(conversationId) {
    if (!state.selectedProjectId || !conversationId) return
    const response = await api.loadConversation(state.selectedProjectId, conversationId)
    state.selectedConversationId = response.conversation.id
    state.chatMessagesData = hydrateChatMessages(response.messages || [])
    state.chatPending = false
    state.chatStreamingText = ""
    state.activeChatReferencePath = null
    state.conversations = state.conversations.map((item) => (
      item.id === response.conversation.id ? response.conversation : item
    ))
    renderChatPanel()
    setStatus(`已打开对话：${response.conversation.title}`)
  }

  async function deleteConversation(conversation) {
    if (!state.selectedProjectId || !conversation?.id) return
    const confirmed = window.confirm(`确认删除对话“${conversation.title || conversation.id}”吗？`)
    if (!confirmed) return
    await api.deleteConversation(state.selectedProjectId, conversation.id)
    state.conversations = state.conversations.filter((item) => item.id !== conversation.id)
    if (state.selectedConversationId === conversation.id) {
      state.selectedConversationId = null
      state.chatMessagesData = []
      state.chatPending = false
      state.chatStreamingText = ""
      state.activeChatReferencePath = null
      if (state.conversations[0]) {
        await selectConversation(state.conversations[0].id)
        return
      }
    }
    renderChatPanel()
    setStatus("对话已删除")
  }

  function restartTaskPolling() {
    if (state.taskPollTimer) {
      clearInterval(state.taskPollTimer)
      state.taskPollTimer = null
    }
    if (!state.selectedProjectId) return
    state.taskPollTimer = setInterval(() => {
      void loadTasks()
    }, 2000)
  }

  async function loadSettings() {
    const settings = await api.loadSettings()
    els.llmBaseUrl.value = settings.llm?.baseUrl || ""
    els.llmModel.value = settings.llm?.model || ""
    els.llmApiKey.value = settings.llm?.apiKey || ""
    els.llmApiMode.value = settings.llm?.apiMode || "anthropic_messages"
    els.llmMaxContextSize.value = String(settings.llm?.maxContextSize || 204800)
    els.llmEnabled.checked = Boolean(settings.llm?.enabled)
    els.outputLanguage.value = settings.output?.language || "auto"
    els.chatResponseMode.value = settings.chat?.responseMode || "stream"
    els.searchProvider.value = settings.search?.provider || "none"
    els.searchApiKey.value = settings.search?.apiKey || ""
    els.embeddingEnabled.checked = Boolean(settings.embedding?.enabled)
    els.embeddingEndpoint.value = settings.embedding?.endpoint || ""
    els.embeddingApiKey.value = settings.embedding?.apiKey || ""
    els.embeddingModel.value = settings.embedding?.model || ""
    els.embeddingMaxChunkChars.value = String(settings.embedding?.maxChunkChars || 1000)
    els.embeddingOverlapChunkChars.value = String(settings.embedding?.overlapChunkChars || 200)
  }

  async function saveSettings() {
    setStatus("正在保存 LLM 配置...")
    await api.saveSettings({
      llm: {
        baseUrl: els.llmBaseUrl.value.trim(),
        model: els.llmModel.value.trim(),
        apiKey: els.llmApiKey.value.trim(),
        apiMode: els.llmApiMode.value,
        maxContextSize: Number(els.llmMaxContextSize.value || 204800),
        enabled: els.llmEnabled.checked,
      },
      output: {
        language: els.outputLanguage.value,
      },
      chat: {
        responseMode: els.chatResponseMode.value,
      },
      search: {
        provider: els.searchProvider.value,
        apiKey: els.searchApiKey.value.trim(),
      },
      embedding: {
        enabled: els.embeddingEnabled.checked,
        endpoint: els.embeddingEndpoint.value.trim(),
        apiKey: els.embeddingApiKey.value.trim(),
        model: els.embeddingModel.value.trim(),
        maxChunkChars: Number(els.embeddingMaxChunkChars.value || 1000),
        overlapChunkChars: Number(els.embeddingOverlapChunkChars.value || 200),
      },
    })
    setStatus("设置已保存")
  }

  async function loadTree() {
    if (!state.selectedProjectId) {
      els.treeRoot.innerHTML = `<p class="empty">请先创建项目或选择一个已有项目。</p>`
      state.knowledge = null
      state.graph = null
      state.lint = null
      state.lens = null
      state.importHistory = []
      state.searchQuery = ""
      state.searchResults = []
      state.importHistory = []
      renderKnowledgePanel()
      renderSourceTreePanel()
      renderSearchPanel()
      renderSourcesWorkspace()
      renderGraphPanel()
      renderLintPanel()
      renderLensPanel()
      renderShell()
      return
    }
    const response = await api.loadTree(state.selectedProjectId)
    state.treeNodes = response.tree
    applyDefaultTreeExpansion(response.tree)
    renderSourceTreePanel()
    setStatus(`已加载 ${response.tree.length} 个顶层目录项`)
  }

  function toggleDir(path) {
    if (state.expandedTreePaths.has(path)) {
      state.expandedTreePaths.delete(path)
    } else {
      state.expandedTreePaths.add(path)
    }
    renderSourceTreePanel()
  }

  function filterTreeNodes(nodes, scope) {
    if (!Array.isArray(nodes) || nodes.length === 0) return []
    if (scope === "all") return nodes
    const topLevelPath = scope === "raw" ? "raw" : "wiki"
    return nodes.filter((node) => node.path === topLevelPath)
  }

  async function openFile(relativePath) {
    if (!state.selectedProjectId) return
    const targetKnowledgeSection = knowledgeSectionForPath(relativePath)
    if (targetKnowledgeSection) {
      state.activeKnowledgeSection = targetKnowledgeSection
    }
    const response = await api.openFile(state.selectedProjectId, relativePath)
    if (!isPreviewableTextFile(relativePath) && response.previewMode !== "cached-text") {
      state.selectedPath = relativePath
      state.currentContents = ""
      state.currentFileMode = "download"
      state.currentDownloadUrl = api.buildDownloadUrl(state.selectedProjectId, relativePath)
      state.activeView = "wiki"
      renderShell()
      updateEditor()
      renderKnowledgePanel()
      renderGraphPanel()
      setStatus(`已准备下载 ${relativePath}`)
      return
    }
    state.selectedPath = response.path
    state.currentContents = response.contents
    state.currentFileMode = "text"
    state.currentDownloadUrl = ""
    if (["sources", "graph", "lint", "chat", "settings"].includes(state.activeView)) {
      state.activeView = "wiki"
    }
    renderShell()
    updateEditor()
    renderKnowledgePanel()
    renderGraphPanel()
    await loadTree()
    setStatus(response.previewMode === "cached-text"
      ? `已打开 ${response.path} 的提取文本缓存`
      : `已打开 ${response.path}`)
  }

  async function previewGraphNode(relativePath) {
    if (!state.selectedProjectId) return
    if (!relativePath) {
      state.graphPreviewPath = null
      state.graphPreviewContents = ""
      state.graphPreviewMode = "empty"
      state.graphPreviewDownloadUrl = ""
      renderGraphPanel()
      return
    }
    const response = await api.openFile(state.selectedProjectId, relativePath)
    state.graphPreviewPath = response.path
    if (!isPreviewableTextFile(relativePath) && response.previewMode !== "cached-text") {
      state.graphPreviewContents = ""
      state.graphPreviewMode = "download"
      state.graphPreviewDownloadUrl = api.buildDownloadUrl(state.selectedProjectId, relativePath)
    } else {
      state.graphPreviewContents = response.contents
      state.graphPreviewMode = "text"
      state.graphPreviewDownloadUrl = ""
    }
    renderGraphPanel()
    setStatus(response.previewMode === "cached-text"
      ? `已在图谱侧栏打开 ${response.path} 的提取文本缓存`
      : `已在图谱侧栏打开 ${response.path}`)
  }

  async function deleteSource(relativePath) {
    if (!state.selectedProjectId) return
    const confirmed = window.confirm(`确认删除来源文件或目录？\n${relativePath}\n\n关联的知识页也会一并清理。`)
    if (!confirmed) return
    setStatus(`正在删除 ${relativePath}...`)
    const response = await api.deleteSource(state.selectedProjectId, relativePath)
    if (state.selectedPath && (state.selectedPath === relativePath || response.deletedWikiPaths.includes(state.selectedPath))) {
      state.selectedPath = null
      state.currentContents = ""
      state.currentDownloadUrl = ""
      state.currentFileMode = "text"
      updateEditor()
    }
    await refreshProjects()
    await loadKnowledge()
    await loadGraph()
    await loadLint()
    await loadLens()
    await loadImportHistory()
    await loadTree()
    await loadTasks()
    renderSourcesWorkspace()
    setStatus(`已删除 ${response.deletedSources.length} 个来源，移除 ${response.deletedWikiPaths.length} 个知识页`)
  }

  async function runSearch() {
    if (!state.selectedProjectId) return
    const query = els.searchInput.value.trim()
    state.searchQuery = query
    if (!query) {
      state.searchResults = []
      renderSearchPanel()
      setStatus("已清空搜索结果")
      return
    }
    setStatus(`正在搜索：${query}`)
    state.searchResults = (await api.searchProject(state.selectedProjectId, query)).results || []
    renderSearchPanel()
    setStatus(`已找到 ${state.searchResults.length} 条结果`)
  }

  async function createProject() {
    const name = els.newProjectName.value.trim()
    if (!name) return
    setStatus("正在创建项目...")
    const response = await api.createProject({ name })
    state.selectedProjectId = response.project.id
    state.searchQuery = ""
    resetProjectWorkspaceState()
    els.newProjectName.value = ""
    await refreshProjects()
    updateEditor()
    await loadKnowledge()
    await loadGraph()
    await loadLint()
    await loadLens()
    await loadImportHistory()
    await loadTree()
    await loadTasks()
    renderSearchPanel()
    restartTaskPolling()
    setStatus(`已创建项目：${response.project.name}`)
  }

  async function deleteProject(project) {
    if (!project?.id) return
    const confirmed = window.confirm(`确认删除项目“${project.name || project.id}”吗？\n\n这会删除该项目下的所有本地文件，且无法恢复。`)
    if (!confirmed) return
    setStatus(`正在删除项目：${project.name || project.id}...`)
    await api.deleteProject(project.id)
    if (state.selectedProjectId === project.id) {
      state.selectedProjectId = null
      state.selectedPath = null
      state.currentContents = ""
      state.currentDownloadUrl = ""
      state.currentFileMode = "text"
      state.knowledge = null
      state.graph = null
      state.lint = null
      state.lens = null
      state.tasks = []
      state.importHistory = []
      state.conversations = []
      state.selectedConversationId = null
      state.chatMessagesData = []
      state.chatPending = false
      state.chatStreamingText = ""
      state.activeChatReferencePath = null
      updateEditor()
    }
    await refreshProjects()
    if (state.selectedProjectId) {
      await loadKnowledge()
      await loadGraph()
      await loadLint()
      await loadLens()
      await loadImportHistory()
      await loadTree()
      await loadTasks()
      await loadConversations()
    } else {
      renderKnowledgePanel()
      renderGraphPanel()
      renderLintPanel()
      renderLensPanel()
      renderChatPanel()
      renderSourceTreePanel()
      renderSourcesWorkspace()
    }
    setStatus(`已删除项目：${project.name || project.id}`)
  }

  async function saveFile() {
    if (!state.selectedProjectId || !state.selectedPath) return
    setStatus(`正在保存 ${state.selectedPath}...`)
    await api.saveFile(state.selectedProjectId, {
      path: state.selectedPath,
      contents: els.editor.value,
    })
    state.currentContents = els.editor.value
    updateEditor()
    await refreshProjects()
    await loadKnowledge()
    await loadGraph()
    await loadLint()
    await loadLens()
    setStatus(`已保存 ${state.selectedPath}`)
  }

  async function uploadFiles(mode = "files") {
    if (!state.selectedProjectId) return
    const input = mode === "folder" ? els.uploadFolderInput : els.uploadInput
    const labelEl = mode === "folder" ? els.uploadFolderLabel : els.uploadLabel
    const files = Array.from(input.files || [])
    if (files.length === 0) return
    labelEl.textContent = mode === "folder" ? "导入中..." : "上传中..."
    setStatus(mode === "folder" ? `正在导入文件夹，包含 ${files.length} 个文件...` : `正在上传 ${files.length} 个文件...`)

    const payload = []
    for (const file of files) {
      const sourcePath = file.webkitRelativePath || file.name
      if (!isVisibleUploadPath(sourcePath)) continue
      const buffer = await file.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      let binary = ""
      for (const byte of bytes) binary += String.fromCharCode(byte)
      payload.push({
        path: sourcePath,
        base64: btoa(binary),
      })
    }

    if (payload.length === 0) {
      input.value = ""
      labelEl.textContent = mode === "folder" ? "导入文件夹" : "上传源文件"
      setStatus("已跳过隐藏文件，本次没有可导入的文件。")
      return
    }

    const response = await api.uploadFiles(state.selectedProjectId, payload)
    input.value = ""
    labelEl.textContent = mode === "folder" ? "导入文件夹" : "上传源文件"
    await refreshProjects()
    await loadKnowledge()
    await loadGraph()
    await loadLint()
    await loadLens()
    await loadImportHistory()
    await loadTree()
    renderSourcesWorkspace()
    const roots = response.batch?.roots?.length ? `：${response.batch.roots.join("、")}` : ""
    const hiddenSuffix = response.skippedHidden?.length
      ? `，已跳过 ${response.skippedHidden.length} 个隐藏文件`
      : ""
    setStatus(mode === "folder"
      ? `已导入 ${response.uploaded.length} 个文件${roots}${hiddenSuffix}`
      : `已上传 ${response.uploaded.length} 个文件${hiddenSuffix}`)
  }

  async function runIngest(options = {}) {
    if (!state.selectedProjectId) return
    setStatus("正在运行知识提取...")
    const response = await api.startIngest(state.selectedProjectId, {
      batchId: options.batchId || "",
      sourcePaths: Array.isArray(options.sourcePaths) ? options.sourcePaths : [],
    })
    await loadTasks()
    restartTaskPolling()
    await loadGraph()
    await loadLint(true)
    await loadLens()
    setStatus(options.batchId
      ? `已启动本批提取任务 ${response.task.id}`
      : `已启动提取任务 ${response.task.id}`)
  }

  async function retryTask(task) {
    if (!state.selectedProjectId) return
    if (task?.type === "reingest-source" && task?.sourcePath) {
      setStatus(`正在重新开始任务 ${task.id}...`)
      await reingestSource(task.sourcePath)
      return
    }
    setStatus(`正在重新开始任务 ${task.id}...`)
    await runIngest({
      batchId: task?.batchId || "",
      sourcePaths: Array.isArray(task?.sourcePaths) ? task.sourcePaths : [],
    })
  }

  async function runBatchIngest(batch, sourcePaths) {
    if (!state.selectedProjectId) return
    const pendingPaths = (Array.isArray(sourcePaths) ? sourcePaths : []).filter(Boolean)
    if (pendingPaths.length === 0) {
      setStatus("这一批没有待处理文件了。")
      return
    }
    await runIngest({
      batchId: batch?.id || "",
      sourcePaths: pendingPaths,
    })
  }

  async function removePendingSource(relativePath) {
    if (!state.selectedProjectId || !relativePath) return
    const confirmed = window.confirm(`确认移除待处理来源文件“${relativePath}”吗？`)
    if (!confirmed) return
    await api.deleteSource(state.selectedProjectId, relativePath)
    await refreshProjects()
    await loadKnowledge()
    await loadGraph()
    await loadLint(true)
    await loadLens()
    await loadImportHistory()
    await loadTree()
    renderSourcesWorkspace()
    setStatus(`已移除待处理来源文件：${relativePath}`)
  }

  async function discardBatchPending(batch, sourcePaths) {
    if (!state.selectedProjectId) return
    const pendingPaths = (Array.isArray(sourcePaths) ? sourcePaths : []).filter(Boolean)
    if (pendingPaths.length === 0) {
      setStatus("这一批没有待处理文件了。")
      return
    }
    const confirmed = window.confirm(`确认取消这一批中的 ${pendingPaths.length} 个待处理文件吗？`)
    if (!confirmed) return
    for (const sourcePath of pendingPaths) {
      await api.deleteSource(state.selectedProjectId, sourcePath)
    }
    await refreshProjects()
    await loadKnowledge()
    await loadGraph()
    await loadLint(true)
    await loadLens()
    await loadImportHistory()
    await loadTree()
    renderSourcesWorkspace()
    setStatus(`已取消本批 ${pendingPaths.length} 个待处理文件`)
  }

  async function reingestSource(relativePath) {
    if (!state.selectedProjectId) return
    const normalizedPath = String(relativePath || "").trim()
    if (!normalizedPath.startsWith("raw/sources/")) {
      setStatus("当前文件不是来源文件，不能重新提取。")
      return
    }
    setStatus(`正在重新提取 ${normalizedPath}...`)
    const response = await api.reingestSource(state.selectedProjectId, normalizedPath)
    await loadTasks()
    restartTaskPolling()
    await loadGraph()
    await loadLint(true)
    await loadLens()
    setStatus(`已启动重新提取任务 ${response.task.id}`)
  }

  async function askChat() {
    if (!state.selectedProjectId) return
    if (state.chatPending) {
      activeChatAbortController?.abort()
      state.chatMessagesData = state.chatMessagesData.slice(0, -1)
      resetStreamingState()
      renderChatPanel()
      setStatus("已停止当前回答")
      return
    }
    const question = els.chatInput.value.trim()
    if (!question) return
    if (!state.selectedConversationId) {
      await createConversation()
    }
    state.lastQuestion = question
    state.chatMessagesData = [
      ...state.chatMessagesData,
      { role: "user", content: question },
    ]
    state.chatPending = true
    state.chatStreamingText = ""
    state.activeChatReferencePath = null
    updateUploadState()
    renderChatPanel()
    els.chatInput.value = ""
    els.chatInput.style.height = "56px"
    setStatus("正在检索项目知识...")
    const abortController = new AbortController()
    activeChatAbortController = abortController
    const useStreaming = els.chatResponseMode.value !== "sync"
    try {
      if (useStreaming) {
        await api.streamChat(
          state.selectedProjectId,
          question,
          state.selectedConversationId,
          {
            onEvent(event, payload) {
              if (event === "token") {
                state.chatStreamingText += String(payload.token || "")
                renderChatPanel()
                return
              }
              if (event === "error") {
                throw new Error(payload.error || "流式问答失败")
              }
              if (event === "final") {
                state.selectedConversationId = payload.conversationId || state.selectedConversationId
                state.chatMessagesData = hydrateChatMessages(payload.messages || [])
                state.chatStreamingText = ""
                state.activeChatReferencePath = null
                if (payload.conversation) {
                  state.conversations = [
                    payload.conversation,
                    ...state.conversations.filter((item) => item.id !== payload.conversation.id),
                  ]
                }
                setStatus("回答已生成")
              }
            },
          },
          abortController.signal,
        )
      } else {
        const payload = await api.askChat(
          state.selectedProjectId,
          question,
          state.selectedConversationId,
          abortController.signal,
        )
        state.selectedConversationId = payload.conversationId || state.selectedConversationId
        state.chatMessagesData = hydrateChatMessages(payload.messages || [])
        state.chatStreamingText = ""
        state.activeChatReferencePath = null
        if (payload.conversation) {
          state.conversations = [
            payload.conversation,
            ...state.conversations.filter((item) => item.id !== payload.conversation.id),
          ]
        }
        setStatus("回答已生成")
      }
    } catch (error) {
      state.chatMessagesData = state.chatMessagesData.slice(0, -1)
      if (abortController.signal.aborted) {
        setStatus("已停止当前回答")
      } else {
        setStatus(`问答失败：${error.message}`)
      }
    }
    resetStreamingState()
    renderChatPanel()
  }

  async function regenerateLastAnswer() {
    if (!state.selectedProjectId || !state.selectedConversationId) return
    if (state.chatPending) {
      activeChatAbortController?.abort()
      resetStreamingState()
      renderChatPanel()
      setStatus("已停止当前回答")
      return
    }
    state.chatPending = true
    state.chatStreamingText = ""
    state.activeChatReferencePath = null
    updateUploadState()
    renderChatPanel()
    setStatus("正在重新生成上一条回答...")
    const abortController = new AbortController()
    activeChatAbortController = abortController
    const useStreaming = els.chatResponseMode.value !== "sync"
    try {
      if (useStreaming) {
        await api.regenerateConversationStream(
          state.selectedProjectId,
          state.selectedConversationId,
          {
            onEvent(event, payload) {
              if (event === "token") {
                state.chatStreamingText += String(payload.token || "")
                renderChatPanel()
                return
              }
              if (event === "error") {
                throw new Error(payload.error || "重新生成失败")
              }
              if (event === "final") {
                state.selectedConversationId = payload.conversationId || state.selectedConversationId
                state.chatMessagesData = hydrateChatMessages(payload.messages || [])
                state.chatStreamingText = ""
                state.activeChatReferencePath = null
                if (payload.conversation) {
                  state.conversations = [
                    payload.conversation,
                    ...state.conversations.filter((item) => item.id !== payload.conversation.id),
                  ]
                }
                setStatus("已重新生成回答")
              }
            },
          },
          abortController.signal,
        )
      } else {
        const payload = await api.regenerateConversation(
          state.selectedProjectId,
          state.selectedConversationId,
          abortController.signal,
        )
        state.selectedConversationId = payload.conversationId || state.selectedConversationId
        state.chatMessagesData = hydrateChatMessages(payload.messages || [])
        state.chatStreamingText = ""
        state.activeChatReferencePath = null
        if (payload.conversation) {
          state.conversations = [
            payload.conversation,
            ...state.conversations.filter((item) => item.id !== payload.conversation.id),
          ]
        }
        setStatus("已重新生成回答")
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        setStatus("已停止当前回答")
      } else {
        setStatus(`重新生成失败：${error.message}`)
      }
    }
    resetStreamingState()
    renderChatPanel()
  }

  function highlightChatReference(referencePath) {
    state.activeChatReferencePath = referencePath || null
    renderChatPanel()
    setStatus(referencePath ? `已定位参考页面：${referencePath}` : "已清除参考页定位")
  }

  return {
    bind,
    handleProjectSelect,
    refreshProjects,
    loadKnowledge,
    loadGraph,
    loadLint,
    loadLens,
    loadImportHistory,
    reviewAction,
    saveSynthesisFromChat,
    loadTasks,
    loadConversations,
    createConversation,
    selectConversation,
    deleteConversation,
    restartTaskPolling,
    loadSettings,
    saveSettings,
    loadTree,
    toggleDir,
    filterTreeNodes,
    openFile,
    previewGraphNode,
    deleteSource,
    runSearch,
    createProject,
    deleteProject,
    saveFile,
    uploadFiles,
    runIngest,
    runBatchIngest,
    reingestSource,
    discardBatchPending,
    removePendingSource,
    retryTask,
    askChat,
    regenerateLastAnswer,
    highlightChatReference,
  }
}
