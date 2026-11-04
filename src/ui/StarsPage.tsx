import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import { descText, pickDescItems } from '../lib/desc'
import { groupByLanguage, topLanguages } from '../lib/stars'
import type { Repo } from '../lib/types'
import { Icon } from './icons'
import { useDescTranslation, type DescOptions } from './useDescTranslation'

interface Props {
  client: GitHubClient | null
  login: string | null
  descOpts: DescOptions
  onOpenRepo: (repo: Repo) => void
  onToast: (msg: string) => void
  onUnstarred: (fullName: string) => void
}

type View = 'list' | 'group'

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
  const [view, setView] = useState<View>('list')
  const [lang, setLang] = useState<string | null>(null)

  /** fresh=true 时绕过缓存，手动刷新用；首次进入直接吃缓存，不再转圈 */
  const load = useCallback(
    async (fresh = false) => {
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
          const { data } = await p.client.listStarred(page, 50, fresh)
          acc.push(...data)
          if (data.length < 50) break
        }
        setRepos(acc)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [p.client],
  )

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

  const groups = useMemo(() => groupByLanguage(filtered), [filtered])
  const langs = useMemo(() => topLanguages(filtered), [filtered])
  // 选中的语言被搜索条件筛没了就退回全部，避免停在空白页
  const activeLang = lang && langs.includes(lang) ? lang : null
  const shownGroups = activeLang ? groups.filter((g) => g.language === activeLang) : groups

  // 星标仓库多数是英文项目，简介按当前可见的前 30 条机翻
  const descItems = useMemo(() => pickDescItems(filtered, 30), [filtered])
  const descZh = useDescTranslation(descItems, p.descOpts)

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

  function repoRow(r: Repo) {
    const zh = descText(descZh, r.full_name)
    return (
      <div className="row star-row" key={r.id}>
        <button className="row-hit" onClick={() => p.onOpenRepo(r)}>
          <span className="row-l1">
            <span className="row-owner">{r.owner}/</span>
            <span className="row-name">{r.name}</span>
            {r.archived && <span className="badge archived">Archived</span>}
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
    )
  }

  const empty = !loading && !error && filtered.length === 0

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">星标</div>
          <div className="page-sub">
            {p.login ? `@${p.login}` : '未连接账号'} · {repos.length} 个仓库
            {groups.length > 0 ? ` · ${groups.length} 种语言` : ''}
          </div>
        </div>
        <div className="spacer" />
        <button className="icon-btn" onClick={() => void load(true)} aria-label="刷新">
          <Icon name="refresh" size={17} />
        </button>
      </div>

      <div className="seg" style={{ margin: '10px 16px 8px' }}>
        <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>
          列表
        </button>
        <button className={view === 'group' ? 'on' : ''} onClick={() => setView('group')}>
          按语言
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

      {view === 'group' && langs.length > 0 && (
        <div className="chips">
          <button className={`chip${activeLang === null ? ' on' : ''}`} onClick={() => setLang(null)}>
            全部 {filtered.length}
          </button>
          {langs.map((l) => {
            const g = groups.find((x) => x.language === l)
            return (
              <button
                key={l}
                className={`chip${activeLang === l ? ' on' : ''}`}
                onClick={() => setLang(activeLang === l ? null : l)}
              >
                {l} {g?.count ?? 0}
              </button>
            )
          })}
        </div>
      )}

      <div className="page" style={{ marginTop: 0 }}>
        {error && (
          <div className="warnbox" style={{ margin: '12px 16px 0' }}>
            <Icon name="warn" size={14} />
            <span>{error}</span>
          </div>
        )}

        {loading && repos.length === 0 && <div className="empty">正在读取星标…</div>}

        {empty && (
          <div className="empty">
            <b>{query ? '没有匹配的仓库' : '还没有 star 过仓库'}</b>
            {query ? '换个关键词试试。' : '在仓库详情里点「Star 该仓库」，这里就会出现。'}
          </div>
        )}

        {view === 'list' && filtered.length > 0 && (
          <div className="rows">{filtered.map(repoRow)}</div>
        )}

        {view === 'group' &&
          shownGroups.map((g) => (
            <div className="lang-group" key={g.language}>
              <div className="lang-head">
                <b>{g.language}</b>
                <span>{g.count} 个</span>
                <span className="lang-stars">共 ★ {g.stars}</span>
              </div>
              <div className="rows">{g.repos.map(repoRow)}</div>
            </div>
          ))}
        <div style={{ height: 16 }} />
      </div>
    </>
  )
}
