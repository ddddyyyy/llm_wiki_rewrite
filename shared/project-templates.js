export const PROJECT_DIRS = [
  "raw/sources",
  "raw/assets",
  "wiki/entities",
  "wiki/concepts",
  "wiki/sources",
  "wiki/queries",
  "wiki/comparisons",
  "wiki/synthesis",
  ".llm-wiki/chats"
]

export const DEFAULT_SCHEMA = `# Wiki 结构说明

## 页面类型

| 类型 | 目录 | 作用 |
|------|------|------|
| entity | wiki/entities/ | 命名对象，例如模型、公司、人物、数据集 |
| concept | wiki/concepts/ | 概念、方法、技术、现象 |
| source | wiki/sources/ | 原始资料，例如论文、文章、演讲、博客 |
| query | wiki/queries/ | 尚待追踪的开放问题 |
| comparison | wiki/comparisons/ | 相关实体或方案的对比分析 |
| synthesis | wiki/synthesis/ | 跨页面的综合结论与提炼 |
| overview | wiki/ | 项目级高层概览 |

## 命名约定

- 如果页面标题本身是中文，文件名可直接使用中文 \`.md\`，不要转成拼音
- 如果页面标题是英文或以英文术语为主，文件名优先使用 \`kebab-case.md\`
- 实体页面尽量使用通行名称
- 概念页面使用清晰的名词短语
- 来源页面可使用原始资料标题或稳定短名
- 问题页面可直接使用中文问题短句，或使用英文 slug

## Frontmatter

\`\`\`yaml
---
type: entity | concept | source | query | comparison | synthesis | overview
title: Human-readable title
tags: []
related: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
\`\`\`
`

export const DEFAULT_PURPOSE = `# 项目目的

## 目标

<!-- 你想理解、研究或构建什么？ -->

## 关键问题

1.
2.
3.

## 范围

**纳入范围：**
-

**不纳入范围：**
-

## 当前判断

> 待补充
`

export const DEFAULT_INDEX = `# Wiki 索引

## 实体

## 概念

## 来源

## 问题

## 对比

## 综合
`

export function buildLog(date) {
  return `# 研究日志

## ${date}

- 已创建项目
`
}

export const DEFAULT_OVERVIEW = `---
type: overview
title: 项目概览
tags: []
related: []
---

# 概览

<!-- 用几句话总结这个 wiki 的研究主题、当前状态与下一步方向。 -->
`
