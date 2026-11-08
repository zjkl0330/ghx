/**
 * 用户维度的纯逻辑：仓库排序与过滤、资料事实行、关注列表分页。
 *
 * 和界面分开写，原因是这些规则都有边界（fork 过滤、时间缺失、blog 没写协议），
 * 塞在 JSX 里就只能靠肉眼验；放这里可以直接喂假数据跑单测。
 */
import type { Repo } from './types'
import type { UserProfile } from './repo-admin'

export type UserRepoSort = 'pushed' | 'stars' | 'name'

export const USER_REPO_SORTS: { key: UserRepoSort; label: string }[] = [
  { key: 'pushed', label: '最近推送' },
  { key: 'stars', label: '星标最多' },
  { key: 'name', label: '名称' },
]

export interface UserRepoView {
  sort: UserRepoSort
  /** 只看自己写的仓库，过滤掉 fork */
  sourceOnly: boolean
}

function stamp(iso?: string | null): number {
  const t = Date.parse(iso ?? '')
  return Number.isNaN(t) ? 0 : t
}

/**
 * 排序 + 过滤。默认按最近推送降序 —— 和 GitHub 个人主页一致，
 * 时间缺失的沉底而不是排最前（`Date.parse` 失败给 0，排序后自然在末尾）。
 */
export function visibleUserRepos(repos: Repo[], opts: UserRepoView): Repo[] {
  const list = opts.sourceOnly ? repos.filter((r) => !r.fork) : repos
  const sorted = [...list]
  if (opts.sort === 'stars') {
    sorted.sort(
      (a, b) =>
        b.stargazers_count - a.stargazers_count ||
        stamp(b.pushed_at) - stamp(a.pushed_at) ||
        a.name.localeCompare(b.name),
    )
  } else if (opts.sort === 'name') {
    sorted.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  } else {
    sorted.sort(
      (a, b) => stamp(b.pushed_at) - stamp(a.pushed_at) || a.name.localeCompare(b.name),
    )
  }
  return sorted
}

/** fork 数量，用来决定「只看源仓库」这个开关要不要显示 */
export function forkCount(repos: Repo[]): number {
  return repos.filter((r) => r.fork).length
}

/** 账号类型：GitHub 的 type 只有 User / Organization / Bot 三种 */
export function userKindLabel(type?: string | null): string {
  const t = (type ?? '').toLowerCase()
  if (t === 'organization') return '组织'
  if (t === 'bot') return '机器人'
  return '个人'
}

/** 展示名：没填名字就退回登录名，别让标题空着 */
export function displayName(user: Pick<UserProfile, 'login' | 'name'>): string {
  return user.name?.trim() || user.login
}

export type UserFactKey = 'company' | 'location' | 'blog' | 'twitter' | 'joined'

export interface UserFact {
  key: UserFactKey
  label: string
  text: string
  href?: string
}

/**
 * 补协议。GitHub 上 blog 字段是用户手填的，大量条目没有 `https://`，
 * 直接塞进 <a href> 会变成相对路径，点了等于没反应。
 */
export function normalizeBlogUrl(raw?: string | null): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s
  if (/^mailto:/i.test(s)) return s
  return `https://${s}`
}

/** X / 社交账号字段在 REST 里叫 twitter_username，存的是不带 @ 的裸名 */
export function twitterUrl(name?: string | null): string | null {
  const s = (name ?? '').trim().replace(/^@+/, '')
  return s ? `https://x.com/${encodeURIComponent(s)}` : null
}

/** 「加入于 2011 年 9 月」。不用相对时间：十年前的账号写「15 年前」没有信息量 */
export function joinedText(createdAt?: string | null): string | null {
  const t = Date.parse(createdAt ?? '')
  if (Number.isNaN(t)) return null
  const d = new Date(t)
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
}

/** 资料事实行。空字段直接不出现，避免一排「—」 */
export function userFacts(
  user: Pick<UserProfile, 'company' | 'location' | 'blog' | 'created_at'> & {
    twitter_username?: string | null
  },
): UserFact[] {
  const out: UserFact[] = []
  const company = user.company?.trim().replace(/^@/, '')
  if (company) out.push({ key: 'company', label: '公司', text: company })
  const location = user.location?.trim()
  if (location) out.push({ key: 'location', label: '位置', text: location })
  const blog = normalizeBlogUrl(user.blog)
  if (blog) {
    out.push({
      key: 'blog',
      label: '博客',
      text: blog.replace(/^https?:\/\//, '').replace(/\/$/, ''),
      href: blog,
    })
  }
  const tw = twitterUrl(user.twitter_username)
  if (tw) {
    out.push({
      key: 'twitter',
      label: 'X',
      text: `@${(user.twitter_username ?? '').trim().replace(/^@+/, '')}`,
      href: tw,
    })
  }
  const joined = joinedText(user.created_at)
  if (joined) out.push({ key: 'joined', label: '加入', text: joined })
  return out
}

/** 关注关系列表的一页。GitHub 上限 100，这里统一 30，翻页次数和仓库列表对齐 */
export const FOLLOW_PAGE_SIZE = 30

export type FollowKind = 'followers' | 'following'

export function followPath(login: string, kind: FollowKind, page = 1, perPage = FOLLOW_PAGE_SIZE): string {
  const q = new URLSearchParams({ per_page: String(perPage), page: String(page) })
  return `/users/${encodeURIComponent(login)}/${kind}?${q.toString()}`
}

/**
 * 还有没有下一页。
 * 不看 total（GitHub 这个接口不给 total），只按「这一页拿满了就认为可能还有」判断：
 * 少一次请求，最坏情况是多点一次「加载更多」才发现空了。
 */
export function hasMoreFollowers(loadedSoFar: number, perPage = FOLLOW_PAGE_SIZE): boolean {
  return loadedSoFar > 0 && loadedSoFar % perPage === 0
}

/** 用户主页的外链。镜像带 page 能力时走镜像，否则退回自建站 */
export function userPagePath(login: string): string {
  return encodeURIComponent(login)
}

/** 「12 个仓库 · 3 个 fork」这类副标题里的统计片段 */
export function userRepoSummary(repos: Repo[]): string {
  if (repos.length === 0) return '没有公开仓库'
  const forks = forkCount(repos)
  const archived = repos.filter((r) => r.archived).length
  const parts = [`${repos.length} 个仓库`]
  if (forks > 0) parts.push(`${forks} 个 fork`)
  if (archived > 0) parts.push(`${archived} 个已归档`)
  return parts.join(' · ')
}
