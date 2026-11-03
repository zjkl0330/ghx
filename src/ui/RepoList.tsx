import { useState } from 'react'
import { snapshotAge } from '../lib/snapshot'
import type { RepoSort } from '../lib/sort'
import type { Repo } from '../lib/types'
import { Icon } from './icons'

/** 顶栏空间紧，排序按钮只放两三个字的简称 */
const SORT_SHORT: Record<RepoSort, string> = {
  pushed: '推送',
  updated: '更新',
  created: '创建',
  stars: 'Star',
  name: '名称',
}

const LANG_COLOR: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Kotlin: '#A97BFF',
  Java: '#b07219',
  Python: '#3572A5',
  'C++': '#f34b7d',
  Rust: '#dea584',
  Go: '#00ADD8',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Shell: '#89e051',
  Dart: '#00B4AB',
  Swift: '#F05138',
}

function relTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${Math.max(m, 1)} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo} 个月前`
  return `${Math.floor(mo / 12)} 年前`
}

interface Props {
  repos: Repo[]
  loading: boolean
  error: string | null
  query: string
  onQuery: (v: string) => void
  visibility: 'all' | 'public' | 'private'
  onVisibility: (v: 'all' | 'public' | 'private') => void
  counts: { total: number; public: number; private: number }
  selectMode: boolean
  selected: Set<string>
  onToggleSelect: (repo: Repo) => void
  onEnterSelect: () => void
  onExitSelect: () => void
  onRefresh: () => void
  hasToken: boolean
  account: string | null
  /** 真实头像；加载失败或为空时回退到首字母 */
  avatarUrl?: string | null
  onOpenRepo: (repo: Repo) => void
  updateVersion: string | null
  onOpenUpdate: () => void
  onCreate: () => void
  canCreate: boolean
  sort: RepoSort
  onOpenSort: () => void
  /** 有值表示当前列表来自本地快照，网络刷新还在后面跑 */
  snapshotAt: number | null
}

export function RepoList(p: Props) {
  const [avatarFailed, setAvatarFailed] = useState(false)
  const initial = (p.account ?? '?').slice(0, 1).toUpperCase()
  const showAvatar = p.avatarUrl && !avatarFailed

  return (
    <>
      <div className="topbar">
        {showAvatar ? (
          <img
            className="avatar avatar-img"
            src={p.avatarUrl as string}
            alt={p.account ?? '头像'}
            onError={() => setAvatarFailed(true)}
          />
        ) : (
          <div className="avatar">{initial}</div>
        )}
        <div className="who">
          {p.account ? `@${p.account}` : '未连接账号'}
          <span> · {p.counts.total} 个仓库</span>
        </div>
        <div className="spacer" />
        <button className="icon-btn" onClick={p.onRefresh} aria-label="刷新">
          <Icon name="refresh" size={17} />
        </button>
        <button className="icon-btn" onClick={p.onCreate} aria-label="新建仓库" disabled={!p.canCreate}>
          <Icon name="plus" size={17} />
        </button>
        <button
          className="icon-btn"
          onClick={p.selectMode ? p.onExitSelect : p.onEnterSelect}
          aria-label="批量选择"
          style={p.selectMode ? { color: 'var(--blue)' } : undefined}
        >
          <Icon name="select" size={17} />
        </button>
      </div>

      <div className="search">
        <Icon name="search" size={14} />
        <input
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
          placeholder="搜索仓库名或描述"
          autoCapitalize="off"
          spellCheck={false}
        />
        {p.query && (
          <button onClick={() => p.onQuery('')} aria-label="清空" style={{ color: 'inherit' }}>
            <Icon name="close" size={13} />
          </button>
        )}
      </div>

      <div className="segrow">
        <div className="seg" style={{ margin: 0, flex: 1 }}>
          {(
            [
              ['all', `全部 ${p.counts.total}`],
              ['public', `公开 ${p.counts.public}`],
              ['private', `私有 ${p.counts.private}`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={p.visibility === key ? 'on' : ''}
              onClick={() => p.onVisibility(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="sortbtn" onClick={p.onOpenSort} aria-label="排列方式">
          <Icon name="sort" size={13} />
          {SORT_SHORT[p.sort]}
        </button>
      </div>

      <div className="page" style={{ marginTop: 0 }}>
        {p.updateVersion && (
          <div className="updatebar">
            <Icon name="download" size={14} />
            <span>新版本 v{p.updateVersion} 可用</span>
            <button onClick={p.onOpenUpdate}>查看</button>
          </div>
        )}

        {p.snapshotAt !== null && p.loading && (
          <div className="snapbar">
            显示 {snapshotAge(p.snapshotAt)} 的本地数据，正在刷新…
          </div>
        )}

        {p.error && (
          <div className="warnbox" style={{ margin: '12px 16px 0' }}>
            <Icon name="warn" size={14} />
            <span>{p.error}</span>
          </div>
        )}

        {p.loading && p.repos.length === 0 && (
          <div className="empty">正在拉取仓库…</div>
        )}

        {!p.loading && p.repos.length === 0 && !p.error && (
          <div className="empty">
            <b>没有匹配的仓库</b>
            {p.hasToken ? '换个筛选条件，或点右上角刷新。' : '先到「令牌」页导入一个 PAT。'}
          </div>
        )}

        {p.repos.length > 0 && (
          <div className="rows">
            {p.repos.map((r) => {
              const on = p.selected.has(r.full_name)
              return (
                <button
                  key={r.id}
                  className={`row${on ? ' selected' : ''}`}
                  onClick={() => {
                    if (p.selectMode) p.onToggleSelect(r)
                    else p.onOpenRepo(r)
                  }}
                >
                  {p.selectMode ? (
                    <span className={`checkbox${on ? ' on' : ''}`}>
                      <Icon name="check" size={12} />
                    </span>
                  ) : (
                    <span className="row-ic">
                      <Icon name="repo" size={15} />
                    </span>
                  )}
                  <span className="row-main">
                    <span className="row-l1">
                      <span className="row-name">{r.name}</span>
                      <span className="badge">{r.private ? 'Private' : 'Public'}</span>
                      {r.archived && <span className="badge archived">Archived</span>}
                    </span>
                    {r.description && <span className="row-desc" style={{ display: 'block' }}>{r.description}</span>}
                    <span className="row-meta">
                      {r.language && (
                        <span>
                          <span className="dot" style={{ background: LANG_COLOR[r.language] ?? '#8b949e' }} />
                          {r.language}
                        </span>
                      )}
                      <span>★ {r.stargazers_count}</span>
                      <span>⑂ {r.forks_count}</span>
                      <span>{relTime(r.pushed_at)}</span>
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
