/**
 * 数据看板的计算层。
 *
 * 全部是纯函数：输入仓库列表与事件流，输出可直接画图的数字。
 * 单独拎出来的原因是口径 —— 「活跃度」「语言占比」这类指标没有唯一正解，
 * 必须把「怎么算的」写成可测的代码，而不是散在 JSX 里。
 *
 * 数据来源只有两个，都是 REST 已有的接口：
 * - `GET /user/repos`：账号名下全部仓库（含私有，带 star / fork / 语言 / 推送时间）
 * - `GET /users/{login}/events`：最近 300 条事件，覆盖约 90 天
 *
 * 事件流的口径要在界面上写清楚：它是 GitHub 公开的事件流，只保留 90 天、
 * 最多 300 条，所以「近 14 天活动」在极端情况下会少算 —— 不是漏数据，是源头就这么长。
 */

import type { Repo } from './types'

/** GitHub 事件流里我们关心的字段，其余一概不读 */
export interface GhEvent {
  id?: string
  /** 事件类型缺失时按「其它」处理，不让整页崩掉 */
  type?: string | null
  created_at?: string | null
  repo?: { name?: string | null } | null
  payload?: {
    /** PushEvent：本次推送的总提交数 */
    size?: number | null
    /** PushEvent：去重后的提交数（force push 会让它小于 size） */
    distinct_size?: number | null
    commits?: unknown[] | null
    /** IssuesEvent / PullRequestEvent 的动作 */
    action?: string | null
  } | null
}

export interface RepoCounts {
  total: number
  public: number
  private: number
  fork: number
  source: number
  archived: number
  /** 所有仓库的 star 之和 */
  stars: number
  /** 所有仓库的 fork 之和 */
  forks: number
  /** 带 topics 的仓库数，用来衡量「收拾过没有」 */
  withTopics: number
}

/** 语言切片。`ratio` 是占「已标注语言」的比例，0–1 */
export interface LangSlice {
  language: string
  count: number
  stars: number
  ratio: number
}

export interface DayBucket {
  /** YYYY-MM-DD，按调用方给的时区偏移折算 */
  date: string
  commits: number
  issues: number
  pulls: number
  /** 三类之外的事件（Create / Release / Fork / …），不计入柱高但单独给数 */
  other: number
  total: number
}

export interface ActivityTotals {
  commits: number
  issues: number
  pulls: number
  other: number
  /** 参与过活动的仓库数 */
  repos: number
  /** 事件覆盖到的最早一天；没有事件时为 null */
  since: string | null
}

export interface RepoRank {
  fullName: string
  name: string
  stars: number
  forks: number
  language: string | null
  pushedAt: string
}

export interface DashboardData {
  counts: RepoCounts
  /** Top N 语言；剩下的合并成「其它」放最后 */
  langs: LangSlice[]
  /** 近 N 天，按时间正序，最后一个是今天 */
  days: DayBucket[]
  totals: ActivityTotals
  topStars: RepoRank[]
  topForks: RepoRank[]
  recent: RepoRank[]
  /** 连续有活动的天数（含今天，今天没活动时从昨天往回数） */
  streak: number
  /** 超过 N 天没推送的仓库数 */
  stale: number
  /** 事件流实际覆盖的天数（从最早一条事件算到今天），至少 1 */
  coveredDays: number
  /** 每天平均提交数。分母是 coveredDays，不是窗口天数 —— 窗口只是显示范围 */
  commitsPerDay: number
  /** 已拉取仓库的 star 中位数 —— 比平均数抗极端值 */
  medianStars: number
}

const DAY_MS = 86_400_000

/**
 * 把 ISO 时间折成「本地日期」。
 *
 * offsetMinutes 是本地时区相对 UTC 的分钟数（东八区传 480）。
 * 不用 `toISOString().slice(0,10)`：那个按 UTC 切日，东八区早上 8 点前的活动
 * 会被算成前一天，柱状图整体错位一格。
 */
export function dayKey(iso: string | null | undefined, offsetMinutes = 0): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const d = new Date(t + offsetMinutes * 60_000)
  const y = d.getUTCFullYear()
  const m = `${d.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${d.getUTCDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 当前本地日期，口径与 dayKey 一致 */
export function todayKey(now: number, offsetMinutes = 0): string {
  return dayKey(new Date(now).toISOString(), offsetMinutes) as string
}

export function countRepos(repos: Repo[]): RepoCounts {
  const out: RepoCounts = {
    total: repos.length,
    public: 0,
    private: 0,
    fork: 0,
    source: 0,
    archived: 0,
    stars: 0,
    forks: 0,
    withTopics: 0,
  }
  for (const r of repos) {
    if (r.private) out.private += 1
    else out.public += 1
    if (r.fork) out.fork += 1
    else out.source += 1
    if (r.archived) out.archived += 1
    out.stars += r.stargazers_count || 0
    out.forks += r.forks_count || 0
    if (r.topics && r.topics.length > 0) out.withTopics += 1
  }
  return out
}

/**
 * 语言分布，按仓库数排序。
 *
 * 为什么不用 star 加权：一个语言只要有一两个爆款仓库就会霸榜，
 * 看起来「我主要写 Rust」其实只写过一个。仓库数更接近「我平时在写什么」。
 * star 仍会跟着返回，界面上作为副信息展示。
 */
export function languageSlices(repos: Repo[], limit = 6): LangSlice[] {
  const map = new Map<string, { count: number; stars: number }>()
  let marked = 0
  for (const r of repos) {
    const lang = r.language?.trim()
    if (!lang) continue
    marked += 1
    const cur = map.get(lang) ?? { count: 0, stars: 0 }
    cur.count += 1
    cur.stars += r.stargazers_count || 0
    map.set(lang, cur)
  }
  if (marked === 0) return []

  const all = [...map.entries()]
    .map(([language, v]) => ({
      language,
      count: v.count,
      stars: v.stars,
      ratio: v.count / marked,
    }))
    .sort((a, b) => b.count - a.count || b.stars - a.stars || a.language.localeCompare(b.language))

  if (all.length <= limit) return all

  const head = all.slice(0, limit)
  const tail = all.slice(limit)
  const restCount = tail.reduce((s, x) => s + x.count, 0)
  head.push({
    language: `其它 ${tail.length} 种`,
    count: restCount,
    stars: tail.reduce((s, x) => s + x.stars, 0),
    ratio: restCount / marked,
  })
  return head
}

/** PushEvent 到底算几个提交：优先 distinct_size，再退 commits 长度，最后按 1 算 */
export function commitsOf(e: GhEvent): number {
  const p = e.payload
  if (!p) return 1
  if (typeof p.distinct_size === 'number' && p.distinct_size >= 0) return p.distinct_size
  if (Array.isArray(p.commits)) return p.commits.length
  if (typeof p.size === 'number' && p.size >= 0) return p.size
  return 1
}

/** 事件归类。WatchEvent 是「我 star 了别人」，不产生内容，不算活动 */
export type EventKind = 'commit' | 'issue' | 'pull' | 'other' | 'skip'

export function classifyEvent(type: string | null | undefined): EventKind {
  switch (type) {
    case 'PushEvent':
      return 'commit'
    case 'IssuesEvent':
      return 'issue'
    case 'PullRequestEvent':
      return 'pull'
    case 'WatchEvent':
    case 'FollowEvent':
      return 'skip'
    default:
      return 'other'
  }
}

/**
 * 逐日活动。days=14 表示「今天往前 13 天 + 今天」，共 14 个格子。
 * 没有事件的日子补 0，保证柱子等宽 —— 靠数据里有没有这一天来画图会歪。
 */
export function dailyActivity(
  events: GhEvent[],
  days: number,
  offsetMinutes = 0,
  now = Date.now(),
): DayBucket[] {
  const span = Math.max(1, Math.floor(days))
  const buckets = new Map<string, DayBucket>()
  const order: string[] = []
  const today = todayKey(now, offsetMinutes)
  const todayStart = Date.parse(`${today}T00:00:00Z`) - offsetMinutes * 60_000
  for (let i = span - 1; i >= 0; i -= 1) {
    const key = dayKey(new Date(todayStart - i * DAY_MS).toISOString(), offsetMinutes) as string
    const bucket: DayBucket = { date: key, commits: 0, issues: 0, pulls: 0, other: 0, total: 0 }
    buckets.set(key, bucket)
    order.push(key)
  }

  for (const e of events) {
    const key = dayKey(e.created_at, offsetMinutes)
    if (!key) continue
    const bucket = buckets.get(key)
    // 落在窗口外的事件直接丢，极少数未来时间的也丢
    if (!bucket) continue
    switch (classifyEvent(e.type)) {
      case 'commit':
        bucket.commits += commitsOf(e)
        break
      case 'issue':
        bucket.issues += 1
        break
      case 'pull':
        bucket.pulls += 1
        break
      case 'other':
        bucket.other += 1
        break
      default:
        continue
    }
  }

  for (const b of buckets.values()) b.total = b.commits + b.issues + b.pulls
  return order.map((k) => buckets.get(k) as DayBucket)
}

/** 贡献日历的一格 */
export interface GridCell {
  /** YYYY-MM-DD（本地口径） */
  date: string
  /** 当天的事件计数：提交按 distinct_size 计，其余每事件 1 */
  count: number
  /** 深浅档，0–4。0 是没动过 */
  level: 0 | 1 | 2 | 3 | 4
  /** 今天之后的日子 —— 画成空格子，不是「没活动」 */
  future: boolean
}

export interface ContributionGrid {
  /** 按列分组，每列 7 格（周日在最上）。最后一列是本周 */
  weeks: GridCell[][]
  /** 区间内总计数 */
  total: number
  /** 有活动的天数 */
  activeDays: number
  /** 单日最高 */
  max: number
  /** 最高那天；全空时 null */
  best: { date: string; count: number } | null
}

/** 计数 → 深浅档。固定阈值而不是按分位数：分位数会让「每天都很闲」也画出深格子 */
export function gridLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count <= 3) return 2
  if (count <= 6) return 3
  return 4
}

/**
 * 贡献日历（格子图）。
 *
 * 口径与柱状图一致：都从同一条事件流来，所以它**不是** GitHub 个人页那张
 * 「贡献图」—— 那张来自 `contributionsCollection`（GraphQL），包含私有仓库的
 * 匿名贡献、Issue 评论、PR 评审等，REST 拿不到。这里的格子只反映公开事件流里
 * 的提交 / Issue / PR / 其它事件，覆盖上限 90 天、300 条。
 *
 * 界面必须把这句写出来，否则会和 GitHub 主页的数字对不上而显得像 bug。
 *
 * `weeks` 是列数，13 列 = 91 天。列从周日起，最后一列含今天，
 * 今天之后的格子标 `future`。
 */
export function contributionGrid(
  events: GhEvent[],
  opts: { weeks?: number; offsetMinutes?: number; now?: number } = {},
): ContributionGrid {
  const weeks = Math.max(1, Math.floor(opts.weeks ?? 13))
  const offsetMinutes = opts.offsetMinutes ?? 0
  const now = opts.now ?? Date.now()

  const counts = new Map<string, number>()
  for (const e of events) {
    const key = dayKey(e.created_at, offsetMinutes)
    if (!key) continue
    const kind = classifyEvent(e.type)
    if (kind === 'skip') continue
    // 提交按去重后的提交数累加，与 activityTotals 的口径保持一致
    const add = kind === 'commit' ? commitsOf(e) : 1
    counts.set(key, (counts.get(key) ?? 0) + add)
  }

  const today = todayKey(now, offsetMinutes)
  const [y, m, d] = today.split('-').map(Number)
  // 用 UTC 的「日历坐标」推算，避免本地时区把日期整体挪一天
  const base = Date.UTC(y, m - 1, d)
  const weekday = new Date(base).getUTCDay()
  const start = base - ((weeks - 1) * 7 + weekday) * DAY_MS

  const cells: GridCell[] = []
  for (let i = 0; i < weeks * 7; i += 1) {
    const ts = start + i * DAY_MS
    const date = new Date(ts).toISOString().slice(0, 10)
    const future = ts > base
    const count = future ? 0 : (counts.get(date) ?? 0)
    cells.push({ date, count, level: future ? 0 : gridLevel(count), future })
  }

  let total = 0
  let activeDays = 0
  let max = 0
  let best: { date: string; count: number } | null = null
  for (const c of cells) {
    if (c.future) continue
    total += c.count
    if (c.count > 0) activeDays += 1
    if (c.count > max) {
      max = c.count
      best = { date: c.date, count: c.count }
    }
  }

  const grouped: GridCell[][] = []
  for (let i = 0; i < cells.length; i += 7) grouped.push(cells.slice(i, i + 7))

  return { weeks: grouped, total, activeDays, max, best }
}

/** 事件流的总量统计。注意 commits 是「推送里带的提交数」，不是去重后的人工提交 */
export function activityTotals(events: GhEvent[]): ActivityTotals {
  const out: ActivityTotals = { commits: 0, issues: 0, pulls: 0, other: 0, repos: 0, since: null }
  const repoSet = new Set<string>()
  let since: string | null = null
  for (const e of events) {
    switch (classifyEvent(e.type)) {
      case 'commit':
        out.commits += commitsOf(e)
        break
      case 'issue':
        out.issues += 1
        break
      case 'pull':
        out.pulls += 1
        break
      case 'other':
        out.other += 1
        break
      default:
        continue
    }
    const name = e.repo?.name
    if (name) repoSet.add(name)
    if (e.created_at && (!since || e.created_at < since)) since = e.created_at
  }
  out.repos = repoSet.size
  out.since = since
  return out
}

/**
 * 连续天数。
 *
 * 今天还没活动不算断 —— 一天刚开始就判「你断了」很打击人。
 * 所以从今天往回找最近一个有活动的日子，再往前数连续段。
 */
export function streakDays(days: DayBucket[]): number {
  let i = days.length - 1
  while (i >= 0 && days[i].total === 0 && days[i].other === 0) i -= 1
  if (i < 0) return 0
  let n = 0
  for (; i >= 0; i -= 1) {
    const d = days[i]
    if (d.total === 0 && d.other === 0) break
    n += 1
  }
  return n
}

function toRank(r: Repo): RepoRank {
  return {
    fullName: r.full_name,
    name: r.name,
    stars: r.stargazers_count || 0,
    forks: r.forks_count || 0,
    language: r.language ?? null,
    pushedAt: r.pushed_at,
  }
}

export function topRepos(repos: Repo[], key: 'stars' | 'forks', limit = 5): RepoRank[] {
  return [...repos]
    .filter((r) => (r[key === 'stars' ? 'stargazers_count' : 'forks_count'] || 0) > 0)
    .sort((a, b) => {
      const d = (b[key === 'stars' ? 'stargazers_count' : 'forks_count'] || 0) -
        (a[key === 'stars' ? 'stargazers_count' : 'forks_count'] || 0)
      if (d !== 0) return d
      return (b.pushed_at || '').localeCompare(a.pushed_at || '')
    })
    .slice(0, limit)
    .map(toRank)
}

export function recentRepos(repos: Repo[], limit = 5): RepoRank[] {
  return [...repos]
    .filter((r) => !!r.pushed_at)
    .sort((a, b) => (b.pushed_at || '').localeCompare(a.pushed_at || ''))
    .slice(0, limit)
    .map(toRank)
}

/** 多久没动过的仓库数。归档的不算 —— 归档本来就是「收起来了」 */
export function staleRepos(repos: Repo[], days: number, now = Date.now()): number {
  const line = now - Math.max(1, days) * DAY_MS
  let n = 0
  for (const r of repos) {
    if (r.archived) continue
    const t = Date.parse(r.pushed_at)
    if (Number.isNaN(t)) continue
    if (t < line) n += 1
  }
  return n
}

/** 中位数。偶数个取中间两个的平均，四舍五入到整数 */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

export interface DashboardOptions {
  /** 活动的天数窗口 */
  days?: number
  /** 语言切片数量上限 */
  langLimit?: number
  /** 本地时区偏移，分钟；东八区 480 */
  offsetMinutes?: number
  now?: number
  /** 超过多少天算「久未更新」 */
  staleDays?: number
}

export function buildDashboard(
  repos: Repo[],
  events: GhEvent[],
  opts: DashboardOptions = {},
): DashboardData {
  const days = opts.days ?? 14
  const offsetMinutes = opts.offsetMinutes ?? 0
  const now = opts.now ?? Date.now()
  const totals = activityTotals(events)
  const daily = dailyActivity(events, days, offsetMinutes, now)

  // 事件流的覆盖天数：仓库口径的「每天提交」要用它当分母，否则早期用户会被算成每天 0.1 个提交
  const coveredDays = totals.since
    ? Math.max(1, Math.round((now - Date.parse(totals.since)) / DAY_MS) + 1)
    : 1

  return {
    counts: countRepos(repos),
    langs: languageSlices(repos, opts.langLimit ?? 6),
    days: daily,
    totals,
    topStars: topRepos(repos, 'stars', 5),
    topForks: topRepos(repos, 'forks', 5),
    recent: recentRepos(repos, 5),
    streak: streakDays(daily),
    stale: staleRepos(repos, opts.staleDays ?? 90, now),
    coveredDays,
    commitsPerDay: Math.round((totals.commits / coveredDays) * 10) / 10,
    medianStars: median(repos.map((r) => r.stargazers_count || 0)),
  }
}

/**
 * 把一页事件并进已有列表，按 id 去重。
 *
 * 为什么需要去重：镜像站和代理有时会忽略 `page` 参数，把同一页原样回三遍。
 * 不去重的话提交数直接翻三倍，而且「本页是否满员」的判断也会失效，
 * 于是一个 200 条的事件流会被当成「已取到 300 条上限」。
 *
 * 返回 `added` 是本页真正新增的条数 —— 调用方要用它判断有没有下一页，
 * 而不是用响应长度：被去重吃光的一页等于没有新数据。
 */
export function mergeEvents(prev: GhEvent[], page: GhEvent[]): { list: GhEvent[]; added: number } {
  const seen = new Set<string>()
  for (const e of prev) {
    if (e.id) seen.add(e.id)
  }
  const list = [...prev]
  let added = 0
  for (const e of page) {
    if (e.id) {
      if (seen.has(e.id)) continue
      seen.add(e.id)
    }
    list.push(e)
    added += 1
  }
  // 没有 id 的事件无法判重，一律当作新增：宁可多算，也不要悄悄丢数据
  return { list, added: page.some((e) => !e.id) ? page.length : added }
}
