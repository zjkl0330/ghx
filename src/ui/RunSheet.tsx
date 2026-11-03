import { useCallback, useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import type { Repo, WorkflowJob, WorkflowRun } from '../lib/types'
import { openExternal } from '../lib/update'
import {
  canCancel,
  canRerun,
  eventLabel,
  formatDuration,
  runDuration,
  runState,
  shortSha,
  spanMs,
} from '../lib/workflows'
import { Icon } from './icons'

interface Props {
  repo: Repo
  run: WorkflowRun
  client: GitHubClient | null
  mirror: string
  onClose: () => void
  onToast: (msg: string) => void
  onChanged?: () => void
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function RunSheet(p: Props) {
  const [jobs, setJobs] = useState<WorkflowJob[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /** 默认只展开失败的作业，其余折叠，避免 20+ 个步骤把弹层撑得很长 */
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const load = useCallback(async () => {
    if (!p.client) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await p.client.listJobs(p.repo.owner, p.repo.name, p.run.id)
      setJobs(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [p.client, p.repo.owner, p.repo.name, p.run.id])

  useEffect(() => {
    void load()
  }, [load])

  async function action(key: string, fn: () => Promise<void>) {
    if (busy) return
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const rs = runState(p.run)
  const total = runDuration(p.run)

  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 className="ellipsis">{p.run.display_title || p.run.name || `运行 #${p.run.run_number}`}</h3>
            <div className="sheet-sub">
              {p.repo.full_name} · #{p.run.run_number} · {shortSha(p.run.head_sha)}
            </div>
          </div>
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭" style={{ marginTop: -4 }}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="run-head">
          <span className={`run-chip big ${rs.tone}`}>{rs.label}</span>
          <span className="run-head-meta">
            <Icon name="branch" size={12} /> {p.run.head_branch ?? '—'}
          </span>
          <span className="run-head-meta">{eventLabel(p.run.event)}</span>
          <span className="run-head-meta">{formatDuration(total)}</span>
        </div>

        <div className="panel" style={{ marginTop: 10 }}>
          <div className="kv-row">
            <span>开始</span>
            <b className="mono">{fmtTime(p.run.run_started_at ?? p.run.created_at)}</b>
          </div>
          <div className="kv-row">
            <span>更新</span>
            <b className="mono">{fmtTime(p.run.updated_at)}</b>
          </div>
          <div className="kv-row">
            <span>触发者</span>
            <b>{p.run.actor?.login ? `@${p.run.actor.login}` : '—'}</b>
          </div>
          <div className="kv-row">
            <span>工作流</span>
            <b className="ellipsis" style={{ maxWidth: '60%' }}>
              {p.run.name ?? '—'}
            </b>
          </div>
        </div>

        {error && (
          <div className="errline" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}

        <div className="list-head" style={{ padding: '16px 0 4px' }}>
          <b>作业 {jobs.length > 0 ? `· ${jobs.length}` : ''}</b>
          <button onClick={() => void load()}>刷新</button>
        </div>

        <div className="mini-list">
          {loading && jobs.length === 0 && <div className="hint">正在读取作业…</div>}
          {!loading && jobs.length === 0 && !error && (
            <div className="hint">还没有作业记录。运行刚开始时这里会是空的，等几秒刷新。</div>
          )}
          {jobs.map((j) => {
            const js = runState(j)
            const steps = j.steps ?? []
            const open = expanded.has(j.id) || js.tone === 'bad'
            const shown = open ? steps : steps.slice(0, 4)
            const hidden = steps.length - shown.length
            return (
              <div className="job" key={j.id}>
                <div className="job-head">
                  <span className={`run-dot ${js.tone}`} />
                  <span className="mini-title ellipsis">{j.name}</span>
                  <span className="job-time">{formatDuration(spanMs(j.started_at, j.completed_at))}</span>
                  <span className={`run-chip ${js.tone}`}>{js.label}</span>
                </div>
                {steps.length > 0 && (
                  <div className="steps">
                    {shown.map((s) => {
                      const ss = runState({ status: s.status, conclusion: s.conclusion })
                      return (
                        <div className="step" key={s.number}>
                          <span className={`step-dot ${ss.tone}`} />
                          <span className="step-name ellipsis">{s.name}</span>
                          {ss.tone === 'bad' && <span className="step-bad">失败</span>}
                        </div>
                      )
                    })}
                    {hidden > 0 && (
                      <button
                        className="step-more"
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev)
                            next.add(j.id)
                            return next
                          })
                        }
                      >
                        展开其余 {hidden} 个步骤
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {canCancel(p.run) && (
            <button
              className="btn danger"
              style={{ flex: 1 }}
              disabled={!!busy}
              onClick={() =>
                void action('cancel', async () => {
                  if (!p.client) throw new Error('未连接令牌')
                  await p.client.cancelRun(p.repo.owner, p.repo.name, p.run.id)
                  p.onToast('已请求取消，状态稍后更新')
                  p.onChanged?.()
                  window.setTimeout(() => void load(), 1500)
                })
              }
            >
              <Icon name="stop" size={14} />
              {busy === 'cancel' ? '取消中…' : '取消运行'}
            </button>
          )}
          {canRerun(p.run) && (
            <button
              className="btn ghost"
              style={{ flex: 1 }}
              disabled={!!busy}
              onClick={() =>
                void action('rerun', async () => {
                  if (!p.client) throw new Error('未连接令牌')
                  await p.client.rerunRun(p.repo.owner, p.repo.name, p.run.id)
                  p.onToast('已重新排队')
                  p.onChanged?.()
                })
              }
            >
              <Icon name="refresh" size={14} />
              {busy === 'rerun' ? '提交中…' : '重新运行'}
            </button>
          )}
          <button
            className="btn ghost"
            style={{ flex: 1 }}
            onClick={() =>
              void openExternal(`${p.mirror.replace(/\/+$/, '')}/${p.repo.full_name}/actions/runs/${p.run.id}`)
            }
          >
            <Icon name="terminal" size={14} />
            看日志
          </button>
        </div>
      </div>
    </div>
  )
}
