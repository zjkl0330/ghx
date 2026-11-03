import { useCallback, useEffect, useState } from 'react'
import { githubUrlAt } from '../lib/mirrors'
import type { GitHubClient } from '../lib/api'
import type { Repo, Workflow, WorkflowRun, WorkflowState } from '../lib/types'
import { openExternal } from '../lib/update'
import {
  eventLabel,
  formatDuration,
  isActive,
  runDuration,
  runState,
  workflowState,
} from '../lib/workflows'
import { Icon } from './icons'

interface Props {
  repo: Repo
  workflow: Workflow
  client: GitHubClient | null
  mirror: string
  onClose: () => void
  onChanged: (workflow: Workflow) => void
  onOpenRun: (run: WorkflowRun) => void
  onToast: (msg: string) => void
  onAudit: (detail: string) => void
}

function relTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const m = Math.floor((Date.now() - t) / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

export function WorkflowSheet(p: Props) {
  const [state, setState] = useState<WorkflowState>(p.workflow.state)
  const [ref, setRef] = useState(p.repo.default_branch)
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadRuns = useCallback(async () => {
    if (!p.client) return
    setLoadingRuns(true)
    try {
      const { data } = await p.client.listRuns(p.repo.owner, p.repo.name, {
        workflowId: p.workflow.id,
        perPage: 5,
      })
      setRuns(data)
    } catch {
      /* 运行列表失败不影响上面的开关与触发 */
    } finally {
      setLoadingRuns(false)
    }
  }, [p.client, p.repo.owner, p.repo.name, p.workflow.id])

  useEffect(() => {
    void loadRuns()
  }, [loadRuns])

  async function run(key: string, fn: () => Promise<void>) {
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

  const enabled = state === 'active'
  const st = workflowState(state)

  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3>{p.workflow.name}</h3>
            <div className="sheet-sub mono ellipsis">
              {p.repo.full_name} · {p.workflow.path}
            </div>
          </div>
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭" style={{ marginTop: -4 }}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 10 }}>
          <span className={`run-chip ${st.tone}`}>{st.label}</span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {enabled ? '推送与手动触发都会执行' : '停用后不会响应任何触发，文件本身不动'}
          </span>
        </div>

        {error && (
          <div className="errline" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}

        <div className="wf-actions">
          <button
            className="btn ghost block"
            disabled={!!busy}
            onClick={() =>
              void run('toggle', async () => {
                if (!p.client) throw new Error('未连接令牌')
                await p.client.setWorkflowEnabled(p.repo.owner, p.repo.name, p.workflow.id, !enabled)
                const next: WorkflowState = enabled ? 'disabled_manually' : 'active'
                setState(next)
                p.onChanged({ ...p.workflow, state: next })
                p.onAudit(enabled ? '已停用工作流' : '已启用工作流')
                p.onToast(enabled ? '工作流已停用' : '工作流已启用')
              })
            }
          >
            <Icon name={enabled ? 'stop' : 'play'} size={14} />
            {busy === 'toggle' ? '处理中…' : enabled ? '停用工作流' : '启用工作流'}
          </button>
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="wf-ref">手动运行的分支 / 标签</label>
          <input
            id="wf-ref"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder={p.repo.default_branch}
            autoCapitalize="off"
            spellCheck={false}
            autoCorrect="off"
          />
          <div className="hint">
            只有声明了 <code className="mono">workflow_dispatch</code> 的工作流才能手动运行；否则会返回 422。
          </div>
        </div>

        <button
          className="btn blue block"
          style={{ marginTop: 10 }}
          disabled={!!busy || !enabled || !ref.trim()}
          onClick={() =>
            void run('dispatch', async () => {
              if (!p.client) throw new Error('未连接令牌')
              await p.client.dispatchWorkflow(p.repo.owner, p.repo.name, p.workflow.id, ref.trim())
              p.onAudit(`手动触发 · ${ref.trim()}`)
              p.onToast('已提交触发，运行稍后出现在列表')
              // GitHub 是异步排队，等两秒再取一次比较容易看到新记录
              window.setTimeout(() => void loadRuns(), 2200)
            })
          }
        >
          <Icon name="play" size={14} />
          {busy === 'dispatch' ? '提交中…' : '运行工作流'}
        </button>
        {!enabled && (
          <div className="hint" style={{ marginTop: 8 }}>
            已停用的工作流不能手动触发，先启用。
          </div>
        )}

        <div className="list-head" style={{ padding: '16px 0 4px' }}>
          <b>最近运行</b>
          <button onClick={() => void loadRuns()}>刷新</button>
        </div>

        <div className="mini-list">
          {loadingRuns && runs.length === 0 && <div className="hint">正在读取…</div>}
          {!loadingRuns && runs.length === 0 && <div className="hint">还没有运行记录。</div>}
          {runs.map((r) => {
            const rs = runState(r)
            return (
              <button className="mini-run" key={r.id} onClick={() => p.onOpenRun(r)}>
                <span className={`run-dot ${rs.tone}`} />
                <span className="mini-main">
                  <span className="mini-title ellipsis">
                    #{r.run_number} · {r.display_title || eventLabel(r.event)}
                  </span>
                  <span className="mini-sub">
                    {r.head_branch ?? '—'} · {relTime(r.created_at)} ·{' '}
                    {isActive(r) ? '进行中' : formatDuration(runDuration(r))}
                  </span>
                </span>
                <span className={`run-chip ${rs.tone}`}>{rs.label}</span>
              </button>
            )
          })}
        </div>

        <button
          className="btn ghost block"
          style={{ marginTop: 12 }}
          onClick={() =>
            void openExternal(githubUrlAt(p.mirror, `${p.repo.full_name}/actions/workflows/${p.workflow.path.split('/').pop()}`))
          }
        >
          <Icon name="terminal" size={14} />
          在网页查看完整日志
        </button>
      </div>
    </div>
  )
}
