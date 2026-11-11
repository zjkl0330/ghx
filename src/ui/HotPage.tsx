import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import { descText, pickDescItems } from '../lib/desc'
import {
  HOT_FRESH,
  HOT_PAGE_SIZE,
  loadHotEntry,
  loadHotPref,
  peekHot,
  recallHotPref,
  rememberHotPref,
  saveHotEntry,
  saveHotPref,
  type HotPref,
} from '../lib/hotCache'
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
import { snapshotAge } from '../lib/snapshot'
import type { KV } from '../lib/storage'
import type { Repo } from '../lib/types'
import { Icon } from './icons'
import { useDescTranslation, type DescOptions } from './useDescTranslation'

interface Props {
  client: GitHubClient | null
  kv: KV | null
  tokenId: string | null
  descOpts: DescOptions
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

/** 首屏骨架。有缓存时根本走不到这里，只有第一次点某个组合才看得到 */
function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="rows" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div className="row hot-row" key={i}>
          <span className="skel skel-rank" />
          <div className="skel-main">
            <span className="skel skel-bar" style={{ width: `${34 + ((i * 13) % 38)}%` }} />
            <span className="skel skel-bar sm" style={{ width: `${58 + ((i * 7) % 34)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * 热门 / 仓库搜索。
 *
 * 空关键词时走 trending 查询（最近创建 + 日均涨星排序）；
 * 输入关键词后切到 GitHub 全区搜索，可按相关度 / 星数 / 更新时间排序。
 *
 * 两种模式都先吃缓存：热门按 (range, lang) 存快照，十分钟内连请求都不发；
 * 超过十分钟先把旧的贴上来再静默刷新，切组合时列表原地换掉，不用干等。
 */
export function HotPage(p: Props) {
  const firstPref = useMemo(
    () => (p.tokenId ? recallHotPref(p.tokenId) : null),
    // 只用于首屏初值，之后由「令牌变化」那个 effect 接管
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const firstRange = firstPref?.range ?? 'week'
  const firstLang = firstPref?.lang ?? null
  const firstEntry = peekHot(p.tokenId, firstRange, firstLang)

  const [range, setRange] = useState<TrendingRange>(firstRange)
  const [lang, setLang] = useState<string | null>(firstLang)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SearchSort>('best')
  const [repos, setRepos] = useState<Repo[]>(firstEntry?.repos ?? [])
  const [total, setTotal] = useState(firstEntry?.repos.length ?? 0)
  /** 这份数据是什么时候拿到/确认的，副标题用它显示「3 分钟前更新」 */
  const [at, setAt] = useState<number | null>(firstEntry?.at ?? null)
  /** 首屏还没有内容时的骨架 */
  const [loading, setLoading] = useState(firstEntry === null)
  /** 已经有内容、正在后台换新 */
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 搜索结果不返回「我是否 star 过」，这里只记本次会话里的手动操作 */
  const [starred, setStarred] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  /** 连打关键词时只认最后一次请求的结果，避免旧响应把新结果盖掉 */
  const seq = useRef(0)
  const lastToken = useRef(p.tokenId)

  const searchMode = hasKeyword(query)

  // 热门列表基本都是英文简介，逐行机翻后读起来快很多；只翻当前这一页可见的几十行
  const descItems = useMemo(() => pickDescItems(repos, 30), [repos])
  const descZh = useDescTranslation(descItems, p.descOpts)

  /** 换组合时先把那一份缓存贴上来：点下去就换，不等网络 */
  const applyCached = useCallback(
    (nextRange: TrendingRange, nextLang: string | null) => {
      // 搜索模式下切语言要重新搜，不能把热门榜单贴到搜索结果里闪一下
      if (searchMode) {
        setRepos([])
        setTotal(0)
        setAt(null)
        setError(null)
        setLoading(true)
        return
      }
      const entry = peekHot(p.tokenId, nextRange, nextLang)
      setRepos(entry?.repos ?? [])
      setTotal(entry?.repos.length ?? 0)
      setAt(entry?.at ?? null)
      setError(null)
      setLoading(entry === null)
    },
    [p.tokenId, searchMode],
  )

  const persistPref = useCallback(
    (pref: HotPref) => {
      if (!p.tokenId) return
      rememberHotPref(p.tokenId, pref)
      void saveHotPref(p.kv, p.tokenId, pref)
    },
    [p.kv, p.tokenId],
  )

  const chooseRange = useCallback(
    (next: TrendingRange) => {
      if (next === range) return
      applyCached(next, lang)
      setRange(next)
      persistPref({ range: next, lang })
    },
    [applyCached, lang, persistPref, range],
  )

  const chooseLang = useCallback(
    (next: string | null) => {
      if (next === lang) return
      applyCached(range, next)
      setLang(next)
      persistPref({ range, lang: next })
    },
    [applyCached, lang, persistPref, range],
  )

  /**
   * 冷启动 / 换账号：把设备上存的筛选条件与榜单贴回来。
   * 内存里没有对应快照时才需要读设备存储（换页签回来是同步命中的）。
   */
  useEffect(() => {
    const id = p.tokenId
    const changed = lastToken.current !== id
    lastToken.current = id

    if (!id) {
      setRepos([])
      setTotal(0)
      setAt(null)
      return
    }
    if (changed) {
      setRepos([])
      setTotal(0)
      setAt(null)
    }

    let alive = true
    void (async () => {
      const pref = recallHotPref(id) ?? (await loadHotPref(p.kv, id))
      if (!alive || !pref) return
      const entry = await loadHotEntry(p.kv, id, pref.range, pref.lang)
      if (!alive) return
      setRange(pref.range)
      setLang(pref.lang)
      if (entry) {
        setRepos(entry.repos)
        setTotal(entry.repos.length)
        setAt(entry.at)
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [p.kv, p.tokenId])

  const load = useCallback(
    async (opts: { fresh?: boolean } = {}) => {
      const client = p.client
      if (!client) {
        setRepos([])
        setTotal(0)
        return
      }
      const mine = seq.current + 1
      seq.current = mine
      setError(null)

      const cached = searchMode ? null : peekHot(p.tokenId, range, lang)
      const fresh = opts.fresh === true
      if (cached && !fresh) {
        // 先把本地那份贴上来，列表立刻有内容
        setRepos(cached.repos)
        setTotal(cached.repos.length)
        setAt(cached.at)
        setLoading(false)
        // 足够新就到此为止：热门榜十分钟内不会变出第二副样子，省一次往返与配额
        if (Date.now() - cached.at < HOT_FRESH) {
          setRefreshing(false)
          return
        }
      }

      if (cached && cached.repos.length > 0) setRefreshing(true)
      else setLoading(true)

      try {
        if (!searchMode) {
          const { data } = await client.searchRepos(trendingQuery(range, lang), {
            perPage: HOT_PAGE_SIZE,
            fresh,
          })
          if (seq.current !== mine) return
          const ranked = rankHot(data)
          setRepos(ranked)
          setTotal(ranked.length)
          setAt(Date.now())
          if (p.tokenId) void saveHotEntry(p.kv, p.tokenId, range, lang, ranked)
        } else {
          const q = repoSearchQuery(query, { language: lang })
          const { data, total: count } = await client.searchRepos(q, {
            sort,
            perPage: HOT_PAGE_SIZE,
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
        if (seq.current === mine) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [p.client, p.kv, p.tokenId, range, lang, query, sort, searchMode],
  )

  // 搜索框边打边搜，别的条件变化立即重查
  useEffect(() => {
    const delay = searchMode ? 400 : 0
    const timer = window.setTimeout(() => void load(), delay)
    return () => window.clearTimeout(timer)
  }, [load, searchMode])

  /**
   * 空闲时把另外两个时间段也拉一遍。
   *
   * 用户点「今日」时如果从来没缓存，就得干等一次往返；提前预取，那次点击基本都能命中。
   * 只在热门模式、且当前组合已经出数据之后做，免得跟首屏请求抢配额。
   */
  useEffect(() => {
    const client = p.client
    const tokenId = p.tokenId
    if (!client || !tokenId || searchMode || repos.length === 0) return

    const timer = window.setTimeout(() => {
      for (const r of TRENDING_RANGES) {
        if (r === range) continue
        const known = peekHot(tokenId, r, lang)
        if (known && Date.now() - known.at < HOT_FRESH) continue
        void client
          .searchRepos(trendingQuery(r, lang), { perPage: HOT_PAGE_SIZE })
          .then(({ data }) => saveHotEntry(p.kv, tokenId, r, lang, rankHot(data)))
          .catch(() => {
            /* 预取失败无所谓，点过去时照常请求 */
          })
      }
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [p.client, p.kv, p.tokenId, range, lang, searchMode, repos.length])

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

  const subtitle = searchMode
    ? loading
      ? '正在搜索…'
      : `找到 ${total} 个仓库${total > 30 ? ' · 显示前 30 个' : ''}`
    : refreshing
      ? '正在更新…'
      : at
        ? `${snapshotAge(at)}更新`
        : '最近创建 · 按日均涨星排序'

  return (
    <>
      <div className="topbar">
        <div style={{ minWidth: 0 }}>
          <div className="page-title">{searchMode ? '搜索' : '热门'}</div>
          <div className="page-sub ellipsis">{subtitle}</div>
        </div>
        <div className="spacer" />
        <button className="icon-btn" onClick={() => void load({ fresh: true })} aria-label="刷新">
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
            <button key={r} className={range === r ? 'on' : ''} onClick={() => chooseRange(r)}>
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      )}

      <div className="chips" style={{ paddingTop: 8 }}>
        <button className={`chip${lang === null ? ' on' : ''}`} onClick={() => chooseLang(null)}>
          全部语言
        </button>
        {COMMON_LANGUAGES.map((l) => (
          <button
            key={l}
            className={`chip${lang === l ? ' on' : ''}`}
            onClick={() => chooseLang(lang === l ? null : l)}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="page" style={{ marginTop: 0 }}>
        {refreshing && <div className="refresh-bar" />}

        {error && (
          <div className="warnbox" style={{ margin: '12px 16px 0' }}>
            <Icon name="warn" size={14} />
            <span>{error}</span>
          </div>
        )}

        {loading && repos.length === 0 && <SkeletonRows count={8} />}

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
              const zh = descText(descZh, r.full_name)
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
                    {(zh ?? r.description) && (
                      <span className="row-desc">
                        <span className="desc-text">{zh ?? r.description}</span>
                        {zh && <span className="tr-mark">译</span>}
                      </span>
                    )}
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
