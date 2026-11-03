/**
 * README 机翻。
 *
 * 约束来自真实的免费通道：
 * - MyMemory 单次请求上限 500 字节，超了直接返回警告串，所以必须切段；
 * - Google 的 gtx 端点没有官方承诺，国内常常连不通，只能当备选；
 * - 两者都会把换行转成 `&#10;`，要反转义回来。
 *
 * 因此这里做三件事：按字节切分、按通道顺序降级、译文按内容哈希缓存。
 */
import type { KV } from './storage'

export type TranslateChannel = 'auto' | 'google' | 'mymemory'

export const TRANSLATE_CHANNELS: { key: TranslateChannel; label: string; hint: string }[] = [
  { key: 'auto', label: '自动', hint: '先用 MyMemory，失败再试 Google' },
  { key: 'mymemory', label: 'MyMemory', hint: '国内可达，单段 500 字节上限' },
  { key: 'google', label: 'Google', hint: '质量稍好，但国内常连不上' },
]

/** MyMemory 免费额度按字符算，单段留点余量 */
export const MYMEMORY_MAX_BYTES = 450
/** Google 走 URL 传参，太长会被截断 */
export const GOOGLE_MAX_BYTES = 1400

/** 默认走自动降级；国内网络下这是成功率最高的组合 */
export const DEFAULT_CHANNEL: TranslateChannel = 'auto'
/** 打开自述时默认自动翻，用户可以在设置里关掉 */
export const DEFAULT_AUTO_TRANSLATE = true

/** 存进本地的通道值可能是旧版本、空白或脏数据，一律归一到合法值 */
export function normalizeChannel(raw: string | null | undefined): TranslateChannel {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'google' || v === 'mymemory' || v === 'auto') return v
  return DEFAULT_CHANNEL
}

/** 「开 / 关」在本地存的是字符串，只有明确的 off/0/false 才算关 */
export function normalizeAutoTranslate(raw: string | null | undefined): boolean {
  if (raw == null || raw === '') return DEFAULT_AUTO_TRANSLATE
  const v = raw.trim().toLowerCase()
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return false
  if (v === 'on' || v === '1' || v === 'true' || v === 'yes') return true
  return DEFAULT_AUTO_TRANSLATE
}


export interface TranslateOptions {
  channel?: TranslateChannel
  fetchImpl?: typeof fetch
  /** 单次请求超时（毫秒） */
  timeout?: number
  /** 一段原文最多切成几段，防止超长段落发出几十个请求 */
  maxChunks?: number
}

export class TranslateError extends Error {
  constructor(
    message: string,
    readonly channel: string,
  ) {
    super(message)
    this.name = 'TranslateError'
  }
}

const encoder = new TextEncoder()

export function byteLength(s: string): number {
  return encoder.encode(s).length
}

/** 已经是中文的段落不必再翻，省额度也省时间 */
export function hasChinese(text: string): boolean {
  const han = text.match(/[\u4e00-\u9fa5]/g)?.length ?? 0
  const letters = text.replace(/\s/g, '').length || 1
  return han / letters > 0.15
}

/** 通道返回里常见的 HTML 实体 */
export function unescapeHtml(s: string): string {
  return (
    s
      // 数字实体统一解：通道偶尔会写成「&# 39；」（插空格、全角分号），
      // 只认固定几条规则会漏，所以在这里一次兜住。
      .replace(/&#\s*(\d{1,6})\s*[;；]/g, (m, d) => {
        const code = Number(d)
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m
        return String.fromCodePoint(code)
      })
      .replace(/&#x\s*([0-9a-f]{1,6})\s*[;；]/gi, (m, h) => {
        const code = parseInt(h, 16)
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m
        return String.fromCodePoint(code)
      })
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
  )
}

/** FNV-1a，够用且不用引依赖；只用于缓存键，不做安全用途 */
export function hashText(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

function splitSentences(s: string): string[] {
  const out: string[] = []
  let buf = ''
  for (const ch of s) {
    buf += ch
    if ('.!?。！？；;'.includes(ch)) {
      out.push(buf)
      buf = ''
    }
  }
  if (buf) out.push(buf)
  return out.filter((x) => x.trim())
}

/** 硬切：逐字符累加，字节数到顶就断开 */
function hardSplit(s: string, maxBytes: number): string[] {
  const out: string[] = []
  let buf = ''
  for (const ch of s) {
    if (byteLength(buf + ch) > maxBytes) {
      if (buf) out.push(buf)
      buf = ch
    } else {
      buf += ch
    }
  }
  if (buf) out.push(buf)
  return out
}

/**
 * 按字节上限切分。顺序是：段落 → 句子 → 硬切。
 * 先按段落切能保证语义完整，句子是退让，硬切只在极端长句时兜底。
 */
export function splitByBytes(text: string, maxBytes = MYMEMORY_MAX_BYTES): string[] {
  const out: string[] = []
  const paras = text.split(/\n{2,}/)

  for (const para of paras) {
    const p = para.trim()
    if (!p) continue
    if (byteLength(p) <= maxBytes) {
      out.push(p)
      continue
    }

    let buf = ''
    for (const sentence of splitSentences(p)) {
      if (byteLength(sentence) > maxBytes) {
        if (buf) {
          out.push(buf.trim())
          buf = ''
        }
        out.push(...hardSplit(sentence, maxBytes))
        continue
      }
      if (byteLength(buf + sentence) > maxBytes) {
        if (buf) out.push(buf.trim())
        buf = sentence
      } else {
        buf += sentence
      }
    }
    if (buf.trim()) out.push(buf.trim())
  }

  return out.filter((s) => s.trim())
}

function withTimeout(fetchImpl: typeof fetch, ms: number): typeof fetch {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), ms)
    try {
      return await fetchImpl(input, { ...init, signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
  }
}

async function viaMyMemory(text: string, f: typeof fetch): Promise<string> {
  const url =
    'https://api.mymemory.translated.net/get?q=' +
    encodeURIComponent(text) +
    '&langpair=en|zh-CN'
  const res = await f(url)
  if (!res.ok) throw new TranslateError(`MyMemory 返回 ${res.status}`, 'mymemory')
  const body = (await res.json()) as {
    responseData?: { translatedText?: string }
    responseStatus?: number | string
    responseDetails?: string
  }
  const out = body.responseData?.translatedText ?? ''
  const detail = String(body.responseDetails ?? '')
  if (!out || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(out) || /LIMIT/i.test(detail)) {
    throw new TranslateError(detail || 'MyMemory 未返回译文', 'mymemory')
  }
  return unescapeHtml(out)
}

async function viaGoogle(text: string, f: typeof fetch): Promise<string> {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=' +
    encodeURIComponent(text)
  const res = await f(url)
  if (!res.ok) throw new TranslateError(`Google 返回 ${res.status}`, 'google')
  const body = (await res.json()) as unknown
  if (!Array.isArray(body) || !Array.isArray(body[0])) {
    throw new TranslateError('Google 返回结构异常', 'google')
  }
  const pieces = (body[0] as unknown[])
    .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
    .join('')
  if (!pieces.trim()) throw new TranslateError('Google 未返回译文', 'google')
  return unescapeHtml(pieces)
}

/** 按通道顺序逐个尝试，全失败才抛错 */
export async function translateChunk(
  text: string,
  opts: TranslateOptions = {},
): Promise<{ text: string; channel: Exclude<TranslateChannel, 'auto'> }> {
  const f = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const timed = withTimeout(f, opts.timeout ?? 12_000)
  const order: Exclude<TranslateChannel, 'auto'>[] =
    opts.channel === 'google'
      ? ['google']
      : opts.channel === 'mymemory'
        ? ['mymemory']
        : ['mymemory', 'google']

  const errors: string[] = []
  for (const ch of order) {
    try {
      const out = ch === 'google' ? await viaGoogle(text, timed) : await viaMyMemory(text, timed)
      return { text: out, channel: ch }
    } catch (err) {
      errors.push(`${ch}: ${(err as Error).message}`)
    }
  }
  throw new TranslateError(errors.join(' | ') || '翻译失败', order.join('+'))
}

export interface TranslationStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

/** 用现有 KV 存译文，key 带内容哈希，同一段文字只翻一次 */
export function kvStore(kv: KV): TranslationStore {
  const PREFIX = 'ghx.tr.v1.'
  return {
    async get(key) {
      try {
        return await kv.get(PREFIX + key)
      } catch {
        return null
      }
    },
    async set(key, value) {
      try {
        await kv.set(PREFIX + key, value)
      } catch {
        /* 存不下就算了，下次重翻 */
      }
    },
  }
}

/** 内存实现，测试与临时会话用 */
export function memoryStore(seed: Record<string, string> = {}): TranslationStore {
  const map = new Map(Object.entries(seed))
  return {
    async get(key) {
      return map.get(key) ?? null
    },
    async set(key, value) {
      map.set(key, value)
    },
  }
}

export interface TranslateResult {
  text: string
  /** 实际使用的通道；全部命中缓存时为 cached */
  channel: string
  /** 命中缓存的段数 / 总段数 */
  cached: number
  total: number
}

/**
 * 翻译一段可能很长的文字：切段 → 查缓存 → 并发请求 → 拼回。
 * 单段失败只留原文，不让整篇崩掉。
 */
export async function translateText(
  text: string,
  opts: TranslateOptions & { store?: TranslationStore; concurrency?: number } = {},
): Promise<TranslateResult> {
  const trimmed = text.trim()
  if (!trimmed) return { text: '', channel: 'none', cached: 0, total: 0 }

  const maxBytes = opts.channel === 'google' ? GOOGLE_MAX_BYTES : MYMEMORY_MAX_BYTES
  let chunks = splitByBytes(trimmed, maxBytes)
  if (opts.maxChunks && chunks.length > opts.maxChunks) {
    chunks = chunks.slice(0, opts.maxChunks)
  }

  const results: string[] = new Array(chunks.length)
  let cached = 0
  let channel = 'cached'
  const pending: number[] = []

  for (let i = 0; i < chunks.length; i += 1) {
    const key = `${opts.channel ?? 'auto'}.${hashText(chunks[i])}`
    const hit = opts.store ? await opts.store.get(key) : null
    if (hit !== null) {
      results[i] = hit
      cached += 1
    } else {
      pending.push(i)
    }
  }

  const limit = Math.max(1, opts.concurrency ?? 2)
  let cursor = 0

  async function worker() {
    while (cursor < pending.length) {
      const idx = pending[cursor]
      cursor += 1
      try {
        const r = await translateChunk(chunks[idx], opts)
        results[idx] = r.text
        channel = r.channel
        if (opts.store) await opts.store.set(`${opts.channel ?? 'auto'}.${hashText(chunks[idx])}`, r.text)
      } catch {
        results[idx] = chunks[idx]
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, pending.length) }, worker))
  return { text: results.join('\n\n'), channel, cached, total: chunks.length }
}

/** 需要翻译的块类型：代码块保持原样，分隔线没有文字 */
export interface BlockLike {
  kind: string
  text?: string
  [key: string]: unknown
}

export interface TranslateBlocksResult<B extends BlockLike> {
  blocks: B[]
  translated: number
  total: number
  channel: string
}

/**
 * 按块翻译，保留标题层级、列表缩进与代码块。
 * 只翻前面 maxBlocks 个块 —— README 后半段常是贡献指南、许可证，
 * 全翻既慢又烧免费额度。
 */
export async function translateBlocks<B extends BlockLike>(
  blocks: B[],
  opts: TranslateOptions & {
    store?: TranslationStore
    maxBlocks?: number
    concurrency?: number
    onProgress?: (done: number, total: number) => void
    /** 每翻好一段就回调，界面可以边翻边显示，不必等全部完成 */
    onBlock?: (index: number, text: string) => void
  } = {},
): Promise<TranslateBlocksResult<B>> {
  const maxBlocks = opts.maxBlocks ?? 30
  const targets: number[] = []

  for (let i = 0; i < blocks.length && targets.length < maxBlocks; i += 1) {
    const b = blocks[i]
    if (b.kind === 'code' || b.kind === 'hr') continue
    const text = (b.text ?? '').trim()
    if (!text || hasChinese(text)) continue
    targets.push(i)
  }

  if (targets.length === 0) {
    return { blocks, translated: 0, total: 0, channel: 'none' }
  }

  const out = blocks.map((b) => ({ ...b }))
  let done = 0
  /** 真正拿到译文的段数（缓存命中也算），全部失败时界面要能看出来 */
  let ok = 0
  let channel = 'cached'
  const limit = Math.max(1, opts.concurrency ?? 2)
  let cursor = 0

  async function worker() {
    while (cursor < targets.length) {
      const idx = targets[cursor]
      cursor += 1
      const src = (blocks[idx].text ?? '').trim()
      const key = `${opts.channel ?? 'auto'}.${hashText(src)}`
      try {
        const hit = opts.store ? await opts.store.get(key) : null
        if (hit !== null) {
          out[idx] = { ...out[idx], text: hit }
          ok += 1
          opts.onBlock?.(idx, hit)
        } else {
          const r = await translateChunk(src, opts)
          out[idx] = { ...out[idx], text: r.text }
          channel = r.channel
          ok += 1
          opts.onBlock?.(idx, r.text)
          if (opts.store) await opts.store.set(key, r.text)
        }
      } catch {
        /* 这一段保持原文 */
      }
      done += 1
      opts.onProgress?.(done, targets.length)
    }
  }

  // 先把总段数报出去，界面才不会一直显示「翻译 …」
  opts.onProgress?.(0, targets.length)
  await Promise.all(Array.from({ length: Math.min(limit, targets.length) }, worker))
  return { blocks: out, translated: ok, total: targets.length, channel }
}
