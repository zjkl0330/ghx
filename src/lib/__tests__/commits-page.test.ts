import { describe, expect, it } from 'vitest'
import { listCommitsPage, mergeCommits, type CommitItem } from '../code'
import type { LinkPages } from '../paging'
import type { Page } from '../types'

const c = (sha: string): CommitItem => ({
  sha,
  commit: { message: `msg ${sha}`, author: { name: 'n', date: '2026-01-01T00:00:00Z' } },
  author: null,
})

const emptyLink: LinkPages = { next: null, last: null, prev: null, first: null }
const noRate: Page<unknown>['rate'] = null

/** 只关心 data 与 link，其余字段凑齐 Page<T> 的类型 */
function page<T>(data: T, link: LinkPages = emptyLink) {
  return { data, rate: noRate, scopes: [] as string[], link }
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => c(`s${i}`))

describe('提交分页', () => {
  it('Link 头给了 next 就按它翻', async () => {
    const client = {
      request: async <T>() =>
        page(rows(30) as T, { ...emptyLink, next: 'https://api.github.com/x?page=2' }),
    }
    const out = await listCommitsPage(client, 'o', 'r')
    expect(out.items).toHaveLength(30)
    expect(out.next).toBe(2)
  })

  it('没有 Link 时满页推断还有下一页', async () => {
    const client = { request: async <T>() => page(rows(30) as T) }
    expect((await listCommitsPage(client, 'o', 'r')).next).toBe(2)
  })

  it('不满页就是到底', async () => {
    const client = { request: async <T>() => page([c('a'), c('b')] as T) }
    expect((await listCommitsPage(client, 'o', 'r')).next).toBe(null)
  })

  it('空仓库返回空列表且没有下一页', async () => {
    const client = { request: async <T>() => page(null as T) }
    const out = await listCommitsPage(client, 'o', 'r')
    expect(out.items).toEqual([])
    expect(out.next).toBe(null)
  })

  it('path 与 ref 都会进 query，中文路径要编码', async () => {
    const seen: string[] = []
    const client = {
      request: async <T>(path: string) => {
        seen.push(path)
        return page([] as T)
      },
    }
    await listCommitsPage(client, 'o', 'r', {
      path: '文档/说明 1.md',
      ref: 'dev',
      page: 3,
      perPage: 50,
    })
    const url = new URL(seen[0], 'https://x')
    expect(url.searchParams.get('path')).toBe('文档/说明 1.md')
    expect(url.searchParams.get('sha')).toBe('dev')
    expect(url.searchParams.get('page')).toBe('3')
    expect(url.searchParams.get('per_page')).toBe('50')
  })

  it('endpoint 里的 owner/repo 要编码', async () => {
    const seen: string[] = []
    const client = {
      request: async <T>(path: string) => {
        seen.push(path)
        return page([] as T)
      },
    }
    await listCommitsPage(client, 'a b', 'c/d')
    expect(seen[0].startsWith('/repos/a%20b/c%2Fd/commits?')).toBe(true)
  })
})

describe('合并两页提交', () => {
  it('按 sha 去重，先出现的留下', () => {
    const out = mergeCommits([c('a'), c('b')], [c('b'), c('c')])
    expect(out.map((x) => x.sha)).toEqual(['a', 'b', 'c'])
  })

  it('没有重叠时就是拼接', () => {
    expect(mergeCommits([c('a')], [c('b'), c('c')]).map((x) => x.sha)).toEqual(['a', 'b', 'c'])
  })

  it('空页不会改动原列表', () => {
    const prev = [c('a')]
    expect(mergeCommits(prev, [])).toEqual(prev)
  })

  it('不修改传入的数组', () => {
    const prev = [c('a')]
    mergeCommits(prev, [c('b')])
    expect(prev).toHaveLength(1)
  })

  it('同一页内部重复也会被压掉', () => {
    expect(mergeCommits([], [c('x'), c('x')]).map((x) => x.sha)).toEqual(['x'])
  })
})
