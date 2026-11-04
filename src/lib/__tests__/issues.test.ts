import { describe, expect, it } from 'vitest'
import type { ApiClient } from '../api'
import {
  filterIssues,
  setAssignees,
  setLocked,
  isPull,
  issueStateText,
  labelColorCss,
  labelCounts,
  labelTextColor,
  onlyIssues,
  type Issue,
} from '../issues'

function issue(n: number, patch: Partial<Issue> = {}): Issue {
  return {
    number: n,
    title: `标题 ${n}`,
    state: 'open',
    body: null,
    user: null,
    labels: [],
    assignees: [],
    comments: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    closed_at: null,
    ...patch,
  }
}

describe('Issue 与 PR 的区分', () => {
  it('带 pull_request 的是 PR', () => {
    expect(isPull(issue(1, { pull_request: {} }))).toBe(true)
    expect(isPull(issue(2))).toBe(false)
  })

  it('列表过滤掉 PR 后条数变少是正常的', () => {
    const list = [issue(1), issue(2, { pull_request: {} }), issue(3, { pull_request: {} })]
    expect(onlyIssues(list).map((i) => i.number)).toEqual([1])
  })
})

describe('状态文案', () => {
  it('closed 要看 reason 才知道是完成还是不做', () => {
    expect(issueStateText('open')).toBe('开启中')
    expect(issueStateText('closed', 'completed')).toBe('已完成')
    expect(issueStateText('closed', 'not_planned')).toBe('未计划')
    expect(issueStateText('closed', null)).toBe('已关闭')
  })
})

describe('标签配色', () => {
  it('深色底用白字，浅色底用黑字', () => {
    expect(labelTextColor('000000')).toBe('#ffffff')
    expect(labelTextColor('ffffff')).toBe('#0d1117')
    // 黄色亮度高，白字会看不清
    expect(labelTextColor('fbca04')).toBe('#0d1117')
  })

  it('三位 hex 能展开，非法值给保底色', () => {
    expect(labelColorCss('abc')).toBe('#abc')
    expect(labelColorCss('zzz')).toBe('#8b949e')
    expect(labelTextColor('zzz')).toBe('#ffffff')
  })
})

describe('筛选与统计', () => {
  const list = [
    issue(1, { title: '登录失败', labels: [{ name: 'bug', color: 'ff0000' }] }),
    issue(2, { title: '文档更新', body: '补充了 deploy 说明', labels: [{ name: 'docs', color: '00ff00' }] }),
    issue(3, { title: 'README 错字', labels: [{ name: 'bug', color: 'ff0000' }] }),
  ]

  it('按标题、正文、编号、标签匹配', () => {
    expect(filterIssues(list, '登录').map((i) => i.number)).toEqual([1])
    expect(filterIssues(list, 'deploy').map((i) => i.number)).toEqual([2])
    expect(filterIssues(list, '3').map((i) => i.number)).toEqual([3])
    expect(filterIssues(list, 'bug').map((i) => i.number)).toEqual([1, 3])
  })

  it('按标签精确过滤，并可与关键词叠加', () => {
    expect(filterIssues(list, '', 'bug').map((i) => i.number)).toEqual([1, 3])
    expect(filterIssues(list, 'README', 'bug').map((i) => i.number)).toEqual([3])
  })

  it('空关键词返回全部', () => {
    expect(filterIssues(list, '   ')).toHaveLength(3)
  })

  it('标签计数按数量降序', () => {
    const counts = labelCounts(list)
    expect(counts[0]).toEqual({ name: 'bug', color: 'ff0000', count: 2 })
    expect(counts.map((c) => c.name).sort()).toEqual(['bug', 'docs'])
  })
})

/** 只记请求、不做网络：用来断言「发出去的是哪一条」 */
function fakeClient() {
  const calls: { path: string; method: string; body?: string }[] = []
  const client = {
    async request(path: string, init: { method?: string; body?: string } = {}) {
      calls.push({ path, method: init.method ?? 'GET', body: init.body })
      return { data: null, rate: null, scopes: [] }
    },
  } as unknown as ApiClient
  return { client, calls }
}

describe('写操作的请求形状', () => {
  it('指派走 PATCH /issues/{n} 整体替换，而不是 /assignees 追加', async () => {
    const { client, calls } = fakeClient()
    await setAssignees(client, 'a', 'b', 7, ['x', 'y'])
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('PATCH')
    expect(calls[0].path).toBe('/repos/a/b/issues/7')
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ assignees: ['x', 'y'] })
  })

  it('清空指派要显式传空数组，否则等于没改', async () => {
    const { client, calls } = fakeClient()
    await setAssignees(client, 'a', 'b', 7, [])
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({ assignees: [] })
  })

  it('锁定带原因，解锁走 DELETE 同一路径', async () => {
    const lockCalls = fakeClient()
    await setLocked(lockCalls.client, 'a', 'b', 9, true, 'spam')
    expect(lockCalls.calls[0].method).toBe('PUT')
    expect(lockCalls.calls[0].path).toBe('/repos/a/b/issues/9/lock')
    expect(JSON.parse(lockCalls.calls[0].body ?? '{}')).toEqual({ lock_reason: 'spam' })

    const unlockCalls = fakeClient()
    await setLocked(unlockCalls.client, 'a', 'b', 9, false)
    expect(unlockCalls.calls[0].method).toBe('DELETE')
    expect(unlockCalls.calls[0].body).toBeUndefined()
  })
})
