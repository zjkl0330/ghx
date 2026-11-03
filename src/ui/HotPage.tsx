import { useCallback, useEffect, useRef, useState } from 'react'
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
import {
  SEARCH_SORTS,
  emptySearchHint,
  hasKeyword,
  repoSearchQuery,
  type SearchSort,
} from '../lib/search'
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

/**
 * 热门 / 仓库搜索。
 *
 * 空关键词时走 trending 查询（最近创建 + 日均涨星排序）；
 * 输入关键词后切到 GitHub 全区搜索，可按相关度 / 星数 / 更新时间排序。
 * 两者共用一条列表，避免再开一个页面。
 */
export function HotPage(p: Props) {
  const [range, setRange] = useState<TrendingRange>('week')
  const [lang, setLang] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SearchSort>('best')
  const [repos, setRepos] = useState<Repo[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 搜索结果不返回「我是否 star 过」，这里只记本次会话里的手动操作 */
  const [starred, setStarred] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  /** 连打关键词时只认最后一次请求的结果，避免旧响应把新结果盖掉 */
  const seq = useRef(0)

  const searchMode = hasKeyword(query)

  const load = useCallback(
    async (fresh = false) => {
      if (!p.client) {
        setRepos([])
        setTotal(0)
        return
      }
      const mine = seq.current + 1
      seq.current = mine
      setLoading(true)
      setError(null)
      try {
        if (!searchMode) {
          const { data } = await p.client.searchRepos(trendingQuery(range, lang), {
            perPage: 30,
            fresh,
          })
          if (seq.current !== mine) return
          const ranked = rankHot(data)
          setRepos(ranked)
          setTotal(ranked.length)
        } else {
          const q = repoSearchQuery(query, { language: lang })
          const { data, total: count } = await p.client.searchRepos(q, {
            sort,
            perPage: 30,
            fresh,
          })
          if (seq.current !== mine) return
          setRepos(data)
          setTotal(count)
        }
      } catch (err) {
        if (seq.current !== mine) return
        setError((err as Error).message)
      } finally {
        if (seq.current === mine) setLoading(false)
      }
    },
    [p.client, range, lang, query, sort, searchMode],
  )

  // 搜索框边打边搜，别的条件变化立即重查
  useEffect(() => {
    const delay = searchMode ? 400 : 0
    const timer = window.setTimeout(() => void load(), delay)
    return () => window.clearTimeout(timer)
  }, [load, searchMode])

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
          <div className="page-title">{searchMode ? '搜索' : '热门'}</div>
          <div className="page-sub ellipsis">
            {searchMode
              ? loading
                ? '正在搜索…'
                : `找到 ${total} 个仓库${total > 30 ? ' · 显示前 30 个' : ''}`
              : '最近创建 · 按日均涨星排序'}
          </div>
        </div>
        <div className="spacer" />
        <button className="icon-btn" onClick={() => void load(true)} aria-label="刷新">
          <Icon name="refresh" size={17} />
        </button>
      </div>

      <div className="search">
        <Icon name="search" size={14} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索 GitHub 仓库，支持 topic: / user: 等限定符"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="清空" style={{ color: 'inherit' }}>
            <Icon name="close" size={13} />
          </button>
        )}
      </div>

      {searchMode ? (
        <div className="seg" style={{ margin: '10px 16px 0' }}>
          {SEARCH_SORTS.map((s) => (
            <button key={s.key} className={sort === s.key ? 'on' : ''} onClick={() => setSort(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="seg" style={{ margin: '10px 16px 0' }}>
          {TRENDING_RANGES.map((r) => (
            <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      )}

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

        {loading && repos.length === 0 && (
          <div className="empty">{searchMode ? '正在搜索…' : '正在找最近的热门…'}</div>
        )}

        {!loading && !error && repos.length === 0 && (
          <div className="empty">
            <b>{searchMode ? '没有找到仓库' : '这个范围内没有结果'}</b>
            {searchMode
              ? emptySearchHint(query, lang)
              : '换个时间范围或语言试试。筛选条件是最近创建且 star 不少于 10。'}
          </div>
        )}

        {repos.length > 0 && (
          <div className="rows">
            {repos.map((r, i) => {
              const on = starred.has(r.full_name)
              const perDay = Math.round(dailyStars(r))
              return (
                <div className="row hot-row" key={r.id}>
                  {searchMode ? (
                    <span className="row-ic">
                      <Icon name="repo" size={15} />
                    </span>
                  ) : (
                    <span className={`hot-rank${i < 3 ? ' top' : ''}`}>{i + 1}</span>
                  )}
                  <button className="row-hit" onClick={() => p.onOpenRepo(r)}>
                    <span className="row-l1">
                      <span className="row-owner">{r.owner}/</span>
                      <span className="row-name">{r.name}</span>
                    </span>
                    {r.description && <span className="row-desc">{r.description}</span>}
                    <span className="row-meta">
                      {r.language && <span>{r.language}</span>}
                      <span>★ {r.stargazers_count}</span>
                      {searchMode ? (
                        <span>{relTime(r.pushed_at)}更新</span>
                      ) : (
                        <>
                          <span className="hot-rate">+{perDay}/天</span>
                          {r.created_at && <span>{relTime(r.created_at)}创建</span>}
                        </>
                      )}
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
