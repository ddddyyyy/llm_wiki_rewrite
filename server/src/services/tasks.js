import path from "node:path"

export function createTaskService({ tasksPath, fs }) {
  const { mkdir, readFile, writeFile } = fs
  const taskStore = new Map()

  async function loadTaskStore() {
    if (taskStore.size > 0) return
    try {
      const raw = JSON.parse(await readFile(tasksPath, "utf8"))
      for (const task of raw.tasks || []) {
        taskStore.set(task.id, task)
      }
    } catch {
      // ignore
    }
  }

  async function persistTaskStore() {
    await mkdir(path.dirname(tasksPath), { recursive: true })
    await writeFile(
      tasksPath,
      JSON.stringify({ tasks: [...taskStore.values()] }, null, 2),
      "utf8",
    )
  }

  function createTask(projectId, type) {
    const now = new Date().toISOString()
    const task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      projectId,
      type,
      status: "queued",
      stage: "queued",
      message: "排队中",
      createdAt: now,
      updatedAt: now,
      result: null,
      error: null,
    }
    taskStore.set(task.id, task)
    return task
  }

  function updateTask(taskId, patch) {
    const current = taskStore.get(taskId)
    if (!current) return
    taskStore.set(taskId, {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    })
  }

  function listProjectTasks(projectId) {
    return [...taskStore.values()]
      .filter((task) => task.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
  }

  return {
    loadTaskStore,
    persistTaskStore,
    createTask,
    updateTask,
    listProjectTasks,
  }
}
