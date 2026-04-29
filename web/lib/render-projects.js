function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

export function renderProjects({ els, state, onSelectProject, onDeleteProject }) {
  els.projectList.innerHTML = ""
  for (const project of state.projects) {
    const wrapper = document.createElement("div")
    wrapper.className = "project-row"

    const button = document.createElement("button")
    button.type = "button"
    button.className = `project-card ${project.id === state.selectedProjectId ? "selected" : ""}`
    button.innerHTML = `<strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(project.id)}</span>`
    button.addEventListener("click", () => void onSelectProject(project.id))
    wrapper.appendChild(button)

    if (state.activeView === "projects") {
      const deleteButton = document.createElement("button")
      deleteButton.type = "button"
      deleteButton.className = "project-delete-button"
      deleteButton.textContent = "删除"
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation()
        void onDeleteProject?.(project)
      })
      wrapper.appendChild(deleteButton)
    }

    els.projectList.appendChild(wrapper)
  }
}

function isTreeNodeExpanded(state, node, depth) {
  if (!node.isDir) return false
  if (depth === 0) return true
  return state.expandedTreePaths?.has(node.path)
}

export function renderTree({ nodes, state, onOpenFile, onToggleDir, depth = 0 }) {
  const fragment = document.createDocumentFragment()
  for (const node of nodes) {
    const row = document.createElement("button")
    row.type = "button"
    row.className = `tree-item ${state.selectedPath === node.path ? "active" : ""}`
    row.style.paddingLeft = `${depth * 16 + 12}px`
    const expanded = isTreeNodeExpanded(state, node, depth)
    row.innerHTML = `
      <span class="tree-caret">${node.isDir ? (expanded ? "▾" : "▸") : ""}</span>
      <span class="tree-icon">${node.isDir ? "DIR" : (node.name.split(".").pop() || "FILE").slice(0, 4).toUpperCase()}</span>
      <span class="tree-label">${escapeHtml(node.name)}</span>
    `
    if (node.isDir) {
      row.classList.add("tree-item-dir")
      row.setAttribute("aria-expanded", expanded ? "true" : "false")
      row.addEventListener("click", () => onToggleDir?.(node.path))
    } else {
      row.addEventListener("click", () => void onOpenFile(node.path))
    }
    fragment.appendChild(row)
    if (node.children?.length && (!node.isDir || expanded)) {
      fragment.appendChild(renderTree({ nodes: node.children, state, onOpenFile, onToggleDir, depth: depth + 1 }))
    }
  }
  return fragment
}
