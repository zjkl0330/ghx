/**
 * 轻量 Markdown 解析。
 *
 * 不引第三方渲染器：包体积吃紧（gzip 已 80KB+），而且 README 里
 * 大量是徽章、居中 div、表格，完整渲染器反而更乱。这里只认
 * 标题 / 段落 / 列表 / 代码块 / 引用 / 分隔线，其余降级成文字。
 */

export type Block =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'li'; text: string; depth: number; ordered: boolean }
  | { kind: 'code'; text: string; lang: string }
  | { kind: 'quote'; text: string }
  | { kind: 'hr' }

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
}

export function parseMarkdown(md: string, opts: ParseOptions = {}): Block[] {
  const maxBlocks = opts.maxBlocks ?? 400
  const keepCode = opts.keepCode ?? true
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []

  let i = 0
  let para: string[] = []

  const flushPara = () => {
    if (para.length === 0) return
    const text = inline(para.join(' '))
    para = []
    if (text) blocks.push({ kind: 'p', text })
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
    if (b.kind === 'code' || b.kind === 'hr') continue
    const t = b.text.trim()
    if (!t) continue
    parts.push(t)
    total += t.length
    if (total >= maxChars) break
  }
  const joined = parts.join(' ')
  return joined.length > maxChars ? `${joined.slice(0, maxChars).trimEnd()}…` : joined
}
