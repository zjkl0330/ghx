import { describe, expect, it } from 'vitest'
import { NO_LANGUAGE, groupByLanguage, topLanguages } from '../stars'
import type { Repo } from '../types'

function repo(name: string, language: string | null, stars = 0, owner = 'o'): Repo {
  return {
    id: Math.random(),
    name,
    full_name: `${owner}/${name}`,
    owner,
    private: false,
    visibility: 'public',
    archived: false,
    disabled: false,
    description: null,
    language,
    stargazers_count: stars,
    forks_count: 0,
    pushed_at: '2026-11-01T00:00:00Z',
    default_branch: 'main',
  }
}

describe('groupByLanguage', () => {
  it('同语言归到一组', () => {
    const groups = groupByLanguage([
      repo('a', 'TypeScript', 3),
      repo('b', 'TypeScript', 9),
      repo('c', 'Go', 5),
    ])
    const ts = groups.find((g) => g.language === 'TypeScript')
    expect(ts?.count).toBe(2)
    expect(ts?.repos.map((r) => r.name)).toEqual(['b', 'a'])
  })

  it('组间按仓库数降序', () => {
    const groups = groupByLanguage([
      repo('a', 'Go'),
      repo('b', 'Rust'),
      repo('c', 'Rust'),
    ])
    expect(groups.map((g) => g.language)).toEqual(['Rust', 'Go'])
  })

  it('数量相同时比 star 总数', () => {
    const groups = groupByLanguage([
      repo('a', 'Go', 1),
      repo('b', 'Rust', 100),
    ])
    expect(groups[0].language).toBe('Rust')
  })

  it('未标注固定排最后，即使数量更多', () => {
    const groups = groupByLanguage([
      repo('a', null),
      repo('b', null),
      repo('c', null),
      repo('d', 'Go'),
    ])
    expect(groups[0].language).toBe('Go')
    expect(groups[groups.length - 1].language).toBe(NO_LANGUAGE)
  })

  it('空字符串与空白也算未标注', () => {
    const groups = groupByLanguage([repo('a', '  '), repo('b', '')])
    expect(groups).toHaveLength(1)
    expect(groups[0].language).toBe(NO_LANGUAGE)
  })

  it('空列表返回空分组', () => {
    expect(groupByLanguage([])).toEqual([])
  })

  it('不修改传入数组', () => {
    const input = [repo('a', 'Go', 1), repo('b', 'Go', 5)]
    const snapshot = input.map((r) => r.name)
    groupByLanguage(input)
    expect(input.map((r) => r.name)).toEqual(snapshot)
  })

  it('组内 star 相同时按名称稳定排序', () => {
    const groups = groupByLanguage([repo('z', 'Go', 1), repo('a', 'Go', 1)])
    expect(groups[0].repos.map((r) => r.name)).toEqual(['a', 'z'])
  })
})

describe('topLanguages', () => {
  it('按数量取前几个，不包含未标注', () => {
    const list = [
      repo('a', 'Go'),
      repo('b', 'Go'),
      repo('c', 'Rust'),
      repo('d', null),
    ]
    expect(topLanguages(list)).toEqual(['Go', 'Rust'])
  })

  it('尊重 limit', () => {
    const list = [repo('a', 'Go'), repo('b', 'Rust'), repo('c', 'Zig')]
    expect(topLanguages(list, 2)).toHaveLength(2)
  })
})
