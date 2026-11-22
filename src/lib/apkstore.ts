/**
 * APK 商店（热门页的应用区块）。
 *
 * 数据不是 GitHub API，而是 komi-store（原 GitHub Store）项目维护的公开精选目录：
 * 它把每天轮换一次的安卓应用清单缓存在 `komi-store-backend-data` 仓库里，
 * 拉一份 raw JSON 就能拿到 150 个「以 Release APK 分发」的应用，
 * 不需要令牌、不占 api.github.com 配额 —— 游客也能看，与热门页
 * 「公开数据匿名可看」的定位一致。每条都带 latestReleaseTag
 * （2026-11-20 核实：150/150 非空、hasInstallersAndroid 全真），
 * 点进仓库详情就能走现有的发行版下载链路，不在 App 里另起炉灶。
 *
 * 源头是 raw.githubusercontent.com，国内直连经常不通，所以候选线路
 * 与下载同一套思路：用户自己填的站排在队首（它还会顺手把 feed 里的
 * avatars.githubusercontent.com 改写成可直连的镜像域名，等于头像也白捡一层加速），
 * 官方 raw 殿后。包里不带任何第三方代理地址，没填就只剩官方一条。
 * JSON 每天只变一次，落盘缓存 6 小时内不再发请求。
 */

import { BUILTIN_MIRRORS, mirrorRegistry, rawUrlAt, selfMirrorBase } from './mirrors'
import type { KV } from './storage'
import type { Repo } from './types'

/** komi-store-backend-data 仓库里的 feed 文件（按优先级合并，去重保序） */
const FEED_OWNER = 'komi-store'
const FEED_REPO = 'komi-store-backend-data'
const FEED_REF = 'main'
/** 每日轮换精选（150 条恒有 tag）、最热门榜（~143 按星排序）、新发行榜（~43）。
 *  只用轮换精选时目录每天就 150 个应用，用户嫌少 —— 三个源合并去重后 ~300。 */
export const APK_STORE_SOURCES: readonly string[] = [
  'feed/android.json',
  'most-popular/android.json',
  'new-releases/android.json',
]

/** 官方 raw 地址（首源），恒在候选表末尾 */
export const APK_STORE_OFFICIAL_URL =
  `https://raw.githubusercontent.com/${FEED_OWNER}/${FEED_REPO}/${FEED_REF}/cached-data/${APK_STORE_SOURCES[0]}`

/**
 * 能改写头像与 feed 的 url 型站点：内置（v1.1.3 起为空）+ 用户自己填的。
 *
 * 用户填的站必须参与这里 —— 否则他明明加了代理，头像和目录却还只走官方 raw，
 * 看起来就像「加了没用」。包里依然不带任何地址：这里的 base 全部来自
 * `ghx.mirror.store`。
 */
export function urlProxyBases(): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of [...BUILTIN_MIRRORS, ...mirrorRegistry()]) {
    if (m.id === 'official' || m.style !== 'url' || !m.base) continue
    const key = m.base.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(m.base)
  }
  return out
}

/**
 * 候选线路：用户自建站（如有）→ 官方 raw，保序去重。
 *
 * 自建站排第一：它专为「国内直连 raw 不通」而生，而且会把 feed 里的
 * 头像域名一并改写成镜像地址。没有自建站时就只剩官方 raw 一条 —— 这是
 * v1.1.3 的预期行为：包里不再预置加速站，装完直接连通不通取决于用户的网络，
 * 要加速就自己填。
 */
export function apkStoreCandidates(
  path: string = APK_STORE_SOURCES[0],
  proxies: string[] = urlProxyBases(),
  selfBase: string = selfMirrorBase(),
): string[] {
  const feedPath = path.startsWith('cached-data/') ? path : `cached-data/${path}`
  const official = `https://raw.githubusercontent.com/${FEED_OWNER}/${FEED_REPO}/${FEED_REF}/${feedPath}`
  const urls: string[] = []
  const self = selfBase.replace(/\/+$/, '')
  if (self) {
    // 自建地址就是官方 raw 本身时别产出 path 风格的重复项，直接算官方
    const isOfficialSelf = /^https?:\/\/raw\.githubusercontent\.com$/i.test(self)
    urls.push(
      isOfficialSelf ? official : rawUrlAt(self, FEED_OWNER, FEED_REPO, FEED_REF, feedPath),
    )
  }
  urls.push(official)
  for (const p of proxies) {
    if (p) urls.push(rawUrlAt(p, FEED_OWNER, FEED_REPO, FEED_REF, feedPath))
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of urls) {
    const key = u.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(u)
  }
  return out
}

/* ------------------------------- 数据模型 ------------------------------- */

/** 平台归属：komi-store 按各平台是否有安装包（apk/exe/dmg/包）来标注 */
export type ApkPlatform = 'android' | 'windows' | 'macos' | 'linux'

/** 平台字段名：feed 用 hasInstallersAndroid/Windows/Macos/Linux 四个布尔 */
const PLATFORM_FLAG: Record<ApkPlatform, string> = {
  android: 'hasInstallersAndroid',
  windows: 'hasInstallersWindows',
  macos: 'hasInstallersMacos',
  linux: 'hasInstallersLinux',
}

/** 卡片/筛选用的短标签 */
export const APK_PLATFORM_LABEL: Record<ApkPlatform, string> = {
  android: '安卓',
  windows: 'Win',
  macos: 'macOS',
  linux: 'Linux',
}

export interface ApkApp {
  fullName: string
  name: string
  owner: string
  avatarUrl: string
  description: string | null
  language: string | null
  stars: number
  forks: number
  /** 最新 Release 的 tag，如 "3.6.3-stable"。feed 恒有值，防御式留空 */
  latestTag: string | null
  pushedAt: string | null
  topics: string[]
  /** 平台归属（android 恒在；其余按上游 installers 标志 / platformReleases 推断） */
  platforms: ApkPlatform[]
}

export interface ApkStore {
  /** 本地拿到/确认这份目录的时间（毫秒） */
  at: number
  /** 上游的轮换日期（YYYY-MM-DD），只作展示与调试 */
  rotation: string
  apps: ApkApp[]
}

/**
 * komi-store 的日期字段是 "2026-11-20 14:36:03+00"（空格分隔 + 双位时区），
 * 不是 ISO 8601，`Date.parse` 在部分内核上会返回 NaN。
 * 先补全成标准形式再交给浏览器，任何异常都收敛成 null。
 */
export function normalizeTs(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let s = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00Z'
  else s = s.replace(' ', 'T')
  // "+00" → "+00:00"；"+0000" 同理。没有时区就当 UTC（上游本身就是 UTC）
  s = s.replace(/([+-]\d{2})$/, '$1:00').replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(s)) s += 'Z'
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

/**
 * 平台归属：优先 hasInstallers* 布尔，缺了退到 platformReleases 的键。
 * 全部缺失（旧缓存、上游改版）按 android feed 的本来面目兜成 ['android']，
 * 绝不让一条应用空着归属 —— 界面的平台筛选靠它分组。
 */
export function apkPlatforms(d: Record<string, unknown>): ApkPlatform[] {
  const all: ApkPlatform[] = ['android', 'windows', 'macos', 'linux']
  // 落盘缓存里存的是解析后的 platforms 字段，先认它
  if (Array.isArray(d.platforms)) {
    const hit = d.platforms.filter((p): p is ApkPlatform => all.includes(p as ApkPlatform))
    if (hit.length > 0) return all.filter((p) => hit.includes(p))
  }
  const releases =
    d.platformReleases && typeof d.platformReleases === 'object'
      ? (d.platformReleases as Record<string, unknown>)
      : null
  const out: ApkPlatform[] = []
  for (const p of all) {
    if (d[PLATFORM_FLAG[p]] === true || (releases && releases[p] != null)) out.push(p)
  }
  return out.length > 0 ? out : ['android']
}

/**
 * 头像候选线路：原图恒在队首（海外/能直连时最准），
 * avatars.githubusercontent.com 在国内经常整站不通，所以按候选垫后：
 * ① 自建站的专用头像域名（avatars-githubusercontent-com-{host}，2026-11-21 实测 200）；
 * ② 用户填的 url 型站点逐个改写（有的站代理头像会 403，能用的那条留在表里）。
 * 原图若已被自建站改写成镜像域名就直接单线返回，不再二次包壳。
 */
export function avatarSources(
  url: string,
  proxies: string[] = urlProxyBases(),
  selfBase: string = selfMirrorBase(),
): string[] {
  const u = (url ?? '').trim()
  if (!u) return []
  const out: string[] = [u]
  const m = /^https?:\/\/avatars\.githubusercontent\.com(\/\S*)?$/i.exec(u)
  if (m) {
    const host = selfBase.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
    if (host) out.push(`https://avatars-githubusercontent-com-${host}${m[1] ?? ''}`)
    const seen = new Set(out.map((x) => x.toLowerCase()))
    for (const p of proxies) {
      const candidate = `${p.replace(/\/+$/, '')}/${u}`
      if (candidate && !seen.has(candidate.toLowerCase())) {
        seen.add(candidate.toLowerCase())
        out.push(candidate)
      }
    }
  }
  return out
}

/**
 * 容错清洗：fullName 必须带「/」才算一条有效应用；同仓去重保首条；
 * 头像与简介缺失不拦 —— 界面有首字母兜底。
 */
export function sanitizeApkApps(raw: unknown): ApkApp[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ApkApp[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const d = item as Record<string, unknown>
    const fullName = str(d.fullName)
    if (!fullName || !fullName.includes('/')) continue
    if (seen.has(fullName.toLowerCase())) continue
    seen.add(fullName.toLowerCase())
    const ownerLogin = str((d.owner as Record<string, unknown> | undefined)?.login) ??
      fullName.split('/')[0]
    // 新 schema 头像嵌在 owner 里；旧 schema（设备缓存、上游回退）在顶层 —— 都认
    const ownerAvatar =
      str((d.owner as Record<string, unknown> | undefined)?.avatarUrl) ?? str(d.avatarUrl) ?? ''
    const tag = str(d.latestReleaseTag) ?? str(d.platformReleases && typeof d.platformReleases === 'object'
      ? (d.platformReleases as Record<string, Record<string, unknown>>).android?.tag
      : undefined)
    out.push({
      fullName,
      name: str(d.name) ?? fullName.split('/')[1] ?? fullName,
      owner: ownerLogin,
      avatarUrl: ownerAvatar,
      description: str(d.description),
      language: str(d.language),
      stars: num(d.stargazersCount) || num(d.stars),
      forks: num(d.forksCount),
      latestTag: tag,
      pushedAt: normalizeTs(d.pushedAt),
      topics: Array.isArray(d.topics) ? d.topics.filter((t): t is string => typeof t === 'string') : [],
      platforms: apkPlatforms(d),
    })  }
  return out
}

/** 解析 feed 文本。结构对不上（HTML 错误页、改版）一律 null，由调用方换线路 */
export function parseApkFeed(text: string, now: number = Date.now()): ApkStore | null {
  if (!text || !text.trimStart().startsWith('{')) return null
  try {
    const d = JSON.parse(text) as Record<string, unknown>
    const apps = sanitizeApkApps(d.repositories)
    if (apps.length === 0) return null
    return {
      at: now,
      rotation: typeof d.rotation === 'string' ? d.rotation : '',
      apps,
    }
  } catch {
    return null
  }
}

/** 落盘结构：字段补齐防旧缓存崩 */
export function parseApkStore(raw: string | null): ApkStore | null {
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as Partial<ApkStore>
    if (!d || typeof d.at !== 'number' || !Number.isFinite(d.at) || !Array.isArray(d.apps)) {
      return null
    }
    return {
      at: d.at,
      rotation: typeof d.rotation === 'string' ? d.rotation : '',
      apps: sanitizeApkApps(d.apps),
    }
  } catch {
    return null
  }
}

export function serializeApkStore(store: ApkStore): string {
  return JSON.stringify({ at: store.at, rotation: store.rotation, apps: store.apps })
}

/* -------------------------------- 新鲜度 -------------------------------- */

/** 6 小时内不再发请求：上游目录一天才轮换一次，没必要追得更紧 */
export const APK_STORE_FRESH = 6 * 60 * 60_000

/** 超过 3 天的缓存不再展示：商店目录过期了还挂着就是误导 */
export const APK_STORE_MAX_AGE = 3 * 24 * 60 * 60_000

export function apkStoreFresh(store: ApkStore | null, now: number = Date.now()): boolean {
  if (!store) return false
  // 设备时钟回拨时年龄是负数：按刚确认过处理，别让时间错乱弄没整个区块
  const age = Math.max(0, now - store.at)
  return age < APK_STORE_FRESH
}

export function apkStoreUsable(store: ApkStore | null, now: number = Date.now()): boolean {
  if (!store) return false
  const age = Math.max(0, now - store.at)
  return age < APK_STORE_MAX_AGE
}

/* ------------------------------- 缓存与拉取 ------------------------------ */

const STORE_KEY = 'ghx.apkstore.v2'

const memStore: { v: ApkStore | null } = { v: null }

export function peekApkStore(): ApkStore | null {
  return memStore.v
}

function putApkStore(store: ApkStore | null): void {
  memStore.v = store
}

export function resetApkStoreMemory(): void {
  putApkStore(null)
}

/** 单条线路的取回结果；null 表示该线路不可用（HTTP 非 200 / 超时 / 响应不是 JSON） */
export type ApkStoreHttp = (url: string) => Promise<string | null>

export const DEFAULT_TIMEOUT = 8000

/**
 * 默认取回通道。WebView 里 fetch 就够：raw 与公共代理都回 `ACAO: *`。
 * 超时收敛成 null 继续下一条，绝不让一条线路卡死整个区块。
 */
export const defaultApkStoreHttp: ApkStoreHttp = async (url) => {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (res.status !== 200) return null
    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 多源合并：按传入顺序拼接，同仓去重保首条；rotation 取第一个有值的，
 * at 取各源最新（保证新鲜度判断不被最旧的源拖死）。
 */
export function mergeApkStores(list: (ApkStore | null)[]): ApkStore | null {
  const ok = list.filter((s): s is ApkStore => !!s && s.apps.length > 0)
  if (ok.length === 0) return null
  const seen = new Set<string>()
  const apps: ApkApp[] = []
  for (const s of ok) {
    for (const a of s.apps) {
      const k = a.fullName.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      apps.push(a)
    }
  }
  return {
    at: Math.max(...ok.map((s) => s.at)),
    rotation: ok.find((s) => s.rotation)?.rotation ?? '',
    apps,
  }
}

/**
 * 顺序尝试候选线路，第一条给出合法 JSON 的赢。
 * 全部失败返回 null（调用方决定是否回退到过期缓存）。
 */
export async function fetchApkStore(
  bases: string[],
  http: ApkStoreHttp = defaultApkStoreHttp,
  now: number = Date.now(),
): Promise<ApkStore | null> {
  for (const url of bases) {
    const text = await http(url)
    if (text === null) continue
    const store = parseApkFeed(text, now)
    if (store) return store
  }
  return null
}

/**
 * 三个目录源各走各的候选线路，拿到多少算多少，合并去重。
 * 单个源挂了不拖累其它源 —— 轮换精选挂了还有最热门榜顶着。
 */
export async function fetchApkStoreMulti(
  sources: readonly string[] = APK_STORE_SOURCES,
  http: ApkStoreHttp = defaultApkStoreHttp,
  now: number = Date.now(),
): Promise<ApkStore | null> {
  const results = await Promise.all(
    sources.map((path) => fetchApkStore(apkStoreCandidates(path), http, now)),
  )
  return mergeApkStores(results)
}

export async function saveApkStore(kv: KV | null, store: ApkStore): Promise<void> {
  putApkStore(store)
  if (!kv) return
  try {
    await kv.set(STORE_KEY, serializeApkStore(store))
  } catch {
    /* 存不下不影响本次会话 */
  }
}

async function loadStored(kv: KV | null): Promise<ApkStore | null> {
  if (!kv) return null
  try {
    return parseApkStore(await kv.get(STORE_KEY))
  } catch {
    return null
  }
}

/**
 * 完整取数链：内存 → 设备缓存（新鲜直接用）→ 网络 → 全失败回退过期缓存。
 *
 * 回退过期缓存是刻意的：商店区块的定位是「锦上添花」，网络全断时
 * 宁可给出三分钟前的目录，也不要在热门页凭空消失一块。
 */
export async function loadApkStore(
  kv: KV | null,
  opts: { bases?: string[]; http?: ApkStoreHttp; fresh?: boolean; now?: number } = {},
): Promise<ApkStore | null> {
  const now = opts.now ?? Date.now()
  if (!opts.fresh) {
    if (memStore.v && apkStoreUsable(memStore.v, now)) return memStore.v
    const stored = await loadStored(kv)
    if (stored) {
      putApkStore(stored)
      if (apkStoreFresh(stored, now)) return stored
    }
  }
  const fetched = await fetchApkStoreMulti(APK_STORE_SOURCES, opts.http, now)
  if (fetched) {
    await saveApkStore(kv, fetched)
    return fetched
  }
  const stale = memStore.v ?? (await loadStored(kv))
  if (stale) putApkStore(stale)
  return apkStoreUsable(stale, now) ? stale : null
}

/* ------------------------------- 转成仓库 ------------------------------- */

/** 拿 ApkApp 当普通仓库打开：详情页 / 发行版 / 下载链路全部复用，零特例 */
export function apkAppToRepo(app: ApkApp, now: number = Date.now()): Repo {
  return {
    id: -hashId(app.fullName),
    name: app.name,
    full_name: app.fullName,
    owner: app.owner,
    private: false,
    visibility: 'public',
    archived: false,
    disabled: false,
    description: app.description,
    language: app.language,
    stargazers_count: app.stars,
    forks_count: app.forks,
    pushed_at: app.pushedAt ?? new Date(now).toISOString(),
    default_branch: 'main',
    ...(app.topics.length > 0 ? { topics: app.topics } : {}),
  }
}

/** FNV-1a：把 full_name 折成稳定正数，负号规避与真实 repo id 撞车 */
function hashId(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
