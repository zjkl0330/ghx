import { useCallback, useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import type { Repo, Workflow, WorkflowRun } from '../lib/types'
import { eventLabel, formatDuration, isActive, runDuration, runState, summarize, workflowState } from '../lib/workflows'
import { Icon } from './icons'

interface Props {
  client: GitHubClient | null
  repo: Repo | null
  /** 外部动作（触发、取消、切换仓库）后加一，用来强制刷新 */
  reloadKey?: number
  onPickRepo: () => void
  onOpenWorkflow: (workflow: Workflow) => void
  onOpenRun: (run: WorkflowRun) => void
}

function relTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const m = Math.floor((Date.now() - t) / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  return `${Math.floor(d / 30)} 个月前`
}

export function PipelinesPage(p: Props) {
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** silent=true 是后台轮询：不转圈，但必须回源，否则拿到的还是缓存里的旧状态 */
  const load = useCallback(
    async (silent = false) => {
      if (!p.client || !p.repo) {
        setWorkflows([])
        setRuns([])
        return
      }
      if (!silent) setLoading(true)
      setError(null)
      try {
        const [wf, rs] = await Promise.all([
          p.client.listWorkflows(p.repo.owner, p.repo.name, silent),
          p.client.listRuns(p.repo.owner, p.repo.name, { perPage: 20, fresh: silent }),
        ])
        setWorkflows(wf.data)
        setRuns(rs.data)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [p.client, p.repo],
  )

  useEffect(() => {
    void load()
  }, [load, p.reloadKey])

  // 有运行中的任务时，静默刷新一次状态，省得用户手动下拉
  useEffect(() => {
    if (!runs.some(isActive)) return
    const timer = window.setInterval(() => void load(true), 12000)
    return () => window.clearInterval(timer)
  }, [runs, load])

  const stats = summarize(runs)

  return (
    <>
      <div className="topbar">
        <div style={{ minWidth: 0 }}>
          <div className="page-title">流水线</div>
          <div className="page-sub ellipsis">
            {p.repo ? p.repo.full_name : '未选择仓库'}
            {p.repo ? ` · ${workflows.length} 个工作流` : ''}
          </div>
        </div>
        <div className="spacer" />
        <button className="icon-btn" onClick={() => void load()} aria-label="刷新">
          <Icon name="refresh" size={17} />
        </button>
        <button className="icon-btn" onClick={p.onPickRepo} aria-label="切换仓库">
          <Icon name="repo" size={17} />
        </button>
      </div>

      <div className="page" style={{ marginTop: 0 }}>
        {!p.repo && (
          <div className="empty">
            <b>先选一个仓库</b>
            GitHub 的流水线是按仓库组织的，选好之后才能看工作流与运行记录。
            <div style={{ marginTop: 14 }}>
              <button className="btn ghost" onClick={p.onPickRepo}>
                <Icon name="repo" size={14} />
                选择仓库
              </button>
            </div>
          </div>
        )}

        {p.repo && loading && workflows.length === 0 && <div className="empty">正在读取工作流…</div>}

        {p.repo && error && (
          <div className="warnbox" style={{ margin: '12px 16px 0' }}>
            <Icon name="warn" size={14} />
            <span>{error}</span>
          </div>
        )}

        {p.repo && !loading && !error && workflows.length === 0 && (
          <div className="empty">
            <b>这个仓库没有工作流</b>
            在 <code className="mono">.github/workflows/</code> 下放一个 YAML 文件，推送后就会出现在这里。
          </div>
        )}

        {p.repo && workflows.length > 0 && (
          <>
            <div className="pipe-stats">
              <div>
                <b>{stats.ok}</b>
                <i>成功</i>
              </div>
              <div>
                <b style={{ color: stats.bad > 0 ? 'var(--red)' : undefined }}>{stats.bad}</b>
                <i>失败</i>
              </div>
              <div>
                <b style={{ color: stats.active > 0 ? 'var(--blue)' : undefined }}>{stats.active}</b>
                <i>进行中</i>
              </div>
            </div>

            <div className="section-title" style={{ margin: '18px 16px 8px' }}>
              工作流
            </div>
            <div className="rows">
              {workflows.map((w) => {
                const st = workflowState(w.state)
                return (
                  <button className="row" key={w.id} onClick={() => p.onOpenWorkflow(w)}>
                    <span className="row-ic">
                      <Icon name="play" size={14} />
                    </span>
                    <span className="row-main">
                      <span className="row-l1">
                        <span className="row-name">{w.name}</span>
                        <span className={`badge${st.tone === 'ok' ? '' : ' archived'}`}>{st.label}</span>
                      </span>
                      <span className="row-desc mono">{w.path}</span>
                    </span>
                    <Icon name="chevron" size={13} className="act-arrow" />
                  </button>
                )
              })}
            </div>

            <div className="section-title" style={{ margin: '18px 16px 8px' }}>
              最近运行
            </div>
            <div className="rows">
              {runs.map((r) => {
                const st = runState(r)
                return (
                  <button className="row run-row" key={r.id} onClick={() => p.onOpenRun(r)}>
                    <span className={`run-dot ${st.tone}`} />
                    <span className="row-main">
                      <span className="row-l1">
                        <span className="run-title">{r.display_title || r.name || '未命名运行'}</span>
                        <span className="run-no">#{r.run_number}</span>
                      </span>
                      <span className="row-meta">
                        <span className={`run-chip ${st.tone}`}>{st.label}</span>
                        <span>
                          <Icon name="branch" size={11} style={{ marginRight: 3, verticalAlign: -1 }} />
                          {r.head_branch ?? '—'}
                        </span>
                        <span>{eventLabel(r.event)}</span>
                        <span>{relTime(r.created_at)}</span>
                        <span>{isActive(r) ? '进行中' : formatDuration(runDuration(r))}</span>
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}
        <div style={{ height: 20 }} />
      </div>
    </>
  )
}
