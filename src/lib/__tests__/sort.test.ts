import { describe, expect, it } from 'vitest'
import { DEFAULT_SORT, normalizeSort, sortRepos } from '../sort'
import type { Repo } from '../types'

function repo(name: string, over: Partial<Repo> = {}): Repo {
  return {
    id: Math.random(),
    name,
    full_name: `o/${name}`,
    owner: 'o',
    private: false,
    visibility: 'public',
    archived: false,
    disabled: false,
    description: null,
    language: null,
    stargazers_count: 0,
    forks_count: 0,
    pushed_at: '2026-01-01T00:00:00Z',
    default_branch: 'main',
    ...over,
  }
}

describe('仓库排序', () => {
  it('默认按最近推送，新的在前', () => {
    const list = [
      repo('old', { pushed_at: '2026-01-01T00:00:00Z' }),
      repo('new', { pushed_at: '2026-11-01T00:00:00Z' }),
      repo('mid', { pushed_at: '2026-06-01T00:00:00Z' }),
    ]
    expect(sortRepos(list, 'pushed').map((r) => r.name)).toEqual(['new', 'mid', 'old'])
  })

  it('最近更新用 updated_at 而不是 pushed_at', () => {
    const list = [
      repo('a', { pushed_at: '2026-11-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z' }),
      repo('b', { pushed_at: '2026-01-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }),
    ]
    expect(sortRepos(list, 'updated').map((r) => r.name)).toEqual(['b', 'a'])
  })

  it('最近创建缺字段时沉底', () => {
    const list = [
      repo('noDate'),
      repo('has', { created_at: '2026-05-01T00:00:00Z' }),
    ]
    expect(sortRepos(list, 'created').map((r) => r.name)).toEqual(['has', 'noDate'])
  })

  it('Star 排序按数值降序', () => {
    const list = [
      repo('one', { stargazers_count: 1 }),
      repo('nine', { stargazers_count: 9 }),
      repo('five', { stargazers_count: 5 }),
    ]
    expect(sortRepos(list, 'stars').map((r) => r.name)).toEqual(['nine', 'five', 'one'])
  })

  it('名称排序不区分大小写差异造成的乱序', () => {
    const list = [repo('b'), repo('A'), repo('c')]
    expect(sortRepos(list, 'name').map((r) => r.name)).toEqual(['A', 'b', 'c'])
  })

  it('时间相同的用名字兜底，保证顺序稳定', () => {
    const same = '2026-03-03T00:00:00Z'
    const list = [repo('zeta', { pushed_at: same }), repo('alpha', { pushed_at: same })]
    const first = sortRepos(list, 'pushed').map((r) => r.name)
    const second = sortRepos([...list].reverse(), 'pushed').map((r) => r.name)
    expect(first).toEqual(['alpha', 'zeta'])
    expect(second).toEqual(first)
  })

  it('时间格式非法当作 0，不会抛错', () => {
    const list = [repo('bad', { pushed_at: 'not-a-date' }), repo('ok', { pushed_at: '2026-01-05T00:00:00Z' })]
    expect(sortRepos(list, 'pushed').map((r) => r.name)).toEqual(['ok', 'bad'])
  })

  it('不改动传入的数组', () => {
    const list = [repo('a', { pushed_at: '2026-01-01T00:00:00Z' }), repo('b', { pushed_at: '2026-02-01T00:00:00Z' })]
    const snapshot = list.map((r) => r.name)
    sortRepos(list, 'pushed')
    expect(list.map((r) => r.name)).toEqual(snapshot)
  })

  it('未知排序值退回默认', () => {
    expect(normalizeSort('whatever')).toBe(DEFAULT_SORT)
    expect(normalizeSort(null)).toBe(DEFAULT_SORT)
    expect(normalizeSort('stars')).toBe('stars')
  })
})
