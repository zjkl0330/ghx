/**
 * 统一下载中心。
 *
 * 三处下载看起来是三件事，其实是同一件事：
 *
 *  - 「检查更新」的安装包（zjkl0330/ghx 的 release 资产）
 *  - 任意仓库的发行版附件（releases 面板里的每一条）
 *  - 仓库源码压缩包（codeload zip）
 *
 * 三者都是「一串候选地址 → 挑一条能用的 → 下下来」，所以测速、选线、回执
 * 不该各写一遍。这个模块只负责算出「下什么、从哪几条线路下」，以及把测速结果
 * 排成序；真正发起请求的是面板（应用内）或系统浏览器（应用外）。
 *
 * 候选顺序沿用 mirrors.ts / archive.ts 里已经踩出来的结论，不在这里重排：
 * 那两处的顺序是实测出来的（自建站对 release 资产 302 到 522、gh-proxy 能吃
 * codeload 等），挪到这里等于把踩过的坑再踩一遍。
 */

import { CODELOAD_BASE, archiveCandidates, archiveFileName } from './archive'
import {
  BUILTIN_MIRRORS,
  mirrorDefFor,
  mirrorRegistry,
  normalizeBase,
  probeMirror,
  releaseCandidates,
  type MirrorStyle,
  type ProbeHttp,
  type ProbeResult,
} from './mirrors'

export type DownloadKind = 'apk' | 'asset' | 'archive' | 'artifact'

/** 应用内下载（自己下、自己装）还是应用外（交给系统浏览器 / 下载管理器） */
export type DownloadMode = 'inner' | 'outer'

export const DOWNLOAD_MODE_KEY = 'ghx.download.mode'

/** 容错解析：只认 'inner'，其余一律当 'outer'（旧版本没有这个键） */
export function parseDownloadMode(raw: string | null | undefined): DownloadMode {
  return raw === 'inner' ? 'inner' : 'outer'
}

export function serializeDownloadMode(mode: DownloadMode): string {
  return mode === 'inner' ? 'inner' : 'outer'
}

export interface DownloadRoute {
  url: string
  /** 站点 base，用于显示站名和测速 */
  base: string
  label: string
  style: MirrorStyle
  /** 这条线路要求带令牌（CI 产物），测速与应用外下载都不适用 */
  auth?: boolean
  /**
   * 官方直连（github.com / codeload.github.com）。
   *
   * 它建连快、首包快，256 KB 探针常年第一，但长时段吞吐会掉 —— 跨境链路、
   * 无缓存、单连接被限速，几百 KB 的测速反映不出来。所以排序时把它整体
   * 压到所有代理之后，只有当代理全不可用时才会被选中。
   */
  official?: boolean
}

export interface DownloadTarget {
  kind: DownloadKind
  /** 面板大标题 */
  title: string
  /** 来源一行，例如 `zjkl0330/ghx · v0.7.8` */
  subtitle: string
  fileName: string
  /** 服务器给的大小，0 表示未知 */
  size: number
  routes: DownloadRoute[]
  /** 能不能应用内下完直接调安装器：只有 apk 有意义 */
  installable: boolean
  /**
   * 来源仓库 full_name（`owner/repo`）。
   *
   * 下载记录靠它跳回仓库 —— 光有文件名回不去。四种目标都从某个仓库来，
   * 所以这里必填；万一将来出现「不知道来源」的下载，传空串，记录里就不给跳转。
   */
  repo: string
  /** 发行版标签 / 分支引用，仅用于记录里展示 */
  tag?: string
}

/* ---------------- 地址 → 站点 ---------------- */

/**
 * 反查某个下载地址属于哪个加速站。
 *
 * 候选表里既有 path 型（`{base}/owner/repo/...`）也有 url 型
 * （`{base}/https://github.com/...`），两种都以 base 开头，所以统一按
 * 「前缀最长匹配」判定：`gh.zjkl0330.dpdns.org` 与 `github.com` 同时命中时，
 * 取更长的那个才对（否则自建站会被认成官方）。
 */
export function mirrorOfUrl(url: string): { base: string; label: string; style: MirrorStyle } {
  const target = (url ?? '').toLowerCase()
  const all: { base: string; label: string; style: MirrorStyle }[] = [
    ...mirrorRegistry().map((m) => ({ base: m.base, label: m.label, style: m.style })),
    ...BUILTIN_MIRRORS.map((m) => ({ base: m.base, label: m.label, style: m.style })),
    { base: 'https://github.com', label: 'GitHub 官方', style: 'path' },
    { base: CODELOAD_BASE, label: 'codeload 官方', style: 'path' },
  ]

  let best: { base: string; label: string; style: MirrorStyle } | null = null
  for (const m of all) {
    const base = normalizeBase(m.base)
    if (!base) continue
    const lower = base.toLowerCase()
    if (target !== lower && !target.startsWith(`${lower}/`)) continue
    if (!best || lower.length > best.base.length) best = { base, label: m.label, style: m.style }
  }
  if (best) return best

  // 用户自己加的站点还没进注册表时（冷启动瞬间），至少把域名显示出来
  try {
    const u = new URL(url)
    return { base: u.origin, label: u.hostname, style: 'path' }
  } catch {
    return { base: '', label: '未知线路', style: 'path' }
  }
}

/** 官方直连的站点名：按域名判定，不按 label —— 同一条线路在两处表里的叫法不同 */
export function isOfficialBase(base: string): boolean {
  const b = (base ?? '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase()
  return b === 'github.com' || b === 'codeload.github.com'
}

/** 地址串 → 线路列表：保持顺序、按 URL 去重 */
export function toRoutes(urls: string[]): DownloadRoute[] {
  const seen = new Set<string>()
  const out: DownloadRoute[] = []
  for (const url of urls) {
    const key = (url ?? '').toLowerCase()
    if (!url || seen.has(key)) continue
    seen.add(key)
    const m = mirrorOfUrl(url)
    out.push({
      url,
      base: m.base,
      label: m.label,
      style: m.style,
      official: isOfficialBase(m.base) || undefined,
    })
  }
  return out
}

/* ---------------- 三类目标 ---------------- */

export function isApkName(name: string): boolean {
  return /\.apk$/i.test((name ?? '').trim())
}

export interface ApkInput {
  mirror: string
  owner: string
  repo: string
  tag: string
  asset: string
  size: number
  /** 展示用的版本号，通常是 tag 去掉 v */
  version?: string
}

/** 「检查更新」里那个安装包 */
export function apkTarget(o: ApkInput): DownloadTarget {
  const routes = toRoutes(releaseCandidates(o.mirror, o.owner, o.repo, o.tag, o.asset))
  const version = (o.version ?? o.tag ?? '').replace(/^v/i, '')
  return {
    kind: 'apk',
    title: `${o.repo}${version ? ` v${version}` : ''} 安装包`,
    subtitle: `${o.owner}/${o.repo} · ${o.tag}`,
    fileName: o.asset,
    size: o.size,
    routes,
    installable: isApkName(o.asset),
    repo: `${o.owner}/${o.repo}`,
    tag: o.tag,
  }
}

export interface AssetInput {
  mirror: string
  owner: string
  repo: string
  tag: string
  asset: string
  size: number
}

/** 任意仓库的发行版附件：和安装包走同一套候选与测速 */
export function assetTarget(o: AssetInput): DownloadTarget {
  return {
    kind: 'asset',
    title: o.asset,
    subtitle: `${o.owner}/${o.repo} · ${o.tag}`,
    fileName: o.asset,
    size: o.size,
    routes: toRoutes(releaseCandidates(o.mirror, o.owner, o.repo, o.tag, o.asset)),
    installable: isApkName(o.asset),
    repo: `${o.owner}/${o.repo}`,
    tag: o.tag,
  }
}

export interface ArchiveInput {
  mirror: string
  owner: string
  repo: string
  ref: string
}

/** 仓库源码 ZIP：候选来自 codeload 那一套（302 与代理的差别见 archive.ts） */
export function archiveTarget(o: ArchiveInput): DownloadTarget {
  const ref = (o.ref || 'main').trim() || 'main'
  return {
    kind: 'archive',
    title: '源码压缩包',
    subtitle: `${o.owner}/${o.repo} · ${ref}`,
    fileName: archiveFileName(o.repo, ref),
    size: 0,
    routes: toRoutes(archiveCandidates(o.mirror, o.owner, o.repo, ref)),
    installable: false,
    repo: `${o.owner}/${o.repo}`,
    tag: ref,
  }
}

export interface ArtifactInput {
  /** API 基地址，默认官方 api.github.com（用户可配镜像） */
  baseUrl?: string
  owner: string
  repo: string
  runId: number
  artifactId: number
  name: string
  size: number
}

/**
 * CI 产物。
 *
 * 与另外三种的根本区别：**它必须带令牌**。`/actions/artifacts/{id}/zip`
 * 会 302 到 pipelines 的签名地址，而签名地址只有拿到 302 的那次请求才存在 ——
 * 浏览器里用 `redirect: 'manual'` 只能读到不透明响应，Location 根本取不到。
 * 所以产物只有一条线路（没有加速站可用，也没有必要），且只能应用内下载。
 */
export function artifactTarget(o: ArtifactInput): DownloadTarget {
  const base = (o.baseUrl || 'https://api.github.com').replace(/\/+$/, '')
  const url = `${base}/repos/${o.owner}/${o.repo}/actions/artifacts/${o.artifactId}/zip`
  return {
    kind: 'artifact',
    title: o.name || 'CI 产物',
    subtitle: `${o.owner}/${o.repo} · 运行 #${o.runId}`,
    fileName: `${safeFileName(o.name || 'artifact')}.zip`,
    size: o.size,
    routes: [{ url, base, label: '官方 API', style: 'path', auth: true }],
    installable: false,
    repo: `${o.owner}/${o.repo}`,
    tag: `run #${o.runId}`,
  }
}

/* ---------------- 测速 ---------------- */

export interface SpeedEntry {
  route: DownloadRoute
  result: ProbeResult
}

/**
 * 并发测速的线路数。
 *
 * 3 是个折中：六条线路两批跑完，总耗时约串行的三分之一；再多就会在移动网络
 * 上互相抢带宽，测出来的 kbps 偏低，虽然名次大体还在，但数字会显得难看。
 */
export const PROBE_CONCURRENCY = 3

export interface MeasureOptions {
  http?: ProbeHttp
  timeoutMs?: number
  now?: () => number
  /** 每测完一条回调一次，界面据此逐行点亮（并发下完成顺序不保证按原序） */
  onResult?: (entry: SpeedEntry, index: number) => void
  /** 同时在跑的线路数，默认 3 */
  concurrency?: number
}

/**
 * 并发测速。
 *
 * 以前是串行：一条挂了要等满 8 秒超时，六条线路最坏 48 秒，面板一直转圈。
 * 这些候选是**不同站点**，不是同一条链路的分片，前 256 KB 的争抢可以忽略，
 * 所以按 3 条一批并发，总耗时从「和」变成「约三分之一的和」。
 *
 * 返回顺序仍与传入的 routes 一一对应 —— 并发只影响谁先完成，不影响结果位置；
 * onResult 的 index 也是原始下标，界面据此点亮对应那行。
 */
export async function measureRoutes(
  routes: DownloadRoute[],
  opts: MeasureOptions = {},
): Promise<SpeedEntry[]> {
  const total = routes.length
  if (total === 0) return []

  const width = Math.max(1, Math.min(opts.concurrency ?? PROBE_CONCURRENCY, total))
  const out: SpeedEntry[] = new Array(total)
  let cursor = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor
      cursor += 1
      if (i >= total) return
      const route = routes[i]
      const result = await probeMirror(route.base || route.url, route.url, {
        http: opts.http,
        timeoutMs: opts.timeoutMs,
        now: opts.now,
      })
      const entry: SpeedEntry = { route, result }
      out[i] = entry
      opts.onResult?.(entry, i)
    }
  }

  await Promise.all(Array.from({ length: width }, () => worker()))
  return out
}

/**
 * 通的按「档位 → 速度」排序，失败的沉底（保持原顺序，界面不会跳）。
 *
 * 档位只有两级：代理（0）与官方直连（1）。官方就算测出最高 kbps 也排在
 * 所有可用代理之后 —— 探针只拉 256 KB，测的是建连与首包，而官方直连真正
 * 难受的地方在于拉长之后的吞吐衰减，那一段测速根本看不见。
 */
export function rankRoutes(entries: SpeedEntry[]): SpeedEntry[] {
  const ok = entries.filter((e) => e.result.status === 'ok')
  const bad = entries.filter((e) => e.result.status !== 'ok')
  ok.sort(
    (a, b) =>
      Number(!!a.route.official) - Number(!!b.route.official) ||
      b.result.kbps - a.result.kbps ||
      a.result.ms - b.result.ms,
  )
  return [...ok, ...bad]
}

/** 最快的一条；一条都不通返回 null，由调用方回退到「按顺序探活」 */
export function fastestRoute(entries: SpeedEntry[]): DownloadRoute | null {
  const [first] = rankRoutes(entries)
  return first && first.result.status === 'ok' ? first.route : null
}

/* ---------------- 测速看板：一天只测一次 ---------------- */

/**
 * 测速结果按「站点」记，不按「文件」记。
 *
 * 以前是每个附件各存一份（键里带 url），结果下 A 包测一遍、下 B 包又测一遍，
 * 而候选线路压根就是同一批代理 —— 白费流量。现在按 base 存成一块看板，
 * 所有下载共用：今天测过，今天所有包都直接用。
 */
export const SPEED_BOARD_KEY = 'ghx.speed.board'

/** 一条线路的一次测量 */
export interface SpeedSample {
  kbps: number
  ms: number
  status: 'ok' | 'fail'
  error?: string
}

export interface SpeedBoard {
  at: number
  /** base（小写）→ 样本 */
  samples: Record<string, SpeedSample>
}

/** 本地时区的日期键 */
export function dayKeyOf(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 这块看板今天还能用吗。
 *
 * 判据是**自然日**而不是滚动 24 小时：用户说的「每天一次」就是跨过零点才重测。
 * 早上八点开 App 不该因为「距上次才 20 小时」又白测一轮。
 * 时间被往回拨（at 在未来）一律当过期，宁可多测一次。
 */
export function boardFresh(b: SpeedBoard | null | undefined, now = Date.now()): boolean {
  if (!b || typeof b.at !== 'number' || !Number.isFinite(b.at)) return false
  if (b.at > now) return false
  return dayKeyOf(b.at) === dayKeyOf(now)
}

/** 容错解析：坏 JSON、旧格式、字段缺失一律当没有看板 */
export function parseSpeedBoard(raw: string | null | undefined): SpeedBoard | null {
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as Partial<SpeedBoard>
    if (!d || typeof d.at !== 'number' || !d.samples || typeof d.samples !== 'object') return null
    const samples: Record<string, SpeedSample> = {}
    for (const [k, v] of Object.entries(d.samples)) {
      if (!k || !v || typeof v !== 'object') continue
      const s = v as Partial<SpeedSample>
      if (typeof s.kbps !== 'number' || typeof s.ms !== 'number') continue
      samples[k.toLowerCase()] = {
        kbps: s.kbps,
        ms: s.ms,
        status: s.status === 'ok' ? 'ok' : 'fail',
        ...(typeof s.error === 'string' && s.error ? { error: s.error } : {}),
      }
    }
    return { at: d.at, samples }
  } catch {
    return null
  }
}

function boardStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // 隐私模式下访问 localStorage 会抛
    return null
  }
}

export function readSpeedBoard(now = Date.now()): SpeedBoard | null {
  try {
    const board = parseSpeedBoard(boardStorage()?.getItem(SPEED_BOARD_KEY) ?? null)
    return boardFresh(board, now) ? board : null
  } catch {
    return null
  }
}

export function writeSpeedBoard(board: SpeedBoard): void {
  try {
    boardStorage()?.setItem(SPEED_BOARD_KEY, JSON.stringify(board))
  } catch {
    // 存不下就算了，下次重测
  }
}

/** 把这一轮的测量结果并进看板；prev 里其它站点的样本保留，重测一条不会抹掉别的 */
export function boardOf(
  entries: SpeedEntry[],
  now = Date.now(),
  prev?: SpeedBoard | null,
): SpeedBoard {
  const samples: Record<string, SpeedSample> = { ...(prev?.samples ?? {}) }
  for (const e of entries) {
    const key = (e.route.base || '').toLowerCase()
    if (!key) continue
    samples[key] = {
      kbps: e.result.kbps,
      ms: e.result.ms,
      status: e.result.status,
      ...(e.result.error ? { error: e.result.error } : {}),
    }
  }
  return { at: now, samples }
}

/** 看板还原成当前这批线路的测速结果；没有样本的线路不出现 */
export function entriesFromBoard(routes: DownloadRoute[], board: SpeedBoard | null): SpeedEntry[] {
  if (!board) return []
  const out: SpeedEntry[] = []
  for (const route of routes) {
    const s = board.samples[(route.base || '').toLowerCase()]
    if (!s) continue
    out.push({
      route,
      result: {
        base: route.base,
        label: route.label,
        style: route.style,
        status: s.status,
        ms: s.ms,
        bytes: 0,
        kbps: s.kbps,
        ...(s.error ? { error: s.error } : {}),
      },
    })
  }
  return out
}

/** 看板里还没有样本的线路 —— 自动测速只补这些，不把已经测过的再拉一遍 */
export function routesWithoutSample(routes: DownloadRoute[], board: SpeedBoard | null): DownloadRoute[] {
  if (!board) return [...routes]
  return routes.filter((r) => !board.samples[(r.base || '').toLowerCase()])
}

/* ---------------- 进度与文案 ---------------- */

/** 0–100，整数；总大小未知时返回 0（界面改用不确定态） */
export function progressOf(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0
  const pct = Math.floor((done / total) * 100)
  return Math.min(100, Math.max(0, pct))
}

/** 剩余时间估算，返回秒；数据不足返回 null */
export function etaSeconds(done: number, total: number, elapsedMs: number): number | null {
  if (done <= 0 || total <= 0 || elapsedMs <= 0) return null
  if (done >= total) return 0
  const speed = done / elapsedMs // 字节/毫秒
  const rest = (total - done) / speed / 1000
  if (!Number.isFinite(rest) || rest < 0) return null
  return Math.ceil(rest)
}

export function formatEta(sec: number | null): string {
  if (sec == null) return ''
  if (sec <= 0) return '即将完成'
  if (sec < 60) return `约 ${sec} 秒`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s === 0 ? `约 ${m} 分钟` : `约 ${m} 分 ${s} 秒`
}

/** 文件名的安全化：去掉路径分隔符与控制字符，避免写到下载目录外面 */
export function safeFileName(raw: string, fallback = 'download.bin'): string {
  const s = (raw ?? '')
    .trim()
    // 先削掉前导的 ./ 与 ../：`../../etc/passwd` 替换分隔符后会变成 `_.._etc_passwd`，
    // 虽然也写不出目录，但名字难看得像个 bug
    .replace(/^[.\\/]+/, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, '')
  return s || fallback
}

/**
 * 设置页里那一行的说明。三种情况分开写清楚，别让用户以为「选了应用内就都能装」。
 */
export function modeHint(mode: DownloadMode, native: boolean, installable = true): string {
  if (!native) {
    return '网页版没有安装权限，下载一律交给浏览器。装进手机后的 App 里才有「应用内下载」。'
  }
  if (mode === 'outer') {
    return '交给系统浏览器下载：进度在通知栏，下完要自己点开安装。适合浏览器里装了下载插件、或想留一份安装包的情形。'
  }
  if (!installable) {
    return '应用内下载只对安装包有意义：其它附件下在 App 私有目录，文件管理器里看不到，所以仍交给浏览器。'
  }
  return 'App 自己下载并直接调起系统安装器：有进度、不用跳浏览器。首次使用系统会问一次「允许安装未知应用」。'
}

/** 面板底部那行「从哪条线路下」的说明 */
export function routeLabelOf(route: DownloadRoute | null): string {
  if (!route) return '未选择线路'
  return route.label || route.base.replace(/^https?:\/\//, '')
}

/**
 * 线路副标题。
 *
 * 同一个站点可能占两行 —— 源码 ZIP 尤其明显：gh-proxy 既能直取 codeload，
 * 也能走 github 的 archive 302，两条都叫「gh-proxy.com」，光看名字分不清。
 * 这里按地址形状补一句，让两行是不同的东西。
 */
export function routeDetail(route: DownloadRoute): string {
  const host = route.base.replace(/^https?:\/\//, '')
  const url = route.url.toLowerCase()
  const viaCodeload = url.includes('codeload.github.com')
  const viaArchive = url.includes('/archive/refs/')
  const same = route.label === host

  if (same) {
    if (viaCodeload) return 'codeload 直取'
    if (viaArchive) return '经 github 302'
    return route.style === 'url' ? '整段 URL 代理' : '路径代理'
  }
  if (viaCodeload) return `${host} · codeload 直取`
  return host
}

/** 目标的一句话来源说明，给回执用 */
export function targetSummary(t: DownloadTarget): string {
  const size = t.size > 0 ? ` · ${(t.size / 1024 / 1024).toFixed(1)} MB` : ''
  return `${t.subtitle}${size}`
}

/** 站点顺序里是否已经有这条（避免重复加候选） */
export function hasRoute(routes: DownloadRoute[], url: string): boolean {
  const key = url.toLowerCase()
  return routes.some((r) => r.url.toLowerCase() === key)
}

/** 当前镜像对应的站点名，给面板顶部「当前线路」用 */
export function currentMirrorLabel(mirror: string): string {
  return mirrorDefFor(mirror).label
}
