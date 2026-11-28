/**
 * 仓库详情里那串操作的顺序。
 *
 * 顺序纯本地，不分账号：它是「这个人的手指习惯」，不是账号数据。
 * 新版本加了操作（比如以后加「转移仓库」）时，旧偏好里没有这个 id，
 * 归一化会把它补在末尾 —— 不能因为漏了一个 id 就把整份偏好判成脏数据丢回默认，
 * 那样用户排好的顺序会一夜之间重置。
 */

export const ACTION_ORDER_KEY = 'ghx.repo.actionorder'

/** 12 个操作，顺序即默认顺序 */
export const DETAIL_ACTIONS = [
  'star',
  'edit',
  'archive',
  'visibility',
  'home',
  'readme',
  'workflows',
  'releases',
  'forks',
  'repo-url',
  'zip',
  'delete',
] as const

export type DetailActionId = (typeof DETAIL_ACTIONS)[number]

export const DEFAULT_ACTION_ORDER: DetailActionId[] = [...DETAIL_ACTIONS]

const KNOWN = new Set<string>(DETAIL_ACTIONS)

export function normalizeActionOrder(raw: unknown): DetailActionId[] {
  const out: DetailActionId[] = []
  const seen = new Set<string>()
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item !== 'string' || !KNOWN.has(item) || seen.has(item)) continue
      seen.add(item)
      out.push(item as DetailActionId)
    }
  }
  // 缺的补在末尾：新加的操作至少能看见，用户想挪再挪
  for (const id of DETAIL_ACTIONS) {
    if (!seen.has(id)) out.push(id)
  }
  return out
}

export function parseActionOrder(raw: string | null | undefined): DetailActionId[] {
  if (!raw) return [...DEFAULT_ACTION_ORDER]
  try {
    return normalizeActionOrder(JSON.parse(raw))
  } catch {
    return [...DEFAULT_ACTION_ORDER]
  }
}

export function serializeActionOrder(order: DetailActionId[]): string {
  return JSON.stringify(normalizeActionOrder(order))
}

/**
 * 上移 / 下移一格。到头就原样返回（返回同一引用，调用方可以据此判断有没有变）。
 */
export function moveAction(
  order: DetailActionId[],
  id: DetailActionId,
  delta: -1 | 1,
): DetailActionId[] {
  const i = order.indexOf(id)
  if (i < 0) return order
  const j = i + delta
  if (j < 0 || j >= order.length) return order
  const next = [...order]
  const [item] = next.splice(i, 1)
  next.splice(j, 0, item)
  return next
}

/* ---------- 本机读写 ---------- */

export function readActionOrder(): DetailActionId[] {
  try {
    return parseActionOrder(globalThis.localStorage?.getItem(ACTION_ORDER_KEY))
  } catch {
    return [...DEFAULT_ACTION_ORDER]
  }
}

export function writeActionOrder(order: DetailActionId[]): void {
  try {
    globalThis.localStorage?.setItem(ACTION_ORDER_KEY, serializeActionOrder(order))
  } catch {
    /* 写不进去也不影响本次会话 */
  }
}
