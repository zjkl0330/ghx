/**
 * 底栏配置。
 *
 * 令牌与设置已经挪进个人页，底栏不再需要六个格子。
 * 剩下的页签让用户自己勾：常用三个（仓库 / 星标 / 热门）默认全开，
 * 流水线默认收起、需要时再放到底栏。
 */

export type TabKey = 'repos' | 'stars' | 'hot' | 'pipelines'

/** 底栏页签图标：统一用实心版，选中只换颜色 —— 线条在玻璃上重量不够，远看只是一团雾 */
type TabIcon = 'repoFill' | 'starOn' | 'flameOn' | 'pipelinesOn'

export const TAB_DEFS: { key: TabKey; label: string; icon: TabIcon }[] = [
  { key: 'repos', label: '仓库', icon: 'repoFill' },
  { key: 'stars', label: '星标', icon: 'starOn' },
  { key: 'hot', label: '热门', icon: 'flameOn' },
  { key: 'pipelines', label: '流水线', icon: 'pipelinesOn' },
]

export const DEFAULT_TABS: TabKey[] = ['repos', 'stars', 'hot']

/**
 * 归一化：去掉脏值、去重、按固定顺序排。
 * 至少留一个 —— 底栏空掉的话用户就没法导航了。
 */
export function normalizeTabs(raw: string | null | undefined): TabKey[] {
  if (!raw) return [...DEFAULT_TABS]
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return [...DEFAULT_TABS]
  }
  if (!Array.isArray(parsed)) return [...DEFAULT_TABS]
  const picked = TAB_DEFS.map((t) => t.key).filter((k) => parsed.includes(k)) as TabKey[]
  return picked.length > 0 ? picked : [...DEFAULT_TABS]
}

/** 勾选或取消一个页签；取消最后一个时保持原样，避免底栏空掉 */
export function toggleTab(list: TabKey[], key: TabKey): TabKey[] {
  if (list.includes(key)) {
    if (list.length <= 1) return list
    return list.filter((k) => k !== key)
  }
  return TAB_DEFS.map((t) => t.key).filter((k) => k === key || list.includes(k)) as TabKey[]
}

/**
 * 当前页签被隐藏时，退回到第一个可见的「内容页」。
 * 流水线是二级页面，不作为底栏页签内容渲染，所以不能选它当 tab。
 */
export function fallbackTab(list: TabKey[], current: TabKey): TabKey {
  const content: TabKey[] = list.filter((k) => k !== 'pipelines')
  if (content.includes(current)) return current
  return content[0] ?? 'repos'
}
