/**
 * 检查更新。
 *
 * 两条通道分开，不能混：
 *  - 查询元数据走 GitHub REST API（api.github.com），不携带用户令牌；
 *  - 下载 APK 走加速前缀（gh.zjkl0330.dpdns.org），因为 github.com 直连基本不通。
 *
 * 之所以不用认证请求：release 属公共信息，匿名即可读；带上用户令牌反而会把
 * 令牌发到一个与账号操作无关的端点，且会占用用户自己的 API 配额。
 */

import { DEFAULT_MIRROR, releaseDownloadUrl, releasePageUrl } from './mirrors'
import { pickArchive } from './archive'

/**
 * 当前版本。构建时由 vite 注入；在 vitest / 裸 node 下没有该全局，降级为 dev 标记，
 * 用 typeof 判断而不是直接引用，避免模块加载期 ReferenceError。
 */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0-dev'

export const UPDATE_OWNER = 'zjkl0330'
export const UPDATE_REPO = 'ghx'

/** 加速前缀保持向后兼容导出；真正的站点表在 mirrors.ts */
export { DEFAULT_MIRROR }
export const DEFAULT_RELEASE_API = 'https://api.github.com'

export interface ReleaseAsset {
  name: string
  size: number
  url: string
}

/**
 * 更新通道。
 *
 *  - `stable`：只装正式版（GitHub 的「Latest release」）；
 *  - `beta`：连预发布一起看，取版本号最高的那个 —— 想先试新功能的人自己选。
 *
 * 通道只影响「检查更新看哪一条」，不改变安装方式：两者都是同一个签名、
 * 同一个包名，可以互相覆盖安装。
 */
export type UpdateChannel = 'stable' | 'beta'

export interface ReleaseInfo {
  tag: string
  version: string
  /** 这条 Release 是否被作者标了 Pre-release */
  prerelease: boolean
  name: string
  notes: string
  publishedAt: string
  asset: ReleaseAsset | null
  /** 已按加速前缀拼好的下载地址；无 APK 资产时为 null */
  downloadUrl: string | null
  /** Release 页面地址（可在浏览器打开，未更新时也能看更新说明） */
  releasePage: string
  /** 官方直链，仅作加速失败时的兜底与排错参考 */
  fallbackUrl: string | null
}

export interface UpdateCheckResult {
  hasUpdate: boolean
  current: string
  latest: string | null
  info: ReleaseInfo | null
  checkedAt: number
  /** 这次查的是哪条通道，界面据此说「最新测试版」还是「最新正式版」 */
  channel: UpdateChannel
}

/** 把 `v1.2.3`、`1.2`、`1.2.3-beta.1` 统一成 [1,2,3]，非法返回 null。 */
export function parseVersion(input: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(input.trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)]
}

/** a > b 返回正数，相等 0，a < b 负数。任一无法解析时抛错，避免静默判错。 */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a)
  const vb = parseVersion(b)
  if (!va || !vb) throw new Error(`无法解析版本号：${!va ? a : b}`)
  for (let i = 0; i < 3; i += 1) {
    if (va[i] !== vb[i]) return va[i] - vb[i]
  }
  return 0
}

/** 版本号里带 `-beta.1` 这类后缀就是预发布 */
export function isPrerelease(version: string): boolean {
  return /-/.test(version.trim().replace(/^v/i, ''))
}

export function isNewer(remote: string, local: string): boolean {
  try {
    const cmp = compareVersions(remote, local)
    if (cmp !== 0) return cmp > 0
    /*
     * 数字相同还要看后缀：1.2.0-beta.1 → 1.2.0 是升级。
     * 测试通道用户在同号正式版发布后应当能被推过去，否则会一直卡在 beta 上。
     */
    return isPrerelease(local) && !isPrerelease(remote)
  } catch {
    return false
  }
}

/** 拼接加速下载地址。分片编码与站点风格都由 mirrors.ts 统一处理。 */
export function buildMirrorUrl(
  mirror: string,
  owner: string,
  repo: string,
  tag: string,
  asset: string,
): string {
  return releaseDownloadUrl(mirror, owner, repo, tag, asset)
}

/** 优先取 .apk；没有则返回 null（不拿源码包冒充安装包）。 */
export function pickApk(assets: { name: string; size: number; browser_download_url: string }[]): ReleaseAsset | null {
  const apk = assets.filter((a) => a.name.toLowerCase().endsWith('.apk'))
  if (apk.length === 0) return null
  apk.sort((x, y) => y.size - x.size)
  return { name: apk[0].name, size: apk[0].size, url: apk[0].browser_download_url }
}

interface RawRelease {
  tag_name?: string
  name?: string
  body?: string
  published_at?: string
  draft?: boolean
  prerelease?: boolean
  assets?: { name: string; size: number; browser_download_url: string }[]
}

export function parseRelease(
  raw: RawRelease,
  mirror: string,
  opts: { allowPrerelease?: boolean } = {},
): ReleaseInfo | null {
  if (!raw.tag_name) return null
  if (raw.draft) return null
  /*
   * 正式通道不认预发布。
   *
   * /releases/latest 本身就不返回预发布，但这条判断留着当双保险：
   * 接口口径变了、或者有人手动传 raw 时，预览版也不会被当成「该升级了」。
   * 测试通道显式传 allowPrerelease，才会把预发布纳入候选。
   */
  const pre = !!raw.prerelease || isPrerelease(raw.tag_name)
  if (pre && !opts.allowPrerelease) return null
  const version = parseVersion(raw.tag_name)
  if (!version) return null
  const asset = pickApk(raw.assets ?? [])
  const owner = UPDATE_OWNER
  const repo = UPDATE_REPO
  return {
    tag: raw.tag_name,
    version: version.join('.'),
    // tag 自带 `-beta.1` 也算预发布：接口字段偶尔缺失，不能让 beta 混进正式通道
    prerelease: !!raw.prerelease || isPrerelease(raw.tag_name),
    name: raw.name?.trim() || raw.tag_name,
    notes: (raw.body ?? '').trim(),
    publishedAt: raw.published_at ?? '',
    asset,
    downloadUrl: asset ? buildMirrorUrl(mirror, owner, repo, raw.tag_name, asset.name) : null,
    releasePage: releasePageUrl(mirror, owner, repo, raw.tag_name),
    fallbackUrl: asset?.url ?? null,
  }
}

/**
 * 从 Release 列表里挑一条「通道内最新」。
 *
 * 不按接口返回顺序取第一条：GitHub 的列表按创建时间排，补发的低版本 hotfix
 * 会排在前面，照单全收就会把用户往回拽。这里按**版本号**排，同号时正式版
 * 优先（1.2.0 > 1.2.0-beta.1），再按发布时间兜底。
 */
export function pickBestRelease(raws: RawRelease[], mirror: string): ReleaseInfo | null {
  const infos: ReleaseInfo[] = []
  for (const raw of raws) {
    const info = parseRelease(raw, mirror, { allowPrerelease: true })
    if (info) infos.push(info)
  }
  if (infos.length === 0) return null
  infos.sort((a, b) => {
    const byVersion = compareVersions(b.version, a.version)
    if (byVersion !== 0) return byVersion
    if (a.prerelease !== b.prerelease) return a.prerelease ? 1 : -1
    return (b.publishedAt || '').localeCompare(a.publishedAt || '')
  })
  return infos[0]
}

export interface CheckOptions {
  current?: string
  /** 更新通道，默认正式版 */
  channel?: UpdateChannel
  mirror?: string
  apiBase?: string
  owner?: string
  repo?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/**
 * 查询最新 release。任何失败都返回结构化的 error 文案，不抛出——
 * 检查更新失败绝不能影响主功能。
 */
export async function checkForUpdate(
  opts: CheckOptions = {},
): Promise<{ result: UpdateCheckResult | null; error: string | null }> {
  const current = opts.current ?? APP_VERSION
  const mirror = opts.mirror ?? DEFAULT_MIRROR
  const apiBase = (opts.apiBase ?? DEFAULT_RELEASE_API).replace(/\/+$/, '')
  const owner = opts.owner ?? UPDATE_OWNER
  const repo = opts.repo ?? UPDATE_REPO
  const f = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const timeoutMs = opts.timeoutMs ?? 12_000

  const channel: UpdateChannel = opts.channel === 'beta' ? 'beta' : 'stable'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    /*
     * 两个通道走两个端点：
     *  - 正式版：/releases/latest，GitHub 已经帮我们筛掉预发布；
     *  - 测试版：/releases 列表，自己按版本号挑最高的那条。
     * 不用同一个列表接口再筛选，是因为 /latest 能正确处理「仓库还没有正式版」
     * 的 404，语义更清楚，也少一次排序。
     */
    const url =
      channel === 'beta'
        ? `${apiBase}/repos/${owner}/${repo}/releases?per_page=30`
        : `${apiBase}/repos/${owner}/${repo}/releases/latest`
    const res = await f(url, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: controller.signal,
    })
    if (res.status === 404) {
      /*
       * 404 = 这个仓库还没有「正式版」。
       *
       * 早期开发期间的包全标了预发布，GitHub 的 /releases/latest 只认正式版，
       * 所以这里 404 属于常态，不能当错误弹给用户。按「无需更新」处理，
       * 用户主动检查时看到的是「已是最新版本 · 当前 vX」。
       */
      return { result: emptyResult(current, channel), error: null }
    }
    if (!res.ok) {
      const limited = res.headers.get('x-ratelimit-remaining') === '0'
      return {
        result: null,
        error: limited ? '查询被限流，请稍后再试' : `查询失败（HTTP ${res.status}）`,
      }
    }
    const payload = (await res.json()) as RawRelease | RawRelease[]
    let info: ReleaseInfo | null
    if (channel === 'beta') {
      const list = Array.isArray(payload) ? payload : payload ? [payload] : []
      info = pickBestRelease(list, mirror)
    } else {
      const raw = payload as RawRelease
      /*
       * 预发布一律不当更新。正常情况下 /releases/latest 根本不会返回它，
       * 但接口口径万一变，这里兜住：宁可少提示一次，也不拿开发中的包去催升级。
       * 返回「无更新」而不是解析错误 —— 用户不该因为一条预发布而看到报错。
       */
      if (raw && (raw.prerelease || isPrerelease(raw.tag_name ?? ''))) {
        return { result: emptyResult(current, channel), error: null }
      }
      info = raw ? parseRelease(raw, mirror) : null
    }
    if (!info) {
      // 测试通道的列表可能是空的（还没有任何 release）：按「无更新」处理，不报错
      if (channel === 'beta') return { result: emptyResult(current, channel), error: null }
      return { result: null, error: '最新版本信息无法解析' }
    }
    return {
      result: {
        hasUpdate: isNewer(info.version, current),
        current,
        latest: info.version,
        info,
        checkedAt: Date.now(),
        channel,
      },
      error: null,
    }
  } catch (err) {
    const name = (err as Error).name
    return {
      result: null,
      error: name === 'AbortError' ? '查询超时，网络可能不通' : '网络不可达，检查更新需要能访问 API',
    }
  } finally {
    clearTimeout(timer)
  }
}

/** 「无需更新」的统一形状，省得每个分支各写一遍 checkedAt */
function emptyResult(current: string, channel: UpdateChannel): UpdateCheckResult {
  return { hasUpdate: false, current, latest: null, info: null, checkedAt: Date.now(), channel }
}

export function formatBytes(n: number): string {
  if (n <= 0) return '未知大小'
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 用系统浏览器打开链接。
 *
 * 原生端必须走系统浏览器（Custom Tabs）：APK 下载后要交给系统 PackageInstaller，
 * 在 WebView 内部加载既下不了也装不上。Web 端直接新开标签。
 */
export async function openExternal(url: string): Promise<void> {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  if (typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url, presentationStyle: 'popover' })
    return
  }
  globalThis.open(url, '_blank', 'noopener,noreferrer')
}

export const openDownload = openExternal

/**
 * 探活用 HEAD，只有 2xx 才算通。
 *
 * 为什么要先探：候选地址有好几条（url 型反代 / 自建站 302 / 官方），
 * 国内往往只有其中一条真的能下。把不能下的那条交给浏览器，用户看到的是
 * 「点了没反应」或者一个 0 字节的文件，比多等两秒糟得多。
 *
 * 302 不算通：自建站对资产就是先回 302，重定向目标那条链路会 522。
 * CapacitorHttp 默认跟随重定向，跟到 522 自然是 false；万一没跟随、
 * 直接把 302 交回来，也应当换下一条而不是赌它。
 *
 * Web 端不做探活：HEAD 基本都被 CORS 挡住，探了反而误判成「全不通」，
 * 所以这里直接返回 true，让调用方沿用第一条（与旧版行为一致）。
 */
export async function headReachable(url: string, timeoutMs = 2500): Promise<boolean> {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  if (!(typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform())) return true
  try {
    const { CapacitorHttp } = await import('@capacitor/core')
    const res = await CapacitorHttp.request({
      url,
      method: 'HEAD',
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    })
    return res.status >= 200 && res.status < 300
  } catch {
    return false
  }
}

/** 挑一条能通的 zip 地址，再交给系统浏览器下载 */
export async function openArchive(candidates: string[]): Promise<string> {
  const url = candidates.length > 1 ? await pickArchive(candidates, (u) => headReachable(u)) : candidates[0]
  await openExternal(url)
  return url
}
