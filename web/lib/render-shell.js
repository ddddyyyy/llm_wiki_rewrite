export const VIEW_ORDER = [
  ["projects", "项目"],
  ["wiki", "知识库"],
  ["sources", "来源"],
  ["search", "搜索"],
  ["graph", "图谱"],
  ["lint", "检查"],
  ["review", "复核"],
  ["chat", "问答"],
  ["settings", "设置"],
]

const VIEW_TITLES = Object.fromEntries(VIEW_ORDER)

const VIEW_LAYOUTS = {
  projects: { sidebar: null, detail: "projects" },
  wiki: { sidebar: "knowledge", detail: "editor" },
  sources: { sidebar: null, detail: "sources" },
  search: { sidebar: "search", detail: "editor" },
  graph: { sidebar: null, detail: "graph" },
  lint: { sidebar: null, detail: "lint" },
  review: { sidebar: "review", detail: "editor" },
  chat: { sidebar: "chat", detail: "chat" },
  settings: { sidebar: null, detail: "settings" },
}

function setHidden(el, hidden) {
  if (!el) return
  el.hidden = hidden
}

export function renderShell({ els, state }) {
  const layout = VIEW_LAYOUTS[state.activeView] || VIEW_LAYOUTS.wiki
  const showProjectsPanel = state.activeView === "projects" || state.activeView === "wiki"
  const showSourceTools = state.activeView === "sources"
  const showProjectManager = state.activeView === "projects"
  const showSourceTreeColumn = state.activeView === "wiki"
  const isProjectsView = state.activeView === "projects"

  els.appShell?.classList.toggle("projects-hidden", !showProjectsPanel)
  els.appShell?.classList.toggle("is-projects-view", isProjectsView)
  els.workspaceShell?.classList.toggle("is-projects-view", isProjectsView)
  setHidden(els.projectsPanel, !showProjectsPanel)
  setHidden(els.projectsPanelHome, !showProjectManager)
  setHidden(els.projectsPanelSources, !showSourceTreeColumn)
  setHidden(els.headerSourceActions, !showSourceTools)
  setHidden(els.sourcesTaskPanel, !showSourceTools)

  for (const button of els.navButtons) {
    const isActive = button.dataset.view === state.activeView
    button.classList.toggle("active", isActive)
    button.setAttribute("aria-pressed", isActive ? "true" : "false")
  }

  els.activeViewTitle.textContent = VIEW_TITLES[state.activeView] || "工作区"
  if (state.selectedProjectId) {
    const currentProject = state.projects.find((project) => project.id === state.selectedProjectId)
    els.activeProjectName.textContent = currentProject?.name || state.selectedProjectId
    els.activeProjectMeta.textContent = currentProject?.id || state.selectedProjectId
  } else {
    els.activeProjectName.textContent = "还没有选择项目"
    els.activeProjectMeta.textContent = "先在左侧创建项目，或者打开一个已有项目。"
  }

  setHidden(els.contextPane, !layout.sidebar)
  setHidden(els.sidebarKnowledge, layout.sidebar !== "knowledge")
  setHidden(els.sidebarSearch, layout.sidebar !== "search")
  setHidden(els.sidebarReview, layout.sidebar !== "review")
  setHidden(els.sidebarChat, layout.sidebar !== "chat")

  setHidden(els.detailProjects, layout.detail !== "projects")
  setHidden(els.detailEditor, layout.detail !== "editor")
  setHidden(els.detailSources, layout.detail !== "sources")
  setHidden(els.detailGraph, layout.detail !== "graph")
  setHidden(els.detailLint, layout.detail !== "lint")
  setHidden(els.detailChat, layout.detail !== "chat")
  setHidden(els.detailSettings, layout.detail !== "settings")

  els.workspaceBody?.classList.toggle("is-full", !layout.sidebar)
}
