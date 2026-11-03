/**
 * 轻量 Markdown 解析。
 *
 * 不引第三方渲染器：包体积吃紧（gzip 已 80KB+），而且 README 里
 * 大量是徽章、居中 div、表格，完整渲染器反而更乱。这里认
 * 标题 / 段落 / 列表 / 代码块 / 引用 / 分隔线 / 图片，其余降级成文字。
 *
 * 图片单独成块：徽章（shields.io 那类）走小尺寸行内排布，截图/示意图
 * 按屏宽缩放。早期版本把图片行整行丢掉，导致「README 里明明有图却看不见」。
 */

import { resolveImageSrc } from './images'

export type Block =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'li'; text: string; depth: number; ordered: boolean }
  | { kind: 'code'; text: string; lang: string }
  | { kind: 'quote'; text: string }
  | { kind: 'hr' }
  | {
      kind: 'img'
      src: string
      alt: string
      badge: boolean
      width: number | null
      height: number | null
      /** 同一行有多张图时并排显示，别把语言按钮之类拆成一屏 */
      inline: boolean
    }

/** 单行去掉行内标记，保留可读文字 */
export function inline(raw: string): string {
  let s = raw
  // HTML 注释整段清掉
  s = s.replace(/<!--[\s\S]*?-->/g, '')
  // 徽章：整块 [![alt](img)](link) 直接丢弃，否则会剩一堆空链接文字
  s = s.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
  // 图片：只留下 alt 为空则丢弃
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  // 链接保留文字
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  // 裸 HTML 标签（div / img / a / br 等）
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
  // 行内代码
  s = s.replace(/`([^`]+)`/g, '$1')
  // 粗体、斜体、删除线
  s = s.replace(/(\*\*|__)(.*?)\1/g, '$2')
  s = s.replace(/(\*|_)(.*?)\1/g, '$2')
  s = s.replace(/~~(.*?)~~/g, '$1')
  // 转义字符
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
  // 折叠空白
  return s.replace(/[ \t]+/g, ' ').trim()
}

/** 一行是否只由图片/徽章构成 —— 这类行在 README 顶部极多，整行不留 */
function isDecorationOnly(raw: string): boolean {
  const stripped = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/[\s|\-:]/g, '')
  return stripped === ''
}

const IMG_MD = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g
const IMG_HTML = /<img\b([^>]*)>/gi
const HTML_SRC = /\bsrc\s*=\s*["']?([^"'\s>]+)/i
const HTML_ALT = /\balt\s*=\s*["']([^"']*)["']/i
const HTML_WIDTH = /\bwidth\s*=\s*["']?(\d{1,4})/i
const HTML_HEIGHT = /\bheight\s*=\s*["']?(\d{1,4})/i

export interface ImageRef {
  src: string
  alt: string
  badge: boolean
  width: number | null
  height: number | null
}

/** 徽章图床。这些图本来就只有十几像素高，按行内小图排 */
const BADGE_HOST =
  /(shields\.io|badgen\.net|badge\.fury\.io|badges\.size|travis-ci\.(org|com)|circleci\.com|codecov\.io|coveralls\.io|codeclimate\.com|snyk\.io|deepsource\.io|opencollective\.com\/.+\/badge|img\.shields\.io)/i

/**
 * 抽出这一行里的全部图片。`[![a](img)](link)` 这种被链接包住的图
 * 一律当徽章 —— README 顶部的构建状态、许可证图标都是这个形状。
 */
export function collectImages(raw: string): ImageRef[] {
  const out: ImageRef[] = []

  for (const m of raw.matchAll(IMG_MD)) {
    const src = (m[2] ?? '').trim()
    if (!src) continue
    // 前一个字符是 `[` → 说明整张图被链接包着，是徽章
    const wrapped = /\[\s*$/.test(raw.slice(0, m.index ?? 0))
    out.push({
      src,
      alt: (m[1] ?? '').trim(),
      badge: wrapped || BADGE_HOST.test(src),
      width: null,
      height: null,
    })
  }

  for (const m of raw.matchAll(IMG_HTML)) {
    const attrs = m[1] ?? ''
    const src = HTML_SRC.exec(attrs)?.[1]?.trim()
    if (!src) continue
    const width = Number(HTML_WIDTH.exec(attrs)?.[1] ?? 0)
    const height = Number(HTML_HEIGHT.exec(attrs)?.[1] ?? 0)
    out.push({
      src,
      alt: HTML_ALT.exec(attrs)?.[1]?.trim() ?? '',
      badge: BADGE_HOST.test(src),
      // width 大于 400 的多半是想撑满，按屏宽自适应更稳
      width: width > 0 && width <= 400 ? width : null,
      // 高度是作者明确想要的行内尺寸（语言按钮、图标），照做
      height: height > 0 && height <= 160 ? height : null,
    })
  }

  return out
}

/** 去掉图片后还剩什么文字，用来判断这行是否「只有图」 */
function textWithoutImages(raw: string): string {
  return raw
    .replace(IMG_MD, '')
    .replace(IMG_HTML, '')
    // 徽章外套的那层链接：图片被拿走后只剩空壳 []（地址）
    .replace(/\[\s*\]\([^)]*\)/g, '')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/&nbsp;|[\s|]/g, '')
}


const HR = /^ {0,3}([-*_])\s*(\1\s*){2,}$/
const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/
const UL = /^(\s*)[-*+]\s+(.*)$/
const OL = /^(\s*)\d{1,3}[.)]\s+(.*)$/
const QUOTE = /^ {0,3}>\s?(.*)$/
const FENCE = /^ {0,3}(```|~~~)\s*([\w+#.-]*)\s*$/

export interface ParseOptions {
  /** 最多解析多少个块，防止超长 README 把界面拖死 */
  maxBlocks?: number
  /** 是否保留代码块（译文视图里通常不需要） */
  keepCode?: boolean
  /** 图片相对路径的基准前缀，一般是 rawBase(owner, repo, branch, readmePath) */
  imageBase?: string
}

export function parseMarkdown(md: string, opts: ParseOptions = {}): Block[] {
  const maxBlocks = opts.maxBlocks ?? 400
  const keepCode = opts.keepCode ?? true
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []

  let i = 0
  let para: string[] = []

  const pushImages = (raw: string) => {
    const found = collectImages(raw)
    // 一行里多张图（语言切换按钮、徽章墙）按行内排，别一张一行撑满屏
    const inline = found.length > 1
    for (const im of found) {
      const src = resolveImageSrc(im.src, opts.imageBase ?? '')
      if (!src) continue
      if (blocks.length >= maxBlocks) return
      blocks.push({
        kind: 'img',
        src,
        alt: im.alt,
        badge: im.badge,
        width: im.width,
        height: im.height,
        inline,
      })
    }
  }

  const flushPara = () => {
    if (para.length === 0) return
    const raw = para.join(' ')
    para = []
    const text = inline(raw)
    if (text) blocks.push({ kind: 'p', text })
    // 段落里夹的图单独成块，别让它们跟着文字一起被当纯文本吞掉
    pushImages(raw)
  }

  while (i < lines.length && blocks.length < maxBlocks) {
    const line = lines[i]

    const fence = FENCE.exec(line)
    if (fence) {
      flushPara()
      const marker = fence[1]
      const lang = fence[2] ?? ''
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) {
        body.push(lines[i])
        i += 1
      }
      i += 1 // 跳过闭合围栏
      const code = body.join('\n')
      if (keepCode && code.trim()) blocks.push({ kind: 'code', text: code, lang })
      continue
    }

    if (!line.trim()) {
      flushPara()
      i += 1
      continue
    }

    // 整行只有图片（含 <div align=center><img></div> 拆开后的单行）
    if (collectImages(line).length > 0 && !textWithoutImages(line)) {
      flushPara()
      pushImages(line)
      i += 1
      continue
    }

    if (HR.test(line)) {
      flushPara()
      blocks.push({ kind: 'hr' })
      i += 1
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flushPara()
      const text = inline(heading[2])
      if (text) blocks.push({ kind: 'h', level: heading[1].length, text })
      i += 1
      continue
    }

    const quote = QUOTE.exec(line)
    if (quote) {
      flushPara()
      const buf: string[] = []
      while (i < lines.length) {
        const m = QUOTE.exec(lines[i])
        if (!m) break
        buf.push(m[1])
        i += 1
      }
      const text = inline(buf.join(' '))
      if (text) blocks.push({ kind: 'quote', text })
      continue
    }

    const ul = UL.exec(line)
    const ol = OL.exec(line)
    if (ul || ol) {
      flushPara()
      const m = (ul ?? ol) as RegExpExecArray
      const indent = m[1].replace(/\t/g, '  ').length
      const text = inline(m[2])
      // 纯徽章列表项不留
      if (text && !isDecorationOnly(line)) {
        blocks.push({
          kind: 'li',
          text,
          depth: Math.min(Math.floor(indent / 2), 3),
          ordered: !!ol,
        })
      }
      i += 1
      continue
    }

    // 表格行降级成普通文字，分隔行（|---|）丢弃
    if (/^\s*\|?[\s:|-]{3,}\|?\s*$/.test(line) && line.includes('-')) {
      i += 1
      continue
    }
    if (line.trim().startsWith('|')) {
      const cells = line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => inline(c))
        .filter(Boolean)
      if (cells.length) blocks.push({ kind: 'p', text: cells.join(' · ') })
      i += 1
      continue
    }

    if (isDecorationOnly(line)) {
      i += 1
      continue
    }

    para.push(line.trim())
    i += 1
  }

  flushPara()
  return blocks.slice(0, maxBlocks)
}

/** 把块还原成带换行的纯文本，供翻译与摘要使用 */
export function blocksToText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case 'li':
          return `${'  '.repeat(b.depth)}- ${b.text}`
        case 'code':
          return b.text
        case 'hr':
          return ''
        case 'img':
          return b.alt ? `[图片：${b.alt}]` : ''
        default:
          return b.text
      }
    })
    .filter((s) => s !== '')
    .join('\n\n')
}

/** 纯文本摘要：跳过代码块，取前 n 个字符 */
export function summarize(blocks: Block[], maxChars = 120): string {
  const parts: string[] = []
  let total = 0
  for (const b of blocks) {
    if (b.kind === 'code' || b.kind === 'hr' || b.kind === 'img') continue
    const t = b.text.trim()
    if (!t) continue
    parts.push(t)
    total += t.length
    if (total >= maxChars) break
  }
  const joined = parts.join(' ')
  return joined.length > maxChars ? `${joined.slice(0, maxChars).trimEnd()}…` : joined
}
