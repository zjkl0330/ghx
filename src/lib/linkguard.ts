/**
 * 机翻时保住链接。
 *
 * 翻译管线只处理纯文本（块.text），行内 spans 里挂着的链接地址会被剥掉；
 * 译文一替换，spansFor 对不上，渲染就退回现场解析 —— 译文里没有链接语法，
 * 于是整段可点的链接全变成死文字。用户看到的是「翻译之后链接都没了」。
 *
 * 解法是占位符：翻译前把每个链接标签换成 ⟦标签⟧（U+27E6/27E7，白方括号），
 * 地址存进按出现顺序的数组；译文回来后按出现顺序回填。
 * 2026-11 实测 Edge 通道对 ⟦⟧ 的幸存率 6/6，标签还能被顺便翻译
 * （"Windows store" → "Windows商店"）；数字序号反而会被中文化（"1个"），
 * 所以不写序号。通道把 ⟦⟧ 吃掉时恢复函数返回 null，段落退回
 * 「无链接的纯译文」—— 和旧行为一样，不会更糟。
 */

import type { Span } from './markdown'

/** 白方括号：实测翻译通道最稳定的一对包裹符 */
export const GUARD_L = '\u27E6'
export const GUARD_R = '\u27E7'

export interface GuardedText {
  /** 送进翻译通道的文字，链接标签已换成 ⟦标签⟧ */
  text: string
  /** 按出现顺序的链接地址 */
  hrefs: string[]
}

/**
 * 从行内 spans 构造受保护的文字。没有链接的块返回 null，走原管线不折腾。
 *
 * 直接由 spans 拼接而不是用块.text：spans 里链接的标签与纯文本一致，
 * 拼出来就是「链接只剩标签」的正文，正是翻译想要的输入。
 */
export function guardLinks(spans: Span[] | undefined): GuardedText | null {
  if (!spans || !spans.some((s) => s.t === 'link')) return null
  const hrefs: string[] = []
  let out = ''
  for (const sp of spans) {
    if (sp.t === 'link') {
      // 标签里万一混进了 ⟦/⟧，先剥掉，否则恢复时会把标签切碎
      const label = sp.v.replace(/[\u27E6\u27E7]/g, '')
      out += `${GUARD_L}${label}${GUARD_R}`
      hrefs.push(sp.href)
    } else {
      out += sp.v
    }
  }
  if (hrefs.length === 0) return null
  return { text: out.trim(), hrefs }
}

export interface UnguardedText {
  text: string
  spans: Span[]
}

/**
 * 译文回填：⟦标签⟧ 按出现顺序配回地址。
 *
 * 返回的是完整的行内序列（文本片段与链接交替），调用方直接把它当
 * block.spans 用；block.text 由序列拼接而成，链接文字保留在里面。
 *
 * 容错都是「宁可少链接，不可出怪字」：
 * - token 比地址多（段落里混进了正文自带的 ⟦⟧）→ 文字保留，不当链接；
 * - token 比地址少（通道吞了几个）→ 有几个回几个；
 * - 孤立的 ⟦/⟧ 一律清除。
 * 一个 token 都没有时返回 null，调用方退回纯译文。
 */
export function unguardLinks(translated: string, hrefs: string[]): UnguardedText | null {
  const re = /\u27E6([^\u27E6\u27E7]*)\u27E7/g
  const spans: Span[] = []
  const pushText = (raw: string) => {
    const v = raw.replace(/[\u27E6\u27E7]/g, '').replace(/[ \t]+/g, ' ')
    if (v) spans.push({ t: 'text', v })
  }
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(translated))) {
    pushText(translated.slice(last, m.index))
    const label = m[1].replace(/\s+/g, ' ').trim()
    const href = i < hrefs.length ? hrefs[i] : null
    i += 1
    if (href) spans.push({ t: 'link', v: label, href })
    else if (label) pushText(label) // 地址配不上了，标签降级成纯文字
    last = re.lastIndex
  }
  pushText(translated.slice(last))
  if (i === 0) return null
  const text = spans
    .map((sp) => sp.v)
    .join('')
    .trim()
  return { text, spans }
}
