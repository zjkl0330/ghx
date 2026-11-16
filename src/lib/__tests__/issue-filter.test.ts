import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTER,
  activeCount,
  buildIssueParams,
  filterSummary,
  isFiltering,
  matchesFilter,
  sinceIso,
  sinceLabel,
  type Filterable,
  type IssueFilter,
} from '../issue-filter'

const NOW = Date.parse('2026-11-16T04:00:00Z')

function item(patch: Partial<Filterable> = {}): Filterable {
  return {
    user: { login: 'alice' },
    assignees: null,
    labels: [{ name: 'bug' }],
    milestone: null,
    updated_at: '2026-11-15T00:00:00Z',
    ...patch,
  }
}

function filter(patch: Partial<IssueFilter> = {}): IssueFilter {
  return { ...EMPTY_FILTER, ...patch }
}

describe('buildIssueParams', () => {
  it('空筛选一个参数都不带', () => {
    expect(buildIssueParams(EMPTY_FILTER, NOW)).toEqual({})
  })

  it('作者走 creator 而不是 author', () => {
    // 踩过的坑：author 是搜索 API 的限定符，issues 端点认的是 creator，
    // 写错不报错，只是筛选静默失效
    expect(buildIssueParams(filter({ author: 'alice' }), NOW)).toEqual({ creator: 'alice' })
  })

  it('@ 前缀会被去掉', () => {
    expect(buildIssueParams(filter({ author: '@alice' }), NOW).creator).toBe('alice')
  })

  it('assignee 支持 none 与 *', () => {
    expect(buildIssueParams(filter({ assignee: 'none' }), NOW).assignee).toBe('none')
    expect(buildIssueParams(filter({ assignee: '*' }), NOW).assignee).toBe('*')
  })

  it('里程碑按号传', () => {
    expect(buildIssueParams(filter({ milestone: '7' }), NOW).milestone).toBe('7')
  })

  it('时间范围折成 ISO 的 since', () => {
    const out = buildIssueParams(filter({ sinceDays: 7 }), NOW)
    expect(out.since).toBe(new Date(NOW - 7 * 86_400_000).toISOString())
  })

  it('0 天不带 since', () => {
    expect(buildIssueParams(filter({ sinceDays: 0 }), NOW).since).toBeUndefined()
  })

  it('标签走 labels（复数）', () => {
    expect(buildIssueParams(filter({ label: 'bug' }), NOW).labels).toBe('bug')
  })
})

describe('sinceIso', () => {
  it('负数与 0 都返回 null', () => {
    expect(sinceIso(0, NOW)).toBe(null)
    expect(sinceIso(-3, NOW)).toBe(null)
  })

  it('天数向下取整，不会被小数带出毫秒漂移', () => {
    expect(sinceIso(1.9, NOW)).toBe(new Date(NOW - 86_400_000).toISOString())
  })
})

describe('activeCount / isFiltering', () => {
  it('空筛选不算在筛', () => {
    expect(activeCount(EMPTY_FILTER)).toBe(0)
    expect(isFiltering(EMPTY_FILTER)).toBe(false)
  })

  it('五个维度各算一项', () => {
    const f = filter({ author: 'a', assignee: 'none', milestone: '3', label: 'bug', sinceDays: 30 })
    expect(activeCount(f)).toBe(5)
  })

  it('只有空格不算', () => {
    expect(activeCount(filter({ author: '   ' }))).toBe(0)
  })
})

describe('matchesFilter', () => {
  it('不限时全部通过', () => {
    expect(matchesFilter(item(), EMPTY_FILTER, NOW)).toBe(true)
  })

  it('作者大小写不敏感', () => {
    expect(matchesFilter(item({ user: { login: 'Alice' } }), filter({ author: 'ALICE' }), NOW)).toBe(true)
    expect(matchesFilter(item({ user: { login: 'bob' } }), filter({ author: 'alice' }), NOW)).toBe(false)
  })

  it('没有作者字段时不匹配具体作者', () => {
    expect(matchesFilter(item({ user: null }), filter({ author: 'alice' }), NOW)).toBe(false)
  })

  it('assignee=none 只留没人指派的', () => {
    expect(matchesFilter(item({ assignees: [] }), filter({ assignee: 'none' }), NOW)).toBe(true)
    expect(matchesFilter(item({ assignees: null }), filter({ assignee: 'none' }), NOW)).toBe(true)
    expect(
      matchesFilter(item({ assignees: [{ login: 'alice' }] }), filter({ assignee: 'none' }), NOW),
    ).toBe(false)
  })

  it('assignee=* 只留有指派人的', () => {
    expect(matchesFilter(item({ assignees: [] }), filter({ assignee: '*' }), NOW)).toBe(false)
    expect(
      matchesFilter(item({ assignees: [{ login: 'bob' }] }), filter({ assignee: '*' }), NOW),
    ).toBe(true)
  })

  it('指定登录名要在指派列表里（多人都算命中）', () => {
    const it1 = item({ assignees: [{ login: 'bob' }, { login: 'Alice' }] })
    expect(matchesFilter(it1, filter({ assignee: 'alice' }), NOW)).toBe(true)
    expect(matchesFilter(it1, filter({ assignee: 'carol' }), NOW)).toBe(false)
  })

  it('里程碑按号比，字符串与数字都能对上', () => {
    const it1 = item({ milestone: { number: 7, title: 'v1' } })
    expect(matchesFilter(it1, filter({ milestone: '7' }), NOW)).toBe(true)
    expect(matchesFilter(it1, filter({ milestone: '8' }), NOW)).toBe(false)
    expect(matchesFilter(it1, filter({ milestone: 'none' }), NOW)).toBe(false)
    expect(matchesFilter(it1, filter({ milestone: '*' }), NOW)).toBe(true)
  })

  it('没有里程碑时 none 命中、* 不命中', () => {
    const it1 = item({ milestone: null })
    expect(matchesFilter(it1, filter({ milestone: 'none' }), NOW)).toBe(true)
    expect(matchesFilter(it1, filter({ milestone: '*' }), NOW)).toBe(false)
  })

  it('标签大小写不敏感', () => {
    expect(matchesFilter(item({ labels: [{ name: 'Bug' }] }), filter({ label: 'bug' }), NOW)).toBe(true)
  })

  it('时间按 updated_at 判，边界内保留', () => {
    const recent = item({ updated_at: new Date(NOW - 3 * 86_400_000).toISOString() })
    const old = item({ updated_at: new Date(NOW - 40 * 86_400_000).toISOString() })
    expect(matchesFilter(recent, filter({ sinceDays: 7 }), NOW)).toBe(true)
    expect(matchesFilter(old, filter({ sinceDays: 7 }), NOW)).toBe(false)
  })

  it('时间字段坏掉时判不通过，而不是放行', () => {
    // 放行会让「近 7 天」里混进一条时间未知的记录，比少一条更糟
    expect(matchesFilter(item({ updated_at: 'not-a-date' }), filter({ sinceDays: 7 }), NOW)).toBe(false)
  })
})

describe('filterSummary', () => {
  it('空筛选没有摘要', () => {
    expect(filterSummary(EMPTY_FILTER)).toEqual([])
  })

  it('各项都翻成人话', () => {
    const f = filter({ author: '@alice', assignee: 'none', milestone: '12', label: 'bug', sinceDays: 30 })
    expect(filterSummary(f)).toEqual(['作者 @alice', '无人指派', '里程碑 #12', '标签 bug', '近 30 天更新'])
  })

  it('星号说成「已指派 / 有里程碑」', () => {
    expect(filterSummary(filter({ assignee: '*', milestone: '*' }))).toEqual(['已指派', '有里程碑'])
  })

  it('填了登录名就说指派给谁', () => {
    expect(filterSummary(filter({ assignee: 'bob' }))).toEqual(['指派 @bob'])
  })
})

describe('sinceLabel', () => {
  it('0 说成不限时间', () => {
    expect(sinceLabel(0)).toBe('不限时间')
    expect(sinceLabel(7)).toBe('近 7 天')
  })
})
