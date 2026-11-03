import { useCallback, useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import { findMyFork, forkHint, sortForks } from '../lib/forks'
import type { Fork, Repo } from '../lib/types'
import { Icon } from './icons'

interface Props {
  repo: Repo
  client: GitHubClient | null
  login: string | null
  onClose: () => void
  onToast: (msg: string) => void
  onAudit: (detail: string) => void
  onOpenRepo: (repo: Repo) => void
}

function relTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const d = Math.floor((Date.now() - t) / 86400000)
  if (d < 1) return '今天'
  if (d < 30) return `${d} 天前`
  if (d < 365) return `${Math.floor(d / 30)} 个月前`
  return `${Math.floor(d / 365)} 年前`
}

export function ForksSheet(p: Props) {
  const [forks, setForks] = useState<Fork[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (fresh = false) => {
    if (!p.client) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await p.client.listForks(p.repo.owner, p.repo.name, 1, 30, fresh)
      setForks(sortForks(data))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [p.client, p.repo.owner, p.repo.name])

  useEffect(() => {
    void load()
  }, [load])

  const mine = findMyFork(forks, p.login)

  async function fork() {
    if (!p.client || busy) return
    setBusy(true)
    setError(null)
    try {
      const { data } = await p.client.createFork(p.repo.owner, p.repo.name)
      if (data) setForks((prev) => sortForks([data, ...prev.filter((f) => f.full_name !== data.full_name)]))
      p.onAudit(`复刻 ${p.repo.full_name}`)
      p.onToast('已提交复刻，稍后出现在你的仓库里')
      // 复刻是后台队列任务，几秒后再取一次列表
      window.setTimeout(() => void load(true), 3000)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3>复刻</h3>
            <div className="sheet-sub">
              {p.repo.full_name} · {forks.length} 份
            </div>
          </div>
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭" style={{ marginTop: -4 }}>
            <Icon name="close" size={16} />
          </button>
        </div>

        {error && (
          <div className="errline" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}

        <div className="forkbox">
          <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.55 }}>
            {forkHint(forks, p.login)}
          </div>
          {mine ? (
            <button
              className="btn blue block"
              style={{ marginTop: 9 }}
              onClick={() => p.onOpenRepo(mine)}
            >
              <Icon name="fork" size={14} />
              打开我的复刻
            </button>
          ) : (
            <button className="btn blue block" style={{ marginTop: 9 }} disabled={busy} onClick={() => void fork()}>
              <Icon name="fork" size={14} />
              {busy ? '提交中…' : '复刻到我的账号'}
            </button>
          )}
          <div className="hint" style={{ marginTop: 7 }}>
            复刻是 GitHub 的异步任务，返回 202 之后要等几秒才出现在你的仓库列表里。
          </div>
        </div>

        <div className="list-head" style={{ padding: '16px 0 4px' }}>
          <b>全部复刻</b>
          <button onClick={() => void load(true)}>刷新</button>
        </div>

        {loading && forks.length === 0 && <div className="hint">正在读取…</div>}
        {!loading && forks.length === 0 && !error && (
          <div className="hint" style={{ padding: '8px 0' }}>还没有人复刻这个仓库。</div>
        )}

        <div className="mini-list">
          {forks.map((f) => (
            <button className="fork-row" key={f.id} onClick={() => p.onOpenRepo(f)}>
              <span className="fork-ic">
                <Icon name="fork" size={14} />
              </span>
              <span className="mini-main">
                <span className="mini-title ellipsis">
                  {f.owner}
                  <span style={{ color: 'var(--text-dim)' }}>/{f.name}</span>
                  {p.login && f.owner.toLowerCase() === p.login.toLowerCase() && (
                    <span className="badge" style={{ marginLeft: 6 }}>你</span>
                  )}
                </span>
                <span className="mini-sub">
                  ★ {f.stargazers_count} · 复刻于 {relTime(f.created_at)}
                </span>
              </span>
              <Icon name="chevron" size={12} className="act-arrow" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
