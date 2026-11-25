import { describe, expect, it } from 'vitest'
import { normalizeTimeline, tailLimit, type TimelineRaw } from '../timeline'

const T1 = '2026-11-20T10:00:00Z'
const T2 = '2026-11-21T10:00:00Z'

const ev = (e: Partial<TimelineRaw> & { event: string }): TimelineRaw => ({
  id: Math.random().toString(36).slice(2),
  created_at: T1,
  actor: { login: 'zjkl0330' },
  ...e,
})

describe('时间线规整', () => {
  it('标签、指派、关闭、重开都能译成人话', () => {
    const items = normalizeTimeline([
      ev({ event: 'labeled', label: { name: 'bug', color: 'd73a4a' } }),
      ev({ event: 'assigned', assignee: { login: 'alice' } }),
      ev({ event: 'closed', state_reason: 'completed' }),
      ev({ event: 'reopened' }),
    ])
    expect(items.map((i) => i.text)).toEqual([
      '加了标签「bug」',
      '指派给 @alice',
      '关闭了（已完成）',
      '重新打开了',
    ])
    expect(items[0].tone).toBe('label')
    expect(items[0].color).toBe('d73a4a')
    expect(items[2].tone).toBe('closed')
  })

  it('关闭原因决定括号里的说法，没给就不加', () => {
    const [planned] = normalizeTimeline([ev({ event: 'closed', state_reason: 'not_planned' })])
    expect(planned.text).toBe('关闭了（不打算处理）')
    const [plain] = normalizeTimeline([ev({ event: 'closed' })])
    expect(plain.text).toBe('关闭了')
  })

  it('评论、提交、订阅类流水账一律不出现', () => {
    const items = normalizeTimeline([
      ev({ event: 'commented' }),
      ev({ event: 'committed' }),
      ev({ event: 'subscribed' }),
      ev({ event: 'head_ref_deleted' }),
      ev({ event: 'reviewed' }),
    ])
    expect(items).toEqual([])
  })

  it('没见过的类型直接丢，不编一句「触发了 something」', () => {
    expect(normalizeTimeline([ev({ event: 'some_future_thing' })])).toEqual([])
  })

  it('没有时间的动态不参与排序', () => {
    expect(normalizeTimeline([{ event: 'closed', actor: { login: 'a' } }])).toEqual([])
  })

  it('引用与合并带上短 sha', () => {
    const items = normalizeTimeline([
      ev({ event: 'referenced', commit_id: 'abcdef1234567890' }),
      ev({ event: 'merged', commit_id: 'fedcba9876543210' }),
    ])
    expect(items[0].text).toBe('在提交 abcdef1 里提到')
    expect(items[1].text).toBe('合并了 fedcba9')
  })

  it('跨仓库引用优先显示 full_name', () => {
    const [a] = normalizeTimeline([
      ev({
        event: 'cross-referenced',
        source: { issue: { number: 42, pull_request: {}, repository: { full_name: 'o/r' } } },
      }),
    ])
    expect(a.text).toBe('关联了 PR o/r#42')

    const [b] = normalizeTimeline([
      ev({ event: 'cross-referenced', source: { issue: { number: 7, repository: { full_name: 'o/r' } } } }),
    ])
    expect(b.text).toBe('关联了 o/r#7')
  })

  it('改名事件把新旧标题都写出来', () => {
    const [a] = normalizeTimeline([ev({ event: 'renamed', rename: { from: '旧', to: '新' } })])
    expect(a.text).toBe('把标题从「旧」改成「新」')
    const [b] = normalizeTimeline([ev({ event: 'renamed', rename: { to: '新' } })])
    expect(b.text).toBe('把标题改成「新」')
  })

  it('actor 缺失时给「某人」，不渲染 undefined', () => {
    const [a] = normalizeTimeline([{ event: 'locked', created_at: T1 }])
    expect(a.actor).toBe('某人')
  })

  it('按钮类事件（里程碑 / 草稿 / 锁定）也有文案', () => {
    const texts = normalizeTimeline([
      ev({ event: 'milestoned', milestone: { title: 'v1.3' } }),
      ev({ event: 'demilestoned', milestone: { title: 'v1.3' } }),
      ev({ event: 'converted_to_draft' }),
      ev({ event: 'ready_for_review' }),
      ev({ event: 'locked' }),
      ev({ event: 'unlocked' }),
      ev({ event: 'marked_as_duplicate' }),
    ]).map((i) => i.text)
    expect(texts).toEqual([
      '加入里程碑「v1.3」',
      '移出里程碑「v1.3」',
      '转为草稿',
      '标记为可评审',
      '锁定了对话',
      '解锁了对话',
      '标记为重复',
    ])
  })

  it('保留原始顺序（接口本来就是时间正序）', () => {
    const items = normalizeTimeline([
      ev({ event: 'labeled', label: { name: 'a' }, created_at: T1 }),
      ev({ event: 'labeled', label: { name: 'b' }, created_at: T2 }),
    ])
    expect(items.map((i) => i.at)).toEqual([T1, T2])
  })

  it('没有 id 的事件也能拿到稳定 key', () => {
    const items = normalizeTimeline([
      { event: 'locked', created_at: T1, actor: { login: 'a' } },
      { event: 'locked', created_at: T1, actor: { login: 'a' } },
    ])
    expect(items[0].key).not.toBe(items[1].key)
    expect(items[0].key).toContain('locked')
  })
})

describe('动态折叠', () => {
  const list = normalizeTimeline(
    Array.from({ length: 12 }, (_, i) =>
      ev({ event: 'labeled', label: { name: `l${i}` }, created_at: `2026-11-${(i + 1).toString().padStart(2, '0')}T00:00:00Z` }),
    ),
  )

  it('超过上限只留最近几条，并报出被折叠的条数', () => {
    const { shown, hidden } = tailLimit(list, 8)
    expect(shown).toHaveLength(8)
    expect(hidden).toBe(4)
    expect(shown[shown.length - 1].text).toBe('加了标签「l11」')
  })

  it('没超过上限时原样返回', () => {
    expect(tailLimit(list.slice(0, 3), 8)).toEqual({ shown: list.slice(0, 3), hidden: 0 })
  })

  it('上限非法时不抛异常', () => {
    expect(tailLimit(list, 0)).toEqual({ shown: [], hidden: 12 })
  })
})
