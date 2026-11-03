import { describe, expect, it } from 'vitest'
import { dailyStars, rankHot, trendingQuery, trendingSince } from '../trending'
import type { Repo } from '../types'

const NOW = Date.parse('2026-11-03T12:00:00Z')

function repo(full: string, stars: number, createdAt?: string): Repo {
  const [owner, name] = full.split('/')
  return {
    id: Math.random(),
    name,
    full_name: full,
    owner,
    private: false,
    visibility: 'public',
    archived: false,
    disabled: false,
    description: null,
    language: 'Go',
    stargazers_count: stars,
    forks_count: 0,
    pushed_at: '2026-11-01T00:00:00Z',
    created_at: createdAt,
    default_branch: 'main',
  }
}

describe('trendingSince', () => {
  it('今日往前一天', () => {
    expect(trendingSince('day', NOW)).toBe('2026-11-02')
  })

  it('本周往前七天', () => {
    expect(trendingSince('week', NOW)).toBe('2026-10-27')
  })

  it('本月往前三十天', () => {
    expect(trendingSince('month', NOW)).toBe('2026-10-04')
  })
})

describe('trendingQuery', () => {
  it('包含创建时间与最低 star', () => {
    const q = trendingQuery('week', null, NOW)
    expect(q).toContain('created:>=2026-10-27')
    expect(q).toContain('stars:>=10')
    expect(q).not.toContain('language:')
  })

  it('指定语言时加引号，兼容 C++ 这类名字', () => {
    expect(trendingQuery('day', 'C++', NOW)).toContain('language:"C++"')
    expect(trendingQuery('day', 'C#', NOW)).toContain('language:"C#"')
  })

  it('普通语言也加上引号，行为一致', () => {
    expect(trendingQuery('day', 'Go', NOW)).toContain('language:"Go"')
  })
})

describe('dailyStars', () => {
  it('30 天 3000 star 约等于每天 100', () => {
    const r = repo('a/b', 3000, '2026-10-04T12:00:00Z')
    expect(Math.round(dailyStars(r, NOW))).toBe(100)
  })

  it('创建不足一天按一天算，不会除爆', () => {
    const r = repo('a/b', 50, '2026-11-03T11:00:00Z')
    expect(dailyStars(r, NOW)).toBe(50)
  })

  it('缺少创建时间时退回总 star', () => {
    expect(dailyStars(repo('a/b', 120), NOW)).toBe(120)
  })

  it('创建时间非法时同样退回总 star', () => {
    expect(dailyStars(repo('a/b', 120, 'not-a-date'), NOW)).toBe(120)
  })
})

describe('rankHot', () => {
  it('新晋暴涨排在高总量前面', () => {
    const fresh = repo('x/new', 3000, '2026-10-25T12:00:00Z') // 9 天 ≈333/天
    const old = repo('x/old', 8000, '2026-10-05T12:00:00Z') // 29 天 ≈276/天
    expect(rankHot([old, fresh], NOW)[0].full_name).toBe('x/new')
  })

  it('日均相同时比总 star', () => {
    const a = repo('x/a', 100, '2026-10-04T12:00:00Z')
    const b = repo('x/b', 200, '2026-10-04T12:00:00Z')
    expect(rankHot([a, b], NOW)[0].full_name).toBe('x/b')
  })

  it('不修改原数组', () => {
    const list = [repo('x/a', 1, '2026-11-02T12:00:00Z'), repo('x/b', 9, '2026-10-10T12:00:00Z')]
    const before = list.map((r) => r.full_name)
    rankHot(list, NOW)
    expect(list.map((r) => r.full_name)).toEqual(before)
  })

  it('空列表返回空数组', () => {
    expect(rankHot([], NOW)).toEqual([])
  })
})
