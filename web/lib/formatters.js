export const KNOWLEDGE_SECTIONS = [
  ["overview", "概览"],
  ["index", "索引"],
  ["sources", "来源"],
  ["concepts", "概念"],
  ["entities", "实体"],
  ["queries", "问题"],
  ["comparisons", "对比"],
  ["synthesis", "综合"],
]

export function formatTaskType(value) {
  const mapping = {
    ingest: "知识提取",
    "ingest-batch": "批次提取",
    "reingest-source": "单文件重提取",
  }
  return mapping[value] || value
}

export function formatTaskStatus(value) {
  const mapping = {
    queued: "排队中",
    running: "运行中",
    done: "已完成",
    error: "失败",
  }
  return mapping[value] || value
}

export function formatTaskStage(value) {
  const mapping = {
    queued: "排队中",
    scanning: "扫描中",
    reading: "读取中",
    analyzing: "分析中",
    generating: "生成中",
    writing: "写入中",
    finalizing: "收尾中",
    done: "已完成",
    failed: "失败",
  }
  return mapping[value] || value || ""
}

export function formatPageMeta(item) {
  const parts = []
  if (item.created) parts.push(`创建：${item.created}`)
  if (item.updated) parts.push(`更新：${item.updated}`)
  return parts.join(" · ")
}
