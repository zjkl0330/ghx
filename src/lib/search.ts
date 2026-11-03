/**
 * GitHub 仓库搜索。
 *
 * 热门页的搜索框既当「在热门里找」也当「全区搜仓库」用：
 * 关键词为空就走 trending 查询，有词就走 /search/repositories。
 * 这里只负责拼查询串与归一化排序方式，网络请求仍在 api.ts。
 */

export type SearchSort = 'best' | 'stars' | 'updated'

export const SEARCH_SORTS: { key: SearchSort; label: string }[] = [
  { key: 'best', label: '最佳匹配' },
  { key: 'stars', label: '最多星' },
  { key: 'updated', label: '最近更新' },
]

export function normalizeSearchSort(raw: string | null | undefined): SearchSort {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'stars' || v === 'updated' || v === 'best') return v
  return 'best'
}

export interface SearchFilters {
  language?: string | null
  /** 最低 star，0 或 null 表示不限 */
  minStars?: number | null
}

/**
 * 拼 /search/repositories 的 q。
 *
 * 关键词原样保留：GitHub 支持 `user:`、`topic:`、`in:name` 这类限定符，
 * 包成引号反而会让它们失效。语言必须加引号，C++ / C# 不加会解析失败。
 */
export function repoSearchQuery(keyword: string, f: SearchFilters = {}): string {
  const parts: string[] = []
  const kw = keyword.trim()
  if (kw) parts.push(kw)
  if (f.language) parts.push(`language:"${f.language}"`)
  if (f.minStars && f.minStars > 0) parts.push(`stars:>=${Math.floor(f.minStars)}`)
  return parts.join(' ').trim()
}

/** 有没有实质关键词（全空白不算） */
export function hasKeyword(keyword: string): boolean {
  return keyword.trim().length > 0
}

/** 搜索结果为空时的解释文案，区分「没搜到」与「筛选太严」 */
export function emptySearchHint(keyword: string, language: string | null): string {
  if (!hasKeyword(keyword)) return '换个时间范围或语言试试。'
  return language
    ? `没有匹配「${keyword.trim()}」的 ${language} 仓库，去掉语言筛选再试一次。`
    : `没有匹配「${keyword.trim()}」的仓库，换个关键词试试。`
}
