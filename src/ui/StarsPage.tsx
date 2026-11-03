import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import type { Repo } from '../lib/types'
import { Icon } from './icons'

interface Props {
  client: GitHubClient | null
  login: string | null
  onOpenRepo: (repo: Repo) => void
  onToast: (msg: string) => void
  onUnstarred: (fullName: string) => void
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

export function StarsPage(p: Props) {
  const [repos, setRepos] = useState<Repo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!p.client) {
      setRepos([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const acc: Repo[] = []
      // 最多拉 3 页，够用且不至于一口气吃掉配额
      for (let page = 1; page <= 3; page += 1) {
        const { data } = await p.client.listStarred(page, 50)
        acc.push(...data)
        if (data.length < 50) break
      }
      setRepos(acc)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [p.client])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return repos
    return repos.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q) ||
        (r.language ?? '').toLowerCase().includes(q),
    )
  }, [repos, query])

  async function unstar(repo: Repo) {
    if (!p.client || busy) return
    setBusy(repo.full_name)
    try {
      await p.client.setStarred(repo.owner, repo.name, false)
      setRepos((prev) => prev.filter((r) => r.full_name !== repo.full_name))
      p.onUnstarred(repo.full_name)
      p.onToast(`已取消 star ${repo.name}`)
    } catch (err) {
      p.onToast((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">星标</div>
          <div className="page-sub">
            {p.login ? `@${p.login}` : '未连接账号'} · {repos.length} 个仓库
          </div>
        </div>
        <div className="spacer" />
        <button className="icon-btn" onClick={() => void load()} aria-label="刷新">
          <Icon name="refresh" size={17} />
        </button>
      </div>

      <div className="search">
        <Icon name="search" size={14} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索星标仓库"
          autoCapitalize="off"
          spellCheck={false}
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="清空" style={{ color: 'inherit' }}>
            <Icon name="close" size={13} />
          </button>
        )}
      </div>

      <div className="page" style={{ marginTop: 0 }}>
        {error && (
          <div className="warnbox" style={{ margin: '12px 16px 0' }}>
            <Icon name="warn" size={14} />
            <span>{error}</span>
          </div>
        )}

        {loading && repos.length === 0 && <div className="empty">正在读取星标…</div>}

        {!loading && !error && filtered.length === 0 && (
          <div className="empty">
            <b>{query ? '没有匹配的仓库' : '还没有 star 过仓库'}</b>
            {query ? '换个关键词试试。' : '在仓库详情里点「Star 该仓库」，这里就会出现。'}
          </div>
        )}

        {filtered.length > 0 && (
          <div className="rows">
            {filtered.map((r) => (
              <div className="row star-row" key={r.id}>
                <button className="row-hit" onClick={() => p.onOpenRepo(r)}>
                  <span className="row-l1">
                    <span className="row-owner">{r.owner}/</span>
                    <span className="row-name">{r.name}</span>
                    {r.archived && <span className="badge archived">Archived</span>}
                  </span>
                  {r.description && <span className="row-desc">{r.description}</span>}
                  <span className="row-meta">
                    {r.language && <span>{r.language}</span>}
                    <span>★ {r.stargazers_count}</span>
                    <span>⑂ {r.forks_count}</span>
                    <span>推送于 {relTime(r.pushed_at)}</span>
                  </span>
                </button>
                <button
                  className="icon-btn star-on"
                  aria-label={`取消 star ${r.full_name}`}
                  disabled={busy === r.full_name}
                  onClick={() => void unstar(r)}
                >
                  {busy === r.full_name ? (
                    <span className="spin" style={{ width: 13, height: 13 }} />
                  ) : (
                    <Icon name="star" size={15} style={{ fill: 'currentColor' }} />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ height: 16 }} />
      </div>
    </>
  )
}
