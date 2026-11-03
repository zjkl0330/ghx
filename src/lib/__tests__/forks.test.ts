import { describe, expect, it } from 'vitest'
import { findMyFork, forkHint, forkOwnerName, repoName, sortForks } from '../forks'
import type { Fork } from '../types'

function fork(over: Partial<Fork> = {}): Fork {
  return {
    id: 1,
    name: 'ghx',
    full_name: 'someone/ghx',
    owner: 'someone',
    private: false,
    visibility: 'public',
    archived: false,
    disabled: false,
    description: null,
    language: 'TypeScript',
    stargazers_count: 0,
    forks_count: 0,
    pushed_at: '2026-10-01T00:00:00Z',
    default_branch: 'main',
    created_at: '2026-10-01T00:00:00Z',
    ...over,
  }
}

describe('findMyFork', () => {
  it('按 owner 匹配，忽略大小写', () => {
    const list = [fork({ id: 1, owner: 'alice' }), fork({ id: 2, owner: 'ZJKL' })]
    expect(findMyFork(list, 'zjkl')?.id).toBe(2)
  })

  it('没登录时不做判断', () => {
    expect(findMyFork([fork({ owner: 'zjkl' })], null)).toBeNull()
  })

  it('没复刻过返回 null', () => {
    expect(findMyFork([fork({ owner: 'alice' })], 'zjkl')).toBeNull()
  })
})

describe('sortForks', () => {
  it('按复刻时间倒序', () => {
    const list = sortForks([
      fork({ id: 1, created_at: '2026-01-01T00:00:00Z' }),
      fork({ id: 2, created_at: '2026-05-01T00:00:00Z' }),
      fork({ id: 3, created_at: '2026-03-01T00:00:00Z' }),
    ])
    expect(list.map((f) => f.id)).toEqual([2, 3, 1])
  })

  it('时间非法时排到最后且不打乱其余顺序', () => {
    const list = sortForks([
      fork({ id: 1, created_at: 'oops' }),
      fork({ id: 2, created_at: '2026-05-01T00:00:00Z' }),
    ])
    expect(list.map((f) => f.id)).toEqual([2, 1])
  })
})

describe('命名与提示', () => {
  it('从 full_name 取出仓库名', () => {
    expect(repoName('owner/repo')).toBe('repo')
    expect(repoName('repo')).toBe('repo')
  })

  it('拼接 owner/name', () => {
    expect(forkOwnerName({ owner: 'zjkl', name: 'ghx' })).toBe('zjkl/ghx')
  })

  it('已复刻时提示带上自己的那份', () => {
    const list = [fork({ owner: 'zjkl', name: 'ghx' })]
    expect(forkHint(list, 'zjkl')).toContain('zjkl/ghx')
  })

  it('未登录与未复刻给不同提示', () => {
    expect(forkHint([], null)).toContain('未连接账号')
    expect(forkHint([], 'zjkl')).toContain('复刻后')
  })
})
