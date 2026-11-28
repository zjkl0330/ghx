import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import { descText, pickDescItems } from '../lib/desc'
import { groupByLanguage, topLanguages } from '../lib/stars'
import {
  assignFolder,
  folderCounts,
  filterByFolder,
  readStarFolders,
  writeStarFolders,
  type FolderSelection,
  type StarFolderStore,
} from '../lib/star-folders'
import type { Repo } from '../lib/types'
import { Icon } from './icons'
import { StarFolderSheet } from './StarFolderSheet'
import { useDescTranslation, type DescOptions } from './useDescTranslation'

interface Props {
  client: GitHubClient | null
  login: string | null
  /** 文件夹按账号分片；没有账号时用 anon，换账号不会串组 */
  accountId?: string | null
  /** 把「页内弹层开着」这件事告诉 App 的返回键，否则返回会带着面板跳页签 */
  registerBack?: (fn: (() => boolean) | null) => void
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
  /** 首屏之后还能不能继续翻。之前写死 3 页，star 多的人第 151 个以后直接看不见 */
  const [nextPage, setNextPage] = useState(4)
  const [allLoaded, setAllLoaded] = useState(false)
  const [moreLoading, setMoreLoading] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  /**
   * 请求序号。换账号时上一个账号的慢响应可能后到，不拦住就会把
   * B 的页面刷成 A 的星标 —— 这是多账号下最典型的串号。
   */
  const seq = useRef(0)

  /**
   * 换账号先清场。
   *
   * 之前只依赖 client 变化触发重新拉取，但列表要等新数据回来才替换：
   * 顶部已经写着 @B，下面还是 @A 的星标仓库，还带着 A 的搜索词。
   * 这里在拉取之前就把它们清掉，宁可空一屏也不要给错数据。
   */
  const lastClient = useRef(p.client)
  useEffect(() => {
    if (lastClient.current === p.client) return
    lastClient.current = p.client
    seq.current += 1
    setRepos([])
    setQuery('')
    setLang(null)
    setNextPage(4)
    setAllLoaded(false)
    setError(null)
    setMoreError(null)
    setMoreLoading(false)
    setBusy(null)
    setView('list')
  }, [p.client])

  /** 星标文件夹：纯本地，按账号分片 */
  const [folders, setFolders] = useState<StarFolderStore>(() => readStarFolders(p.accountId))
  const [folderSel, setFolderSel] = useState<FolderSelection>('all')
  const [folderSheet, setFolderSheet] = useState<
    { kind: 'assign'; repo: Repo } | { kind: 'manage' } | null
  >(null)

  useEffect(() => {
    // 换账号时重新读：A 账号分的组不该出现在 B 账号的侧栏里
    setFolders(readStarFolders(p.accountId))
    setFolderSel('all')
    setFolderSheet(null)
  }, [p.accountId])

  useEffect(() => {
    const reg = p.registerBack
    if (!reg) return
    if (!folderSheet) {
      reg(null)
      return
    }
    reg(() => {
      setFolderSheet(null)
      return true
    })
    return () => reg(null)
  }, [folderSheet, p.registerBack])

  const commitFolders = useCallback(
    (next: StarFolderStore) => {
      setFolders(next)
      writeStarFolders(p.accountId, next)
    },
    [p.accountId],
  )

  /** fresh=true 时绕过缓存，手动刷新用；首次进入直接吃缓存，不再转圈 */
  const load = useCallback(
    async (fresh = false) => {
      const mine = seq.current + 1
      seq.current = mine
      if (!p.client) {
        setRepos([])
        setAllLoaded(true)
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      setMoreError(null)
      try {
        const acc: Repo[] = []
        // 首屏先拉 3 页：够铺满一屏，也不至于一口气吃掉配额。
        // 第三页满 50 条说明后面还有，留给「加载更多」接着拉。
        let lastFull = false
        for (let page = 1; page <= 3; page += 1) {
          const { data } = await p.client.listStarred(page, 50, fresh)
          // 期间切了账号：这份结果属于上一个账号，丢掉
          if (seq.current !== mine) return
          acc.push(...data)
          lastFull = data.length === 50
          if (!lastFull) break
        }
        setRepos(acc)
        setNextPage(4)
        setAllLoaded(!lastFull)
      } catch (err) {
        if (seq.current !== mine) return
        setError((err as Error).message)
      } finally {
        if (seq.current === mine) setLoading(false)
      }
    },
    [p.client],
  )

  const loadMore = useCallback(async () => {
    if (!p.client || moreLoading || allLoaded) return
    const mine = seq.current
    setMoreLoading(true)
    setMoreError(null)
    try {
      const { data } = await p.client.listStarred(nextPage, 50)
      if (seq.current !== mine) return
      setRepos((prev) => [...prev, ...data])
      setNextPage((n) => n + 1)
      if (data.length < 50) setAllLoaded(true)
    } catch (err) {
      // 停在原页，再点一次就是重试
      if (seq.current === mine) setMoreError((err as Error).message)
    } finally {
      if (seq.current === mine) setMoreLoading(false)
    }
  }, [p.client, moreLoading, allLoaded, nextPage])

  useEffect(() => {
    void load()
  }, [load])

  /** 搜索先筛一遍；文件夹计数基于搜索结果，chips 上的数字才和列表对得上 */
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return repos
    return repos.filter(
      (r) =>
        r.full_name.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q) ||
        (r.language ?? '').toLowerCase().includes(q),
    )
  }, [repos, query])

  // 选中的文件夹被删掉或换了账号时退回「全部」，不显示空白页
  const activeFolder: FolderSelection =
    folderSel === 'all' || folderSel === 'none' || folders.folders.some((f) => f.id === folderSel)
      ? folderSel
      : 'all'

  const filtered = useMemo(
    () => filterByFolder(folders, searched, activeFolder),
    [folders, searched, activeFolder],
  )
  const counts = useMemo(() => folderCounts(folders, searched), [folders, searched])

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
      // 取消 star 后把归类一起清掉：留着的话，哪天重新 star 会莫名其妙回到旧文件夹
      if (folders.assign[repo.full_name.toLowerCase()]) {
        commitFolders(assignFolder(folders, repo.full_name, null))
      }
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
    const fid = folders.assign[r.full_name.toLowerCase()]
    const fname = fid ? folders.folders.find((f) => f.id === fid)?.name : null
    return (
      <div className="row star-row" key={r.id}>
        <button className="row-hit" onClick={() => p.onOpenRepo(r)}>
          <span className="row-l1">
            <span className="row-owner">{r.owner}/</span>
            <span className="row-name">{r.name}</span>
            {r.archived && <span className="badge archived">Archived</span>}
          </span>
          {(zh ?? r.description) && (
            <span className={`row-desc${zh ? ' with-mark' : ''}`}>
              <span className="desc-text">{zh ?? r.description}</span>
              {zh && <span className="tr-mark">译</span>}
            </span>
          )}
          <span className="row-meta">
            {fname && (
              <span className="row-folder">
                <Icon name="folder" size={10} />
                {fname}
              </span>
            )}
            {r.language && <span>{r.language}</span>}
            <span>★ {r.stargazers_count}</span>
            <span>⑂ {r.forks_count}</span>
            <span>推送于 {relTime(r.pushed_at)}</span>
          </span>
        </button>
        <button
          className="icon-btn"
          aria-label={`把 ${r.full_name} 归类到文件夹`}
          onClick={() => setFolderSheet({ kind: 'assign', repo: r })}
        >
          <Icon name="folder" size={15} />
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
  const inFolderView = activeFolder !== 'all' && activeFolder !== 'none'

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">星标</div>
          <div className="page-sub">
            {p.login ? `@${p.login}` : '账号未校验'} · {repos.length} 个仓库
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

      <div className="chips folder-row">
        <button
          className={`chip${activeFolder === 'all' ? ' on' : ''}`}
          onClick={() => setFolderSel('all')}
        >
          全部 {counts.all}
        </button>
        {folders.folders.length > 0 && (
          <button
            className={`chip${activeFolder === 'none' ? ' on' : ''}`}
            onClick={() => setFolderSel(activeFolder === 'none' ? 'all' : 'none')}
          >
            未分类 {counts.none}
          </button>
        )}
        {folders.folders.map((f) => (
          <button
            key={f.id}
            className={`chip${activeFolder === f.id ? ' on' : ''}`}
            onClick={() => setFolderSel(activeFolder === f.id ? 'all' : f.id)}
          >
            {f.name} {counts.byId[f.id] ?? 0}
          </button>
        ))}
        <button
          className="chip folder-add"
          onClick={() => setFolderSheet({ kind: 'manage' })}
          aria-label="管理文件夹"
        >
          <Icon name="folder" size={12} />
          {folders.folders.length > 0 ? '管理' : '新建'}
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
            <b>
              {query
                ? '没有匹配的仓库'
                : inFolderView
                  ? '这个文件夹还是空的'
                  : activeFolder === 'none'
                    ? '所有仓库都归好类了'
                    : '还没有 star 过仓库'}
            </b>
            {query
              ? '换个关键词试试。'
              : inFolderView
                ? '在列表里点每行右侧的文件夹图标，就能把它放进来。'
                : activeFolder === 'none'
                  ? '去上面的文件夹里看看。'
                  : '在仓库详情里点「Star 该仓库」，这里就会出现。'}
          </div>
        )}

        {view === 'list' && filtered.length > 0 && (
          <div className="rows">{filtered.map(repoRow)}</div>
        )}

        {/* 出错时列表是空的，这时再挂一个「加载更多（已有 0 个）」只会让人以为是分页问题 */}
        {view === 'list' && !error && filtered.length > 0 && !allLoaded && (
          <button
            className="btn ghost block"
            style={{ marginTop: 10 }}
            onClick={() => void loadMore()}
            disabled={moreLoading}
          >
            {moreLoading ? '加载中…' : moreError ? '加载失败，点此重试' : `加载更多（已有 ${repos.length} 个）`}
          </button>
        )}
        {view === 'list' && allLoaded && repos.length > 150 && (
          <div className="hint" style={{ textAlign: 'center', marginTop: 10 }}>
            已是全部 {repos.length} 个星标仓库
          </div>
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

      {folderSheet && (
        <StarFolderSheet
          store={folders}
          initial={folderSheet.kind}
          {...(folderSheet.kind === 'assign' ? { fullName: folderSheet.repo.full_name } : {})}
          counts={counts}
          onChange={commitFolders}
          onClose={() => setFolderSheet(null)}
          onToast={p.onToast}
        />
      )}
    </>
  )
}
