import { describe, expect, it } from 'vitest'
import { descText, pickDescItems } from '../desc'
import type { Repo } from '../types'

function repo(full: string, description: string | null): Repo {
  const [owner, name] = full.split('/')
  return {
    id: full.length,
    name,
    full_name: full,
    owner,
    private: false,
    visibility: 'public',
    archived: false,
    disabled: false,
    description,
    language: null,
    stargazers_count: 0,
    forks_count: 0,
    pushed_at: '2026-01-01T00:00:00Z',
    default_branch: 'main',
  }
}

describe('pickDescItems', () => {
  it('丢掉空简介和纯空格', () => {
    const out = pickDescItems([repo('a/one', 'hello'), repo('a/two', null), repo('a/three', '   ')])
    expect(out).toEqual([{ key: 'a/one', text: 'hello' }])
  })

  it('trim 掉首尾空白', () => {
    expect(pickDescItems([repo('a/one', '  hi  ')])[0].text).toBe('hi')
  })

  it('按 limit 截断', () => {
    const list = Array.from({ length: 50 }, (_, i) => repo(`a/r${i}`, `d${i}`))
    expect(pickDescItems(list, 30)).toHaveLength(30)
  })

  it('默认上限 30', () => {
    const list = Array.from({ length: 80 }, (_, i) => repo(`a/r${i}`, `d${i}`))
    expect(pickDescItems(list)).toHaveLength(30)
  })

  it('同名仓库只翻一次', () => {
    const out = pickDescItems([repo('a/one', 'x'), repo('a/one', 'x')])
    expect(out).toHaveLength(1)
  })

  it('详情即使不在列表里也要补进去', () => {
    const list = [repo('a/one', 'x')]
    const extra = repo('b/detail', 'the one I opened')
    const out = pickDescItems(list, 30, extra)
    expect(out.map((i) => i.key)).toEqual(['a/one', 'b/detail'])
  })

  it('详情已在列表里时不重复', () => {
    const list = [repo('a/one', 'x')]
    const out = pickDescItems(list, 30, list[0])
    expect(out).toHaveLength(1)
  })

  it('列表塞满后详情仍会追加（越界一条）', () => {
    const list = Array.from({ length: 30 }, (_, i) => repo(`a/r${i}`, `d${i}`))
    const out = pickDescItems(list, 30, repo('b/detail', 'y'))
    expect(out).toHaveLength(31)
    expect(out[30].key).toBe('b/detail')
  })

  it('详情没有简介就不进队列', () => {
    const out = pickDescItems([repo('a/one', 'x')], 30, repo('b/detail', null))
    expect(out).toHaveLength(1)
  })

  it('空列表返回空', () => {
    expect(pickDescItems([], 30)).toEqual([])
  })
})

describe('descText', () => {
  it('命中返回译文', () => {
    expect(descText({ 'a/b': '中文' }, 'a/b')).toBe('中文')
  })

  it('未命中返回 null', () => {
    expect(descText({}, 'a/b')).toBeNull()
    expect(descText(undefined, 'a/b')).toBeNull()
  })

  it('空译文当没翻', () => {
    expect(descText({ 'a/b': '   ' }, 'a/b')).toBeNull()
  })
})
