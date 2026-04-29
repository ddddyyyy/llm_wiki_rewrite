function normalizeQuery(query) {
  return String(query || "").trim().toLowerCase()
}

function asksForNextSteps(query) {
  const text = normalizeQuery(query)
  return /下一步|接下来|优先|建议|怎么做|如何做|怎么办|行动|计划|follow up|next step|recommend|what should/i.test(text)
}

function asksForComparison(query) {
  const text = normalizeQuery(query)
  return /区别|差异|比较|对比|相比|优缺点|trade-?off|compare|difference|versus|vs\b/i.test(text)
}

function asksForRisk(query) {
  const text = normalizeQuery(query)
  return /风险|问题|隐患|冲突|合规|漏洞|risk|issue|problem|concern|conflict/i.test(text)
}

function asksForDefinition(query) {
  const text = normalizeQuery(query)
  return /是什么|什么意思|定义|指什么|如何理解|what is|meaning|define|definition/i.test(text)
}

export function buildChatAnswerStyle(query, responseLanguage) {
  const isEnglish = responseLanguage === "English"

  if (asksForNextSteps(query)) {
    return isEnglish
      ? [
          "## Preferred Answer Structure",
          "- First: give the direct recommendation or next step.",
          "- Second: explain why, using the retrieved wiki knowledge.",
          "- Third: briefly note what evidence is still missing.",
          "- Avoid merely listing page topics without making a recommendation.",
        ].join("\n")
      : [
          "## 建议的回答结构",
          "- 第一段：直接给出建议或下一步优先事项。",
          "- 第二段：结合检索到的知识说明原因和依据。",
          "- 第三段：简要说明当前仍缺什么信息。",
          "- 不要只罗列页面主题，要形成明确建议。",
        ].join("\n")
  }

  if (asksForComparison(query)) {
    return isEnglish
      ? [
          "## Preferred Answer Structure",
          "- First: state the main comparison result directly.",
          "- Then: explain the key similarities and differences that matter for the user's question.",
          "- End with the practical implication if the pages support one.",
          "- Do not answer with a loose list of facts only.",
        ].join("\n")
      : [
          "## 建议的回答结构",
          "- 第一段：直接给出比较结论。",
          "- 第二段：说明关键相同点和差异点，聚焦用户问题真正关心的部分。",
          "- 结尾：如果知识页支持，请说明实际影响或结论。",
          "- 不要只做松散的信息罗列。",
        ].join("\n")
  }

  if (asksForRisk(query)) {
    return isEnglish
      ? [
          "## Preferred Answer Structure",
          "- First: state the main risk, issue, or conflict directly.",
          "- Then: explain the supporting evidence from the retrieved pages.",
          "- Finally: distinguish between confirmed risk and unresolved uncertainty.",
        ].join("\n")
      : [
          "## 建议的回答结构",
          "- 第一段：直接指出主要风险、问题或冲突点。",
          "- 第二段：说明这些判断分别依据哪些知识页内容。",
          "- 结尾：区分已经确认的风险与仍待验证的不确定点。",
        ].join("\n")
  }

  if (asksForDefinition(query)) {
    return isEnglish
      ? [
          "## Preferred Answer Structure",
          "- First sentence: define the concept plainly.",
          "- Then: expand with the most relevant project context from the wiki.",
          "- Avoid turning the answer into a broad unrelated survey.",
        ].join("\n")
      : [
          "## 建议的回答结构",
          "- 第一段第一句：先直接解释这个概念或术语是什么。",
          "- 然后：结合项目语境补充它在当前知识库里的含义和作用。",
          "- 不要扩成不相关的大而全综述。",
        ].join("\n")
  }

  return isEnglish
    ? [
        "## Preferred Answer Structure",
        "- First paragraph: answer the user's question directly.",
        "- Second paragraph: explain the supporting evidence or reasoning from the retrieved wiki pages.",
        "- Final short paragraph: note the remaining uncertainty or next useful follow-up if needed.",
        "- Do not stop at listing related pages or concepts.",
      ].join("\n")
    : [
        "## 建议的回答结构",
        "- 第一段：先直接回答用户的问题。",
        "- 第二段：再结合检索到的知识页说明依据、推理或背景。",
        "- 最后一小段：如果有必要，再补充当前仍不确定的点或下一步建议。",
        "- 不要停留在“相关知识点列表”。",
      ].join("\n")
}
