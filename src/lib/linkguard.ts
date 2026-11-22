/**
 * 机翻时保住行内结构：链接、粗体、斜体、删除线、代码。
 *
 * 旧办法是把片段包成 ⟦标签⟧ 占位符，指望翻译通道原样吐回来。真机长文里
 * 通道会把这些括号「本地化」成 〖〗、吞掉一半、或者把顺序挪走，于是
 * restore 找不到占位符就整段降级 —— 用户看到的正是「链接被顶掉」
 * 和「正文里冒出 〖〗 / ◆◆」。
 *
 * 现在改成不依赖通道：把一段按 spans 拆成「可翻片段」和「原样片段」，
 * 只把可翻片段逐条送进通道，回来按原顺序拼回本地保存的 spans。
 * 链接地址从头到尾没离开过本机，所以顺序、数量、href 全部确定；
 * 纯地址标签与 emoji/符号片段干脆不送翻（送了只会被改写）。
 *
 * 兜底一律取「宁可这段不翻，不可翻坏」：
 * - 片段译文缺失 / 译文里出现替换字符（通道把 emoji 啃成 ◆ 或 �）→
 *   返回 null，调用方保留原块。少一段译文远好过错位链接。
 */

import type { Span } from './markdown'
import type { BlockGuard } from './translate'

/** 一段里需要回填的最小单位 */
export interface InlinePart {
  kind: 'text' | 'link' | 'strong' | 'em' | 'del' | 'code'
  /** link 才有：地址原样保存在本地，永不经过翻译通道 */
  href?: string
  /** 片段原文；translate 为 false 时按原样回填 */
  source: string
  /** 是否送进翻译通道 */
  translate: boolean
}

export interface InlineGuardCtx {
  parts: InlinePart[]
}

export interface InlinePlan {
  /** 送进通道的片段，顺序即回填顺序 */
  parts: string[]
  ctx: InlineGuardCtx
}

export interface UnguardedText {
  text: string
  spans: Span[]
}

/** 有字母、数字或汉字才算「有话可翻」 */
const WORD = /[\p{L}\p{N}]/u
/** 整段就是一个地址（裸 URL 被 linkify 后标签就是地址本身） */
const URL_ONLY = /^(?:https?:\/\/|www\.)\S+$/i
/** 已经就是中文的片段：目标中文时不必送翻，省一次请求也避免改写 */
const HAN = /[\u3400-\u9fff]/
const LATIN = /[A-Za-z\u00c0-\u024f]/
/** 通道破坏字符的痕迹：替换符 / 黑菱形 / 黑方块 */
const BROKEN = /[\uFFFD\u25C6\u25A0]/

/**
 * 这个片段值不值得送翻。
 * 纯地址、纯符号（emoji、箭头、分隔线）、已是目标语言的中文都不送。
 */
function shouldTranslate(v: string, target: string): boolean {
  const t = v.trim()
  if (!t) return false
  if (URL_ONLY.test(t)) return false
  if (!WORD.test(t)) return false
  if (target.startsWith('zh') && HAN.test(t) && !LATIN.test(t)) return false
  return true
}

/**
 * 把行内 spans 拆成片段计划。
 *
 * 返回 null 表示「这一段没什么要保的、也没什么可翻的」，走原管线即可。
 * 只要存在链接/粗体等结构，即使一个片段都不翻也返回计划 —— 这样译文
 * 回来时能把结构原样拼回去，而不是把带格式的段落交给纯文本替换。
 */
export function planInline(
  spans: Span[] | undefined,
  target = 'zh-CN',
): InlinePlan | null {
  if (!spans || spans.length === 0) return null
  const parts: InlinePart[] = []
  let need = false
  let structure = false

  for (const sp of spans) {
    if (sp.t === 'code') {
      parts.push({ kind: 'code', source: sp.v, translate: false })
      structure = true
      continue
    }
    const tr = shouldTranslate(sp.v, target)
    if (tr) need = true
    if (sp.t !== 'text') structure = true
    parts.push(
      sp.t === 'link'
        ? { kind: 'link', href: sp.href, source: sp.v, translate: tr }
        : { kind: sp.t, source: sp.v, translate: tr },
    )
  }

  if (!need && !structure) return null
  return {
    parts: parts.filter((p) => p.translate).map((p) => p.source),
    ctx: { parts },
  }
}

/**
 * 译文被通道啃过的痕迹：
 * - 出现原文没有的替换符 / 黑菱形 / 黑方块（emoji 被写成 ◆◆ 的典型样子）；
 * - 原文有 emoji、译文却少了（被换成 ? 或整个吃掉）。
 * 命中就放弃这段译文，宁可保留英文，也不让正文出现问号方块。
 */
function polluted(translated: string, source: string): boolean {
  if (BROKEN.test(translated) && !BROKEN.test(source)) return true
  // 箭头、星号这类「符号」不算 Extended_Pictographic，用 So 一起兜住
  const SYMBOL = symbolPattern()
  // 内核的 Unicode 数据太旧、这两个属性都不认时，退化成只靠替换符判断。
  // 不能因为「数不清 emoji」就让整段翻译流程抛错。
  if (!SYMBOL) return false
  const before = (source.match(SYMBOL) ?? []).length
  if (before > 0) {
    const after = (translated.match(SYMBOL) ?? []).length
    if (after < before) return true
  }
  return false
}

/**
 * 符号正则。
 *
 * 刻意用 `new RegExp` 而不是字面量：`\p{Extended_Pictographic}` 要在
 * Unicode 11 以上的数据里才有，老内核编译**字面量**会在解析阶段抛 SyntaxError，
 * 那等于整个包一行都不执行（页面纯黑）。放到运行时构造，最坏也只是这条判断失效。
 */
let symbolRe: RegExp | null | undefined
function symbolPattern(): RegExp | null {
  if (symbolRe !== undefined) return symbolRe
  try {
    symbolRe = new RegExp('\\p{Extended_Pictographic}|\\p{So}', 'gu')
  } catch {
    try {
      symbolRe = new RegExp('\\p{So}', 'gu')
    } catch {
      symbolRe = null
    }
  }
  return symbolRe
}

/**
 * 译文回填：按片段顺序把译文填回本地结构。
 *
 * 片段缺一条就返回 null（宁可这段保留原文），绝不按「大概位置」硬配。
 */
export function applyInline(translated: string[], ctx: unknown): UnguardedText | null {
  const parts = (ctx as InlineGuardCtx | undefined)?.parts
  if (!Array.isArray(parts)) return null

  const expected = parts.filter((p) => p.translate).length
  if (translated.length !== expected) return null

  const spans: Span[] = []
  let cursor = 0
  const pushText = (v: string) => {
    if (!v) return
    const last = spans[spans.length - 1]
    // 相邻纯文本合并，避免一行被切成十几个碎片（渲染层每个 span 一个节点）
    if (last && last.t === 'text') last.v += v
    else spans.push({ t: 'text', v })
  }

  for (const p of parts) {
    let v = p.source
    if (p.translate) {
      const raw = translated[cursor]
      cursor += 1
      if (typeof raw !== 'string') return null
      if (polluted(raw, p.source)) return null
      // 只压平换行/连续空白，不 trim 两端 —— 片段之间的空格也是句子的一部分
      const t = raw.replace(/\s+/g, ' ')
      // 通道偶尔返回空串：保留原文比留个洞好
      v = t.trim() ? t : p.source
    }
    if (!v) continue
    if (p.kind === 'link') spans.push({ t: 'link', v, href: p.href ?? '' })
    else if (p.kind === 'code') spans.push({ t: 'code', v })
    else if (p.kind === 'text') pushText(v)
    else spans.push({ t: p.kind, v })
  }

  if (cursor !== expected) return null
  const text = spans.map((s) => s.v).join('').trim()
  if (!text) return null
  return { text, spans }
}

/**
 * 给 translateBlocks 用的标准 guard。
 *
 * README、发行说明、Issue 正文都走这里，免得三处各写一份、改一处漏两处。
 * 泛型只要求块上带 spans；restore 出来的块仍满足调用方的 Block 类型。
 */
export function inlineGuard<B = unknown>(target: string): BlockGuard<B> {
  return {
    protect: (b) => {
      const p = planInline((b as { spans?: Span[] }).spans, target)
      return p ? { parts: p.parts, ctx: p.ctx } : null
    },
    restore: (b, translated, ctx) => {
      const r = applyInline(translated, ctx)
      if (!r) return null
      return { ...b, text: r.text, spans: r.spans, spansFor: r.text } as B
    },
  }
}
