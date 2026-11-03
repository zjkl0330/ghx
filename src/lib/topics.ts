/**
 * 仓库话题（topics）的输入归一化。
 *
 * GitHub 只接受小写字母、数字与连字符，长度上限 50，个数上限 20。
 * 用户在手机上多半是随手敲「React, 前端、tauri」这种混排，直接在界面上报错
 * 体验很差，所以先在本地尽量修好；修不出来的（比如纯中文）直接丢掉。
 */

export const MAX_TOPICS = 20
export const MAX_TOPIC_LEN = 50

/** 单个话题：小写、空格转连字符、去掉非法字符、压缩连字符 */
export function normalizeTopic(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TOPIC_LEN)
}

/** 解析用户输入，逗号、顿号、空格、换行都当分隔符；自动去重并截断到 20 个 */
export function parseTopics(input: string): string[] {
  const out: string[] = []
  for (const part of input.split(/[,，、;；\s]+/)) {
    if (out.length >= MAX_TOPICS) break
    const t = normalizeTopic(part)
    if (!t || out.includes(t)) continue
    out.push(t)
  }
  return out
}

/** 回填输入框：用逗号空格分隔，比逗号更好读 */
export function topicsToInput(topics: string[] | undefined | null): string {
  return (topics ?? []).join(', ')
}
