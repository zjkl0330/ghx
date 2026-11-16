/**
 * Issue / PR 列表的高级筛选。
 *
 * 两个层面同时存在，缺一不可：
 * 1. **服务端**：GitHub 的 `GET /repos/{o}/{r}/issues` 支持 `labels` / `assignee` /
 *    `creator` / `milestone` / `since`，带上就能少拉一堆数据；
 * 2. **客户端**：`GET /repos/{o}/{r}/pulls` **不支持**这几个参数（只有 base / head /
 *    sort / direction / state），同一个筛选条要在 PR 页也生效，只能自己判。
 *
 * 所以这里导出两套：`buildIssueParams` 给 Issues 拼 query，`matchesFilter` 给两边兜底。
 * 两套判据必须一致 —— 服务端筛完客户端又筛掉，会让人以为「筛选丢了数据」。
 *
 * 另有一个坑：`since` 过滤的是 **updated_at**（最后更新时间），不是创建时间。
 * GitHub 文档写的是 "Only show results that were last updated after the given time"，
 * 界面上必须写「最近更新过」，否则用户拿「最近 7 天创建的 Issue」来对会对不上。
 */

/** 筛选条件。空字符串 / 0 都表示不限，方便直接展开成输入框的值 */
export interface IssueFilter {
  /** 作者登录名 */
  author: string
  /** 指派给谁：登录名、`none`（无人指派）、`*`（有人指派） */
  assignee: string
  /** 里程碑：数字字符串、`none`（无里程碑）、`*`（有里程碑） */
  milestone: string
  /** 标签名，单个 */
  label: string
  /** 只看最近 N 天更新过的；0 不限 */
  sinceDays: number
}

export const EMPTY_FILTER: IssueFilter = {
  author: '',
  assignee: '',
  milestone: '',
  label: '',
  sinceDays: 0,
}

export const SINCE_CHOICES = [0, 7, 30, 90] as const

/** Issue 与 PR 共有的字段子集 —— 客户端判定只依赖这些 */
export interface Filterable {
  user?: { login?: string | null } | null
  assignees?: { login?: string | null }[] | null
  labels: { name: string }[]
  milestone?: { number: number; title?: string } | null
  updated_at: string
}

const DAY_MS = 86_400_000

/** since 的截止时刻。0 天返回 null，表示不带这个参数 */
export function sinceIso(days: number, now = Date.now()): string | null {
  if (!Number.isFinite(days) || days <= 0) return null
  return new Date(now - Math.floor(days) * DAY_MS).toISOString()
}

/**
 * 拼成 Issues 端点认的 query 片段。
 *
 * 只放非空项：GitHub 对空字符串的处理是「过滤出标签为空串的」，不是「不过滤」，
 * 早几年就有人踩过，所以这里宁可少传也不传空值。
 */
export function buildIssueParams(f: IssueFilter, now = Date.now()): Record<string, string> {
  const out: Record<string, string> = {}
  const author = f.author.trim().replace(/^@/, '')
  if (author) out.creator = author
  const assignee = f.assignee.trim().replace(/^@/, '')
  if (assignee) out.assignee = assignee
  const milestone = f.milestone.trim()
  if (milestone) out.milestone = milestone
  const label = f.label.trim()
  if (label) out.labels = label
  const since = sinceIso(f.sinceDays, now)
  if (since) out.since = since
  return out
}

/** 是否在筛（任一项非空）。界面用它决定筛选按钮要不要高亮 */
export function isFiltering(f: IssueFilter): boolean {
  return activeCount(f) > 0
}

export function activeCount(f: IssueFilter): number {
  let n = 0
  if (f.author.trim()) n += 1
  if (f.assignee.trim()) n += 1
  if (f.milestone.trim()) n += 1
  if (f.label.trim()) n += 1
  if (f.sinceDays > 0) n += 1
  return n
}

/**
 * 客户端判定。
 *
 * 与 `buildIssueParams` 一一对应：
 * - `assignee=none` 意思是「没人指派」，`*` 是「有人指派」；
 * - `milestone=none` / `*` 同理；
 * - `since` 按 updated_at 比。
 *
 * 大小写一律忽略：GitHub 的登录名不区分大小写，用户手输时经常大小写混着打。
 */
export function matchesFilter(item: Filterable, f: IssueFilter, now = Date.now()): boolean {
  const author = f.author.trim().replace(/^@/, '').toLowerCase()
  if (author && (item.user?.login ?? '').toLowerCase() !== author) return false

  const assignee = f.assignee.trim().replace(/^@/, '').toLowerCase()
  if (assignee) {
    const list = (item.assignees ?? []).map((u) => (u.login ?? '').toLowerCase())
    if (assignee === 'none') {
      if (list.length > 0) return false
    } else if (assignee === '*') {
      if (list.length === 0) return false
    } else if (!list.includes(assignee)) {
      return false
    }
  }

  const milestone = f.milestone.trim()
  if (milestone) {
    const num = item.milestone?.number ?? null
    if (milestone === 'none') {
      if (num !== null) return false
    } else if (milestone === '*') {
      if (num === null) return false
    } else if (num === null || String(num) !== milestone) {
      return false
    }
  }

  const label = f.label.trim().toLowerCase()
  if (label && !item.labels.some((l) => l.name.toLowerCase() === label)) return false

  if (f.sinceDays > 0) {
    const t = Date.parse(item.updated_at)
    if (Number.isNaN(t)) return false
    if (t < now - f.sinceDays * DAY_MS) return false
  }

  return true
}

/**
 * 人话摘要，给筛选按钮下方那行小字用。
 * 返回空数组表示没在筛。
 */
export function filterSummary(f: IssueFilter): string[] {
  const out: string[] = []
  const author = f.author.trim().replace(/^@/, '')
  if (author) out.push(`作者 @${author}`)
  const assignee = f.assignee.trim().replace(/^@/, '')
  if (assignee === 'none') out.push('无人指派')
  else if (assignee === '*') out.push('已指派')
  else if (assignee) out.push(`指派 @${assignee}`)
  const milestone = f.milestone.trim()
  if (milestone === 'none') out.push('无里程碑')
  else if (milestone === '*') out.push('有里程碑')
  else if (milestone) out.push(`里程碑 #${milestone}`)
  if (f.label.trim()) out.push(`标签 ${f.label.trim()}`)
  if (f.sinceDays > 0) out.push(`近 ${f.sinceDays} 天更新`)
  return out
}

/** 把「不限 / 7 / 30 / 90」翻成按钮文字 */
export function sinceLabel(days: number): string {
  return days > 0 ? `近 ${days} 天` : '不限时间'
}
