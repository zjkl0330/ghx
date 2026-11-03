import { useCallback, useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import {
  COMMON_LANGUAGES,
  RANGE_LABEL,
  TRENDING_RANGES,
  dailyStars,
  rankHot,
  trendingQuery,
  type TrendingRange,
} from '../lib/trending'
import type { Repo } from '../lib/types'
import { Icon } from './icons'

interface Props {
  client: GitHubClient | null
  onOpenRepo: (repo: Repo) => void
  onToast: (msg: string) => void
}

function relTime(iso: string | undefined): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const days = Math.floor((Date.now() - t) / 86_400_000)
  if (days < 1) return '今天'
  if (days < 30) return `${days} 天前`
  if (days < 365) return `${Math.floor(days / 30)} 个月前`
  return `${Math.floor(days / 365)} 年前`
}

export function HotPage(p: Props) {
  const [range, setRange] = useState<TrendingRange>('week')
  const [lang, setLang] = useState<string | null>(null)
  const [repos, setRepos] = useState<Repo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 搜索结果不返回「我是否 star 过」，这里只记本次会话里的手动操作 */
  const [starred, setStarred] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(
    async (fresh = false) => {
      if (!p.client) {
        setRepos([])
        return
      }
      setLoading(true)
      setError(null)
      try {
        const { data } = await p.client.searchRepos(trendingQuery(range, lang), {
          perPage: 30,
          fresh,
        })
        setRepos(rankHot(data))
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [p.client, range, lang],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function toggleStar(repo: Repo) {
    if (!p.client || busy) return
    const next = !starred.has(repo.full_name)
    setBusy(repo.full_name)
    try {
      await p.client.setStarred(repo.owner, repo.name, next)
      setStarred((prev) => {
        const s = new Set(prev)
        if (next) s.add(repo.full_name)
        else s.delete(repo.full_name)
        return s
      })
      p.onToast(next ? `已 star ${repo.name}` : `已取消 star ${repo.name}`)
    } catch (err) {
      p.onToast((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="topbar">
        <div style={{ minWidth: 0 }}>
          <div className="page-title">热门</div>
          <div className="page-sub ellipsis">最近创建 · 按日均涨星排序</div>
        </div>
        <div className="spacer" />
        <button className="icon-btn" onClick={() => void load(true)} aria-label="刷新">
          <Icon name="refresh" size={17} />
        </button>
      </div>

      <div className="seg" style={{ margin: '10px 16px 0' }}>
        {TRENDING_RANGES.map((r) => (
          <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
            {RANGE_LABEL[r]}
          </button>
        ))}
      </div>

      <div className="chips" style={{ paddingTop: 8 }}>
        <button className={`chip${lang === null ? ' on' : ''}`} onClick={() => setLang(null)}>
          全部语言
        </button>
        {COMMON_LANGUAGES.map((l) => (
          <button
            key={l}
            className={`chip${lang === l ? ' on' : ''}`}
            onClick={() => setLang(lang === l ? null : l)}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="page" style={{ marginTop: 0 }}>
        {error && (
          <div className="warnbox" style={{ margin: '12px 16px 0' }}>
            <Icon name="warn" size={14} />
            <span>{error}</span>
          </div>
        )}

        {loading && repos.length === 0 && <div className="empty">正在找最近的热门…</div>}

        {!loading && !error && repos.length === 0 && (
          <div className="empty">
            <b>这个范围内没有结果</b>
            换个时间范围或语言试试。筛选条件是最近创建且 star 不少于 10。
          </div>
        )}

        {repos.length > 0 && (
          <div className="rows">
            {repos.map((r, i) => {
              const on = starred.has(r.full_name)
              const perDay = Math.round(dailyStars(r))
              return (
                <div className="row hot-row" key={r.id}>
                  <span className={`hot-rank${i < 3 ? ' top' : ''}`}>{i + 1}</span>
                  <button className="row-hit" onClick={() => p.onOpenRepo(r)}>
                    <span className="row-l1">
                      <span className="row-owner">{r.owner}/</span>
                      <span className="row-name">{r.name}</span>
                    </span>
                    {r.description && <span className="row-desc">{r.description}</span>}
                    <span className="row-meta">
                      {r.language && <span>{r.language}</span>}
                      <span>★ {r.stargazers_count}</span>
                      <span className="hot-rate">+{perDay}/天</span>
                      {r.created_at && <span>{relTime(r.created_at)}创建</span>}
                    </span>
                  </button>
                  <button
                    className="icon-btn star-on"
                    aria-label={`${on ? '取消 star' : 'star'} ${r.full_name}`}
                    disabled={busy === r.full_name}
                    style={on ? undefined : { color: 'var(--text-dim)' }}
                    onClick={() => void toggleStar(r)}
                  >
                    {busy === r.full_name ? (
                      <span className="spin" style={{ width: 13, height: 13 }} />
                    ) : (
                      <Icon name="star" size={15} style={on ? { fill: 'currentColor' } : undefined} />
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <div style={{ height: 16 }} />
      </div>
    </>
  )
}
