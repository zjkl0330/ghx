/**
 * 分页。
 *
 * GitHub 的列表接口有两种翻页信号：
 * 1. `Link` 响应头（标准做法，准确）；
 * 2. 本页条数是否等于 per_page（兜底）。
 *
 * WebView 里 `Link` 有时读不到（代理/CDN 会吞掉未暴露的响应头），
 * 所以两条路都要留：能读头就按头，读不到就按条数判断。
 */

export interface LinkPages {
  next: string | null
  last: string | null
  prev: string | null
  first: string | null
}

const EMPTY: LinkPages = { next: null, last: null, prev: null, first: null }

/**
 * 解析 `Link` 头：`<https://api.github.com/x?page=2>; rel="next", <...>; rel="last"`
 * 大小写与空白都不敏感，畸形片段直接跳过，绝不抛错。
 */
export function parseLink(header: string | null | undefined): LinkPages {
  if (!header) return { ...EMPTY }
  const out: LinkPages = { ...EMPTY }
  for (const part of header.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel\s*=\s*"?([a-z]+)"?/i.exec(part.trim())
    if (!m) continue
    const rel = m[2].toLowerCase()
    if (rel === 'next' || rel === 'last' || rel === 'prev' || rel === 'first') {
      out[rel] = m[1]
    }
  }
  return out
}

/** 从链接里取 page 参数，取不到返回 null */
export function pageFromLink(url: string | null): number | null {
  if (!url) return null
  const m = /[?&]page=(\d+)/.exec(url)
  return m ? Number(m[1]) : null
}

/** 下一页的页码：优先读 Link，读不到就靠「本页是否满页」推断 */
export function nextPage(link: LinkPages, page: number, count: number, perPage: number): number | null {
  if (link.next) return pageFromLink(link.next) ?? page + 1
  return count >= perPage ? page + 1 : null
}

/** 有没有下一页：同上，两个信号任一成立即可 */
export function hasNext(link: LinkPages, count: number, perPage: number): boolean {
  if (link.next) return true
  if (link.last) return true
  return count >= perPage
}

/**
 * 顺序拉多页，遇到空页/不足页/超出上限就停。
 * `fetchPage` 返回该页数据，空数组视为到底。
 */
export async function collectPages<T>(
  fetchPage: (page: number) => Promise<T[]>,
  opts: { perPage: number; maxPages?: number; start?: number } = { perPage: 100 },
): Promise<T[]> {
  const maxPages = opts.maxPages ?? 10
  const acc: T[] = []
  for (let page = opts.start ?? 1, i = 0; i < maxPages; page += 1, i += 1) {
    const rows = await fetchPage(page)
    acc.push(...rows)
    if (rows.length < opts.perPage) break
  }
  return acc
}
