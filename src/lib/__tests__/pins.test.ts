import { describe, expect, it } from 'vitest'
import {
  MAX_PINS,
  applyPins,
  isPinned,
  missingPins,
  parsePins,
  serializePins,
  togglePin,
} from '../pins'

const repo = (full: string) => ({ full_name: full })

describe('置顶列表解析', () => {
  it('正常数组原样读回', () => {
    expect(parsePins('["a/b","c/d"]')).toEqual(['a/b', 'c/d'])
  })

  it('脏数据一律丢掉，不抛错', () => {
    expect(parsePins(null)).toEqual([])
    expect(parsePins('')).toEqual([])
    expect(parsePins('不是 JSON')).toEqual([])
    expect(parsePins('{"a":1}')).toEqual([])
    expect(parsePins('["a/b",3,null,"没有斜杠","a/b/c","x/y"]')).toEqual(['a/b', 'x/y'])
  })

  it('大小写不同视为同一个，去重保留先出现的', () => {
    expect(parsePins('["A/B","a/b","c/d"]')).toEqual(['A/B', 'c/d'])
  })

  it('超过上限只留前面那些', () => {
    const many = Array.from({ length: MAX_PINS + 20 }, (_, i) => `u/r${i}`)
    expect(parsePins(JSON.stringify(many))).toHaveLength(MAX_PINS)
  })
})

describe('切换置顶', () => {
  it('钉上再取消，回到原样', () => {
    const a = togglePin([], 'zjkl0330/ghx')
    expect(a).toEqual(['zjkl0330/ghx'])
    expect(togglePin(a, 'zjkl0330/ghx')).toEqual([])
  })

  it('取消时大小写不敏感', () => {
    expect(togglePin(['zjkl0330/GHX'], 'zjkl0330/ghx')).toEqual([])
  })

  it('满了之后不再加，但已钉的还能取消', () => {
    const full = Array.from({ length: MAX_PINS }, (_, i) => `u/r${i}`)
    expect(togglePin(full, 'x/y')).toHaveLength(MAX_PINS)
    expect(togglePin(full, 'u/r0')).toHaveLength(MAX_PINS - 1)
  })

  it('isPinned 大小写不敏感', () => {
    expect(isPinned(['a/b'], 'A/B')).toBe(true)
    expect(isPinned([], 'A/B')).toBe(false)
  })

  it('序列化后能原样解析回来', () => {
    const list = ['a/b', 'c/d']
    expect(parsePins(serializePins(list))).toEqual(list)
  })
})

describe('置顶排序', () => {
  const repos = [repo('a/1'), repo('b/2'), repo('c/3')]

  it('没有置顶时原样返回，连数组都不复制', () => {
    expect(applyPins(repos, [])).toBe(repos)
  })

  it('置顶的提到最前，其余保持原顺序', () => {
    const out = applyPins(repos, ['c/3', 'a/1'])
    expect(out.map((r) => r.full_name)).toEqual(['c/3', 'a/1', 'b/2'])
  })

  it('置顶区内部按添加顺序排，不受当前排序影响', () => {
    const out = applyPins(repos, ['b/2', 'c/3'])
    expect(out.map((r) => r.full_name)).toEqual(['b/2', 'c/3', 'a/1'])
  })

  it('钉了但不在当前列表里的项直接跳过', () => {
    const out = applyPins(repos, ['gone/x', 'b/2'])
    expect(out.map((r) => r.full_name)).toEqual(['b/2', 'a/1', 'c/3'])
    expect(out).toHaveLength(3)
  })

  it('全部置顶项都不在列表时返回原数组', () => {
    expect(applyPins(repos, ['gone/x'])).toBe(repos)
  })

  it('大小写不同也能匹配上', () => {
    const out = applyPins(repos, ['C/3'])
    expect(out[0].full_name).toBe('c/3')
  })

  it('置顶列表里有重复时不会把同一个仓库排两遍', () => {
    const out = applyPins(repos, ['b/2', 'B/2'])
    expect(out.map((r) => r.full_name)).toEqual(['b/2', 'a/1', 'c/3'])
  })
})

describe('失联的置顶项', () => {
  it('列出不在当前列表里的', () => {
    expect(missingPins([repo('a/1')], ['a/1', 'b/2'])).toEqual(['b/2'])
  })

  it('全在时返回空数组', () => {
    expect(missingPins([repo('a/1')], ['a/1'])).toEqual([])
  })
})
