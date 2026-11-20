/**
 * 仓库列表上的「有 APK / 有 EXE」标记。
 *
 * 列表接口（`/user/repos`）只给仓库元数据，不含发行版资产，所以「这个仓库
 * 有没有安装包」必须另查一次 `/releases`。一次请求一个仓库，成本不低，
 * 因此整条链路按「可见才查、查过就存、24 小时内不再查」来做：
 *
 * - 只对当前列表里的仓库发起（用户翻到哪页就查哪页）；
 * - 结果按 `令牌 + 仓库` 存本地，换号不串、退出登录不误删；
 * - 过期时间 24 小时：发不发版是低频事件，半天的新鲜度已经够。
 *
 * 游客不查：匿名配额 60 次/小时，一页 25 个仓库就把额度吃光，
 * 热门与搜索会跟着一起挂。这是刻意的取舍 —— 没令牌时看不到这两个标记。
 */

import type { KV } from './storage'
import type { Release } from './types'

export type PkgKind = 'apk' | 'exe'

/** 顺序即展示顺序：手机上装 APK 更相关，所以 apk 在前 */
export const PKG_KINDS: PkgKind[] = ['apk', 'exe']

/** 一次探测的结果保留多久 */
export const BADGE_TTL = 24 * 60 * 60 * 1000

export const BADGE_KEY_PREFIX = 'ghx.badge.'

/** 一次最多看多少个 release：发版频繁的仓库不必翻到底 */
export const BADGE_RELEASE_PAGE = 10

/** 单轮最多并发几个请求。串行太慢，放开又容易撞二级限流 */
export const BADGE_CONCURRENCY = 3

export function isPkgKind(v: unknown): v is PkgKind {
  return v === 'apk' || v === 'exe'
}

/** 只看后缀，不看 content_type：同一个包在不同仓库的 type 经常是空的 */
export function kindOfAsset(name: string): PkgKind | null {
  const s = (name ?? '').trim().toLowerCase()
  if (!s) return null
  if (s.endsWith('.apk')) return 'apk'
  if (s.endsWith('.exe')) return 'exe'
  return null
}

/** 资产名 → 徽标。同一个仓库既有 apk 又有 exe 时两个都返回 */
export function badgesOfAssets(names: string[]): PkgKind[] {
  const set = new Set<PkgKind>()
  for (const n of names) {
    const k = kindOfAsset(n)
    if (k) set.add(k)
  }
  return PKG_KINDS.filter((k) => set.has(k))
}

/**
 * release 列表 → 徽标。
 *
 * 草稿不算（草稿只有自己看得见，装了也下不到）；预发布算 —— 用户要判断的是
 * 「这个仓库有没有能装的包」，不是「有没有正式版」。
 */
export function badgesOfReleases(list: Pick<Release, 'draft' | 'assets'>[]): PkgKind[] {
  const names: string[] = []
  for (const r of list ?? []) {
    if (!r || r.draft) continue
    for (const a of r.assets ?? []) names.push(a?.name ?? '')
  }
  return badgesOfAssets(names)
}

export interface BadgeEntry {
  /** 写入时间（毫秒） */
  at: number
  kinds: PkgKind[]
}

/** 缓存键带上令牌 id：不同账号看到的 release 不同，混用会张冠李戴 */
export function badgeKey(tokenId: string, fullName: string): string {
  const id = (tokenId || '').trim() || 'anon'
  return `${BADGE_KEY_PREFIX}${id}.${(fullName || '').trim().toLowerCase()}`
}

/** 脏数据一律当没有，不能让一条坏记录把整页标记打歪 */
export function parseBadge(raw: string | null | undefined): BadgeEntry | null {
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as Partial<BadgeEntry>
    const at = Number(d.at)
    if (!Number.isFinite(at) || at <= 0) return null
    const kinds = (Array.isArray(d.kinds) ? d.kinds : []).filter(isPkgKind)
    return { at, kinds: PKG_KINDS.filter((k) => kinds.includes(k)) }
  } catch {
    return null
  }
}

export function serializeBadge(e: BadgeEntry): string {
  return JSON.stringify({ at: e.at, kinds: e.kinds })
}

export function badgeFresh(e: BadgeEntry | null | undefined, now = Date.now()): boolean {
  if (!e) return false
  const age = now - e.at
  return age >= 0 && age < BADGE_TTL
}

export interface BadgeProbeInput {
  kv: KV | null
  tokenId: string
  fullName: string
  /** 真正发请求的那一步，由调用方注入，纯逻辑部分不碰 client */
  fetchReleases: () => Promise<Pick<Release, 'draft' | 'assets'>[]>
  now?: () => number
}

/**
 * 查一个仓库的徽标：先看本地缓存，过期或缺失才发请求。
 * 请求失败不写缓存，也不抛错 —— 列表上少一个标记比弹一个错误条好。
 */
export async function loadBadges(o: BadgeProbeInput): Promise<PkgKind[]> {
  const now = o.now ?? Date.now
  const key = badgeKey(o.tokenId, o.fullName)
  if (o.kv) {
    const cached = parseBadge(await o.kv.get(key).catch(() => null))
    if (badgeFresh(cached, now())) return cached?.kinds ?? []
  }
  const list = await o.fetchReleases()
  const kinds = badgesOfReleases(list)
  if (o.kv) {
    await o.kv.set(key, serializeBadge({ at: now(), kinds })).catch(() => undefined)
  }
  return kinds
}

/** 本地已缓存且未过期的那部分，用来在请求回来之前先把大多数行填上 */
export async function readCachedBadges(
  kv: KV | null,
  tokenId: string,
  fullNames: string[],
  now = Date.now(),
): Promise<Record<string, PkgKind[]>> {
  const out: Record<string, PkgKind[]> = {}
  if (!kv) return out
  for (const name of fullNames) {
    const hit = parseBadge(await kv.get(badgeKey(tokenId, name)).catch(() => null))
    if (hit && badgeFresh(hit, now) && hit.kinds.length > 0) out[name] = hit.kinds
  }
  return out
}

export interface BadgeQueueInput {
  names: string[]
  concurrency?: number
  /** 单个仓库的处理；返回 null 表示这次跳过（例如已被别处填上） */
  probe: (fullName: string) => Promise<PkgKind[] | null>
  onEach: (fullName: string, kinds: PkgKind[] | null) => void
  /** 组件卸载后仍可能回包，靠它决定要不要落地 */
  isAlive?: () => boolean
}

/**
 * 有界并发跑一批探测。
 *
 * 不用 Promise.all：25 个仓库同时打过去，GitHub 的二级限流会挑几个回 403，
 * 表现成「有的仓库有标记、有的没有」，看起来像随机。
 */
export async function runBadgeQueue(o: BadgeQueueInput): Promise<void> {
  const names = o.names.filter(Boolean)
  const limit = Math.max(1, Math.min(6, o.concurrency ?? BADGE_CONCURRENCY))
  let cursor = 0

  async function worker() {
    for (;;) {
      const i = cursor
      cursor += 1
      if (i >= names.length) return
      if (o.isAlive && !o.isAlive()) return
      const name = names[i]
      let kinds: PkgKind[] | null = null
      try {
        kinds = await o.probe(name)
      } catch {
        kinds = null
      }
      if (o.isAlive && !o.isAlive()) return
      o.onEach(name, kinds)
    }
  }

  const workers = Array.from({ length: Math.min(limit, names.length) }, () => worker())
  await Promise.all(workers)
}
