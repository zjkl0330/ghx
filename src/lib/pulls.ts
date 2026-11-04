/**
 * Pull Requests。
 *
 * 三个必须处理的坑：
 * 1. `mergeable` 初始是 `null` —— 服务端要后台算，得隔一两秒重取；
 * 2. 合并失败的码含义完全不同（405 冲突 / 409 head 变了 / 403 保护分支 / 422 参数），
 *    统一提示「合并失败」等于让用户猜；
 * 3. `files[].patch` 对二进制文件和大文件是空的，界面要能解释「为什么看不到 diff」。
 */

import type { ApiClient } from './api'
import type { IssueLabel, IssueUser } from './issues'

export type PullState = 'open' | 'closed'
export type MergeMethod = 'merge' | 'squash' | 'rebase'

export interface PullRef {
  ref: string
  sha: string
  label: string
  repo: { full_name: string; owner: { login: string } } | null
}

export interface PullRequest {
  number: number
  title: string
  state: PullState
  draft?: boolean
  merged: boolean
  merged_at: string | null
  mergeable: boolean | null
  mergeable_state?: string
  body: string | null
  user: IssueUser | null
  labels: IssueLabel[]
  head: PullRef
  base: PullRef
  commits: number
  additions: number
  deletions: number
  changed_files: number
  created_at: string
  updated_at: string
  html_url?: string
  requested_reviewers?: IssueUser[] | null
}

export interface PullFile {
  filename: string
  previous_filename?: string
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged'
  additions: number
  deletions: number
  changes: number
  /** 二进制或超大文件时为空 */
  patch?: string
  sha?: string
}

export interface PullCommit {
  sha: string
  commit: { message: string; author: { name: string; date: string } | null }
  author: { login: string } | null
}

export interface PullReview {
  id: number
  user: IssueUser | null
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'PENDING' | 'DISMISSED'
  body: string | null
  submitted_at: string | null
}

export interface PullStats {
  additions: number
  deletions: number
  changed_files: number
}

/** PR 的展示状态：草稿 / 已合并 / 已关闭 / 开启，比裸 state 有用 */
export function pullStateText(pr: PullRequest): string {
  if (pr.merged_at) return '已合并'
  if (pr.state === 'open' && pr.draft) return '草稿'
  return pr.state === 'open' ? '开启中' : '已关闭'
}

export function isMergeable(pr: PullRequest): boolean {
  return pr.state === 'open' && !pr.merged_at && pr.mergeable === true
}

/** mergeable 是 null 时说明还在算，界面应该说「正在检查」而不是「不能合并」 */
export function mergeableHint(pr: PullRequest): string | null {
  if (pr.state !== 'open' || pr.merged_at) return null
  if (pr.mergeable === null) return '正在检查能否合并…'
  if (pr.mergeable === false) {
    if (pr.mergeable_state === 'dirty') return '与目标分支有冲突，需先解决'
    if (pr.mergeable_state === 'blocked') return '被分支保护或必需的检查阻塞'
    if (pr.mergeable_state === 'behind') return '落后于目标分支，可能需要先更新'
    return '当前不能自动合并'
  }
  return null
}

/** 合并失败码翻译。每种码的处理方式不同，不能一句「失败」糊过去 */
export function mergeFailure(status: number, body?: unknown): string {
  const msg = ((body ?? {}) as { message?: string }).message ?? ''
  if (status === 405) return '这个 PR 现在不能合并：可能有冲突，或没有可合并的提交'
  if (status === 409) return '源分支在你操作期间更新了，请刷新后重试'
  if (status === 403) return '被拒绝：分支保护要求审核通过，或令牌没有写权限'
  if (status === 422) return msg.includes('not mergeable') ? '当前状态下不可合并' : '合并参数不合法，检查合并方式'
  if (status === 404) return 'PR 不存在，或令牌无权访问'
  return msg || `合并失败 (${status})`
}

/** 审核失败提示，自己给自己审核是 422 里最常见的一种 */
export function reviewFailure(status: number, body?: unknown): string {
  const msg = ((body ?? {}) as { message?: string }).message ?? ''
  if (status === 422) {
    if (msg.includes('own pull request')) return '不能给自己的 PR 投审核票，可以留评论'
    return '这个操作不被允许，检查 PR 状态'
  }
  if (status === 403) return '没有审核权限'
  return msg || `提交审核失败 (${status})`
}

/** diff 行分类：给 DiffView 上色用 */
export type DiffLineKind = 'add' | 'del' | 'ctx' | 'meta'

export interface DiffLine {
  kind: DiffLineKind
  text: string
}

/**
 * 把 patch 拆成带类型的行。
 * `@@ ... @@` 是分块标记；`+`/`-` 是增删；其余是上下文。
 */
export function parsePatch(patch: string): DiffLine[] {
  if (!patch) return []
  return patch.split('\n').map((raw) => {
    if (raw.startsWith('@@')) return { kind: 'meta' as const, text: raw }
    if (raw.startsWith('+++') || raw.startsWith('---')) return { kind: 'meta' as const, text: raw }
    if (raw.startsWith('+')) return { kind: 'add' as const, text: raw.slice(1) }
    if (raw.startsWith('-')) return { kind: 'del' as const, text: raw.slice(1) }
    if (raw.startsWith('\\')) return { kind: 'meta' as const, text: raw }
    return { kind: 'ctx' as const, text: raw.startsWith(' ') ? raw.slice(1) : raw }
  })
}

/** 一次最多渲染多少行 diff —— 手机屏塞几千行会直接卡住 */
export const DIFF_MAX_LINES = 400

export interface DiffSlice {
  lines: DiffLine[]
  /** 被截掉的行数，界面要提示「还有 N 行」 */
  hidden: number
}

export function slicePatch(patch: string, max = DIFF_MAX_LINES): DiffSlice {
  const all = parsePatch(patch)
  if (all.length <= max) return { lines: all, hidden: 0 }
  return { lines: all.slice(0, max), hidden: all.length - max }
}

/** 文件状态的中文名与符号 */
export function fileStatusMeta(status: PullFile['status']): { mark: string; label: string } {
  switch (status) {
    case 'added':
      return { mark: 'A', label: '新增' }
    case 'removed':
      return { mark: 'D', label: '删除' }
    case 'renamed':
      return { mark: 'R', label: '重命名' }
    case 'copied':
      return { mark: 'C', label: '复制' }
    default:
      return { mark: 'M', label: '修改' }
  }
}

/** 汇总所有文件的增删，用于顶栏统计 */
export function totalStats(files: PullFile[]): PullStats {
  let additions = 0
  let deletions = 0
  for (const f of files) {
    additions += f.additions
    deletions += f.deletions
  }
  return { additions, deletions, changed_files: files.length }
}

/* ---------------- 网络 ---------------- */

const enc = (s: string) => encodeURIComponent(s)

export async function listPulls(
  client: ApiClient,
  owner: string,
  repo: string,
  opts: { state?: 'open' | 'closed' | 'all'; page?: number; perPage?: number; fresh?: boolean } = {},
): Promise<PullRequest[]> {
  const query = new URLSearchParams({
    state: opts.state ?? 'open',
    per_page: String(opts.perPage ?? 30),
    page: String(opts.page ?? 1),
    sort: 'updated',
    direction: 'desc',
  })
  const { data } = await client.request<PullRequest[]>(
    `/repos/${enc(owner)}/${enc(repo)}/pulls?${query.toString()}`,
    {},
    { fresh: opts.fresh },
  )
  return data ?? []
}

export async function getPull(client: ApiClient, owner: string, repo: string, n: number, fresh = false) {
  const { data } = await client.request<PullRequest>(
    `/repos/${enc(owner)}/${enc(repo)}/pulls/${n}`,
    {},
    { fresh },
  )
  return data
}

export async function pullFiles(
  client: ApiClient,
  owner: string,
  repo: string,
  n: number,
  fresh = false,
): Promise<PullFile[]> {
  const { data } = await client.request<PullFile[]>(
    `/repos/${enc(owner)}/${enc(repo)}/pulls/${n}/files?per_page=100`,
    {},
    { fresh },
  )
  return data ?? []
}

export async function pullCommits(
  client: ApiClient,
  owner: string,
  repo: string,
  n: number,
  fresh = false,
): Promise<PullCommit[]> {
  const { data } = await client.request<PullCommit[]>(
    `/repos/${enc(owner)}/${enc(repo)}/pulls/${n}/commits?per_page=100`,
    {},
    { fresh },
  )
  return data ?? []
}

export async function listReviews(
  client: ApiClient,
  owner: string,
  repo: string,
  n: number,
  fresh = false,
): Promise<PullReview[]> {
  const { data } = await client.request<PullReview[]>(
    `/repos/${enc(owner)}/${enc(repo)}/pulls/${n}/reviews?per_page=50`,
    {},
    { fresh },
  )
  return data ?? []
}

export async function mergePull(
  client: ApiClient,
  owner: string,
  repo: string,
  n: number,
  input: { method: MergeMethod; title?: string; message?: string; sha?: string },
) {
  const body: Record<string, unknown> = { merge_method: input.method }
  if (input.title) body.commit_title = input.title
  if (input.message) body.commit_message = input.message
  // 带上 head sha：源分支在操作期间变了，服务端会 409 而不是合错东西
  if (input.sha) body.sha = input.sha
  const { data } = await client.request<{ merged: boolean; message: string; sha?: string }>(
    `/repos/${enc(owner)}/${enc(repo)}/pulls/${n}/merge`,
    { method: 'PUT', body: JSON.stringify(body) },
  )
  return data
}

export async function createPull(
  client: ApiClient,
  owner: string,
  repo: string,
  input: { title: string; head: string; base: string; body?: string; draft?: boolean },
) {
  const { data } = await client.request<PullRequest>(`/repos/${enc(owner)}/${enc(repo)}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body ?? '',
      draft: input.draft ?? false,
    }),
  })
  return data
}

export async function submitReview(
  client: ApiClient,
  owner: string,
  repo: string,
  n: number,
  input: { event: 'APPROVE' | 'COMMENT' | 'REQUEST_CHANGES'; body?: string },
) {
  const { data } = await client.request<PullReview>(
    `/repos/${enc(owner)}/${enc(repo)}/pulls/${n}/reviews`,
    { method: 'POST', body: JSON.stringify({ event: input.event, body: input.body ?? '' }) },
  )
  return data
}

/** 关掉 PR（不删分支）。reopen 用 PATCH state=open */
export async function setPullState(
  client: ApiClient,
  owner: string,
  repo: string,
  n: number,
  state: PullState,
) {
  const { data } = await client.request<PullRequest>(
    `/repos/${enc(owner)}/${enc(repo)}/pulls/${n}`,
    { method: 'PATCH', body: JSON.stringify({ state }) },
  )
  return data
}

export interface CheckRun {
  id: number
  name: string
  status: string
  conclusion: string | null
  html_url?: string
}

/** PR 的检查状态，挂在 head sha 上 */
export async function checkRuns(
  client: ApiClient,
  owner: string,
  repo: string,
  ref: string,
  fresh = false,
): Promise<CheckRun[]> {
  const { data } = await client.request<{ check_runs: CheckRun[] }>(
    `/repos/${enc(owner)}/${enc(repo)}/commits/${enc(ref)}/check-runs?per_page=50`,
    { headers: { Accept: 'application/vnd.github+json' } },
    { fresh },
  )
  return data?.check_runs ?? []
}
