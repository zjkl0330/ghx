/**
 * 机翻时保住行内格式：链接、粗体、斜体、删除线。
 *
 * 翻译管线只处理纯文本（块.text）；行内 spans 里的链接地址早就被 inline()
 * 剥掉了，粗体标记 `**` 更是在 text 里连影子都没有。译文一替换，spansFor
 * 对不上，渲染退回现场解析译文 —— 于是链接全变死文字，粗体整段消失。
 *
 * 解法是占位符：翻译前把每个需要保住的片段换成 ⟦内容⟧（U+27E6/27E7，
 * 白方括号），类型与地址按出现顺序存进 ctx；译文回来后按顺序回填。
 * 2026-11 实测 Edge 通道对 ⟦⟧ 的幸存率 6/6（9 个连续 token 也 9/9），
 * 标签还能被顺便翻译（"Windows store" → "Windows商店"）；数字序号反而
 * 会被中文化（"1个"），所以 token 里不写序号。
 *
 * 容错一律取「宁可少格式，不可错配」：
 * - token 数与 ctx 不符（通道吞了 / 命中了旧格式缓存）→ 整段降级纯文字，
 *   绝不按顺序硬配：错位的链接比死链接更糟（点了跳错页）；
 * - 孤立的 ⟦/⟧ 一律清除。
 */

import type { Span } from './markdown'

/** 白方括号：实测翻译通道最稳定的一对包裹符 */
export const GUARD_L = '\u27E6'
export const GUARD_R = '\u27E7'

/** 一个占位符对应的行内语义，按出现顺序排队 */
export type InlineToken =
  | { kind: 'link'; href: string }
  | { kind: 'strong' }
  | { kind: 'em' }
  | { kind: 'del' }

export interface InlineGuardCtx {
  tokens: InlineToken[]
}

export interface GuardedInline {
  /** 送进翻译通道的文字，受保护片段已换成 ⟦内容⟧ */
  text: string
  ctx: InlineGuardCtx
}

/** 这些 span 类型要保；code 保不住原文语义（通道会把命令翻掉），保持原样拼接 */
const KEEP = new Set<Span['t']>(['link', 'strong', 'em', 'del'])

/**
 * 从行内 spans 构造受保护的文字。
 *
 * 没有任何需要保护的片段时返回 null，走原管线不折腾（纯文本段落没损失）。
 * 直接由 spans 拼接而不是用块.text：spans 里链接只剩标签、粗体只剩文字，
 * 正是翻译想要的输入。
 */
export function guardInline(spans: Span[] | undefined): GuardedInline | null {
  if (!spans || !spans.some((s) => KEEP.has(s.t))) return null
  const tokens: InlineToken[] = []
  let out = ''
  for (const sp of spans) {
    if (sp.t === 'link' || sp.t === 'strong' || sp.t === 'em' || sp.t === 'del') {
      // 内容里万一混进了 ⟦/⟧，先剥掉，否则恢复时会把 token 切碎
      const label = sp.v.replace(/[\u27E6\u27E7]/g, '')
      out += `${GUARD_L}${label}${GUARD_R}`
      tokens.push(sp.t === 'link' ? { kind: 'link', href: sp.href } : { kind: sp.t })
    } else {
      out += sp.v
    }
  }
  if (tokens.length === 0) return null
  return { text: out.trim(), ctx: { tokens } }
}

export interface UnguardedText {
  text: string
  spans: Span[]
}

function stripGuards(s: string): string {
  return s.replace(/[\u27E6\u27E7]/g, '')
}

/**
 * 译文回填：⟦内容⟧ 按出现顺序配回语义。
 *
 * 返回完整的行内序列（文本片段与格式化片段交替），调用方直接把它当
 * block.spans 用；block.text 由序列拼接而成。
 */
export function unguardInline(translated: string, ctx: unknown): UnguardedText | null {
  const tokens = (ctx as InlineGuardCtx | undefined)?.tokens
  const re = /\u27E6([^\u27E6\u27E7]*)\u27E7/g
  const total = (translated.match(re) ?? []).length
  if (total === 0) return null

  const plain = (): UnguardedText => {
    const text = stripGuards(translated).trim()
    return { text, spans: [{ t: 'text', v: text }] }
  }
  // 数量对不上就整段降级：吞了几个 token 时按顺序硬配必然错位
  if (!tokens || tokens.length !== total) return plain()

  const spans: Span[] = []
  const pushText = (raw: string) => {
    const v = stripGuards(raw).replace(/[ \t]+/g, ' ')
    if (v) spans.push({ t: 'text', v })
  }
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(translated))) {
    pushText(translated.slice(last, m.index))
    const label = m[1].replace(/\s+/g, ' ').trim()
    const token = tokens[i]
    i += 1
    if (!label) {
      // 通道可能把标签翻没了：保留占位却空内容，直接跳过该片段
    } else if (token.kind === 'link') {
      spans.push({ t: 'link', v: label, href: token.href })
    } else {
      spans.push({ t: token.kind, v: label })
    }
    last = re.lastIndex
  }
  pushText(translated.slice(last))
  const text = spans.map((sp) => sp.v).join('').trim()
  return { text, spans }
}
