/**
 * 星标仓库的语言分类。
 *
 * 只做纯计算：分组、排序、计数，UI 只负责渲染。
 */

import type { Repo } from './types'

/** 没有 language 字段的仓库统一归到这一组，排在最后 */
export const NO_LANGUAGE = '未标注'

export interface LanguageGroup {
  language: string
  repos: Repo[]
  count: number
  /** 组内 star 总数，用于同等数量时的排序 */
  stars: number
}

function byStars(a: Repo, b: Repo): number {
  if (b.stargazers_count !== a.stargazers_count) return b.stargazers_count - a.stargazers_count
  return a.full_name.localeCompare(b.full_name)
}

/**
 * 按语言分组。
 * - 组内按 star 降序
 * - 组间按仓库数降序，同数量比 star 总数，再按语言名
 * - 「未标注」固定排最后，不参与数量排序
 */
export function groupByLanguage(repos: Repo[]): LanguageGroup[] {
  const map = new Map<string, Repo[]>()
  for (const r of repos) {
    const key = r.language?.trim() || NO_LANGUAGE
    const list = map.get(key)
    if (list) list.push(r)
    else map.set(key, [r])
  }

  const groups: LanguageGroup[] = [...map.entries()].map(([language, list]) => ({
    language,
    repos: [...list].sort(byStars),
    count: list.length,
    stars: list.reduce((sum, r) => sum + r.stargazers_count, 0),
  }))

  return groups.sort((a, b) => {
    const aNone = a.language === NO_LANGUAGE
    const bNone = b.language === NO_LANGUAGE
    if (aNone !== bNone) return aNone ? 1 : -1
    if (b.count !== a.count) return b.count - a.count
    if (b.stars !== a.stars) return b.stars - a.stars
    return a.language.localeCompare(b.language)
  })
}

/** 语言筛选条用的列表：按仓库数降序，最多取 limit 个 */
export function topLanguages(repos: Repo[], limit = 8): string[] {
  return groupByLanguage(repos)
    .filter((g) => g.language !== NO_LANGUAGE)
    .slice(0, limit)
    .map((g) => g.language)
}
