import { describe, expect, it } from 'vitest'
import {
  popRoute,
  pushRoute,
  replaceTop,
  repoOf,
  routeKey,
  routeLabel,
  withRepoTab,
  type Route,
} from '../routes'

const repo: Route = { kind: 'repo', owner: 'a', repo: 'b' }

describe('路由栈', () => {
  it('压栈与出栈', () => {
    const s1 = pushRoute([], repo)
    expect(s1).toHaveLength(1)
    const s2 = pushRoute(s1, { kind: 'issue', owner: 'a', repo: 'b', number: 3 })
    expect(s2).toHaveLength(2)
    expect(popRoute(s2)).toEqual(s1)
    expect(popRoute([])).toEqual([])
  })

  it('同一个路由连压两次只留一条（防连点）', () => {
    const s1 = pushRoute([], repo)
    expect(pushRoute(s1, { ...repo })).toHaveLength(1)
  })

  it('替换栈顶不增加层级', () => {
    const s1 = pushRoute([], repo)
    const s2 = replaceTop(s1, { kind: 'settings' })
    expect(s2).toHaveLength(1)
    expect(s2[0].kind).toBe('settings')
  })

  it('空栈替换等价于压栈', () => {
    expect(replaceTop([], { kind: 'settings' })).toEqual([{ kind: 'settings' }])
  })
})

describe('路由键', () => {
  it('同类不同参数不冲突', () => {
    expect(routeKey({ kind: 'issue', owner: 'a', repo: 'b', number: 1 })).not.toBe(
      routeKey({ kind: 'issue', owner: 'a', repo: 'b', number: 2 }),
    )
  })

  it('仓库页签参与键值，切换页签不会命中同一条', () => {
    expect(routeKey({ kind: 'repo', owner: 'a', repo: 'b', tab: 'code' })).not.toBe(
      routeKey({ kind: 'repo', owner: 'a', repo: 'b', tab: 'issues' }),
    )
  })

  it('用户名大小写不敏感', () => {
    expect(routeKey({ kind: 'user', login: 'ABC' })).toBe(routeKey({ kind: 'user', login: 'abc' }))
  })

  it('文件路径参与键值', () => {
    expect(routeKey({ kind: 'code', owner: 'a', repo: 'b', path: 'src/x.ts' })).not.toBe(
      routeKey({ kind: 'code', owner: 'a', repo: 'b', path: 'src/y.ts' }),
    )
  })
})

describe('路由辅助', () => {
  it('repoOf 只对仓库相关路由返回值', () => {
    expect(repoOf({ kind: 'pull', owner: 'a', repo: 'b', number: 2 })).toEqual({ owner: 'a', repo: 'b' })
    expect(repoOf({ kind: 'settings' })).toBe(null)
  })

  it('中文标签齐备', () => {
    expect(routeLabel({ kind: 'notifications' })).toBe('通知')
    expect(routeLabel({ kind: 'code', owner: 'a', repo: 'b', path: 'src' })).toBe('src')
    expect(routeLabel({ kind: 'edit', owner: 'a', repo: 'b', path: '' })).toBe('新建文件')
  })

  it('切页签只对 repo 路由生效', () => {
    expect(withRepoTab({ kind: 'repo', owner: 'a', repo: 'b' }, 'pulls')).toMatchObject({ tab: 'pulls' })
    const other: Route = { kind: 'settings' }
    expect(withRepoTab(other, 'pulls')).toBe(other)
  })
})

describe('提交路由', () => {
  it('文件历史与整库历史用 path 区分', () => {
    const a = routeKey({ kind: 'commits', owner: 'o', repo: 'r' })
    const b = routeKey({ kind: 'commits', owner: 'o', repo: 'r', path: 'src/a.ts' })
    expect(a).not.toBe(b)
    expect(b).toContain('src/a.ts')
  })

  it('带 ref 的历史是不同的键（换分支要重新挂载）', () => {
    const x = routeKey({ kind: 'commits', owner: 'o', repo: 'r', path: 'a', ref: 'main' })
    const y = routeKey({ kind: 'commits', owner: 'o', repo: 'r', path: 'a', ref: 'dev' })
    expect(x).not.toBe(y)
  })

  it('提交详情标题用短 sha，且能认出所属仓库', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567'
    expect(routeLabel({ kind: 'commit', owner: 'o', repo: 'r', sha })).toBe('0123456')
    expect(repoOf({ kind: 'commit', owner: 'o', repo: 'r', sha })).toEqual({ owner: 'o', repo: 'r' })
  })

  it('历史页标题带上路径', () => {
    expect(routeLabel({ kind: 'commits', owner: 'o', repo: 'r', path: 'src/a.ts' })).toBe('src/a.ts 的历史')
    expect(routeLabel({ kind: 'commits', owner: 'o', repo: 'r' })).toBe('提交历史')
  })
})
