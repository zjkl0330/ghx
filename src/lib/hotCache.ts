/**
 * 热门榜单的本地缓存。
 *
 * 热门是拿 search 接口现算的（`created:>=… stars:>=10` 再按日均涨星重排），
 * 一次往返 1–3 秒。在「今日 / 本周 / 本月」和语言之间来回点，每次都要重来一遍，
 * 所以按 (range, lang) 存一份：
 *
 * - L0：模块级 Map。切页签回来是同步取，0 延迟；
 * - L1：Preferences / localStorage。冷启动也能先渲染再后台刷新。
 *
 * 存的是**过滤后的公开仓库**。私有仓库的名字和简介属于账号数据，
 * 保险库把令牌加密放着，却把私有仓库明文写进设备存储，等于白加密。
 */

import { TRENDING_RANGES, type TrendingRange } from './trending'
import type { KV } from './storage'
import type { Repo } from './types'

/** 这个时长内直接当有效数据用，连请求都不发：热门榜一分钟内不会变出第二副样子 */
export const HOT_FRESH = 10 * 60_000

/** 超过这个时长就不再展示。热门时效性强，三天前的榜单留着只会误导 */
export const HOT_MAX_AGE = 3 * 24 * 60 * 60_000

/** 最多留几份快照：3 个时间段 × 常用语言，再多就是浪费设备存储 */
export const HOT_MAX_ENTRIES = 9

/** 与列表页一致的每页条数 */
export const HOT_PAGE_SIZE = 30

export interface HotEntry {
  /** 写入时间（毫秒） */
  at: number
  /** 归属令牌，换号后不串数据 */
  tokenId: string
  repos: Repo[]
}

export interface HotPref {
  range: TrendingRange
  lang: string | null
}

/** 组合键：`week|*` 这种形式，只用于内存索引与日志，不做解析 */
export function hotKey(range: TrendingRange, lang: string | null): string {
  return `${range}|${lang ?? '*'}`
}

export function isTrendingRange(v: unknown): v is TrendingRange {
  return typeof v === 'string' && (TRENDING_RANGES as string[]).includes(v)
}

function entryStorageKey(tokenId: string, range: TrendingRange, lang: string | null): string {
  return `ghx.hot.v1.${tokenId}.${range}.${lang ?? '*'}`
}

function indexStorageKey(tokenId: string): string {
  return `ghx.hot.v1.idx.${tokenId}`
}

function prefStorageKey(tokenId: string): string {
  return `ghx.hot.pref.${tokenId}`
}

/**
 * 落盘前过一遍：私有 / 停用仓库不写，权限位也不写（那是详情页才需要的）。
 * 不修改入参，返回新数组。
 */
export function sanitizeHotRepos(repos: Repo[]): Repo[] {
  return repos
    .filter((r) => r && typeof r.full_name === 'string' && !r.private && !r.disabled)
    .slice(0, HOT_PAGE_SIZE)
    .map((r) => {
      const { permissions: _drop, ...rest } = r
      return rest
    })
}

/** 单条快照的合法性：令牌对得上、时间在可接受区间、至少是个数组 */
export function parseHotEntry(
  raw: string | null,
  tokenId: string,
  now: number = Date.now(),
  maxAge: number = HOT_MAX_AGE,
): HotEntry | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as HotEntry
    if (!parsed || typeof parsed !== 'object') return null
    if (parsed.tokenId !== tokenId) return null
    if (typeof parsed.at !== 'number' || !Number.isFinite(parsed.at)) return null
    if (!Array.isArray(parsed.repos)) return null
    const age = now - parsed.at
    if (age < 0 || age > maxAge) return null
    return { at: parsed.at, tokenId, repos: sanitizeHotRepos(parsed.repos) }
  } catch {
    return null
  }
}

/** 索引项：key + 时间，用来做 LRU 淘汰 */
export interface HotIndexItem {
  k: string
  at: number
}

/**
 * 合并索引并按时间留下最新的 max 条。
 * 同一个 key 重复出现只留最新那条；drop 里的 key 由调用方负责删值。
 */
export function mergeHotIndex(
  current: HotIndexItem[],
  add: HotIndexItem,
  max: number = HOT_MAX_ENTRIES,
): { keep: HotIndexItem[]; drop: HotIndexItem[] } {
  const map = new Map<string, HotIndexItem>()
  for (const item of current) {
    if (item && typeof item.k === 'string' && typeof item.at === 'number') map.set(item.k, item)
  }
  map.set(add.k, add)
  const sorted = [...map.values()].sort((a, b) => b.at - a.at)
  return { keep: sorted.slice(0, max), drop: sorted.slice(max) }
}

export function parseHotIndex(raw: string | null): HotIndexItem[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as HotIndexItem[]) : []
  } catch {
    return []
  }
}

/** 上次选的筛选条件。同步的那份在内存里，冷启动才读设备存储 */
const prefMemory = new Map<string, HotPref>()

export function rememberHotPref(tokenId: string, pref: HotPref): void {
  prefMemory.set(tokenId, pref)
}

export function recallHotPref(tokenId: string): HotPref | null {
  return prefMemory.get(tokenId) ?? null
}

export function parseHotPref(raw: string | null): HotPref | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<HotPref>
    if (!isTrendingRange(parsed.range)) return null
    // 老版本可能只存了 range，lang 缺失按「全部语言」处理
    const lang = parsed.lang ?? null
    if (lang !== null && (typeof lang !== 'string' || lang.length > 32)) return null
    return { range: parsed.range, lang }
  } catch {
    return null
  }
}

export async function loadHotPref(kv: KV | null, tokenId: string): Promise<HotPref | null> {
  if (!kv) return recallHotPref(tokenId)
  try {
    const pref = parseHotPref(await kv.get(prefStorageKey(tokenId)))
    if (pref) rememberHotPref(tokenId, pref)
    return pref
  } catch {
    return null
  }
}

export async function saveHotPref(kv: KV | null, tokenId: string, pref: HotPref): Promise<void> {
  rememberHotPref(tokenId, pref)
  if (!kv) return
  try {
    await kv.set(prefStorageKey(tokenId), JSON.stringify(pref))
  } catch {
    /* 记不住偏好不影响使用，下次默认本周 */
  }
}

/* ------------------------------- L0 内存 ------------------------------- */

const memory = new Map<string, HotEntry>()
const MEMORY_MAX = HOT_MAX_ENTRIES * 2

function memKey(tokenId: string, range: TrendingRange, lang: string | null): string {
  return `${tokenId}::${hotKey(range, lang)}`
}

export function peekHot(
  tokenId: string | null,
  range: TrendingRange,
  lang: string | null,
): HotEntry | null {
  if (!tokenId) return null
  return memory.get(memKey(tokenId, range, lang)) ?? null
}

export function putHot(
  tokenId: string,
  range: TrendingRange,
  lang: string | null,
  entry: HotEntry,
): void {
  const key = memKey(tokenId, range, lang)
  memory.delete(key)
  memory.set(key, entry)
  while (memory.size > MEMORY_MAX) {
    const oldest = memory.keys().next()
    if (oldest.done) break
    memory.delete(oldest.value)
  }
}

/** 换号 / 登出时清掉，避免另一个账号看到上一份榜单 */
export function clearHotMemory(): void {
  memory.clear()
  prefMemory.clear()
}

/* ------------------------------ L1 设备存储 ----------------------------- */

/** 读-改-写索引会互相覆盖，这里串成一条链 */
let chain: Promise<void> = Promise.resolve()

function enqueue(task: () => Promise<void>): Promise<void> {
  chain = chain.then(task, task)
  return chain
}

export async function saveHotEntry(
  kv: KV | null,
  tokenId: string,
  range: TrendingRange,
  lang: string | null,
  repos: Repo[],
  now: number = Date.now(),
): Promise<void> {
  const clean = sanitizeHotRepos(repos)
  const entry: HotEntry = { at: now, tokenId, repos: clean }
  putHot(tokenId, range, lang, entry)
  if (!kv) return

  await enqueue(async () => {
    const key = entryStorageKey(tokenId, range, lang)
    try {
      await kv.set(key, JSON.stringify(entry))
      const index = parseHotIndex(await kv.get(indexStorageKey(tokenId)))
      const { keep, drop } = mergeHotIndex(index, { k: key, at: now })
      await kv.set(indexStorageKey(tokenId), JSON.stringify(keep))
      for (const item of drop) {
        if (item.k !== key) await kv.remove(item.k)
      }
    } catch {
      /* 存不下（配额满 / 序列化失败）就算了，内存那份还在 */
    }
  })
}

export async function loadHotEntry(
  kv: KV | null,
  tokenId: string,
  range: TrendingRange,
  lang: string | null,
  now: number = Date.now(),
): Promise<HotEntry | null> {
  const hit = peekHot(tokenId, range, lang)
  if (hit) return hit
  if (!kv) return null
  try {
    const entry = parseHotEntry(
      await kv.get(entryStorageKey(tokenId, range, lang)),
      tokenId,
      now,
    )
    if (entry) putHot(tokenId, range, lang, entry)
    return entry
  } catch {
    return null
  }
}

/** 清掉某个令牌下的全部热门缓存（退出登录 / 删除账号时用） */
export async function clearHotCache(kv: KV | null, tokenId: string): Promise<void> {
  for (const key of [...memory.keys()]) {
    if (key.startsWith(`${tokenId}::`)) memory.delete(key)
  }
  prefMemory.delete(tokenId)
  if (!kv) return
  await enqueue(async () => {
    try {
      const index = parseHotIndex(await kv.get(indexStorageKey(tokenId)))
      for (const item of index) await kv.remove(item.k)
      await kv.remove(indexStorageKey(tokenId))
      await kv.remove(prefStorageKey(tokenId))
    } catch {
      /* 清不掉不影响使用 */
    }
  })
}
