import { useCallback, useMemo, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import { filterIssues, labelCounts, labelColorCss, type Issue } from '../lib/issues'
import { listIssues } from '../lib/issues'
import { relTime } from '../lib/format'
import { useLoad } from './useLoad'
import { PageState } from './PageHeader'
import { Icon } from './icons'

type Filter = 'open' | 'closed' | 'all'

/**
 * Issue 列表。挂在仓库主页的 Issues 页签里，也可以作为独立路由打开。
 * 注意：接口会把 PR 一起返回，lib 层已经过滤掉了。
 */
export function IssuesPage(p: {
  client: GitHubClient | null
  owner: string
  repo: string
  onOpen: (n: number) => void
}) {
  const [filter, setFilter] = useState<Filter>('open')
  const [query, setQuery] = useState('')
  const [label, setLabel] = useState<string | null>(null)

  const { data, loading, error, reload } = useLoad(
    () =>
      p.client
        ? listIssues(p.client, p.owner, p.repo, { state: filter, perPage: 50 })
        : null,
    [p.client, p.owner, p.repo, filter],
  )

  const items = data?.items ?? []
  const shown = useMemo(() => filterIssues(items, query, label ?? undefined), [items, query, label])
  const counts = useMemo(() => labelCounts(items), [items])

  const refresh = useCallback(() => void reload(true), [reload])

  return (
    <>
      <div className="seg" style={{ margin: '8px 16px 0' }}>
        {(['open', 'closed', 'all'] as Filter[]).map((k) => (
          <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
            {k === 'open' ? '开启中' : k === 'closed' ? '已关闭' : '全部'}
          </button>
        ))}
      </div>

      <div className="search" style={{ margin: '10px 16px 0' }}>
        <Icon name="search" size={15} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="筛选标题、正文、编号"
        />
        {query && (
          <button className="icon-btn" onClick={() => setQuery('')} aria-label="清空">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      {counts.length > 0 && (
        <div className="chips">
          <button className={`chip${label === null ? ' on' : ''}`} onClick={() => setLabel(null)}>
            全部标签
          </button>
          {counts.slice(0, 12).map((c) => (
            <button
              key={c.name}
              className={`chip${label === c.name ? ' on' : ''}`}
              onClick={() => setLabel(label === c.name ? null : c.name)}
            >
              <span className="chip-dot" style={{ background: labelColorCss(c.color) }} />
              {c.name}
              <span className="chip-n">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      <PageState
        loading={loading && items.length === 0}
        error={error}
        onRetry={refresh}
        empty={
          items.length === 0
            ? filter === 'open'
              ? '没有开启中的 Issue。点右上角「新建」提一个。'
              : '这个筛选下没有 Issue'
            : undefined
        }
      />

      {shown.length > 0 && (
        <div className="list-head">
          <span>{shown.length} 条</span>
          <button className="linkbtn" onClick={refresh}>
            刷新
          </button>
        </div>
      )}

      <div className="rows">
        {shown.map((i) => (
          <IssueRow key={i.number} issue={i} onOpen={() => p.onOpen(i.number)} />
        ))}
      </div>
    </>
  )
}

export function IssueRow(p: { issue: Issue; onOpen: () => void }) {
  const i = p.issue
  const open = i.state === 'open'
  return (
    <button className="row issue-row" onClick={p.onOpen}>
      <span className={`issue-ic${open ? ' open' : ''}`} aria-hidden="true">
        <Icon name={open ? 'issue' : 'check'} size={15} />
      </span>
      <span className="row-main">
        <span className="row-l1">
          <span className="row-name ellipsis">{i.title}</span>
        </span>
        <span className="row-meta">
          #{i.number} · {i.user?.login ?? '未知'} · {relTime(i.updated_at)}
          {i.comments > 0 ? ` · ${i.comments} 条评论` : ''}
        </span>
        {i.labels.length > 0 && (
          <span className="issue-labels">
            {i.labels.slice(0, 4).map((l) => (
              <span
                key={l.name}
                className="issue-label"
                style={{ background: labelColorCss(l.color), color: textOn(l.color) }}
              >
                {l.name}
              </span>
            ))}
          </span>
        )}
      </span>
    </button>
  )
}

/** 标签底色决定文字颜色，逻辑与 lib 保持一致 */
function textOn(hex: string): string {
  const raw = hex.replace('#', '')
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  if ([r, g, b].some((n) => Number.isNaN(n))) return '#fff'
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#0d1117' : '#fff'
}
