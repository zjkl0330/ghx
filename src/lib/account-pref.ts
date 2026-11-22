/**
 * 账号级偏好：每个账号各记各的现场，重启也还在。
 *
 * v0.7.6 起切账号会保留「停在哪个页面、筛了什么、钉了哪些仓库」，但那份
 * 现场只活在内存里 —— 关掉 App 再开，几个账号的现场一起归零。用户说的
 * 「多账号偏好」就是这件事：切回来该接着上次看，而不是每次都从头翻。
 *
 * 这里只做两件事：
 * 1. 读写的白名单校验（存进去的东西可能来自旧版本 / 手改，不能让一个坏
 *    字段把整页路由炸掉）；
 * 2. 上限裁剪（历史太长、仓库快照太大，恢复回来反而像卡死）。
 * 不碰 React、不碰网络，单测直接喂字符串。
 */

import type { RepoFilterVisibility } from './repos'
import type { Route } from './routes'
import type { RepoSort } from './sort'
import { normalizeSort } from './sort'
import type { KV } from './storage'
import type { Repo } from './types'
import type { Workspace } from './workspace'
import { emptyWorkspace } from './workspace'

/**
 * 多账号批量操作（Star / 复刻）默认勾几个账号。
 * 0 表示「全部可用账号」—— 与 v1.1.0 之前的行为一致，升级上来不会变。
 */
export type MultiCount = 0 | 1 | 2 | 3

export const MULTI_COUNT_LABEL: Record<MultiCount, string> = {
  0: '全部',
  1: '1 个',
  2: '2 个',
  3: '3 个',
}

export interface AccountPref {
  /** 切回某个账号时恢复上次停的位置；关掉就每次回首页 */
  keepWorkspace: boolean
  /** Star / 复刻时默认勾几个账号；0 = 全部 */
  multiCount: MultiCount
}

export const ACCOUNT_PREF_KEY = 'ghx.acct.pref'
export const DEFAULT_ACCOUNT_PREF: AccountPref = { keepWorkspace: true, multiCount: 0 }

/** 只认 0/1/2/3，其余（旧版本没有这个字段、手改坏了）退回「全部」 */
export function parseMultiCount(v: unknown): MultiCount {
  return v === 1 || v === 2 || v === 3 ? v : 0
}

export function parseAccountPref(raw: string | null | undefined): AccountPref {
  if (!raw) return { ...DEFAULT_ACCOUNT_PREF }
  try {
    const o = JSON.parse(raw) as { keepWorkspace?: unknown; multiCount?: unknown }
    if (!o || typeof o !== 'object') return { ...DEFAULT_ACCOUNT_PREF }
    return {
      keepWorkspace:
        typeof o.keepWorkspace === 'boolean' ? o.keepWorkspace : DEFAULT_ACCOUNT_PREF.keepWorkspace,
      multiCount: parseMultiCount(o.multiCount),
    }
  } catch {
    return { ...DEFAULT_ACCOUNT_PREF }
  }
}

export function encodeAccountPref(p: AccountPref): string {
  return JSON.stringify({
    keepWorkspace: !!p.keepWorkspace,
    multiCount: parseMultiCount(p.multiCount),
  })
}

export async function readAccountPref(kv: KV | null): Promise<AccountPref> {
  if (!kv) return { ...DEFAULT_ACCOUNT_PREF }
  try {
    return parseAccountPref(await kv.get(ACCOUNT_PREF_KEY))
  } catch {
    return { ...DEFAULT_ACCOUNT_PREF }
  }
}

export async function writeAccountPref(kv: KV | null, p: AccountPref): Promise<void> {
  if (!kv) return
  try {
    await kv.set(ACCOUNT_PREF_KEY, encodeAccountPref(p))
  } catch {
    /* 存不下就用本次会话里的值 */
  }
}

/* ── 每个账号的现场 ─────────────────────────────────────────────── */

const WS_PREFIX = 'ghx.ws.'
/** 恢复的路由层数上限：超过这个数的历史恢复回来只会让人找不到北 */
export const MAX_ROUTES = 6
/** 快照最多留这么多条，列表本来就分页，恢复后还会再拉 */
export const MAX_REPOS = 80
export const MAX_PINS = 40

export function workspaceKey(id: string): string {
  return WS_PREFIX + id
}

const ROUTE_KINDS = new Set<Route['kind']>([
  'profile',
  'settings',
  'tokens',
  'audit',
  'notifications',
  'search',
  'user',
  'gists',
  'gist',
  'repo',
  'issues',
  'issue',
  'pulls',
  'pull',
  'code',
  'edit',
  'commits',
  'commit',
  'refs',
  'actions',
  'admin',
  'webOnly',
])

function isRoute(v: unknown): v is Route {
  if (!v || typeof v !== 'object') return false
  const kind = (v as { kind?: unknown }).kind
  return typeof kind === 'string' && ROUTE_KINDS.has(kind as Route['kind'])
}

function isRepo(v: unknown): v is Repo {
  if (!v || typeof v !== 'object') return false
  const r = v as { full_name?: unknown; name?: unknown }
  return typeof r.full_name === 'string' && typeof r.name === 'string'
}

function visibilityOf(v: unknown): RepoFilterVisibility {
  return v === 'public' || v === 'private' || v === 'archived' || v === 'all' ? v : 'all'
}

/** 存：只留白名单字段，免得把界面态（选中、加载中）也写进去 */
export function encodeWorkspace(ws: Workspace): string {
  const slim = {
    routeStack: ws.routeStack.slice(-MAX_ROUTES),
    repos: ws.repos.slice(0, MAX_REPOS),
    snapshotAt: ws.snapshotAt,
    query: ws.query.slice(0, 120),
    visibility: ws.visibility,
    sort: ws.sort,
    unread: ws.unread,
    pins: ws.pins.slice(0, MAX_PINS),
  }
  return JSON.stringify(slim)
}

/**
 * 读：坏字段逐个退回默认值，整份解析失败返回 null。
 * 不抛错是硬要求 —— 一个旧版本的现场不值得把启动流程打断。
 */
export function decodeWorkspace(raw: string | null | undefined): Workspace | null {
  if (!raw) return null
  let o: Partial<Workspace> & { routeStack?: unknown; repos?: unknown; pins?: unknown }
  try {
    o = JSON.parse(raw) as typeof o
  } catch {
    return null
  }
  if (!o || typeof o !== 'object') return null

  const routeStack = Array.isArray(o.routeStack) ? o.routeStack.filter(isRoute).slice(-MAX_ROUTES) : []
  const repos = Array.isArray(o.repos) ? o.repos.filter(isRepo).slice(0, MAX_REPOS) : []
  const pins = Array.isArray(o.pins)
    ? (o.pins as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, MAX_PINS)
    : []
  const snapshotAt = typeof o.snapshotAt === 'number' && Number.isFinite(o.snapshotAt) ? o.snapshotAt : null
  const unread = typeof o.unread === 'number' && Number.isFinite(o.unread) ? Math.max(0, o.unread) : 0

  // 完全空白（没路由也没列表）视为没存过，别把「空现场」写回内存表
  if (routeStack.length === 0 && repos.length === 0) return null

  return {
    ...emptyWorkspace(normalizeSort(o.sort)),
    routeStack,
    repos,
    snapshotAt,
    query: typeof o.query === 'string' ? o.query.slice(0, 120) : '',
    visibility: visibilityOf(o.visibility),
    sort: normalizeSort(o.sort as RepoSort),
    unread,
    pins,
  }
}

/** 从本机读某个账号的现场；失败一律当没存过 */
export async function loadWorkspace(kv: KV | null, id: string): Promise<Workspace | null> {
  if (!kv || !id) return null
  try {
    return decodeWorkspace(await kv.get(workspaceKey(id)))
  } catch {
    return null
  }
}

export async function persistWorkspace(
  kv: KV | null,
  id: string,
  ws: Workspace,
): Promise<void> {
  if (!kv || !id) return
  try {
    await kv.set(workspaceKey(id), encodeWorkspace(ws))
  } catch {
    /* 存不下就算了，下次切号还在内存里 */
  }
}

/** 删号时清掉那一个账号的现场，别留孤儿键 */
export async function dropWorkspaceKV(kv: KV | null, id: string): Promise<void> {
  if (!kv || !id) return
  try {
    await kv.remove(workspaceKey(id))
  } catch {
    /* 删不掉不影响主流程 */
  }
}
