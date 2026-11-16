/**
 * 自述目录。
 *
 * README 动辄几百行，手机上从头划到尾很痛苦。这里从已解析的块里抽标题，
 * 生成一个可跳转的目录。
 *
 * 三个判断：
 * 1. **只认 1–3 级标题**。4 级以下多是「参数说明」这种小节，全收进来目录比正文还长。
 * 2. **按最小级别归一化**。很多 README 直接从 `##` 起（`#` 留给了徽章），
 *    照 level 硬编码缩进会让所有条目都缩进一格。
 * 3. **标题少于 3 个就不给目录**。两个标题的文档一眼看完，多一个按钮纯属碍事。
 */

import type { Block } from './markdown'

export interface TocItem {
  /** 对应 blocks 数组里的下标，滚动定位用 */
  index: number
  /** 原始标题级别（1–3） */
  level: number
  /** 去掉行内标记后的标题文字 */
  text: string
  /** 相对最小级别的缩进层级，0 表示最高 */
  depth: number
}

export interface TocOptions {
  /** 收进来的最大标题级别，默认 3 */
  maxLevel?: number
  /** 条目少于此数直接返回空数组，默认 3 */
  minItems?: number
  /** 最多列多少条，防止畸形文档把目录撑爆，默认 40 */
  maxItems?: number
}

/**
 * 从块数组里抽目录。
 *
 * 用块下标（而不是自己编 slug）当锚点：Markdown 里同名标题很常见
 * （比如每个版本都有「修复」），slug 会撞，下标永远唯一。
 */
export function buildToc(blocks: Block[], opts: TocOptions = {}): TocItem[] {
  const maxLevel = opts.maxLevel ?? 3
  const minItems = opts.minItems ?? 3
  const maxItems = opts.maxItems ?? 40

  const heads: { index: number; level: number; text: string }[] = []
  blocks.forEach((b, index) => {
    if (b.kind !== 'h') return
    const text = (b.text ?? '').trim()
    if (!text) return
    if (b.level > maxLevel) return
    heads.push({ index, level: b.level, text })
  })

  if (heads.length < minItems) return []

  const minLevel = Math.min(...heads.map((h) => h.level))
  return heads.slice(0, maxItems).map((h) => ({
    index: h.index,
    level: h.level,
    text: h.text,
    depth: h.level - minLevel,
  }))
}

/** 目录项的锚点 id。渲染侧与滚动侧共用，避免两边手写字符串对不上 */
export function tocAnchor(index: number): string {
  return `md-h-${index}`
}

/**
 * 当前读到哪一节。
 *
 * `offsets` 是各标题相对滚动容器的偏移（升序）。返回最后一个「已经越过顶部留白」
 * 的下标；一个都没越过时返回 0 —— 目录里始终有一项是高亮的，不然看着像坏了。
 */
export function activeHeading(offsets: number[], scrollTop: number, slack = 24): number {
  if (offsets.length === 0) return -1
  let active = 0
  for (let i = 0; i < offsets.length; i += 1) {
    if (offsets[i] <= scrollTop + slack) active = i
    else break
  }
  return active
}

/** 目录条目的缩进量（px），给样式用。3 级标题最多缩进 16px，再多就挤了 */
export function tocIndent(depth: number): number {
  return Math.max(0, Math.min(depth, 2)) * 8
}
