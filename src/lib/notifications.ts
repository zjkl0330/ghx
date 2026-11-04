/**
 * 通知收件箱。
 *
 * 边界：Notifications 与 Watch 订阅**只支持 classic PAT**。
 * fine-grained 令牌调这两个接口会 403，界面要按令牌类型隐藏入口并说明原因，
 * 而不是让用户点了才看到红字。
 *
 * 304 是有意义的：`GET /notifications` 支持 ETag，没新东西时返回 304，
 * 界面应该说「没有新通知」而不是清空列表。
 */

import type { ApiClient } from './api'

export type NotificationReason =
  | 'assign'
  | 'author'
  | 'comment'
  | 'ci_activity'
  | 'invitation'
  | 'manual'
  | 'mention'
  | 'review_requested'
  | 'security_alert'
  | 'state_change'
  | 'subscribed'
  | 'team_mention'

export type SubjectType = 'Issue' | 'PullRequest' | 'Release' | 'Discussion' | 'Commit' | 'CheckSuite' | 'RepositoryVulnerabilityAlert' | string

export interface NotificationThread {
  id: string
  unread: boolean
  reason: NotificationReason
  updated_at: string
  last_read_at?: string | null
  subject: { title: string; type: SubjectType; url: string | null; latest_comment_url?: string | null }
  repository: { full_name: string; name: string; owner: { login: string } } | null
  url?: string
}

const REASON_TEXT: Record<string, string> = {
  assign: '指派给你',
  author: '你创建的',
  comment: '有新评论',
  ci_activity: 'CI 结果',
  invitation: '邀请',
  manual: '手动订阅',
  mention: '提到了你',
  review_requested: '请求你审核',
  security_alert: '安全告警',
  state_change: '状态变化',
  subscribed: '你关注的',
  team_mention: '提到了你的团队',
}

export function reasonText(reason: string): string {
  return REASON_TEXT[reason] ?? reason
}

/** 主题类型 → 中文名 + 图标名 */
export function subjectMeta(type: SubjectType): {
  label: string
  icon: 'repo' | 'branch' | 'tag' | 'package' | 'bell' | 'bolt'
} {
  switch (type) {
    case 'Issue':
      return { label: 'Issue', icon: 'repo' }
    case 'PullRequest':
      return { label: 'PR', icon: 'branch' }
    case 'Release':
      return { label: '发行版', icon: 'tag' }
    case 'Discussion':
      return { label: '讨论', icon: 'bell' }
    case 'Commit':
      return { label: '提交', icon: 'package' }
    case 'CheckSuite':
      return { label: '检查', icon: 'bolt' }
    default:
      return { label: type, icon: 'bell' }
  }
}

/**
 * 从 subject.url 里解析出「点了该去哪」。
 * GitHub 给的是 API 地址，如 `.../repos/o/r/issues/12`，
 * 网页地址可以用 html_url 拼，也可以按编号自己拼。
 */
export function subjectTarget(t: NotificationThread): { kind: 'issue' | 'pull' | 'repo'; owner: string; repo: string; number?: number } | null {
  const full = t.repository?.full_name
  if (!full || !full.includes('/')) return null
  const [owner, repo] = full.split('/')
  const url = t.subject.url ?? ''
  const m = /\/issues\/(\d+)$/.exec(url)
  if (m) {
    const number = Number(m[1])
    if (t.subject.type === 'PullRequest') return { kind: 'pull', owner, repo, number }
    return { kind: 'issue', owner, repo, number }
  }
  return { kind: 'repo', owner, repo }
}

/** 按未读/原因筛选 */
export function filterThreads(
  list: NotificationThread[],
  opts: { unreadOnly?: boolean; reason?: string } = {},
): NotificationThread[] {
  return list.filter((t) => {
    if (opts.unreadOnly && !t.unread) return false
    if (opts.reason && t.reason !== opts.reason) return false
    return true
  })
}

/** 按仓库分组，同一仓库的通知堆一起更容易扫 */
export function groupByRepo(list: NotificationThread[]): { repo: string; threads: NotificationThread[] }[] {
  const map = new Map<string, NotificationThread[]>()
  for (const t of list) {
    const key = t.repository?.full_name ?? '其它'
    const arr = map.get(key)
    if (arr) arr.push(t)
    else map.set(key, [t])
  }
  return [...map.entries()].map(([repo, threads]) => ({ repo, threads }))
}

export function unreadCount(list: NotificationThread[]): number {
  return list.filter((t) => t.unread).length
}

/* ---------------- 网络 ---------------- */

export async function listNotifications(
  client: ApiClient,
  opts: { all?: boolean; participating?: boolean; fresh?: boolean; conditional?: boolean } = {},
): Promise<{ items: NotificationThread[]; notModified: boolean }> {
  const query = new URLSearchParams({
    all: opts.all ? 'true' : 'false',
    participating: opts.participating ? 'true' : 'false',
    per_page: '50',
  })
  const { data, notModified } = await client.request<NotificationThread[]>(
    `/notifications?${query.toString()}`,
    {},
    { fresh: opts.fresh, conditional: opts.conditional },
  )
  return { items: data ?? [], notModified: !!notModified }
}

export async function markThreadRead(client: ApiClient, id: string) {
  await client.request<null>(`/notifications/threads/${encodeURIComponent(id)}`, { method: 'PATCH' })
}

export async function markThreadDone(client: ApiClient, id: string) {
  await client.request<null>(`/notifications/threads/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** 全标已读。传 last_read_at 可以只清到某个时间点之前 */
export async function markAllRead(client: ApiClient, lastReadAt?: string) {
  await client.request<null>('/notifications', {
    method: 'PUT',
    body: JSON.stringify(lastReadAt ? { last_read_at: lastReadAt } : { read: true }),
  })
}

/**
 * 令牌能不能用通知接口。
 * fine-grained 令牌的 x-oauth-scopes 是空的，classic 才有 notifications。
 */
export function canUseNotifications(scopes: string[], kind?: 'classic' | 'fine-grained'): boolean {
  if (kind === 'fine-grained') return false
  if (scopes.length === 0) return false
  return scopes.includes('notifications') || scopes.includes('repo')
}

export function notificationsUnsupportedHint(): string {
  return '通知与关注订阅只支持 classic 令牌；fine-grained 令牌调这些接口一律 403。可以在 GitHub 上另建一个带 notifications 权限的 classic 令牌。'
}
