import type { Repo } from './types'

/**
 * 仓库列表排序。
 *
 * 之前直接用 GitHub `/user/repos` 的默认顺序（full_name 升序），
 * 名字相近的仓库挤在一起，最近动过的反而沉到底部 —— 这是用户反馈的「顺序不对」。
 * 这里改成客户端排序，默认按最近推送，和 GitHub 网页首屏的行为对齐。
 */
export type RepoSort = 'pushed' | 'updated' | 'created' | 'name' | 'stars'

export const REPO_SORTS: { key: RepoSort; label: string; hint: string }[] = [
  { key: 'pushed', label: '最近推送', hint: '按最后一次提交时间' },
  { key: 'updated', label: '最近更新', hint: '含改描述、改设置等' },
  { key: 'created', label: '最近创建', hint: '新仓库排在前面' },
  { key: 'stars', label: 'Star 最多', hint: '按星标数从高到低' },
  { key: 'name', label: '名称 A→Z', hint: '按仓库名字典序' },
]

export const DEFAULT_SORT: RepoSort = 'pushed'

/** 读回来的值可能是旧版本、手改的、或干脆是 null，一律退回默认 */
export function normalizeSort(raw: string | null | undefined): RepoSort {
  const hit = REPO_SORTS.find((s) => s.key === raw)
  return hit ? hit.key : DEFAULT_SORT
}

/**
 * 取时间戳。时间字段缺失或格式不对时返回 0，
 * 这样这类仓库统一沉底，而不是随机插在中间。
 */
function ts(iso: string | null | undefined): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

/**
 * 排序但不改原数组。同值时按 full_name 兜底，
 * 保证多次渲染顺序稳定（否则每次刷新顺序抖动，看着像加载失败）。
 */
export function sortRepos(repos: Repo[], sort: RepoSort): Repo[] {
  const copy = [...repos]
  const byName = (a: Repo, b: Repo) => a.full_name.localeCompare(b.full_name)

  switch (sort) {
    case 'name':
      return copy.sort(byName)
    case 'stars':
      return copy.sort(
        (a, b) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0) || byName(a, b),
      )
    case 'created':
      return copy.sort((a, b) => ts(b.created_at) - ts(a.created_at) || byName(a, b))
    case 'updated':
      return copy.sort((a, b) => ts(b.updated_at) - ts(a.updated_at) || byName(a, b))
    case 'pushed':
    default:
      return copy.sort((a, b) => ts(b.pushed_at) - ts(a.pushed_at) || byName(a, b))
  }
}
