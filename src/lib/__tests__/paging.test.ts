import { describe, expect, it } from 'vitest'
import { collectPages, hasNext, nextPage, pageFromLink, parseLink } from '../paging'

describe('Link 头解析', () => {
  it('解析 next / last / prev / first', () => {
    const h =
      '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=9>; rel="last", <https://api.github.com/x?page=1>; rel="prev", <https://api.github.com/x?page=1>; rel="first"'
    const p = parseLink(h)
    expect(pageFromLink(p.next)).toBe(2)
    expect(pageFromLink(p.last)).toBe(9)
    expect(pageFromLink(p.prev)).toBe(1)
    expect(pageFromLink(p.first)).toBe(1)
  })

  it('空值、畸形片段都不抛错', () => {
    expect(parseLink(null)).toEqual({ next: null, last: null, prev: null, first: null })
    expect(parseLink('乱码')).toEqual({ next: null, last: null, prev: null, first: null })
    expect(parseLink('<bad>; rel="next"').next).toBe('bad')
  })

  it('大小写与多余空白都认', () => {
    const p = parseLink('<https://a/b?page=3>;  REL="Next"')
    expect(pageFromLink(p.next)).toBe(3)
  })
})

describe('翻页判定', () => {
  const empty = { next: null, last: null, prev: null, first: null }

  it('有 next 就是有下一页', () => {
    expect(hasNext({ ...empty, next: 'x?page=2' }, 3, 100)).toBe(true)
    expect(nextPage({ ...empty, next: 'x?page=2' }, 1, 3, 100)).toBe(2)
  })

  it('读不到 Link 时按条数兜底：满页说明可能还有', () => {
    expect(hasNext(empty, 100, 100)).toBe(true)
    expect(hasNext(empty, 99, 100)).toBe(false)
    expect(nextPage(empty, 3, 100, 100)).toBe(4)
    expect(nextPage(empty, 3, 12, 100)).toBe(null)
  })
})

describe('collectPages', () => {
  it('遇到不足页就停，不空跑', async () => {
    const seen: number[] = []
    const rows = await collectPages(
      async (page) => {
        seen.push(page)
        return page === 1 ? [1, 2, 3] : []
      },
      { perPage: 3, maxPages: 5 },
    )
    expect(rows).toEqual([1, 2, 3])
    expect(seen).toEqual([1, 2])
  })

  it('不超过 maxPages，防止无限拉', async () => {
    const rows = await collectPages(async () => [1, 2], { perPage: 2, maxPages: 3 })
    expect(rows).toHaveLength(6)
  })
})
