/**
 * 仓库置顶（收藏）。
 *
 * 纯本地功能：只往 KV 里写一串 `owner/repo`，不碰 GitHub 接口，不烧配额。
 * 置顶排在最前面，其余保持原来的排序 —— 用户钉它就是为了「一眼看到」，
 * 而不是为了改整个列表的秩序。
 *
 * 键按账号分片：换个账号看到的是自己的置顶，不会把 A 的仓库钉在 B 的列表里。
 */

export const PINS_KEY = 'ghx.pins'

/** 按账号分片：A 账号钉的仓库不该出现在 B 账号的列表顶上 */
export function pinKey(accountId: string): string {
  return `${PINS_KEY}.${accountId}`
}

/** 上限。超过这个数，置顶区自己就变成第二个列表了 */
export const MAX_PINS = 60

/**
 * 解析存下来的置顶列表。
 * 脏数据（不是数组、元素不是字符串、空串、超长）一律丢掉，绝不抛错 ——
 * 这里出错会让整个仓库列表打不开。
 */
export function parsePins(raw: string | null | undefined): string[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const out: string[] = []
  const seen = new Set<string>()
  for (const item of parsed) {
    if (typeof item !== 'string') continue
    const full = item.trim()
    // 只接受 owner/repo 形态，别的一律当脏数据
    if (!/^[^/\s]+\/[^/\s]+$/.test(full)) continue
    const key = full.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(full)
    if (out.length >= MAX_PINS) break
  }
  return out
}

export function serializePins(list: string[]): string {
  return JSON.stringify(list.slice(0, MAX_PINS))
}

export function isPinned(list: string[], full: string): boolean {
  const key = full.toLowerCase()
  return list.some((x) => x.toLowerCase() === key)
}

/**
 * 切换置顶状态。
 * 取消置顶时按大小写不敏感匹配，避免 `Owner/Repo` 与 `owner/repo` 各存一份。
 */
export function togglePin(list: string[], full: string): string[] {
  const key = full.toLowerCase()
  const idx = list.findIndex((x) => x.toLowerCase() === key)
  if (idx >= 0) {
    const next = [...list]
    next.splice(idx, 1)
    return next
  }
  if (list.length >= MAX_PINS) return list
  return [...list, full]
}

/**
 * 把置顶的仓库提到最前面，其余保持传入顺序。
 *
 * 置顶区内部的顺序跟着 `pins` 走（也就是添加顺序），
 * 而不是跟着当前排序 —— 换了「按 Star 排」不该把钉住的几个也打乱。
 */
export function applyPins<T extends { full_name: string }>(repos: T[], pins: string[]): T[] {
  if (pins.length === 0) return repos
  const byKey = new Map(repos.map((r) => [r.full_name.toLowerCase(), r]))
  const pinned: T[] = []
  const used = new Set<string>()
  for (const p of pins) {
    const key = p.toLowerCase()
    const repo = byKey.get(key)
    if (!repo || used.has(key)) continue
    used.add(key)
    pinned.push(repo)
  }
  if (pinned.length === 0) return repos
  return [...pinned, ...repos.filter((r) => !used.has(r.full_name.toLowerCase()))]
}

/**
 * 置顶项里有多少个已经不在当前列表（被删、转走、或筛选掉了）。
 * 用来在「置顶 N」的提示里说清楚，不然用户会以为钉的东西丢了。
 */
export function missingPins<T extends { full_name: string }>(repos: T[], pins: string[]): string[] {
  const have = new Set(repos.map((r) => r.full_name.toLowerCase()))
  return pins.filter((p) => !have.has(p.toLowerCase()))
}
