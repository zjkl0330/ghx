import { describe, expect, it } from 'vitest'
import {
  dueInfo,
  formatDue,
  milestoneExists,
  milestoneProgress,
  setMilestone,
  type Milestone,
} from '../milestones'

const NOW = Date.parse('2026-11-16T04:00:00Z')

function ms(patch: Partial<Milestone> = {}): Milestone {
  return {
    number: 1,
    title: 'v1.0',
    state: 'open',
    description: null,
    open_issues: 3,
    closed_issues: 7,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    due_on: null,
    closed_at: null,
    ...patch,
  }
}

describe('milestoneProgress', () => {
  it('按关闭数占比取整', () => {
    expect(milestoneProgress(ms({ open_issues: 3, closed_issues: 7 }))).toBe(70)
  })

  it('全部关闭是 100', () => {
    expect(milestoneProgress(ms({ open_issues: 0, closed_issues: 4 }))).toBe(100)
  })

  it('一条都没有时返回 0，不返回 NaN', () => {
    // 空里程碑画进度条时 NaN 会让宽度变成非法值，整条消失
    expect(milestoneProgress(ms({ open_issues: 0, closed_issues: 0 }))).toBe(0)
  })

  it('缺字段按 0 算', () => {
    const broken = { ...ms(), open_issues: undefined, closed_issues: undefined } as unknown as Milestone
    expect(milestoneProgress(broken)).toBe(0)
  })
})

describe('dueInfo', () => {
  it('没设截止日就是空', () => {
    expect(dueInfo(ms(), NOW)).toEqual({ text: '', tone: 'none' })
  })

  it('还早的显示日期', () => {
    expect(dueInfo(ms({ due_on: '2026-12-24T00:00:00Z' }), NOW)).toEqual({ text: '12-24', tone: 'ok' })
  })

  it('7 天内算临近', () => {
    expect(dueInfo(ms({ due_on: '2026-11-20T00:00:00Z' }), NOW).tone).toBe('soon')
    expect(dueInfo(ms({ due_on: '2026-11-20T00:00:00Z' }), NOW).text).toBe('还剩 4 天')
  })

  it('当天到期单独说', () => {
    expect(dueInfo(ms({ due_on: '2026-11-16T04:00:00Z' }), NOW).text).toBe('今天到期')
  })

  it('过期报逾期天数', () => {
    const info = dueInfo(ms({ due_on: '2026-11-10T04:00:00Z' }), NOW)
    expect(info.tone).toBe('over')
    expect(info.text).toBe('逾期 6 天')
  })

  it('已关闭的里程碑不标红，只显示日期', () => {
    const info = dueInfo(ms({ state: 'closed', due_on: '2026-11-10T00:00:00Z' }), NOW)
    expect(info.tone).toBe('none')
    expect(info.text).toBe('11-10')
  })

  it('坏日期当没设', () => {
    expect(dueInfo(ms({ due_on: 'soon' }), NOW)).toEqual({ text: '', tone: 'none' })
  })
})

describe('formatDue', () => {
  it('取月日', () => {
    expect(formatDue('2026-01-09T00:00:00Z')).toBe('01-09')
  })

  it('非 ISO 原样返回', () => {
    expect(formatDue('下个月')).toBe('下个月')
  })
})

describe('milestoneExists', () => {
  const list = [ms({ number: 1 }), ms({ number: 5 })]

  it('空值与特殊值永远算存在（它们不是号）', () => {
    expect(milestoneExists(list, '')).toBe(true)
    expect(milestoneExists(list, 'none')).toBe(true)
    expect(milestoneExists(list, '*')).toBe(true)
  })

  it('号在列表里才算', () => {
    expect(milestoneExists(list, '5')).toBe(true)
    expect(milestoneExists(list, '6')).toBe(false)
  })
})

describe('setMilestone', () => {
  it('PATCH 到 issue 端点，body 只有 milestone', async () => {
    const calls: { path: string; init?: RequestInit }[] = []
    const client = {
      request: async <T>(path: string, init?: RequestInit) => {
        calls.push({ path, init })
        return { data: { milestone: { number: 9 } } as T }
      },
    }
    const out = await setMilestone(client, 'o', 'r', 12, 9)
    expect(out).toEqual({ number: 9 })
    expect(calls[0].path).toBe('/repos/o/r/issues/12')
    expect(calls[0].init?.method).toBe('PATCH')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ milestone: 9 })
  })

  it('传 null 是移出里程碑', async () => {
    const client = {
      request: async <T>() => ({ data: { milestone: null } as T }),
    }
    const out = await setMilestone(client, 'o', 'r', 12, null)
    expect(out.number).toBe(null)
  })

  it('响应里没有 milestone 字段时按移出处理', async () => {
    const client = { request: async <T>() => ({ data: {} as T }) }
    expect((await setMilestone(client, 'o', 'r', 1, null)).number).toBe(null)
  })
})
