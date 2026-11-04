/**
 * 仓库设置、转移、关注订阅、协作者。
 *
 * 改名是最危险的一项：改完 owner/name 全变，路由、缓存 key、快照 key
 * 都要跟着换，否则会点进 404。所以这里只负责发请求，
 * 「改完怎么让界面跟上」由调用方处理，并把影响写清楚。
 */

import type { ApiClient } from './api'
import type { IssueUser } from './issues'
import type { Repo } from './types'

export interface RepoSettingsPatch {
  name?: string
  description?: string | null
  homepage?: string | null
  default_branch?: string
  has_issues?: boolean
  has_projects?: boolean
  has_wiki?: boolean
  has_downloads?: boolean
  is_template?: boolean
  allow_squash_merge?: boolean
  allow_merge_commit?: boolean
  allow_rebase_merge?: boolean
  delete_branch_on_merge?: boolean
  archived?: boolean
}

/** 设置页里那些开关的中文说明，避免用户对着英文键名猜 */
export const REPO_SWITCHES: { key: keyof RepoSettingsPatch; label: string; hint: string }[] = [
  { key: 'has_issues', label: 'Issues', hint: '关闭后仓库不再接受新 issue' },
  { key: 'has_projects', label: 'Projects', hint: '项目看板（移动端只能开关，不能编辑）' },
  { key: 'has_wiki', label: 'Wiki', hint: 'Wiki 页面本身需要 clone 才能编辑' },
  { key: 'has_downloads', label: 'Downloads', hint: '旧的下载区，现在一般用 Releases' },
  { key: 'is_template', label: '作为模板', hint: '别人可以从这个仓库新建项目' },
  { key: 'allow_squash_merge', label: '允许 squash 合并', hint: '多个提交压成一个' },
  { key: 'allow_merge_commit', label: '允许 merge 提交', hint: '保留合并节点' },
  { key: 'allow_rebase_merge', label: '允许 rebase 合并', hint: '线性历史，不产生合并节点' },
  { key: 'delete_branch_on_merge', label: '合并后删源分支', hint: '减少分支堆积' },
]

/** 改名的二次确认文案：把所有连带影响一次说清 */
export function renameImpact(from: string, to: string): string[] {
  // from 是 full_name（owner/name），to 只是新名字，得比最后一段
  if (!to || to === from.split('/').pop()) return []
  return [
    `仓库地址会变成 ${from.split('/')[0]}/${to}`,
    '旧的远程地址与网页链接会 301 跳到新地址，但第三方 clone 需要更新',
    '本地的快照与缓存会按新名字重建，下次进入要重新加载',
  ]
}

export function repoNameError(name: string): string | null {
  const s = (name ?? '').trim()
  if (!s) return '仓库名不能为空'
  if (!/^[A-Za-z0-9._-]+$/.test(s)) return '只能用字母、数字、点、下划线、连字符'
  if (s === '.' || s === '..') return '这个名字不合法'
  if (s.length > 100) return '名字太长了'
  return null
}

const enc = encodeURIComponent

export async function updateRepoSettings(
  client: ApiClient,
  owner: string,
  repo: string,
  patch: RepoSettingsPatch,
): Promise<Repo> {
  const { data } = await client.request<Repo>(`/repos/${enc(owner)}/${enc(repo)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return data
}

/**
 * 转移到别的账号或组织。
 * 需要目标方的邀请确认，API 返回 202 —— 不是「已完成」，界面措辞要注意。
 */
export async function transferRepo(
  client: ApiClient,
  owner: string,
  repo: string,
  newOwner: string,
) {
  await client.request<{ message?: string }>(`/repos/${enc(owner)}/${enc(repo)}/transfer`, {
    method: 'POST',
    body: JSON.stringify({ new_owner: newOwner }),
  })
}

export async function listCollaborators(
  client: ApiClient,
  owner: string,
  repo: string,
): Promise<IssueUser[]> {
  const { data } = await client.request<IssueUser[]>(
    `/repos/${enc(owner)}/${enc(repo)}/collaborators?per_page=100`,
  )
  return data ?? []
}

/* ---------------- 关注 / 订阅 ---------------- */

export type WatchState = 'subscribed' | 'ignored'

export async function getWatch(client: ApiClient, owner: string, repo: string): Promise<WatchState | null> {
  try {
    const { data } = await client.request<{ subscribed: boolean; ignored: boolean }>(
      `/repos/${enc(owner)}/${enc(repo)}/subscription`,
    )
    if (data?.ignored) return 'ignored'
    return data?.subscribed ? 'subscribed' : null
  } catch {
    // 404 = 没订阅过；403 = 令牌不支持，两种情况都按「未知」处理
    return null
  }
}

export async function setWatch(
  client: ApiClient,
  owner: string,
  repo: string,
  state: WatchState | 'none',
) {
  if (state === 'none') {
    await client.request<null>(`/repos/${enc(owner)}/${enc(repo)}/subscription`, { method: 'DELETE' })
    return
  }
  await client.request<null>(`/repos/${enc(owner)}/${enc(repo)}/subscription`, {
    method: 'PUT',
    body: JSON.stringify({ subscribed: state === 'subscribed', ignored: state === 'ignored' }),
  })
}

export function watchLabel(state: WatchState | null): string {
  if (state === 'subscribed') return '已订阅全部动态'
  if (state === 'ignored') return '已忽略'
  return '未订阅'
}

/* ---------------- 用户与社交 ---------------- */

export interface UserProfile extends IssueUser {
  name: string | null
  bio: string | null
  company: string | null
  location: string | null
  blog: string | null
  public_repos: number
  public_gists?: number
  followers: number
  following: number
  created_at: string
  html_url?: string
  type?: string
}

export async function getUser(client: ApiClient, login: string, fresh = false): Promise<UserProfile> {
  const { data } = await client.request<UserProfile>(`/users/${enc(login)}`, {}, { fresh })
  return data
}

export async function isFollowing(client: ApiClient, login: string): Promise<boolean> {
  try {
    await client.request<null>(`/user/following/${enc(login)}`)
    return true
  } catch {
    return false
  }
}

/**
 * 关注/取关。PUT 必须显式带长度 0 的 body，
 * 否则某些代理会把请求当成 GET 处理掉。
 */
export async function setFollowing(client: ApiClient, login: string, following: boolean) {
  await client.request<null>(`/user/following/${enc(login)}`, {
    method: following ? 'PUT' : 'DELETE',
    body: following ? '' : undefined,
    headers: following ? { 'Content-Length': '0' } : undefined,
  })
}

export async function userRepos(
  client: ApiClient,
  login: string,
  opts: { page?: number; perPage?: number; fresh?: boolean } = {},
): Promise<Repo[]> {
  const query = new URLSearchParams({
    per_page: String(opts.perPage ?? 30),
    page: String(opts.page ?? 1),
    sort: 'pushed',
    direction: 'desc',
  })
  const { data } = await client.request<Repo[]>(
    `/users/${enc(login)}/repos?${query.toString()}`,
    {},
    { fresh: opts.fresh },
  )
  return data ?? []
}

export async function listOrgs(client: ApiClient): Promise<IssueUser[]> {
  const { data } = await client.request<IssueUser[]>('/user/orgs?per_page=100')
  return data ?? []
}
