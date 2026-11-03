import type { KV } from './storage'

/**
 * 冷启动快照。
 *
 * 缓存层（cache.ts）活在内存里，进程一被杀就没了，所以每次冷启动都要
 * 重新拉 6 页仓库列表，界面空转好几秒。这里把列表落到 Preferences/localStorage，
 * 下次启动先拿旧数据渲染，同时后台刷新 —— 打开就有内容，不闪空白。
 */

/** 超过这个时长的快照不再展示，免得把一周前的状态当成现状 */
export const SNAPSHOT_MAX_AGE = 7 * 24 * 60 * 60 * 1000

export interface Snapshot<T> {
  /** 写入时间（毫秒） */
  at: number
  /** 归属令牌，避免换号后串数据 */
  tokenId: string
  data: T
}

export function snapshotKey(kind: string, tokenId: string): string {
  return `ghx.snap.${kind}.${tokenId}`
}

/** 存入快照。失败不该影响主流程，所以吞掉异常只返回 false */
export async function saveSnapshot<T>(
  kv: KV,
  kind: string,
  tokenId: string,
  data: T,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const payload: Snapshot<T> = { at: now, tokenId, data }
    await kv.set(snapshotKey(kind, tokenId), JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

/**
 * 读取快照。以下情况一律当没有：解析失败、令牌对不上、超过保留时长。
 * 宁可多等一次网络，也不要把别账号的数据渲染出来。
 */
export async function loadSnapshot<T>(
  kv: KV,
  kind: string,
  tokenId: string,
  now: number = Date.now(),
  maxAge: number = SNAPSHOT_MAX_AGE,
): Promise<{ data: T; at: number } | null> {
  try {
    const raw = await kv.get(snapshotKey(kind, tokenId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Snapshot<T>
    if (!parsed || typeof parsed.at !== 'number' || parsed.tokenId !== tokenId) return null
    if (!parsed.data) return null
    if (now - parsed.at > maxAge) return null
    // 时间在未来说明设备时钟被改过，同样不采信
    if (parsed.at - now > 60_000) return null
    return { data: parsed.data, at: parsed.at }
  } catch {
    return null
  }
}

export async function clearSnapshot(kv: KV, kind: string, tokenId: string): Promise<void> {
  try {
    await kv.remove(snapshotKey(kind, tokenId))
  } catch {
    /* 清不掉也不影响使用 */
  }
}

/** 快照年龄，用于界面提示「显示的是 X 前的数据」 */
export function snapshotAge(at: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - at)
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}
