/**
 * 下载记录。
 *
 * 只存在本机（localStorage），不上传 —— 和审计日志、外观偏好同一个态度：
 * 「下载过什么」是用户自己的事，没必要让别人知道。
 *
 * 为什么记 `repo` 而不只记文件名：记录面板要能「跳回那个仓库」，
 * 光有 `ghx-0.8.7-debug.apk` 这种名字是回不去的。
 *
 * 去重规则：同一个仓库、同一个文件名、同一种类型只留最新一条。
 * 重复下载同一个包时，列表里堆十条一模一样的记录毫无用处 ——
 * 用户要看的是「最后那次成没成」。
 */

import type { DownloadKind } from './download'

const KEY = 'ghx.dl.history'
/** 再多也没人翻，60 条足够覆盖「最近装过什么」 */
export const HISTORY_LIMIT = 60

export type DlStatus = 'done' | 'failed' | 'canceled'

export interface DlRecord {
  /** 由 repo + kind + name 拼成，既是去重键也是 React key */
  id: string
  /** 毫秒时间戳 */
  at: number
  /** 来源仓库 full_name，空串表示不知道（不该发生，兜底用） */
  repo: string
  name: string
  kind: DownloadKind
  /** 服务器声明的大小，0 未知 */
  size: number
  /** 实际落盘字节，失败/取消时是已下到的部分 */
  bytes: number
  status: DlStatus
  path?: string
  tag?: string
  error?: string
}

const KINDS: DownloadKind[] = ['apk', 'asset', 'archive', 'artifact']

export function recordId(repo: string, kind: DownloadKind, name: string): string {
  return `${repo}|${kind}|${name}`.toLowerCase()
}

function isKind(v: unknown): v is DownloadKind {
  return typeof v === 'string' && (KINDS as string[]).includes(v)
}

function isStatus(v: unknown): v is DlStatus {
  return v === 'done' || v === 'failed' || v === 'canceled'
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

/**
 * 容错解析。旧版本写的记录、手动改坏的内容、将来加了字段的记录，
 * 都只丢坏的那一条，不能让整块面板空白。
 */
export function parseHistory(raw: string | null | undefined): DlRecord[] {
  if (!raw) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []

  const out: DlRecord[] = []
  const seen = new Set<string>()
  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const repo = str(o.repo)
    const name = str(o.name)
    if (!name) continue
    if (!isKind(o.kind) || !isStatus(o.status)) continue
    const at = num(o.at)
    if (at <= 0) continue
    const id = str(o.id) || recordId(repo, o.kind, name)
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      at,
      repo,
      name,
      kind: o.kind,
      size: num(o.size),
      bytes: num(o.bytes),
      status: o.status,
      ...(str(o.path) ? { path: str(o.path) } : {}),
      ...(str(o.tag) ? { tag: str(o.tag) } : {}),
      ...(str(o.error) ? { error: str(o.error) } : {}),
    })
  }
  // 存储里的顺序理论上就是最新在前，但外部写坏过就不好说，统一按时间排一次
  return out.sort((a, b) => b.at - a.at).slice(0, HISTORY_LIMIT)
}

/** 新记录插到最前；同 id 的旧记录被顶掉（不是追加） */
export function pushRecord(list: DlRecord[], rec: DlRecord, limit = HISTORY_LIMIT): DlRecord[] {
  const rest = list.filter((r) => r.id !== rec.id)
  return [rec, ...rest].slice(0, Math.max(1, limit))
}

export function makeRecord(o: {
  repo: string
  name: string
  kind: DownloadKind
  size?: number
  bytes?: number
  status: DlStatus
  path?: string
  tag?: string
  error?: string
  at?: number
}): DlRecord {
  return {
    id: recordId(o.repo, o.kind, o.name),
    at: o.at ?? Date.now(),
    repo: o.repo,
    name: o.name,
    kind: o.kind,
    size: o.size ?? 0,
    bytes: o.bytes ?? 0,
    status: o.status,
    ...(o.path ? { path: o.path } : {}),
    ...(o.tag ? { tag: o.tag } : {}),
    ...(o.error ? { error: o.error } : {}),
  }
}

/** 去掉一整条记录（用户在面板里左滑/点叉时用；当前只有「清空」） */
export function removeRecord(list: DlRecord[], id: string): DlRecord[] {
  return list.filter((r) => r.id !== id)
}

/* ---------------- 待认领的结果 ---------------- */

/**
 * 原生留下的「这次下载结束了，但界面没来得及记」的原始 JSON。
 *
 * 放在 dl-history 而不是 native-download：这里是纯解析，不该为了跑单测
 * 去 import 一个依赖 Capacitor 运行时的模块。
 */
export interface PendingDownload {
  repo: string
  kind: DownloadKind
  tag?: string
  name: string
  ok: boolean
  bytes: number
  ms: number
  at: number
  path?: string
  error?: string
}

/** 解析待认领结果。字段缺失按「不知道」处理，只有文件名是硬要求 */
export function parsePendingDownload(raw: string | null | undefined): PendingDownload | null {
  if (!raw) return null
  let o: Record<string, unknown>
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    o = data as Record<string, unknown>
  } catch {
    return null
  }
  const name = str(o.name)
  if (!name) return null
  const kind = isKind(o.kind) ? o.kind : 'asset'
  return {
    repo: str(o.repo),
    kind,
    name,
    ok: o.ok === true,
    bytes: num(o.bytes),
    ms: num(o.ms),
    at: num(o.at) || Date.now(),
    ...(str(o.tag) ? { tag: str(o.tag) } : {}),
    ...(str(o.path) ? { path: str(o.path) } : {}),
    ...(str(o.error) ? { error: str(o.error) } : {}),
  }
}

/** 待认领结果 → 历史记录 */
export function recordFromPending(p: PendingDownload): DlRecord {
  return makeRecord({
    repo: p.repo,
    name: p.name,
    kind: p.kind,
    tag: p.tag,
    bytes: p.bytes,
    status: p.ok ? 'done' : 'failed',
    at: p.at,
    ...(p.path ? { path: p.path } : {}),
    ...(p.error ? { error: p.error } : {}),
  })
}

/* ---------------- 读写 ---------------- */

export function readHistory(): DlRecord[] {
  try {
    return parseHistory(globalThis.localStorage?.getItem(KEY))
  } catch {
    /* 隐私模式下读都可能抛 */
    return []
  }
}

export function writeHistory(list: DlRecord[]): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(list.slice(0, HISTORY_LIMIT)))
  } catch {
    /* 写不进去不影响本次下载 */
  }
}

export function clearHistory(): void {
  try {
    globalThis.localStorage?.removeItem(KEY)
  } catch {
    /* 同上 */
  }
}

/** 追加一条并立即落盘，返回新列表供界面同步 */
export function appendRecord(rec: DlRecord): DlRecord[] {
  const next = pushRecord(readHistory(), rec)
  writeHistory(next)
  return next
}

/* ---------------- 展示 ---------------- */

/**
 * 相对时间：今天只写时刻，昨天写「昨天」，更早写日期。
 * 下载记录看的是「多久以前」，不是精确到秒。
 */
export function historyTime(at: number, now = Date.now()): string {
  if (!Number.isFinite(at) || at <= 0) return '—'
  const d = new Date(at)
  const n = new Date(now)
  const pad = (v: number) => String(v).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

  if (sameDay(d, n)) return hm
  const yesterday = new Date(now - 24 * 3600 * 1000)
  if (sameDay(d, yesterday)) return `昨天 ${hm}`
  if (d.getFullYear() === n.getFullYear()) return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}

export const KIND_LABEL: Record<DownloadKind, string> = {
  apk: '安装包',
  asset: '发行版附件',
  archive: '源码 ZIP',
  artifact: 'CI 产物',
}

export const STATUS_LABEL: Record<DlStatus, string> = {
  done: '已完成',
  failed: '失败',
  canceled: '已取消',
}
