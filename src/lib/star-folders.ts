/**
 * 星标文件夹。
 *
 * 纯本地：只把「哪个仓库放在哪个文件夹」写进 KV，不碰 GitHub 接口，不烧配额。
 * 一个仓库最多属于一个文件夹 —— 多归属听起来灵活，实际会让「未分类」的语义烂掉，
 * 用户也说不清「我从这个文件夹里取消了，为什么它还在那个文件夹里」。
 *
 * 键按账号分片：A 账号分的组不该出现在 B 账号的侧栏里。
 *
 * 这里所有函数都是纯函数，脏数据一律吞掉不抛错 —— 解析失败最多是没有文件夹，
 * 不能让整个星标页打不开。
 */

export const STAR_FOLDERS_KEY = 'ghx.starfolders'

/** 上限。再多，横向的文件夹条就变成第二层导航了 */
export const MAX_FOLDERS = 20
/** 文件夹名上限，超过这个长度 chips 会把它撑成一整行 */
export const MAX_FOLDER_NAME = 24
/** 归类记录上限，防止脏数据把 KV 写爆 */
export const MAX_ASSIGN = 5000

export interface StarFolder {
  id: string
  name: string
}

export interface StarFolderStore {
  folders: StarFolder[]
  /** `owner/repo`（小写）→ 文件夹 id；没有条目就是未分类 */
  assign: Record<string, string>
}

/** `all` 全部、`none` 未分类、其余是文件夹 id */
export type FolderSelection = 'all' | 'none' | string

export function emptyStore(): StarFolderStore {
  return { folders: [], assign: {} }
}

/** 按账号分片：A 账号分的组不该出现在 B 账号的列表里 */
export function starFoldersKey(accountId: string): string {
  return `${STAR_FOLDERS_KEY}.${accountId}`
}

const FULL_RE = /^[^/\s]+\/[^/\s]+$/
const ID_RE = /^[a-z0-9_-]{1,16}$/i
const MAX_ID_TRY = 999

/** 名字清洗：压掉换行与连续空格，超长截断；清洗后为空返回 null */
export function cleanFolderName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!name) return null
  // 按码点截，别把 emoji 劈成半个
  return Array.from(name).slice(0, MAX_FOLDER_NAME).join('')
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export function parseStarFolders(raw: string | null | undefined): StarFolderStore {
  if (!raw) return emptyStore()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return emptyStore()
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyStore()
  const src = parsed as Record<string, unknown>

  const folders: StarFolder[] = []
  const seenId = new Set<string>()
  const seenName = new Set<string>()
  const list = Array.isArray(src.folders) ? src.folders : []
  for (const item of list) {
    if (folders.length >= MAX_FOLDERS) break
    if (!item || typeof item !== 'object') continue
    const it = item as Record<string, unknown>
    if (typeof it.id !== 'string' || !ID_RE.test(it.id)) continue
    const name = cleanFolderName(it.name)
    if (!name) continue
    if (seenId.has(it.id) || seenName.has(name.toLowerCase())) continue
    seenId.add(it.id)
    seenName.add(name.toLowerCase())
    folders.push({ id: it.id, name })
  }

  const assign: Record<string, string> = {}
  const rawAssign = src.assign && typeof src.assign === 'object' && !Array.isArray(src.assign)
    ? (src.assign as Record<string, unknown>)
    : {}
  let n = 0
  for (const [key, val] of Object.entries(rawAssign)) {
    if (n >= MAX_ASSIGN) break
    if (typeof val !== 'string' || !seenId.has(val)) continue
    const full = key.trim()
    if (!FULL_RE.test(full)) continue
    const lower = full.toLowerCase()
    if (lower in assign) continue
    assign[lower] = val
    n += 1
  }

  return { folders, assign }
}

export function serializeStarFolders(store: StarFolderStore): string {
  return JSON.stringify({ folders: store.folders, assign: store.assign })
}

export interface FolderOp {
  store: StarFolderStore
  ok: boolean
  /** 失败原因：空名 / 重名 / 数量到顶 / 找不到 */
  reason?: 'empty' | 'dupe' | 'full' | 'missing'
  /** 新建成功或重名时，给出那个文件夹的 id */
  id?: string
}

function nextId(folders: StarFolder[]): string | null {
  const used = new Set(folders.map((f) => f.id))
  for (let i = 1; i <= MAX_ID_TRY; i += 1) {
    const id = `f${i}`
    if (!used.has(id)) return id
  }
  return null
}

/** 新建。同名（大小写不敏感）不重复建，直接返回已有那个的 id */
export function createFolder(store: StarFolderStore, rawName: string): FolderOp {
  const name = cleanFolderName(rawName)
  if (!name) return { store, ok: false, reason: 'empty' }
  const same = store.folders.find((f) => sameName(f.name, name))
  if (same) return { store, ok: false, reason: 'dupe', id: same.id }
  if (store.folders.length >= MAX_FOLDERS) return { store, ok: false, reason: 'full' }
  const id = nextId(store.folders)
  if (!id) return { store, ok: false, reason: 'full' }
  return {
    store: { ...store, folders: [...store.folders, { id, name }] },
    ok: true,
    id,
  }
}

export function renameFolder(store: StarFolderStore, id: string, rawName: string): FolderOp {
  const name = cleanFolderName(rawName)
  if (!name) return { store, ok: false, reason: 'empty' }
  const target = store.folders.find((f) => f.id === id)
  if (!target) return { store, ok: false, reason: 'missing' }
  const dupe = store.folders.find((f) => f.id !== id && sameName(f.name, name))
  if (dupe) return { store, ok: false, reason: 'dupe', id: dupe.id }
  return {
    store: {
      ...store,
      folders: store.folders.map((f) => (f.id === id ? { ...f, name } : f)),
    },
    ok: true,
    id,
  }
}

/**
 * 删除文件夹。
 * 只取消归类，不动仓库本身 —— 用户的 star 与列表位置都不该因为整理分组而丢。
 */
export function deleteFolder(store: StarFolderStore, id: string): FolderOp {
  if (!store.folders.some((f) => f.id === id)) {
    return { store, ok: false, reason: 'missing' }
  }
  const assign: Record<string, string> = {}
  for (const [full, folderId] of Object.entries(store.assign)) {
    if (folderId !== id) assign[full] = folderId
  }
  return {
    store: { folders: store.folders.filter((f) => f.id !== id), assign },
    ok: true,
  }
}

/**
 * 归类。folderId 传 null / 空串表示移出文件夹（变回未分类）。
 * 文件夹不存在时按「未分类」处理，避免脏 id 把仓库藏起来。
 */
export function assignFolder(
  store: StarFolderStore,
  full: string,
  folderId: string | null,
): StarFolderStore {
  const key = full.trim().toLowerCase()
  if (!FULL_RE.test(key)) return store
  const assign = { ...store.assign }
  if (!folderId || !store.folders.some((f) => f.id === folderId)) {
    if (!(key in assign)) return store
    delete assign[key]
    return { ...store, assign }
  }
  if (assign[key] === folderId) return store
  assign[key] = folderId
  return { ...store, assign }
}

/** 这个仓库在哪个文件夹里；没有就是 null */
export function folderOf(store: StarFolderStore, full: string): string | null {
  return store.assign[full.trim().toLowerCase()] ?? null
}

export function folderById(store: StarFolderStore, id: string): StarFolder | null {
  return store.folders.find((f) => f.id === id) ?? null
}

export interface FolderCounts {
  all: number
  none: number
  /** 文件夹 id → 数量 */
  byId: Record<string, number>
}

/** 当前这一批仓库在每个文件夹里各有多少个（只统计传进来的，不查全量） */
export function folderCounts<T extends { full_name: string }>(
  store: StarFolderStore,
  repos: T[],
): FolderCounts {
  const byId: Record<string, number> = {}
  for (const f of store.folders) byId[f.id] = 0
  let none = 0
  for (const r of repos) {
    const id = folderOf(store, r.full_name)
    if (id && id in byId) byId[id] += 1
    else none += 1
  }
  return { all: repos.length, none, byId }
}

/**
 * 按选中的文件夹筛。
 * 选中项已经不存在（文件夹被删、或换了账号）时退回全部，不显示空白页。
 */
export function filterByFolder<T extends { full_name: string }>(
  store: StarFolderStore,
  repos: T[],
  sel: FolderSelection,
): T[] {
  if (sel === 'all') return repos
  if (sel === 'none') return repos.filter((r) => folderOf(store, r.full_name) === null)
  if (!store.folders.some((f) => f.id === sel)) return repos
  return repos.filter((r) => folderOf(store, r.full_name) === sel)
}

/* ---------- 本机读写 ---------- */

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    /* 隐私模式下访问 localStorage 本身就可能抛 */
    return null
  }
}

export function readStarFolders(accountId: string | null | undefined): StarFolderStore {
  try {
    return parseStarFolders(storage()?.getItem(starFoldersKey(accountId || 'anon')))
  } catch {
    return emptyStore()
  }
}

export function writeStarFolders(accountId: string | null | undefined, store: StarFolderStore): void {
  try {
    storage()?.setItem(starFoldersKey(accountId || 'anon'), serializeStarFolders(store))
  } catch {
    /* 写不进去也不影响本次会话 */
  }
}
