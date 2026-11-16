/**
 * 代码页的阅读偏好与文件内查找。
 *
 * 抽成纯函数是因为两件事都不该依赖浏览器：
 * - 查找会跑在 600KB 的文件上，要能单测命中位置与截断；
 * - 字号与折行要能记住，但测试里不想碰 localStorage，
 *   所以这里只负责「字符串 ↔ 结构体」，读写交给调用方。
 */

export type CodeSize = 12 | 13 | 15

export interface CodePrefs {
  /** 代码字号（px）。手机上 10.5 的默认字号看代码偏小 */
  size: CodeSize
  /** 长行折行。关掉就是横向滚动，GitHub 网页端默认行为 */
  wrap: boolean
}

export const CODE_SIZES: readonly CodeSize[] = [12, 13, 15]

export const DEFAULT_CODE_PREFS: CodePrefs = { size: 13, wrap: false }

export const CODE_PREFS_KEY = 'ghx.codeview'

/** 解析落盘的偏好。任何字段非法都退回默认，不让一条脏数据把页面搞崩 */
export function parseCodePrefs(raw: string | null | undefined): CodePrefs {
  if (!raw) return { ...DEFAULT_CODE_PREFS }
  try {
    const v = JSON.parse(raw) as Partial<CodePrefs> | null
    if (!v || typeof v !== 'object') return { ...DEFAULT_CODE_PREFS }
    const size = CODE_SIZES.includes(v.size as CodeSize) ? (v.size as CodeSize) : DEFAULT_CODE_PREFS.size
    return { size, wrap: v.wrap === true }
  } catch {
    return { ...DEFAULT_CODE_PREFS }
  }
}

export function serializeCodePrefs(p: CodePrefs): string {
  return JSON.stringify({ size: p.size, wrap: p.wrap })
}

/** 字号进退一档，到边界就停住（不循环，避免点了半天又回到原样） */
export function stepCodeSize(size: CodeSize, dir: 1 | -1): CodeSize {
  const i = CODE_SIZES.indexOf(size)
  const at = i < 0 ? CODE_SIZES.indexOf(DEFAULT_CODE_PREFS.size) : i
  const next = Math.min(Math.max(at + dir, 0), CODE_SIZES.length - 1)
  return CODE_SIZES[next]
}

/** 一条命中：第几行（0 基）、行内起始列、长度 */
export interface FindHit {
  line: number
  start: number
  len: number
}

/** 命中数上限：再多的文件也没人逐条跳，封顶避免几万个 span 把渲染拖死 */
export const MAX_FIND_HITS = 500

/**
 * 在已切好的行数组里找关键词。大小写不敏感。
 *
 * 逐行 `indexOf` 而不是拼成一个大串再算偏移 —— 大串拼接会复制整份文本，
 * 而折行后的行号本来就按行数组来，省一次换算也少一类越界 bug。
 */
export function findHits(lines: string[], query: string, max = MAX_FIND_HITS): FindHit[] {
  const q = query.trim()
  if (!q) return []
  const needle = q.toLowerCase()
  const out: FindHit[] = []
  for (let i = 0; i < lines.length && out.length < max; i += 1) {
    const hay = lines[i].toLowerCase()
    let from = 0
    for (;;) {
      if (out.length >= max) break
      const at = hay.indexOf(needle, from)
      if (at < 0) break
      out.push({ line: i, start: at, len: q.length })
      // 允许重叠命中（"aaa" 里找 "aa" 得两条），前进一格
      from = at + 1
    }
  }
  return out
}

export interface Segment {
  text: string
  hit: boolean
}

/**
 * 把一行按命中的列切成交替的普通段 / 高亮段。
 * 命中按 start 升序传入；出现重叠（不同 query 才不会，但兜一下）时以先到的为准。
 */
export function splitHighlight(line: string, hits: FindHit[]): Segment[] {
  if (hits.length === 0) return [{ text: line, hit: false }]
  const sorted = [...hits].sort((a, b) => a.start - b.start)
  const out: Segment[] = []
  let cursor = 0
  for (const h of sorted) {
    if (h.start < cursor) continue
    if (h.start > cursor) out.push({ text: line.slice(cursor, h.start), hit: false })
    out.push({ text: line.slice(h.start, h.start + h.len), hit: true })
    cursor = h.start + h.len
  }
  if (cursor < line.length) out.push({ text: line.slice(cursor), hit: false })
  return out
}

/** 按行号把命中分桶，渲染时每行只查自己那一桶 */
export function groupHitsByLine(hits: FindHit[]): Map<number, FindHit[]> {
  const map = new Map<number, FindHit[]>()
  for (const h of hits) {
    const list = map.get(h.line)
    if (list) list.push(h)
    else map.set(h.line, [h])
  }
  return map
}

/** 当前命中在第几条（从 0 开始），越界就折回，用于上一处 / 下一处循环 */
export function stepHit(index: number, total: number, dir: 1 | -1): number {
  if (total <= 0) return 0
  const base = index < 0 ? (dir > 0 ? -1 : 0) : index
  const next = base + dir
  if (next < 0) return total - 1
  if (next >= total) return 0
  return Math.min(next, total - 1)
}

/** 文件链接：优先用 API 给的 html_url，没有就按 blob 规则拼 */
export function blobUrl(
  owner: string,
  repo: string,
  ref: string | undefined,
  path: string,
  fallback?: string | null,
): string {
  if (fallback) return fallback
  const branch = ref ?? 'HEAD'
  const clean = path.split('/').map(encodeURIComponent).join('/')
  return `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${clean}`
}

/** 文件行数与字符数，给操作面板显示 */
export function fileStats(text: string): { lines: number; chars: number } {
  return { lines: text ? text.split('\n').length : 0, chars: text.length }
}
