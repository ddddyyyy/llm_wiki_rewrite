function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

export function renderTasks({ els, state, formatTaskType, formatTaskStatus, formatTaskStage, onRetryTask }) {
  els.taskList.innerHTML = ""
  if (!state.selectedProjectId) {
    els.taskList.innerHTML = `<p class="empty">请选择一个项目来查看提取任务。</p>`
    return
  }
  if (state.tasks.length === 0) {
    els.taskList.innerHTML = `<p class="empty">还没有运行过提取任务。</p>`
    return
  }
  for (const task of state.tasks) {
    const article = document.createElement("article")
    article.className = `task-card ${task.status}`
    article.innerHTML = `
      <div class="task-row">
        <strong>${escapeHtml(formatTaskType(task.type))}</strong>
        <div class="task-row-actions">
          <span class="task-status">${escapeHtml(formatTaskStatus(task.status))}</span>
          ${task.status === "error" ? `<button type="button" class="mini-button task-retry-button" data-task-id="${escapeHtml(task.id)}">重新开始</button>` : ""}
        </div>
      </div>
      <div class="task-stage">${escapeHtml(formatTaskStage(task.stage))}</div>
      ${task.file ? `<div class="task-file">${escapeHtml(task.file)}</div>` : ""}
      <div class="task-message">${escapeHtml(task.message || "")}</div>
    `
    if (task.status === "error") {
      article.querySelector(".task-retry-button")?.addEventListener("click", () => void onRetryTask?.(task))
    }
    els.taskList.appendChild(article)
  }
}
