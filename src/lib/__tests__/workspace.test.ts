import { describe, expect, it } from 'vitest'
import {
  dropWorkspace,
  emptyWorkspace,
  hasContent,
  patchWorkspace,
  restoreWorkspace,
  saveWorkspace,
  type Workspace,
} from '../workspace'
import type { Repo } from '../types'

const repo = (full: string): Repo => ({
  id: 1,
  name: full.split('/')[1],
  full_name: full,
  owner: full.split('/')[0],
  private: false,
  visibility: 'public',
  archived: false,
  disabled: false,
  description: null,
  language: null,
  stargazers_count: 0,
  forks_count: 0,
  pushed_at: '',
  default_branch: 'main',
})

const ws = (over: Partial<Workspace> = {}): Workspace => ({
  ...emptyWorkspace('pushed'),
  ...over,
})

describe('空现场', () => {
  it('默认值稳定：不共享同一个数组', () => {
    const a = emptyWorkspace('pushed')
    const b = emptyWorkspace('pushed')
    a.pins.push('x/y')
    expect(b.pins).toEqual([])
    expect(a.sort).toBe('pushed')
  })
})

describe('保存与恢复', () => {
  it('存进去能原样取出来', () => {
    const table = saveWorkspace({}, 'a1', ws({ query: 'ghx', pins: ['o/r'] }))
    const got = restoreWorkspace(table, 'a1')
    expect(got?.query).toBe('ghx')
    expect(got?.pins).toEqual(['o/r'])
  })

  it('没存过就是 null，调用方好判断', () => {
    expect(restoreWorkspace({}, 'nope')).toBe(null)
  })

  it('存的是副本：外部再改原对象不影响表里的', () => {
    const src = ws({ query: 'a' })
    const table = saveWorkspace({}, 'a1', src)
    src.query = 'b'
    src.pins.push('x/y')
    expect(restoreWorkspace(table, 'a1')?.query).toBe('a')
    expect(restoreWorkspace(table, 'a1')?.pins).toEqual([])
  })

  it('两个账号互不干扰', () => {
    let table = saveWorkspace({}, 'a1', ws({ query: 'one' }))
    table = saveWorkspace(table, 'a2', ws({ query: 'two' }))
    expect(restoreWorkspace(table, 'a1')?.query).toBe('one')
    expect(restoreWorkspace(table, 'a2')?.query).toBe('two')
  })

  it('同一账号再存是覆盖，不是叠加', () => {
    let table = saveWorkspace({}, 'a1', ws({ query: 'old' }))
    table = saveWorkspace(table, 'a1', ws({ query: 'new' }))
    expect(restoreWorkspace(table, 'a1')?.query).toBe('new')
    expect(Object.keys(table)).toHaveLength(1)
  })

  it('空 id 不写入（启动早期还没有活动账号）', () => {
    const table = saveWorkspace({}, '', ws())
    expect(Object.keys(table)).toHaveLength(0)
  })
})

describe('丢弃现场', () => {
  it('指定 id 只丢那一个', () => {
    const table = { a1: ws(), a2: ws() }
    const next = dropWorkspace(table, 'a1')
    expect(Object.keys(next)).toEqual(['a2'])
  })

  it('不指定 id 清空整表（锁定保险库）', () => {
    expect(dropWorkspace({ a1: ws(), a2: ws() })).toEqual({})
  })

  it('丢不存在的 id 时原样返回，不复制', () => {
    const table = { a1: ws() }
    expect(dropWorkspace(table, 'zzz')).toBe(table)
  })
})

describe('局部更新', () => {
  it('只改指定字段，其余保留', () => {
    const table = { a1: ws({ query: 'q', pins: ['o/r'] }) }
    const next = patchWorkspace(table, 'a1', { unread: 3 })
    expect(next.a1.unread).toBe(3)
    expect(next.a1.query).toBe('q')
    expect(next.a1.pins).toEqual(['o/r'])
  })

  it('账号没现场时不动，避免凭空造一个空壳覆盖真实数据', () => {
    const table = { a1: ws() }
    expect(patchWorkspace(table, 'a2', { unread: 1 })).toBe(table)
  })
})

describe('有没有内容', () => {
  it('有仓库或停在某个页面才算', () => {
    expect(hasContent(null)).toBe(false)
    expect(hasContent(ws())).toBe(false)
    expect(hasContent(ws({ repos: [repo('o/r')] }))).toBe(true)
    expect(hasContent(ws({ routeStack: [{ kind: 'settings' }] }))).toBe(true)
  })
})
