/**
 * 下载加速站（GitHub 反代）。
 *
 * 国内直连 github.com 基本不通，App 的安装包与 README 图片都靠这类代理。
 * 但代理有两种路径风格，传错就 404，所以风格必须跟着站点一起记，不能靠猜：
 *
 *   path：{base}/{owner}/{repo}/releases/...        自建 worker、gitproxy.click
 *   url ：{base}/https://github.com/{owner}/{repo}/...  gh-proxy 系（gh-proxy.com、ghfast.top）
 *
 * 另外，HTML 页面（仓库页、Release 页）只有部分代理会转，下载型代理直接 403，
 * 所以「打开网页」单独走 pageUrl()：当前镜像不能翻页时退回自建站点。
 */

export type MirrorStyle = 'path' | 'url'

export interface MirrorDef {
  id: string
  label: string
  /** 去掉结尾斜杠的裸前缀 */
  base: string
  style: MirrorStyle
  /** 是否连 HTML 页面一起代理 */
  page?: boolean
  note?: string
}

/** 自建站点：既是默认下载镜像，也是唯一保证能翻网页的镜像 */
export const DEFAULT_MIRROR = 'https://gh.zjkl0330.dpdns.org'

export const OFFICIAL_MIRROR: MirrorDef = {
  id: 'official',
  label: '官方直连',
  base: 'https://github.com',
  style: 'path',
  page: true,
  note: '不加速，能直连 github.com 时才快',
}

export const BUILTIN_MIRRORS: MirrorDef[] = [
  {
    id: 'zjkl',
    label: '自建加速',
    base: DEFAULT_MIRROR,
    style: 'path',
    page: true,
    note: 'Cloudflare Worker',
  },
  { id: 'ghproxy', label: 'gh-proxy.com', base: 'https://gh-proxy.com', style: 'url', note: '下载型' },
  { id: 'ghfast', label: 'ghfast.top', base: 'https://ghfast.top', style: 'url', note: '下载型' },
  { id: 'ghproxynet', label: 'ghproxy.net', base: 'https://ghproxy.net', style: 'url', note: '下载型' },
  { id: 'imciel', label: 'ghproxy.imciel.com', base: 'https://ghproxy.imciel.com', style: 'url' },
  { id: 'gitproxy', label: 'gitproxy.click', base: 'https://gitproxy.click', style: 'path', note: '下载型' },
  OFFICIAL_MIRROR,
]

/** 去掉结尾斜杠、补全协议；空串原样返回，交给调用方决定兜底 */
export function normalizeBase(base: string): string {
  const s = (base ?? '').trim()
  if (!s) return ''
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`
  return withScheme.replace(/\/+$/, '')
}

/** 已知站点查表；自定义地址按 path 风格处理（最常见） */
export function mirrorDefFor(base: string): MirrorDef {
  const target = normalizeBase(base).toLowerCase()
  const hit = BUILTIN_MIRRORS.find((m) => m.base.toLowerCase() === target)
  if (hit) return hit
  return { id: 'custom', label: normalizeBase(base) || '未设置', base: normalizeBase(base), style: 'path' }
}

/**
 * 参与测速与展示的站点：内置表 + 当前自定义站。
 * 自定义站不在内置表里时补在最前面，否则用户选中了却在列表里看不见。
 */
export function mirrorCandidates(current: string): { base: string; label: string; note?: string }[] {
  const cur = normalizeBase(current)
  const rows = BUILTIN_MIRRORS.map((m) => ({ base: m.base, label: m.label, note: m.note }))
  if (cur && !rows.some((r) => r.base.toLowerCase() === cur.toLowerCase())) {
    rows.unshift({ base: cur, label: cur.replace(/^https?:\/\//, ''), note: '自定义' })
  }
  return rows
}

export function mirrorLabel(base: string): string {
  const def = mirrorDefFor(base)
  return def.id === 'custom' ? def.base.replace(/^https?:\/\//, '') : def.label
}

/** github.com 下的路径（不带域名）换成加速地址；带上域名也认，避免拼出双域名 */
export function githubUrlAt(base: string, path: string): string {
  const def = mirrorDefFor(base)
  const clean = path
    .replace(/^\/+/, '')
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
  if (!def.base) return `https://github.com/${clean}`
  return def.style === 'url' ? `${def.base}/https://github.com/${clean}` : `${def.base}/${clean}`
}

/** raw.githubusercontent.com 下的文件换成加速地址 */
export function rawUrlAt(base: string, owner: string, repo: string, branch: string, path: string): string {
  const def = mirrorDefFor(base)
  const clean = path.replace(/^\/+/, '')
  const ref = branch || 'main'
  if (!def.base) return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${clean}`
  return def.style === 'url'
    ? `${def.base}/https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${clean}`
    : `${def.base}/${owner}/${repo}/raw/${ref}/${clean}`
}

/** 分段编码，避免 tag / 文件名里的空格、# 被截断 */
function seg(s: string): string {
  return encodeURIComponent(s.replace(/^\/+|\/+$/g, ''))
}

/** Release 资产下载地址 */
export function releaseDownloadUrl(
  base: string,
  owner: string,
  repo: string,
  tag: string,
  asset: string,
): string {
  return githubUrlAt(base, `${seg(owner)}/${seg(repo)}/releases/download/${seg(tag)}/${seg(asset)}`)
}

/** Release 页面（HTML）。当前镜像不翻页时退回自建站点，保证按钮点得开 */
export function releasePageUrl(base: string, owner: string, repo: string, tag?: string): string {
  const def = mirrorDefFor(base)
  const useBase = def.page ? def.base : DEFAULT_MIRROR
  const tail = tag ? `/releases/tag/${seg(tag)}` : '/releases'
  return githubUrlAt(useBase, `${seg(owner)}/${seg(repo)}${tail}`)
}

/* ---------------- 测速 ---------------- */

/** 单次探测拉多少字节。够看出吞吐，又不至于在移动网络下太费流量 */
export const PROBE_BYTES = 256 * 1024
export const PROBE_TIMEOUT = 8000
/** 测速结果有效期：6 小时内冷启动直接沿用，不重复测 */
export const SPEED_TTL = 6 * 60 * 60 * 1000

export interface ProbeResponse {
  status: number
  headers: Record<string, string>
  bytes: number
}

export type ProbeHttp = (url: string, timeoutMs: number) => Promise<ProbeResponse>

export interface ProbeResult {
  base: string
  label: string
  style: MirrorStyle
  status: 'ok' | 'fail'
  ms: number
  bytes: number
  /** KB/s，失败为 0 */
  kbps: number
  error?: string
}

export interface ProbeOptions {
  timeoutMs?: number
  now?: () => number
  http?: ProbeHttp
}

export function kbpsOf(bytes: number, ms: number): number {
  if (bytes <= 0 || ms <= 0) return 0
  return Math.round((bytes * 1000) / (1024 * ms) * 10) / 10
}

export function formatSpeed(kbps: number): string {
  if (!Number.isFinite(kbps) || kbps <= 0) return '—'
  if (kbps >= 1000) return `${(kbps / 1024).toFixed(1)} MB/s`
  return `${Math.round(kbps)} KB/s`
}

function lowerKeys(h: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(h ?? {})) out[k.toLowerCase()] = String(v)
  return out
}

/**
 * 默认探测通道：原生端走 CapacitorHttp（不受 WebView 跨域限制，
 * 普通 fetch 会被代理站没有 ACAO 头挡住），Web 端退回 fetch。
 */
export const defaultProbeHttp: ProbeHttp = async (url, timeoutMs) => {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  const native = typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform()
  if (native) {
    try {
      const { CapacitorHttp } = await import('@capacitor/core')
      const res = await CapacitorHttp.request({
        url,
        method: 'GET',
        headers: { Range: `bytes=0-${PROBE_BYTES - 1}` },
        responseType: 'text',
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      })
      const headers = lowerKeys(res.headers as Record<string, string>)
      const len = Number(headers['content-length'] ?? 0)
      const bytes = Number.isFinite(len) && len > 0 ? len : typeof res.data === 'string' ? res.data.length : 0
      return { status: res.status, headers, bytes }
    } catch {
      // 插件不可用时继续往下走，让 fetch 再试一次
    }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=0-${PROBE_BYTES - 1}` },
      signal: ctrl.signal,
    })
    const buf = await res.arrayBuffer()
    const headers = lowerKeys(Object.fromEntries(res.headers.entries()))
    return { status: res.status, headers, bytes: buf.byteLength }
  } finally {
    clearTimeout(timer)
  }
}

/** 测一个站。任何异常都收敛成 fail，不往上抛 */
export async function probeMirror(base: string, url: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const def = mirrorDefFor(base)
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT
  const now = opts.now ?? (() => Date.now())
  const http = opts.http ?? defaultProbeHttp

  const fail = (error: string, ms: number): ProbeResult => ({
    base: def.base,
    label: def.label,
    style: def.style,
    status: 'fail',
    ms,
    bytes: 0,
    kbps: 0,
    error,
  })

  if (!def.base) return fail('地址为空', 0)

  const started = now()
  try {
    const res = await http(url, timeoutMs)
    const ms = Math.max(1, now() - started)
    if (res.status !== 200 && res.status !== 206) return fail(`HTTP ${res.status}`, ms)
    if (res.bytes < 512) return fail('返回内容异常', ms)
    return {
      base: def.base,
      label: def.label,
      style: def.style,
      status: 'ok',
      ms,
      bytes: res.bytes,
      kbps: kbpsOf(res.bytes, ms),
    }
  } catch (err) {
    const ms = Math.max(1, now() - started)
    const name = (err as Error).name
    if (name === 'AbortError') return fail('超时', ms)
    const msg = (err as Error).message ?? '网络错误'
    return fail(/Failed to fetch|NetworkError|Load failed/i.test(msg) ? '不可达或被跨域拦截' : msg.slice(0, 60), ms)
  }
}

/** 顺序测（并发会互相抢带宽，测出来名次不准），每测完一个回调一次 */
export async function probeAll(
  bases: string[],
  urlFor: (base: string) => string,
  opts: ProbeOptions & { onResult?: (r: ProbeResult, index: number) => void } = {},
): Promise<ProbeResult[]> {
  const out: ProbeResult[] = []
  for (let i = 0; i < bases.length; i += 1) {
    const base = bases[i]
    const r = await probeMirror(base, urlFor(base), opts)
    out.push(r)
    opts.onResult?.(r, i)
  }
  return out
}

/** 成功的按速度降序，失败的沉底（保留原有顺序，方便界面稳定） */
export function rankProbes(list: ProbeResult[]): ProbeResult[] {
  const ok = list.filter((r) => r.status === 'ok').sort((a, b) => b.kbps - a.kbps || a.ms - b.ms)
  const bad = list.filter((r) => r.status !== 'ok')
  return [...ok, ...bad]
}

export function pickFastest(list: ProbeResult[]): ProbeResult | null {
  const [first] = rankProbes(list)
  return first?.status === 'ok' ? first : null
}

/* ---------------- 结果快照 ---------------- */

export interface SpeedSnapshot {
  at: number
  best: string | null
  results: { base: string; kbps: number; ms: number }[]
}

/** 容错解析：旧版本/损坏的 JSON 一律当没有缓存，不要让界面启动就崩 */
export function parseSnapshot(raw: string | null): SpeedSnapshot | null {
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as Partial<SpeedSnapshot>
    if (!d || typeof d.at !== 'number' || !Array.isArray(d.results)) return null
    const results = d.results
      .filter((r) => r && typeof r.base === 'string' && typeof r.kbps === 'number')
      .map((r) => ({ base: r.base, kbps: r.kbps, ms: typeof r.ms === 'number' ? r.ms : 0 }))
    if (results.length === 0) return null
    return { at: d.at, best: typeof d.best === 'string' ? d.best : null, results }
  } catch {
    return null
  }
}

export function snapshotFresh(s: SpeedSnapshot | null, now = Date.now()): boolean {
  if (!s) return false
  const age = now - s.at
  return age >= 0 && age < SPEED_TTL
}

export function snapshotOf(results: ProbeResult[], now = Date.now()): SpeedSnapshot {
  const best = pickFastest(results)
  return {
    at: now,
    best: best?.base ?? null,
    results: results.map((r) => ({ base: r.base, kbps: r.kbps, ms: r.ms })),
  }
}
