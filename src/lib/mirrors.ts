/**
 * 下载加速站（GitHub 反代）。
 *
 * 国内直连 github.com 基本不通，App 的安装包与 README 图片都靠这类代理。
 * 但代理有两种路径风格，传错就 404，所以风格必须跟着站点一起记，不能靠猜：
 *
 *   path：{base}/{owner}/{repo}/releases/...        透明路径反代（自建 Worker 一般就是这样）
 *   url ：{base}/https://github.com/{owner}/{repo}/... 整段 URL 反代（gh-proxy 系）
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

/**
 * 默认站点：官方直连。
 *
 * v1.1.3 起包里不再预置任何加速站。原因不是技术上的 —— 自建反代的地址被
 * 别人扒去用了，流量算在作者账上，而每一个装了这个包的人都默认走它，
 * 等于把账单摊给一个不认识的服务器。现在要加速就自己填，填完存本地。
 *
 * 老版本存过地址的照旧生效（见 migrateLegacyMirrorStore）：升级只影响
 * 「以后的新装包」，已经在用的机器不会被改配置。
 */
export const DEFAULT_MIRROR = 'https://github.com'

/** 迁移后的老自建站沿用这个 id，好让候选表仍把它固定在靠前的位置 */
export const SELF_ID = 'self'

/**
 * 用户自己配的自建站地址（没有就是空串）。
 *
 * 以前这里是内置地址兜底；现在内置表里根本没有加速站，返回值只可能来自
 * 用户本地存的站点表，拿不到就返回空 —— 调用方要么跳过这一位，要么
 * 自然退回官方直连，不会拼出别人的域名。
 */
export function selfMirrorBase(): string {
  const hit = REGISTRY.find((m) => m.id === SELF_ID && m.base)
  return normalizeBase(hit?.base ?? '')
}

/** 保序去重（大小写不敏感），地址列表通用 */
function uniqUrls(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const url of list) {
    const key = (url ?? '').toLowerCase()
    if (!url || seen.has(key)) continue
    seen.add(key)
    out.push(url)
  }
  return out
}

export const OFFICIAL_MIRROR: MirrorDef = {
  id: 'official',
  label: '官方直连',
  base: 'https://github.com',
  style: 'path',
  page: true,
  note: '不加速，能直连 github.com 时才快',
}

/**
 * 内置站点表：只有官方直连。
 *
 * 加速站一个都不预置 —— 包一旦发出去，里面的域名就跟着几十台设备走，
 * 流量成本落在域名所有者的账单上。用户要加速，在面板里填一次，存在本机。
 */
export const BUILTIN_MIRRORS: MirrorDef[] = [OFFICIAL_MIRROR]

/** 去掉结尾斜杠、补全协议；空串原样返回，交给调用方决定兜底 */
export function normalizeBase(base: string): string {
  const s = (base ?? '').trim()
  if (!s) return ''
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`
  return withScheme.replace(/\/+$/, '')
}

/* ---------------- 用户自定义站点 ---------------- */

/**
 * 加速站会换域名（自建 worker 尤其如此），所以站点表不能写死在代码里：
 *
 * - overrides：内置站点的「改地址」。id 不变（zjkl / ghproxy…），
 *   地址换成新的，这样所有引用该站的地方自动跟着变，不用改代码重打包。
 * - custom：用户自己加的站点。给个名字、地址、路径风格就能参与测速。
 *
 * 两者都存本地，启动时喂给 setMirrorRegistry()，让 githubUrlAt / rawUrlAt
 * 这类「只知道 base 不知道 style」的函数也能查回风格。
 */
export interface MirrorStore {
  overrides: Record<string, string>
  custom: MirrorDef[]
}

export const EMPTY_STORE: MirrorStore = { overrides: {}, custom: [] }

/** 容错解析：旧版本、损坏 JSON、脏字段一律退化成空表，不能让界面启动就崩 */
export function parseMirrorStore(raw: string | null | undefined): MirrorStore {
  if (!raw) return { overrides: {}, custom: [] }
  try {
    const d = JSON.parse(raw) as Partial<MirrorStore>
    const overrides: Record<string, string> = {}
    for (const [k, v] of Object.entries(d.overrides ?? {})) {
      const base = normalizeBase(String(v ?? ''))
      if (k && base) overrides[k] = base
    }
    const custom: MirrorDef[] = []
    for (const item of Array.isArray(d.custom) ? d.custom : []) {
      const base = normalizeBase(String(item?.base ?? ''))
      if (!base) continue
      const id = String(item?.id ?? '').trim() || `u-${base}`
      if (custom.some((c) => c.id === id || c.base.toLowerCase() === base.toLowerCase())) continue
      custom.push({
        id,
        label: String(item?.label ?? '').trim() || base.replace(/^https?:\/\//, ''),
        base,
        style: item?.style === 'url' ? 'url' : 'path',
        ...(item?.page ? { page: true } : {}),
      })
    }
    return { overrides, custom }
  } catch {
    return { overrides: {}, custom: [] }
  }
}

export function serializeMirrorStore(store: MirrorStore): string {
  return JSON.stringify({ overrides: store.overrides ?? {}, custom: store.custom ?? [] })
}

/** 把 overrides 应用到内置表：id 保持不变，只换地址 */
export function applyOverrides(
  list: MirrorDef[],
  overrides: Record<string, string> = {},
): MirrorDef[] {
  return list.map((m) => {
    const base = normalizeBase(overrides[m.id] ?? '')
    return base ? { ...m, base } : m
  })
}

/** 最终生效的站点表：内置（已套用改地址）+ 自定义（与内置重复的丢掉） */
export function effectiveMirrors(store: MirrorStore = EMPTY_STORE): MirrorDef[] {
  const builtin = applyOverrides(BUILTIN_MIRRORS, store.overrides)
  const seen = new Set(builtin.map((m) => m.base.toLowerCase()))
  const custom: MirrorDef[] = []
  for (const c of store.custom ?? []) {
    const base = normalizeBase(c.base)
    if (!base || seen.has(base.toLowerCase())) continue
    seen.add(base.toLowerCase())
    custom.push({ ...c, base, style: c.style === 'url' ? 'url' : 'path' })
  }
  return [...builtin, ...custom]
}

/**
 * 旧版本内置站的路径风格。**只有 id 与风格，没有地址**。
 *
 * 用途仅限 v1.1.3 的一次性迁移：用户改过地址的内置站，在新包里已经没有这个
 * id 了，得转成自定义站；转的时候要沿用原来的路径风格，否则 url 型反代会被
 * 按 path 拼，下载直接 404。这张表不参与任何候选生成。
 */
const LEGACY_STYLE: Record<string, { style: MirrorStyle; page?: boolean; label?: string }> = {
  zjkl: { style: 'path', page: true, label: '自建加速' },
  ghproxy: { style: 'url' },
  ghfast: { style: 'url' },
  ghproxynet: { style: 'url' },
  imciel: { style: 'url' },
  gitproxy: { style: 'path' },
}

/**
 * v1.1.3 迁移：把失效的「内置站改地址」转成自定义站。
 *
 * 包里不再预置加速站，但**老用户机器上存过的地址一条都不能丢** ——
 * 用户说「已经安装的不影响」，所以这里只做加法：地址搬到 custom 里，
 * 选中项原样保留，不写任何新地址。
 *
 * `changed` 为真表示站点表被改写，调用方要把结果写回本地。
 */
export function migrateLegacyMirrorStore(
  store: MirrorStore,
  selected?: string | null,
): { store: MirrorStore; selected: string; changed: boolean } {
  const builtinIds = new Set(BUILTIN_MIRRORS.map((m) => m.id))
  const custom = [...(store.custom ?? [])]
  const overrides: Record<string, string> = {}
  let changed = false

  for (const [id, rawBase] of Object.entries(store.overrides ?? {})) {
    const base = normalizeBase(rawBase)
    if (!base) continue
    if (builtinIds.has(id)) {
      overrides[id] = base
      continue
    }
    changed = true
    if (custom.some((c) => c.base.toLowerCase() === base.toLowerCase())) continue
    const meta = LEGACY_STYLE[id]
    custom.push({
      id: id === 'zjkl' ? SELF_ID : id,
      label: meta?.label ?? base.replace(/^https?:\/\//, ''),
      base,
      style: meta?.style ?? 'path',
      ...(meta?.page ? { page: true } : {}),
    })
  }

  const sel = normalizeBase(selected ?? '') || DEFAULT_MIRROR
  return { store: { overrides, custom }, selected: sel, changed }
}

/**
 * 这个地址是不是站点表里登记过的。
 *
 * 用来区分「用户明确选了 path 风格」和「从旧版本继承来、风格未知」——
 * 后者要同时给出两种拼法，让探活自己挑，不能因为猜错风格就下不动。
 */
export function mirrorKnown(base: string): boolean {
  const t = normalizeBase(base).toLowerCase()
  if (!t) return false
  if (BUILTIN_MIRRORS.some((m) => m.base.toLowerCase() === t)) return true
  return REGISTRY.some((m) => m.base.toLowerCase() === t)
}

/** 模块级注册表：给只拿到 base 的调用方（图片、release 下载）反查风格 */
let REGISTRY: MirrorDef[] = []

export function setMirrorRegistry(list: MirrorDef[]): void {
  REGISTRY = list.map((m) => ({ ...m, base: normalizeBase(m.base) })).filter((m) => m.base)
}

export function resetMirrorRegistry(): void {
  REGISTRY = []
}

/** 当前注册表（测试与设置页展示用） */
export function mirrorRegistry(): MirrorDef[] {
  return REGISTRY
}

/** 可翻 HTML 页面的站点：注册表里第一个带 page 的自定义站；没有就交回官方 */
export function fallbackPageBase(): string {
  const hit = REGISTRY.find((m) => m.page && m.base && m.id !== 'official')
  return hit?.base ?? ''
}

/**
 * 校验用户填的地址。
 * 不校验「必须能访问」——那要联网，交给测速按钮；这里只管格式别把配置写坏。
 */
export function validateMirrorBase(raw: string): { ok: boolean; base: string; error?: string } {
  const base = normalizeBase(raw)
  if (!base) return { ok: false, base: '', error: '地址不能为空' }
  let url: URL
  try {
    url = new URL(base)
  } catch {
    return { ok: false, base, error: '地址格式不对，示例：gh.example.com' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, base, error: '只支持 http / https' }
  }
  if (!url.hostname || (!url.hostname.includes('.') && url.hostname !== 'localhost')) {
    return { ok: false, base, error: '域名不完整' }
  }
  if (url.search || url.hash) {
    return { ok: false, base, error: '地址不要带 ? 或 #' }
  }
  return { ok: true, base }
}

/** 自定义站 id：加时间戳 + 自增序号，避免同一毫秒内连加两个导致 id 撞车 */
let customSeq = 0
function nextCustomId(): string {
  customSeq += 1
  return `u${Date.now().toString(36)}${customSeq.toString(36)}`
}

/** 加一个自定义站点；地址与内置重复时返回原表（由调用方提示） */
export function addCustomMirror(
  store: MirrorStore,
  input: { label?: string; base: string; style: MirrorStyle; page?: boolean },
): MirrorStore {
  const base = normalizeBase(input.base)
  if (!base) return store
  const all = effectiveMirrors(store)
  if (all.some((m) => m.base.toLowerCase() === base.toLowerCase())) return store
  const def: MirrorDef = {
    id: nextCustomId(),
    label: (input.label ?? '').trim() || base.replace(/^https?:\/\//, ''),
    base,
    style: input.style === 'url' ? 'url' : 'path',
    ...(input.page ? { page: true } : {}),
  }
  return { ...store, custom: [...store.custom, def] }
}

export function removeCustomMirror(store: MirrorStore, id: string): MirrorStore {
  return { ...store, custom: store.custom.filter((c) => c.id !== id) }
}

/** 改地址：内置站点写进 overrides，自定义站点直接改 base */
export function setMirrorBase(store: MirrorStore, id: string, rawBase: string): MirrorStore {
  const base = normalizeBase(rawBase)
  const builtin = BUILTIN_MIRRORS.find((m) => m.id === id)
  if (builtin) {
    const next = { ...store.overrides }
    if (!base || base === builtin.base) delete next[id]
    else next[id] = base
    return { ...store, overrides: next }
  }
  return {
    ...store,
    custom: store.custom.map((c) => (c.id === id ? { ...c, base: base || c.base } : c)),
  }
}

/** 恢复某个内置站点的原始地址 */
export function resetMirrorBase(store: MirrorStore, id: string): MirrorStore {
  const next = { ...store.overrides }
  delete next[id]
  return { ...store, overrides: next }
}

export function isOverridden(store: MirrorStore, id: string): boolean {
  return !!normalizeBase(store.overrides[id] ?? '')
}

/** 已知站点查表；自定义地址按 path 风格处理（最常见） */
export function mirrorDefFor(base: string): MirrorDef {
  const target = normalizeBase(base).toLowerCase()
  const hit =
    REGISTRY.find((m) => m.base.toLowerCase() === target) ??
    BUILTIN_MIRRORS.find((m) => m.base.toLowerCase() === target)
  if (hit) return hit
  return { id: 'custom', label: normalizeBase(base) || '未设置', base: normalizeBase(base), style: 'path' }
}

/**
 * 参与测速与展示的站点：注册表（含自定义与改地址）+ 当前自定义站。
 * 当前站不在表里时补在最前面，否则用户选中了却在列表里看不见。
 */
export function mirrorCandidates(current: string): { base: string; label: string; note?: string }[] {
  const cur = normalizeBase(current)
  const source = REGISTRY.length > 0 ? REGISTRY : BUILTIN_MIRRORS
  const rows = source.map((m) => ({ base: m.base, label: m.label, note: m.note }))
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

/** 仓库主页（HTML）。和 Release 页同理：下载型镜像不翻页，得退回能翻页的站点 */
export function repoPageUrl(base: string, fullName: string): string {
  const def = mirrorDefFor(base)
  const useBase = def.page ? def.base : fallbackPageBase()
  return githubUrlAt(useBase, fullName.split('/').map(seg).join('/'))
}

/** Release 页面（HTML）。当前镜像不翻页时退回能翻页的站点，保证按钮点得开 */
export function releasePageUrl(base: string, owner: string, repo: string, tag?: string): string {
  const def = mirrorDefFor(base)
  const useBase = def.page ? def.base : fallbackPageBase()
  const tail = tag ? `/releases/tag/${seg(tag)}` : '/releases'
  return githubUrlAt(useBase, `${seg(owner)}/${seg(repo)}${tail}`)
}

/* ---------------- Release 资产：多站候选 ---------------- */

/**
 * 能吃 release 资产的公共反代：**一个都不内置**。
 *
 * v1.1.3 起这个表是空的。以前这里放的是实测过吞吐的四家公共代理，问题不在
 * 它们本身 —— 而是「包里带地址」这件事等于替第三方做分发，谁被写进包里，
 * 谁的带宽就被所有装了 App 的人一起用。所以留成空表 + 参数注入：
 * 想加线路的用户自己填站，站点表里有的自然会进候选；单测也能显式传表。
 *
 * 历史实测（2026-11-20，对同一 APK 发 HEAD）：四家都能回 200 且长度一致，
 * 另有某家回 200 但只有 195 字节（错误页），所以「能连上」不等于「能下包」，
 * 加线路前必须比对长度。
 */
export const KNOWN_RELEASE_PROXIES: string[] = []

/**
 * 下载候选：用户自己的站排前面，官方直连永远垫底。
 *
 * 顺序由三件事决定：
 *
 * - 用户选中的站排最前 —— 站点修好之后必须立刻恢复默认线路，不能因为兜底表
 *   存在就永久绕开它。它真的坏了也不会卡住，探活会跳过。
 * - **用户的自建站固定占一位，紧跟在选中站后面**。这不是冗余：开了「自动选最快」
 *   之后 selected 会在后台被换掉，自建站就不再是 selected，于是从表里整个消失 ——
 *   用户看到的就是「我的加速站不见了」。它由用户自己填，理应在候选里常驻。
 * - **官方直连不进前三**。它建连快、首包快，256 KB 测速常年第一，但长时段
 *   吞吐会掉下来（跨境链路 + 无缓存），几百 KB 的探针根本反映不出这一点。
 *   所以这里把它固定在末尾：只有前面的线路全挂时才轮到它。
 *
 * `proxies` 默认是空表：包里不带任何第三方代理地址，要加线路由调用方显式传入
 * （用户站点表里有的话），或用户自己在面板里填。
 */
export function releaseCandidates(
  base: string,
  owner: string,
  repo: string,
  tag: string,
  asset: string,
  proxies?: string[],
  selfBase: string = selfMirrorBase(),
): string[] {
  const official = 'https://github.com'
  const path = `${seg(owner)}/${seg(repo)}/releases/download/${seg(tag)}/${seg(asset)}`
  const officialUrl = githubUrlAt(official, path)
  const chosen = normalizeBase(base)
  const self = normalizeBase(selfBase)
  // 不传就是「用户填过的所有 url 型站」；传空数组表示只要选中站与自建站
  const pool = proxies ?? userProxyBases([chosen, self])

  const head: string[] = []
  if (chosen && chosen !== official) {
    head.push(githubUrlAt(chosen, path))
    // 从旧版本继承来的地址没有风格记录：再给一条 url 拼法，让探活自己挑对的。
    // 猜错风格不该等于下不动包，代价只是多探一条。
    if (!mirrorKnown(chosen)) head.push(`${chosen}/https://github.com/${path}`)
  }
  if (self && self !== official && self.toLowerCase() !== chosen.toLowerCase()) {
    head.push(githubUrlAt(self, path))
  }
  for (const p of pool) if (p) head.push(githubUrlAt(p, path))

  const others = uniqUrls(head).filter((u) => u !== officialUrl)
  return [...others.slice(0, 6), officialUrl]
}

/** 探活回调：true 表示这条线路能下 */
export type ReachProbe = (url: string) => Promise<boolean>

/**
 * 站点表里所有 url 型站（用户自己填的），按登记顺序去重。
 *
 * v1.1.3 之前这里是内置的公共代理表；现在包里没有地址，能进候选的只能是
 * 用户填过的站。`exclude` 用来把「已经单独占位的选中站 / 自建站」剔掉，
 * 免得同一条线路在表里出现两次。
 */
export function userProxyBases(exclude: string[] = []): string[] {
  const skip = new Set(exclude.map((b) => normalizeBase(b).toLowerCase()).filter(Boolean))
  const out: string[] = []
  for (const m of REGISTRY) {
    if (m.style !== 'url' || m.id === 'official') continue
    const base = normalizeBase(m.base)
    if (!base || skip.has(base.toLowerCase())) continue
    out.push(base)
  }
  return uniqUrls(out)
}

/**
 * 顺序探活，返回第一条通的。
 *
 * 全都不通时回第一条而不是报错：探活本身会失败（企业网络拦 HEAD、代理没给 CORS），
 * 这时候把选择权交回浏览器比直接判定「下载失败」更有机会成功。
 */
export async function pickReachable(candidates: string[], probe: ReachProbe): Promise<string> {
  for (const url of candidates) {
    try {
      if (await probe(url)) return url
    } catch {
      // 探活自身异常按不通处理，继续下一条
    }
  }
  return candidates[0] ?? ''
}

/* ---------------- 测速 ---------------- */

/** 单次探测拉多少字节。够看出吞吐，又不至于在移动网络下太费流量 */
export const PROBE_BYTES = 256 * 1024
/**
 * 单条线路的超时。
 *
 * 8 秒是串行时代的数字 —— 那时一条挂掉就白等 8 秒，六条能拖到 48 秒。
 * 现在是并发测，超时只需覆盖「建连 + 前 256 KB」，6 秒足够；真慢到 6 秒还
 * 没吐完的线路，就算通了也不该排在第一位。
 */
export const PROBE_TIMEOUT = 6000
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
