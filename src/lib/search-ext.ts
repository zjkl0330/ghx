/**
 * 全局搜索。
 *
 * 配额提醒：代码搜索是 **10 次/分钟**，其它搜索 30 次/分钟。
 * 所以这里只做「点搜索才发请求」，不做输入即搜的自动补全。
 *
 * 语义坑：`/search/issues` 同时返回 Issue 与 PR，
 * 必须显式写 `is:issue` 或 `is:pull-request`，否则两类混在一起。
 * `/search/code` 只搜**默认分支**，这是 GitHub 的限制，不是我们少传了参数。
 */

import type { ApiClient } from './api'
import type { Issue, IssueUser } from './issues'

export type SearchKind = 'repos' | 'code' | 'issues' | 'pulls' | 'users' | 'commits'

export const SEARCH_KINDS: { key: SearchKind; label: string; hint: string }[] = [
  { key: 'repos', label: '仓库', hint: '按名字、描述、话题搜索' },
  { key: 'code', label: '代码', hint: '只搜默认分支，10 次/分钟' },
  { key: 'issues', label: 'Issue', hint: '标题、正文、评论' },
  { key: 'pulls', label: 'PR', hint: '标题、正文、评论' },
  { key: 'users', label: '用户', hint: '按用户名或昵称' },
  { key: 'commits', label: '提交', hint: '按提交信息搜索' },
]

export interface CodeHit {
  name: string
  path: string
  html_url?: string
  repository: { full_name: string; owner: { login: string }; name: string } | null
}

export interface UserHit extends IssueUser {
  type?: string
  html_url?: string
}

export interface CommitHit {
  sha: string
  html_url?: string
  commit: { message: string; author: { date: string } | null }
  repository: { full_name: string } | null
}

/** 代码搜索限定条件 */
export function codeQuery(term: string, opts: { repo?: string; language?: string; path?: string } = {}): string {
  const parts = [term.trim()]
  if (opts.repo) parts.push(`repo:${opts.repo}`)
  if (opts.language) parts.push(`language:"${opts.language}"`)
  if (opts.path) parts.push(`path:${opts.path}`)
  return parts.filter(Boolean).join(' ')
}

/** Issue / PR 搜索：类型必须显式写，否则混在一起 */
export function issueQuery(
  term: string,
  kind: 'issues' | 'pulls',
  opts: { repo?: string; state?: 'open' | 'closed'; author?: string; label?: string } = {},
): string {
  const parts = [term.trim(), kind === 'pulls' ? 'is:pull-request' : 'is:issue']
  if (opts.repo) parts.push(`repo:${opts.repo}`)
  if (opts.state) parts.push(`state:${opts.state}`)
  if (opts.author) parts.push(`author:${opts.author}`)
  if (opts.label) parts.push(`label:"${opts.label}"`)
  return parts.filter(Boolean).join(' ')
}

/** 搜索接口的总数统计。incomplete_results 表示服务端没扫完，别把数字说成精确值 */
export interface SearchResult<T> {
  items: T[]
  total: number
  incomplete: boolean
}

async function run<T>(
  client: ApiClient,
  path: string,
  fresh: boolean,
): Promise<SearchResult<T>> {
  const { data } = await client.request<{ total_count: number; incomplete_results: boolean; items: T[] }>(
    path,
    {},
    { fresh },
  )
  return { items: data?.items ?? [], total: data?.total_count ?? 0, incomplete: !!data?.incomplete_results }
}

function q(term: string, extra: string, page: number, perPage: number): string {
  const params = new URLSearchParams({ q: [term, extra].filter(Boolean).join(' '), page: String(page), per_page: String(perPage) })
  return params.toString()
}

export function searchCode(
  client: ApiClient,
  term: string,
  opts: { page?: number; repo?: string; language?: string; fresh?: boolean } = {},
) {
  const query = codeQuery(term, opts)
  return run<CodeHit>(
    client,
    `/search/code?${q(query, '', opts.page ?? 1, 30)}`,
    opts.fresh ?? false,
  )
}

export function searchIssues(
  client: ApiClient,
  term: string,
  kind: 'issues' | 'pulls',
  opts: { page?: number; repo?: string; state?: 'open' | 'closed'; fresh?: boolean } = {},
) {
  const query = issueQuery(term, kind, opts)
  return run<Issue>(
    client,
    `/search/issues?${q(query, '', opts.page ?? 1, 30)}`,
    opts.fresh ?? false,
  )
}

/**
 * 用户搜索的关键词清洗。
 * 大家习惯直接写 `@zjkl0330`，但 `/search/users` 把 @ 当普通字符，
 * 带上去经常一个结果都没有。只在这里去前导 @，不影响仓库搜索。
 */
export function normalizeUserTerm(term: string): string {
  return term.trim().replace(/^@+/, '').trim()
}

export function searchUsers(client: ApiClient, term: string, opts: { page?: number; fresh?: boolean } = {}) {
  const clean = normalizeUserTerm(term)
  return run<UserHit>(
    client,
    `/search/users?${q(clean, '', opts.page ?? 1, 30)}`,
    opts.fresh ?? false,
  )
}

export function searchCommits(
  client: ApiClient,
  term: string,
  opts: { page?: number; repo?: string; fresh?: boolean } = {},
) {
  const extra = opts.repo ? `repo:${opts.repo}` : ''
  return run<CommitHit>(
    client,
    `/search/commits?${q(term, extra, opts.page ?? 1, 30)}`,
    opts.fresh ?? false,
  )
}

/** 空关键词提示。搜索接口对空 q 会 422，界面要提前拦 */
export function emptyQueryHint(kind: SearchKind, term: string): string | null {
  if (term.trim()) return null
  if (kind === 'code') return '输入要在代码里找的文字，比如函数名或报错信息'
  if (kind === 'issues' || kind === 'pulls') return '输入关键词，比如「登录失败」'
  if (kind === 'users') return '输入用户名或昵称'
  if (kind === 'commits') return '输入提交信息里的关键词'
  return '输入仓库名、描述或话题'
}

/** 搜索额度：代码搜索最紧，界面要提示 */
export function searchQuotaHint(kind: SearchKind): string | null {
  if (kind === 'code') return '代码搜索每分钟最多 10 次，超了要等一分钟'
  return null
}

/** 结果里的仓库名拆成 owner / repo，点进去要用 */
export function splitFullName(full: string | null | undefined): { owner: string; repo: string } | null {
  if (!full || !full.includes('/')) return null
  const [owner, repo] = full.split('/')
  return { owner, repo }
}
