export function normalizePromptLanguage(language) {
  return language === "en" || language === "English" ? "en" : "zh-CN"
}

export function pickPromptText(language, enText, zhText) {
  return normalizePromptLanguage(language) === "en" ? enText : zhText
}
