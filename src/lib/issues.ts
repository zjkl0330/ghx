/**
 * Issues。
 *
 * 一个必须记住的坑：`GET /repos/{o}/{r}/issues` **会把 PR 也返回**。
 * 网页端靠过滤器区分，这里统一用 `isPull()` 过滤掉，否则 Issue 列表里
 * 会莫名其妙混进一堆 pull request。
 *
 * 另一个坑：`PUT /issues/{n}/labels` 是**整体替换**，不是追加。
 * 想把某个标签加上，必须把旧的也一起提交，否则其余标签会被清空。
 */

import type { ApiClient } from './api'

export type IssueState = 'open' | 'closed'
export type IssueStateReason = 'completed' | 'not_planned' | 'reopened' | null

export interface IssueUser {
  login: string
  avatar_url?: string
}

export interface IssueLabel {
  id?: number
  name: string
  color: string
  description?: string | null
}

export interface Issue {
  number: number
  title: string
  state: IssueState
  state_reason?: IssueStateReason
  body: string | null
  user: IssueUser | null
  labels: IssueLabel[]
  assignees: IssueUser[] | null
  comments: number
  created_at: string
  updated_at: string
  closed_at: string | null
  locked?: boolean
  html_url?: string
  /** 只有 PR 才有这个字段 —— 判重的唯一可靠依据 */
  pull_request?: { url?: string; merged_at?: string | null }
}

export interface IssueComment {
  id: number
  body: string | null
  user: IssueUser | null
  created_at: string
  updated_at: string
}

/** 列表里混进来的 PR 要剔掉 */
export function isPull(item: Issue): boolean {
  return !!item.pull_request
}

/** 只要 issue，不要 PR */
export function onlyIssues(items: Issue[]): Issue[] {
  return items.filter((i) => !isPull(i))
}

/** 状态下拉的中文说明。closed 的 reason 决定是「已完成」还是「未计划」 */
export function issueStateText(state: IssueState, reason?: IssueStateReason): string {
  if (state === 'open') return '开启中'
  if (reason === 'not_planned') return '未计划'
  if (reason === 'completed') return '已完成'
  return '已关闭'
}

/** 标签底色上的文字该黑还是白：按感知亮度算，别在黄标签上用白字 */
export function labelTextColor(hex: string): string {
  const raw = (hex ?? '').replace('#', '')
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw.padEnd(6, '0').slice(0, 6)
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  if ([r, g, b].some((n) => Number.isNaN(n))) return '#ffffff'
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  return lum > 150 ? '#0d1117' : '#ffffff'
}

/** 补 # ，GitHub 返回的是不带 # 的六位 */
export function labelColorCss(hex: string): string {
  const raw = (hex ?? '').replace('#', '')
  return /^[0-9a-f]{3,6}$/i.test(raw) ? `#${raw}` : '#8b949e'
}

/** 关键词过滤：标题 + 正文 + 编号 + 标签名 */
export function filterIssues(items: Issue[], query: string, label?: string): Issue[] {
  const q = query.trim().toLowerCase()
  return items.filter((i) => {
    if (label && !i.labels.some((l) => l.name === label)) return false
    if (!q) return true
    if (String(i.number) === q) return true
    if (i.title.toLowerCase().includes(q)) return true
    if ((i.body ?? '').toLowerCase().includes(q)) return true
    return i.labels.some((l) => l.name.toLowerCase().includes(q))
  })
}

/** 统计每种标签出现次数，用于筛选条只显示真的有的标签 */
export function labelCounts(items: Issue[]): { name: string; color: string; count: number }[] {
  const map = new Map<string, { name: string; color: string; count: number }>()
  for (const i of items) {
    for (const l of i.labels) {
      const hit = map.get(l.name)
      if (hit) hit.count += 1
      else map.set(l.name, { name: l.name, color: l.color, count: 1 })
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/* ---------------- 网络 ---------------- */

const enc = (s: string) => encodeURIComponent(s)

export async function listIssues(
  client: ApiClient,
  owner: string,
  repo: string,
  opts: { state?: 'open' | 'closed' | 'all'; page?: number; perPage?: number; fresh?: boolean } = {},
): Promise<{ items: Issue[]; openCount: number }> {
  const query = new URLSearchParams({
    state: opts.state ?? 'open',
    per_page: String(opts.perPage ?? 40),
    page: String(opts.page ?? 1),
    sort: 'updated',
    direction: 'desc',
  })
  const { data } = await client.request<Issue[]>(
    `/repos/${enc(owner)}/${enc(repo)}/issues?${query.toString()}`,
    {},
    { fresh: opts.fresh },
  )
  const all = data ?? []
  // 本页可能有 PR，过滤后条数会变少，这是正常的，不要拿它当「到底了」的依据
  return { items: onlyIssues(all), openCount: onlyIssues(all).filter((i) => i.state === 'open').length }
}

export async function getIssue(client: ApiClient, owner: string, repo: string, number: number, fresh = false) {
  const { data } = await client.request<Issue>(
    `/repos/${enc(owner)}/${enc(repo)}/issues/${number}`,
    {},
    { fresh },
  )
  return data
}

export async function listComments(
  client: ApiClient,
  owner: string,
  repo: string,
  number: number,
  fresh = false,
): Promise<IssueComment[]> {
  const { data } = await client.request<IssueComment[]>(
    `/repos/${enc(owner)}/${enc(repo)}/issues/${number}/comments?per_page=100`,
    {},
    { fresh },
  )
  return data ?? []
}

export async function addComment(
  client: ApiClient,
  owner: string,
  repo: string,
  number: number,
  body: string,
) {
  const { data } = await client.request<IssueComment>(
    `/repos/${enc(owner)}/${enc(repo)}/issues/${number}/comments`,
    { method: 'POST', body: JSON.stringify({ body }) },
  )
  return data
}

export async function createIssue(
  client: ApiClient,
  owner: string,
  repo: string,
  input: { title: string; body?: string; labels?: string[] },
) {
  const { data } = await client.request<Issue>(`/repos/${enc(owner)}/${enc(repo)}/issues`, {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      body: input.body ?? '',
      ...(input.labels && input.labels.length > 0 ? { labels: input.labels } : {}),
    }),
  })
  return data
}

/**
 * 改 Issue。只传变化过的字段 —— 传了 labels 就是整体替换，
 * 传了 assignees 会整体覆盖，所以调用方要自己保证传的是完整集合。
 */
export async function updateIssue(
  client: ApiClient,
  owner: string,
  repo: string,
  number: number,
  patch: {
    title?: string
    body?: string
    state?: IssueState
    state_reason?: 'completed' | 'not_planned' | 'reopened'
    labels?: string[]
    assignees?: string[]
  },
) {
  const { data } = await client.request<Issue>(
    `/repos/${enc(owner)}/${enc(repo)}/issues/${number}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
  return data
}

/** 仓库里定义过的标签，供选择器列出 */
export async function listLabels(client: ApiClient, owner: string, repo: string, fresh = false) {
  const { data } = await client.request<IssueLabel[]>(
    `/repos/${enc(owner)}/${enc(repo)}/labels?per_page=100`,
    {},
    { fresh },
  )
  return data ?? []
}

/** 整体替换标签，调用方必须传完整的标签集合 */
export async function setIssueLabels(
  client: ApiClient,
  owner: string,
  repo: string,
  number: number,
  labels: string[],
) {
  const { data } = await client.request<IssueLabel[]>(
    `/repos/${enc(owner)}/${enc(repo)}/issues/${number}/labels`,
    { method: 'PUT', body: JSON.stringify({ labels }) },
  )
  return data ?? []
}

/**
 * 设置指派人为「这一份名单」，不是追加。
 *
 * 用 `PATCH /issues/{n}` 整体替换；`POST /issues/{n}/assignees` 只加不减，
 * 界面上勾选框表达的是「最终是谁」，整体替换才是对的意思。
 * 无 push 权限时 GitHub 会静默忽略，只能按返回值判断。
 */
export async function setAssignees(
  client: ApiClient,
  owner: string,
  repo: string,
  number: number,
  assignees: string[],
) {
  const { data } = await client.request<Issue>(`/repos/${enc(owner)}/${enc(repo)}/issues/${number}`, {
    method: 'PATCH',
    body: JSON.stringify({ assignees }),
  })
  return data
}

/** 锁定对话，防止无关讨论 */
export async function setLocked(
  client: ApiClient,
  owner: string,
  repo: string,
  number: number,
  locked: boolean,
  reason?: 'off-topic' | 'too heated' | 'resolved' | 'spam',
) {
  const path = `/repos/${enc(owner)}/${enc(repo)}/issues/${number}/lock`
  if (!locked) {
    await client.request<null>(path, { method: 'DELETE' })
    return
  }
  await client.request<null>(path, {
    method: 'PUT',
    body: JSON.stringify(reason ? { lock_reason: reason } : {}),
  })
}
