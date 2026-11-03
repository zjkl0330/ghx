import type { RunConclusion, RunStatus, Workflow, WorkflowRun, WorkflowState } from './types'

/** 运行中/排队中的状态集合，用于决定要不要轮询、能不能取消。 */
const ACTIVE: RunStatus[] = ['queued', 'in_progress', 'requested', 'waiting', 'pending']

export type RunTone = 'ok' | 'bad' | 'run' | 'idle'

export interface RunState {
  label: string
  tone: RunTone
}

/** 把 status + conclusion 两段状态压成一个可读标签，避免界面上出现裸英文。 */
export function runState(run: Pick<WorkflowRun, 'status' | 'conclusion'>): RunState {
  if (run.status === 'queued' || run.status === 'requested') return { label: '排队中', tone: 'run' }
  if (run.status === 'waiting' || run.status === 'pending') return { label: '等待中', tone: 'run' }
  if (run.status === 'in_progress') return { label: '运行中', tone: 'run' }

  const conclusion = run.conclusion as RunConclusion
  switch (conclusion) {
    case 'success':
      return { label: '成功', tone: 'ok' }
    case 'failure':
      return { label: '失败', tone: 'bad' }
    case 'timed_out':
      return { label: '超时', tone: 'bad' }
    case 'cancelled':
      return { label: '已取消', tone: 'idle' }
    case 'skipped':
      return { label: '已跳过', tone: 'idle' }
    case 'action_required':
      return { label: '待处理', tone: 'idle' }
    case 'neutral':
      return { label: '中性', tone: 'idle' }
    case 'stale':
      return { label: '已过时', tone: 'idle' }
    default:
      return run.status === 'completed' ? { label: '已完成', tone: 'idle' } : { label: '未知', tone: 'idle' }
  }
}

export function isActive(run: Pick<WorkflowRun, 'status'>): boolean {
  return ACTIVE.includes(run.status)
}

/** 只有排队中和运行中可以取消，已完成再点会 409。 */
export function canCancel(run: Pick<WorkflowRun, 'status'>): boolean {
  return run.status === 'queued' || run.status === 'in_progress' || run.status === 'waiting'
}

/** 已结束的运行才能重跑。 */
export function canRerun(run: Pick<WorkflowRun, 'status'>): boolean {
  return run.status === 'completed'
}

export function workflowState(state: WorkflowState): { label: string; tone: RunTone } {
  switch (state) {
    case 'active':
      return { label: '启用', tone: 'ok' }
    case 'disabled_manually':
      return { label: '已停用', tone: 'idle' }
    case 'disabled_inactivity':
      return { label: '长期无活动已停用', tone: 'idle' }
    default:
      return { label: '未知', tone: 'idle' }
  }
}

export function isEnabled(w: Pick<Workflow, 'state'>): boolean {
  return w.state === 'active'
}

/** 两个时间点之间的毫秒差；任一缺失或非法返回 null。 */
export function spanMs(start: string | null | undefined, end: string | null | undefined): number | null {
  if (!start || !end) return null
  const a = Date.parse(start)
  const b = Date.parse(end)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.max(0, b - a)
}

/**
 * 运行耗时。GitHub 的 updated_at 在排队期间会一直变，所以优先用 run_started_at，
 * 只有它缺失时才退回 created_at，避免把排队时间算进运行时长。
 */
export function runDuration(run: Pick<WorkflowRun, 'created_at' | 'run_started_at' | 'updated_at'>): number | null {
  return spanMs(run.run_started_at ?? run.created_at, run.updated_at)
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`
  const h = Math.floor(m / 60)
  return `${h}h ${String(m % 60).padStart(2, '0')}m`
}

export function summarize(runs: WorkflowRun[]): { total: number; ok: number; bad: number; active: number } {
  let ok = 0
  let bad = 0
  let active = 0
  for (const r of runs) {
    if (isActive(r)) active += 1
    else if (r.conclusion === 'success') ok += 1
    else if (r.conclusion === 'failure' || r.conclusion === 'timed_out') bad += 1
  }
  return { total: runs.length, ok, bad, active }
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : '—'
}

/** 运行事件的中文名，用于「由 push 触发」这类说明。 */
const EVENT_LABEL: Record<string, string> = {
  push: 'push',
  pull_request: 'PR',
  workflow_dispatch: '手动',
  schedule: '定时',
  release: 'release',
  issue_comment: '评论',
  repository_dispatch: '外部事件',
}

export function eventLabel(event: string | null | undefined): string {
  if (!event) return '未知'
  return EVENT_LABEL[event] ?? event
}
