import { describe, expect, it, vi } from 'vitest'
import {
  defaultSelection,
  forkOwners,
  planMultiTasks,
  runLabel,
  runMultiTasks,
  summarize,
  toggleAllSelection,
  toggleSelection,
  type MultiAccount,
} from '../multi'

const A: MultiAccount = { id: 'a', label: '@zjkl0330', login: 'zjkl0330' }
const B: MultiAccount = { id: 'b', label: '@work', login: 'work-account' }
const C: MultiAccount = { id: 'c', label: '小号', login: null }

describe('多账号动作计划', () => {
  it('已 star 的账号跳过，未 star 与状态未知的都执行', () => {
    const tasks = planMultiTasks([A, B, C], 'star', {
      a: { starred: true },
      b: { starred: false },
      c: {},
    })
    expect(tasks.map((t) => t.skip ?? null)).toEqual(['已经 star 过', null, null])
  })

  it('取消 star 时只跳过「本来就没 star」的账号', () => {
    const tasks = planMultiTasks([A, B, C], 'unstar', {
      a: { starred: true },
      b: { starred: false },
      c: { starred: null },
    })
    expect(tasks.map((t) => t.skip ?? null)).toEqual([null, '本来就没 star', null])
  })

  it('已有复刻的账号跳过，状态未知的照样执行', () => {
    const tasks = planMultiTasks([A, B, C], 'fork', {
      a: { forked: true },
      b: { forked: false },
    })
    expect(tasks.map((t) => t.skip ?? null)).toEqual(['已有复刻', null, null])
  })

  it('每个任务都带着自己的账号名，回执不靠下标对号', () => {
    const tasks = planMultiTasks([B, A], 'star', {})
    expect(tasks.map((t) => t.label)).toEqual(['@work', '@zjkl0330'])
    expect(tasks.map((t) => t.id)).toEqual(['b', 'a'])
  })

  it('空账号列表得到空计划', () => {
    expect(planMultiTasks([], 'star', {})).toEqual([])
  })
})

describe('默认勾选', () => {
  it('跳过的不选，其余全选', () => {
    const tasks = planMultiTasks([A, B, C], 'star', { a: { starred: true } })
    expect([...defaultSelection(tasks)]).toEqual(['b', 'c'])
  })

  it('偏好选 1 个：只勾第一个（当前账号排第一）', () => {
    const tasks = planMultiTasks([A, B, C], 'star', {})
    expect([...defaultSelection(tasks, 1)]).toEqual(['a'])
  })

  it('偏好选 2 个：按顺序取前两个，跳过的不占名额', () => {
    const tasks = planMultiTasks([A, B, C], 'star', { a: { starred: true } })
    expect([...defaultSelection(tasks, 2)]).toEqual(['b', 'c'])
  })

  it('偏好要的比可执行的还多：全勾上，不会越界', () => {
    const tasks = planMultiTasks([A, B], 'star', { b: { starred: true } })
    expect([...defaultSelection(tasks, 3)]).toEqual(['a'])
  })

  it('0 / 不传 都表示全部', () => {
    const tasks = planMultiTasks([A, B], 'star', {})
    expect([...defaultSelection(tasks, 0)]).toEqual(['a', 'b'])
    expect([...defaultSelection(tasks)]).toEqual(['a', 'b'])
  })

  it('切换勾选返回新集合，不改原来的', () => {
    const base = new Set(['a'])
    const off = toggleSelection(base, 'a')
    const on = toggleSelection(base, 'b')
    expect([...base]).toEqual(['a'])
    expect([...off]).toEqual([])
    expect([...on]).toEqual(['a', 'b'])
  })

  it('全选只作用于没跳过的，再点一次清空', () => {
    const tasks = planMultiTasks([A, B, C], 'star', { a: { starred: true } })
    const all = toggleAllSelection(new Set(), tasks)
    expect([...all]).toEqual(['b', 'c'])
    const none = toggleAllSelection(all, tasks)
    expect([...none]).toEqual([])
  })
})

describe('复刻归属判断', () => {
  it('大小写不敏感', () => {
    const owners = forkOwners([{ owner: 'ZJKL0330' }, { owner: 'work-account' }])
    expect(owners.has('zjkl0330')).toBe(true)
    expect(owners.has('work-account')).toBe(true)
    expect(owners.has('nobody')).toBe(false)
  })
})

describe('串行执行', () => {
  it('按顺序执行，跳过的不发请求', async () => {
    const calls: string[] = []
    const tasks = planMultiTasks([A, B, C], 'star', { a: { starred: true } })
    const results = await runMultiTasks(
      tasks,
      async (t) => {
        calls.push(t.id)
      },
      { gap: 0 },
    )
    expect(calls).toEqual(['b', 'c'])
    expect(results.map((r) => r.skipped ?? null)).toEqual(['已经 star 过', null, null])
  })

  it('单个账号失败不中断后面的账号', async () => {
    const tasks = planMultiTasks([A, B, C], 'star', {})
    const results = await runMultiTasks(
      tasks,
      async (t) => {
        if (t.id === 'a') throw new Error('403 缺 star 权限')
      },
      { gap: 0 },
    )
    expect(results.map((r) => r.ok)).toEqual([false, true, true])
    expect(results[0].error).toBe('403 缺 star 权限')
  })

  it('每完成一条就回调一次，且回调顺序与执行顺序一致', async () => {
    const seen: string[] = []
    const onDone = vi.fn((r: { id: string }) => seen.push(r.id))
    const tasks = planMultiTasks([A, B], 'fork', {})
    await runMultiTasks(tasks, async () => {}, { gap: 0, onDone })
    expect(onDone).toHaveBeenCalledTimes(2)
    expect(seen).toEqual(['a', 'b'])
  })

  it('空计划直接返回空回执', async () => {
    const exec = vi.fn()
    const results = await runMultiTasks([], exec, { gap: 0 })
    expect(results).toEqual([])
    expect(exec).not.toHaveBeenCalled()
  })
})

describe('回执文案', () => {
  it('成功、跳过、失败分开数', () => {
    const text = summarize(
      [
        { id: 'a', label: '@a', ok: true },
        { id: 'b', label: '@b', ok: true },
        { id: 'c', label: '@c', ok: true, skipped: '已经 star 过' },
        { id: 'd', label: '@d', ok: false, error: 'boom' },
      ],
      'star',
    )
    expect(text).toBe('2 个账号已 star，1 个跳过，1 个失败')
  })

  it('全跳过时只说跳过', () => {
    const text = summarize([{ id: 'a', label: '@a', ok: true, skipped: '已有复刻' }], 'fork')
    expect(text).toBe('1 个跳过')
  })

  it('空回执给出人话', () => {
    expect(summarize([], 'unstar')).toBe('没有可执行的账号')
  })

  it('按钮文案随数量变', () => {
    expect(runLabel('star', 3)).toBe('Star 到 3 个账号')
    expect(runLabel('star', 1)).toBe('Star 到该账号')
    expect(runLabel('unstar', 2)).toBe('在 2 个账号取消 Star')
    expect(runLabel('fork', 2)).toBe('复刻到 2 个账号')
    expect(runLabel('fork', 0)).toBe('复刻到该账号')
  })
})
