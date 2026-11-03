/**
 * 热门仓库。
 *
 * GitHub 没有开放 trending API，首页那个榜单是网页端自己算的。
 * 这里用 search 接口取「最近创建 + star 数达标」的仓库，再按日均 star 重排，
 * 尽量贴近「最近涨得快」的语义，而不是「历史总量最大」。
 */

import type { Repo } from './types'

export type TrendingRange = 'day' | 'week' | 'month'

export const TRENDING_RANGES: TrendingRange[] = ['day', 'week', 'month']

export const RANGE_LABEL: Record<TrendingRange, string> = {
  day: '今日',
  week: '本周',
  month: '本月',
}

const RANGE_DAYS: Record<TrendingRange, number> = { day: 1, week: 7, month: 30 }

/** 语言筛选项。搜索前不知道结果里有哪些语言，这里给常用的几个 */
export const COMMON_LANGUAGES = [
  'TypeScript',
  'JavaScript',
  'Python',
  'Go',
  'Rust',
  'Java',
  'C++',
  'Swift',
  'Kotlin',
  'C#',
]

/** 起始日期，YYYY-MM-DD（UTC），search 的 created 限定符只认这个精度 */
export function trendingSince(range: TrendingRange, now: number = Date.now()): string {
  const d = new Date(now - RANGE_DAYS[range] * 86_400_000)
  return d.toISOString().slice(0, 10)
}

/**
 * 拼 search 查询。
 * 语言一律加引号：C++ / C# / F# 这类带符号的名字不加会解析失败。
 */
export function trendingQuery(
  range: TrendingRange,
  language: string | null,
  now: number = Date.now(),
): string {
  const parts = [`created:>=${trendingSince(range, now)}`, 'stars:>=10']
  if (language) parts.push(`language:"${language}"`)
  return parts.join(' ')
}

/**
 * 日均 star。用于把「老牌高星」和「新晋暴涨」区分开。
 * 创建时间缺失或解析失败时退回总量，至少不把条目排到末尾。
 * 创建不足一天按一天算，避免除出天文数字。
 */
export function dailyStars(repo: Repo, now: number = Date.now()): number {
  const created = Date.parse(repo.created_at ?? '')
  if (Number.isNaN(created)) return repo.stargazers_count
  const days = Math.max(1, (now - created) / 86_400_000)
  return repo.stargazers_count / days
}

/** 按日均 star 降序；相同时按总 star、再按名称，保证顺序稳定 */
export function rankHot(repos: Repo[], now: number = Date.now()): Repo[] {
  return [...repos].sort((a, b) => {
    const da = dailyStars(a, now)
    const db = dailyStars(b, now)
    if (db !== da) return db - da
    if (b.stargazers_count !== a.stargazers_count) return b.stargazers_count - a.stargazers_count
    return a.full_name.localeCompare(b.full_name)
  })
}
