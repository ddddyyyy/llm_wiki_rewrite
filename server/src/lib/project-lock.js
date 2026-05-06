export function createProjectLockService() {
  const projectLocks = new Map()

  async function withProjectLock(projectId, work) {
    const key = String(projectId || "").trim()
    const previous = projectLocks.get(key) || Promise.resolve()

    let releaseCurrent
    const current = new Promise((resolve) => {
      releaseCurrent = resolve
    })
    const chained = previous.finally(() => current)
    projectLocks.set(key, chained)

    await previous
    try {
      return await work()
    } finally {
      releaseCurrent()
      const active = projectLocks.get(key)
      if (active && active === chained) {
        projectLocks.delete(key)
      }
    }
  }

  function hasActiveLock(projectId) {
    return projectLocks.has(String(projectId || "").trim())
  }

  return {
    withProjectLock,
    hasActiveLock,
  }
}
