import { describe, expect, it } from 'vitest'
import {
  canCancel,
  canRerun,
  eventLabel,
  formatDuration,
  isActive,
  runDuration,
  runState,
  shortSha,
  spanMs,
  summarize,
  workflowState,
} from '../workflows'
import type { WorkflowRun } from '../types'

function run(over: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 1,
    name: 'CI',
    head_branch: 'main',
    head_sha: 'a1b2c3d4e5f6',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    run_number: 12,
    workflow_id: 9,
    created_at: '2026-11-01T10:00:00Z',
    run_started_at: '2026-11-01T10:00:05Z',
    updated_at: '2026-11-01T10:01:25Z',
    html_url: 'https://github.com/o/r/actions/runs/1',
    ...over,
  }
}

describe('runState', () => {
  it('把排队态和运行态区分开', () => {
    expect(runState({ status: 'queued', conclusion: null }).label).toBe('排队中')
    expect(runState({ status: 'in_progress', conclusion: null }).tone).toBe('run')
  })

  it('结论决定最终标签与色调', () => {
    expect(runState({ status: 'completed', conclusion: 'success' })).toEqual({ label: '成功', tone: 'ok' })
    expect(runState({ status: 'completed', conclusion: 'failure' })).toEqual({ label: '失败', tone: 'bad' })
    expect(runState({ status: 'completed', conclusion: 'timed_out' }).tone).toBe('bad')
    expect(runState({ status: 'completed', conclusion: 'cancelled' })).toEqual({ label: '已取消', tone: 'idle' })
  })

  it('结论缺失时不显示英文 null', () => {
    expect(runState({ status: 'completed', conclusion: null }).label).toBe('已完成')
  })
})

describe('状态判定', () => {
  it('运行中的任务算活跃', () => {
    expect(isActive(run({ status: 'in_progress' }))).toBe(true)
    expect(isActive(run({ status: 'completed' }))).toBe(false)
  })

  it('只有未结束的运行能取消', () => {
    expect(canCancel(run({ status: 'queued' }))).toBe(true)
    expect(canCancel(run({ status: 'completed', conclusion: 'success' }))).toBe(false)
  })

  it('只有已结束的运行能重跑', () => {
    expect(canRerun(run({ status: 'completed' }))).toBe(true)
    expect(canRerun(run({ status: 'in_progress' }))).toBe(false)
  })

  it('工作流停用原因分别给出说明', () => {
    expect(workflowState('active')).toEqual({ label: '启用', tone: 'ok' })
    expect(workflowState('disabled_manually').label).toBe('已停用')
    expect(workflowState('disabled_inactivity').label).toContain('无活动')
  })
})

describe('耗时计算', () => {
  it('优先用 run_started_at，不把排队时间算进去', () => {
    const r = run({
      created_at: '2026-11-01T09:00:00Z',
      run_started_at: '2026-11-01T10:00:00Z',
      updated_at: '2026-11-01T10:01:00Z',
    })
    expect(runDuration(r)).toBe(60_000)
  })

  it('缺 run_started_at 时退回 created_at', () => {
    const r = run({ created_at: '2026-11-01T10:00:00Z', run_started_at: null, updated_at: '2026-11-01T10:00:30Z' })
    expect(runDuration(r)).toBe(30_000)
  })

  it('时间非法或缺失返回 null', () => {
    expect(spanMs(null, '2026-11-01T10:00:00Z')).toBeNull()
    expect(spanMs('oops', '2026-11-01T10:00:00Z')).toBeNull()
    expect(runDuration(run({ updated_at: '' }))).toBeNull()
  })

  it('时长格式按量级切换单位', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(83_000)).toBe('1m 23s')
    expect(formatDuration(120_000)).toBe('2m')
    expect(formatDuration(3_930_000)).toBe('1h 05m')
  })
})

describe('summarize', () => {
  it('按结论分类统计，活跃的单独计数', () => {
    const s = summarize([
      run({ id: 1, conclusion: 'success' }),
      run({ id: 2, conclusion: 'failure' }),
      run({ id: 3, conclusion: 'timed_out' }),
      run({ id: 4, status: 'in_progress', conclusion: null }),
      run({ id: 5, conclusion: 'cancelled' }),
    ])
    expect(s).toEqual({ total: 5, ok: 1, bad: 2, active: 1 })
  })
})

describe('展示细节', () => {
  it('sha 截短到 7 位', () => {
    expect(shortSha('a1b2c3d4e5f6')).toBe('a1b2c3d')
    expect(shortSha(null)).toBe('—')
  })

  it('事件名有中文别名，未知事件原样返回', () => {
    expect(eventLabel('workflow_dispatch')).toBe('手动')
    expect(eventLabel('schedule')).toBe('定时')
    expect(eventLabel('deployment')).toBe('deployment')
    expect(eventLabel(null)).toBe('未知')
  })
})
