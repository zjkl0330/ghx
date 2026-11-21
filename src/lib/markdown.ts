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

/**
 * 行内片段。
 *
 * 之前 `[文字](地址)` 在 `inline()` 里被直接替换成 `$1`，地址就地丢失 ——
 * 结果是自述里所有链接既不是蓝色也点不动。块上多挂一份 spans，
 * 纯文本 `text` 原样保留，翻译、摘要、缓存的逻辑一行都不用改。
 */
export type Span =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; v: string }
  | { t: 'em'; v: string }
  | { t: 'del'; v: string }
  | { t: 'link'; v: string; href: string }

/**
 * 行内结构附带的两个字段，直接展开在每个块上而不是用 `&` 交叉 ——
 * 交叉类型会让 TS 丢掉「对象字面量的隐式索引签名」，导致 Block 不再满足
 * translate.ts 里的 `BlockLike`（那边靠 `[key: string]: unknown` 遍历字段）。
 */
export type Block =
  | { kind: 'h'; level: number; text: string; spans?: Span[]; spansFor?: string }
  | { kind: 'p'; text: string; spans?: Span[]; spansFor?: string }
  | {
      kind: 'li'
      text: string
      depth: number
      ordered: boolean
      checked?: boolean
      spans?: Span[]
      spansFor?: string
    }
  | { kind: 'code'; text: string; lang: string }
  | { kind: 'quote'; text: string; spans?: Span[]; spansFor?: string }
  | { kind: 'hr' }
  | { kind: 'table'; head: string[]; rows: string[][]; align: ('l' | 'c' | 'r')[] }
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

/**
 * 行内拆分规则。数组顺序即优先级：同一位置命中多条时，靠前的赢。
 *
 * 刻意不用后行断言 `(?<!…)` —— iOS 16.4 以前不支持，整个正则字面量
 * 会直接抛语法错误，表现为「自述整页白屏」。
 */
const RULES: { re: RegExp; make: (m: RegExpExecArray) => Span | null }[] = [
  // 行内代码：里面的 `*` `[` 都不该再生效
  { re: /`([^`\n]+)`/g, make: (m) => ({ t: 'code', v: m[1] }) },
  // 徽章整块丢弃，否则会剩一堆空链接文字
  { re: /\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, make: () => null },
  // 图片：只留下 alt 文字
  { re: /!\[([^\]]*)\]\([^)\s]*(?:\s+["'][^"']*["'])?\s*\)/g, make: (m) => (m[1] ? { t: 'text', v: m[1] } : null) },
  // `<https://…>` 自动链接
  { re: /<(https?:\/\/[^>\s]+)>/g, make: (m) => ({ t: 'link', v: m[1], href: m[1] }) },
  // `[文字](地址 "标题")`，地址允许被尖括号包裹
  {
    re: /\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g,
    make: (m) => ({ t: 'link', v: m[1], href: m[2] }),
  },
  { re: /(\*\*)(?=\S)([\s\S]*?\S)\1/g, make: (m) => ({ t: 'strong', v: m[2] }) },
  { re: /(__)(?=\S)([\s\S]*?\S)\1/g, make: (m) => ({ t: 'strong', v: m[2] }) },
  { re: /~~(?=\S)([\s\S]*?\S)~~/g, make: (m) => ({ t: 'del', v: m[1] }) },
  // 只认单星号斜体。`_` 在 snake_case 里到处都是，放进来只会误伤
  { re: /\*(?=\S)([^*\n]*?\S)\*/g, make: (m) => ({ t: 'em', v: m[1] }) },
  // 裸 HTML 标签：丢掉标签本身，保留中间的文字（由别的规则处理）
  { re: /<\/?[a-zA-Z][^>]*>/g, make: () => null },
]

/** 转义占位符：先把 `\*` 这类保护起来，最后再还原，避免被当成标记 */
const ESCAPE_TOKEN = '\uE000'
const ESCAPABLE = '\\`*_{}[]()#+-.!~'

function protectEscapes(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '\\' && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) {
      out += ESCAPE_TOKEN + s[i + 1]
      i += 1
      continue
    }
    out += s[i]
  }
  return out
}

function restoreEscapes(s: string): string {
  return s.replace(new RegExp(`${ESCAPE_TOKEN}(.)`, 'g'), '$1')
}

/**
 * 把一行拆成带结构的片段。
 *
 * 扫描方式：每一轮在剩余串里找「最早出现」的规则匹配，命中的那段之前
 * 一律当纯文字，命中段按规则产出一个 span，然后从它后面继续。
 * 这样天然支持 `见 **粗体** 和 [链接](url) 混排`，不需要递归下降。
 */
export function parseInline(raw: string): Span[] {
  const s = protectEscapes(raw.replace(/<!--[\s\S]*?-->/g, ''))
  const out: Span[] = []
  let buf = ''
  let i = 0

  const flush = () => {
    if (!buf) return
    out.push({ t: 'text', v: restoreEscapes(buf) })
    buf = ''
  }

  while (i < s.length) {
    let best: { at: number; len: number; span: Span | null } | null = null
    for (const rule of RULES) {
      rule.re.lastIndex = i
      const m = rule.re.exec(s)
      if (!m || m[0].length === 0) continue
      if (!best || m.index < best.at) best = { at: m.index, len: m[0].length, span: rule.make(m) }
    }
    if (!best) {
      buf += s.slice(i)
      break
    }
    buf += s.slice(i, best.at)
    flush()
    if (best.span) out.push(best.span)
    i = best.at + best.len
  }
  flush()
  return out
}

/** 片段还原成纯文本（链接只留文字），用来和 block.text 比对 */
export function spansText(spans: Span[]): string {
  return spans
    .map((sp) => sp.v)
    .join('')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/**
 * 同时产出纯文本与行内结构。
 *
 * `spansFor` 记下当时的纯文本：机翻会把 `text` 换掉但碰不到 spans，
 * 渲染侧据此判断「这段还是原文吗」，否则译文里会混进一截原文。
 */
export function rich(raw: string): { text: string; spans: Span[]; spansFor: string } {
  const text = inline(raw)
  return { text, spans: parseInline(raw), spansFor: text }
}

/** 一行是否只由图片/徽章构成 —— 这类行在 README 顶部极多，整行不留 */
function isDecorationOnly(raw: string): boolean {
  const stripped = raw
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
/**
 * 独占一行的 HTML 标题：`<h1 align="center">标题</h1>`。
 * GitHub 上大量个人主页自述就是这么写标题的，按普通段落处理会丢掉层级，
 * 一整页看起来全是等大的正文。只认「整行一个标签」这种最常见的形式，
 * 里面还有别的块级结构就留给段落逻辑，不硬猜。
 */
const HTML_HEADING = /^\s*<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>\s*$/i
const UL = /^(\s*)[-*+]\s+(.*)$/
const OL = /^(\s*)\d{1,3}[.)]\s+(.*)$/
const QUOTE = /^ {0,3}>\s?(.*)$/
const FENCE = /^ {0,3}(```|~~~)\s*([\w+#.-]*)\s*$/
/** 表格分隔行：| --- | :--: | ---: | */
const TABLE_SEP = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/
/** 任务列表：[ ] / [x] ，Issue 与 PR 正文里到处都是 */
const TASK = /^\[([ xX])\]\s*(.*)$/

/** 拆单元格。先去首尾竖线，再按未转义的 | 切 */
function splitCells(line: string): string[] {
  let s = line.trim().replace(/\\\|/g, '\u0000')
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.replace(/\u0000/g, '|').trim())
}

function alignOf(cell: string): 'l' | 'c' | 'r' {
  const s = cell.trim()
  if (s.startsWith(':') && s.endsWith(':')) return 'c'
  if (s.endsWith(':')) return 'r'
  return 'l'
}

export interface ParseOptions {
  /** 最多解析多少个块，防止超长 README 把界面拖死 */
  maxBlocks?: number
  /** 是否保留代码块（译文视图里通常不需要） */
  keepCode?: boolean
  /** 图片相对路径的基准前缀，一般是 rawBase(owner, repo, branch, readmePath) */
  imageBase?: string
}

/*
 * 参考式链接。
 *
 * LocalSend、SoftEther 这类 README 大量使用 `[文字][ref]` + 文末 `[ref]: url`
 * 的写法。早期版本只认 `[文字](地址)`，结果是链接变纯文字、定义行整段
 * 原样吐在页面上 —— 用户看到的是一屏 URL 而不是文档。
 * 这里在解析前统一展开成行内链接，后续逻辑（spans、翻译、徽章）一行不用改。
 */

/** 定义行：`[ref]: https://… "可选标题"`。标题里允许换行以外的任意内容 */
const REF_DEF = /^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?(?:\s+["'(](.*)["')])?\s*$/
/** 图片引用：`![alt][ref]`，ref 可空（collapsed） */
const IMG_REF = /!\[([^\]]*)\]\s*\[([^\]]*)\]/g
/** 完整/折叠引用：`[text][ref]` */
const FULL_REF = /\[([^\]]+)\]\s*\[([^\]]*)\]/g
/** 快捷引用：`[ref]`，只在 ref 已定义时展开，且后面不跟 `[` 或 `(` */
const SHORT_REF = /\[([^\]\n]+)\](?!\[|\()/g

export interface LinkRefs {
  /** 标签（小写、空白折叠）→ 地址 */
  map: Map<string, string>
  /** 展开后的 markdown，定义行已剔除 */
  body: string
}

/** 标签归一：大小写与内部空白不敏感，跟 GitHub 的行为一致 */
function refKey(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * 收集参考定义并展开全部引用。围栏代码块里的内容一字不动 ——
 * 示例代码里写 `[link]: url` 是合法内容，不该被当定义吃掉。
 */
export function expandLinkRefs(md: string): LinkRefs {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const map = new Map<string, string>()
  const kept: string[] = []

  let fence: string | null = null
  for (const line of lines) {
    const f = FENCE.exec(line)
    if (f) {
      // 开/闭围栏（``` 与 ~~~ 各自配对）
      if (!fence) fence = f[1]
      else if (fence === f[1]) fence = null
      kept.push(line)
      continue
    }
    if (fence) {
      kept.push(line)
      continue
    }
    const def = REF_DEF.exec(line)
    if (def && !map.has(refKey(def[1]))) {
      map.set(refKey(def[1]), def[2].trim())
      continue // 定义行不进正文
    }
    kept.push(line)
  }

  const urlOf = (label: string): string | null => {
    const key = refKey(label)
    if (!key) return null
    return map.get(key) ?? null
  }

  const expandLine = (line: string): string =>
    line
      .replace(IMG_REF, (m, alt: string, ref: string) => {
        const url = urlOf(ref || alt)
        return url ? `![${alt}](${url})` : m
      })
      .replace(FULL_REF, (m, text: string, ref: string) => {
        const url = urlOf(ref || text)
        return url ? `[${text}](${url})` : m
      })
      .replace(SHORT_REF, (m, label: string) => {
        const url = urlOf(label)
        return url ? `[${label}](${url})` : m
      })

  // 展开同样要绕开围栏：代码示例里的 `[文字][ref]` 是教学内容，不是链接
  const out: string[] = []
  fence = null
  for (const line of kept) {
    const f = FENCE.exec(line)
    if (f) {
      if (!fence) fence = f[1]
      else if (fence === f[1]) fence = null
      out.push(line)
      continue
    }
    out.push(fence ? line : expandLine(line))
  }
  return { map, body: out.join('\n') }
}

export function parseMarkdown(md: string, opts: ParseOptions = {}): Block[] {
  // 参考式链接先展开，正文里就只剩行内链接一种写法了
  const expanded = expandLinkRefs(md)
  md = expanded.body
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
    const r = rich(raw)
    if (r.text) blocks.push({ kind: 'p', ...r })
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

    const htmlHeading = HTML_HEADING.exec(line)
    if (htmlHeading) {
      flushPara()
      const r = rich(htmlHeading[2])
      if (r.text) blocks.push({ kind: 'h', level: Number(htmlHeading[1]), ...r })
      i += 1
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flushPara()
      const r = rich(heading[2])
      if (r.text) blocks.push({ kind: 'h', level: heading[1].length, ...r })
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
      const r = rich(buf.join(' '))
      if (r.text) blocks.push({ kind: 'quote', ...r })
      continue
    }

    const ul = UL.exec(line)
    const ol = OL.exec(line)
    if (ul || ol) {
      flushPara()
      const m = (ul ?? ol) as RegExpExecArray
      const indent = m[1].replace(/\t/g, '  ').length
      const body = m[2]
      // 任务列表：保留勾选状态，Issue 里的清单要能一眼看出哪些做完了
      const task = TASK.exec(body.trim())
      const r = rich(task ? task[2] : body)
      // 纯徽章列表项不留
      if (r.text && !isDecorationOnly(line)) {
        blocks.push({
          kind: 'li',
          ...r,
          depth: Math.min(Math.floor(indent / 2), 3),
          ordered: !!ol,
          ...(task ? { checked: task[1].toLowerCase() === 'x' } : {}),
        })
      } else if (task && !r.text) {
        // 只有勾选框没有文字（`- [x]`）也算一条，否则清单会缺行
        blocks.push({ kind: 'li', text: '', depth: 0, ordered: false, checked: task[1].toLowerCase() === 'x' })
      }
      i += 1
      continue
    }

    // 表格：本行像表头，下一行是分隔行。Issue/PR 正文与 README 都大量使用
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      flushPara()
      // 格子里保留原始标记，不在这里 `inline()`：表格里放链接、`代码` 太常见，
      // 提前清洗会把地址丢掉，渲染层就没法把它们变成可点的东西了。
      // 纯文本场景（摘要、导出）另行清洗，见 blocksToText / summarize。
      const head = splitCells(line).slice(0, 6)
      const align = splitCells(lines[i + 1]).map(alignOf).slice(0, 6)
      i += 2
      const rows: string[][] = []
      // 行数封顶，避免有人贴一张几千行的表把界面拖死
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() && rows.length < 60) {
        rows.push(splitCells(lines[i]).slice(0, 6))
        i += 1
      }
      blocks.push({ kind: 'table', head, rows, align })
      continue
    }

    // 分隔行（|---|）单独出现就丢弃
    if (TABLE_SEP.test(line)) {
      i += 1
      continue
    }
    if (line.trim().startsWith('|')) {
      const cells = splitCells(line).map(inline).filter(Boolean)
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
        case 'li': {
          const box = b.checked === undefined ? '' : b.checked ? '[x] ' : '[ ] '
          return `${'  '.repeat(b.depth)}- ${box}${b.text}`
        }
        case 'code':
          return b.text
        case 'hr':
          return ''
        case 'img':
          return b.alt ? `[图片：${b.alt}]` : ''
        case 'table':
          // 块里存的是带标记的原文（渲染要拿它解析链接），这里才清洗
          return [
            b.head.map(inline).join(' | '),
            ...b.rows.map((r) => r.map(inline).join(' | ')),
          ].join('\n')
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
    const t = b.kind === 'table' ? b.head.map(inline).join(' ') : b.text.trim()
    if (!t) continue
    parts.push(t)
    total += t.length
    if (total >= maxChars) break
  }
  const joined = parts.join(' ')
  return joined.length > maxChars ? `${joined.slice(0, maxChars).trimEnd()}…` : joined
}
