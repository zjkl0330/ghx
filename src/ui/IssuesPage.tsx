import { useCallback, useMemo, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import { filterIssues, labelCounts, labelColorCss, type Issue } from '../lib/issues'
import { listIssues } from '../lib/issues'
import {
  EMPTY_FILTER,
  activeCount,
  buildIssueParams,
  filterSummary,
  matchesFilter,
  type IssueFilter,
} from '../lib/issue-filter'
import { listMilestones, type Milestone } from '../lib/milestones'
import { relTime } from '../lib/format'
import { useLoad } from './useLoad'
import { useMore } from './useMore'
import { PageState } from './PageHeader'
import { IssueFilterSheet } from './IssueFilterSheet'
import { Icon } from './icons'

type Filter = 'open' | 'closed' | 'all'

/**
 * Issue 列表。挂在仓库主页的 Issues 页签里，也可以作为独立路由打开。
 * 注意：接口会把 PR 一起返回，lib 层已经过滤掉了。
 *
 * 筛选分两层：标签 chips 是常用的一维筛选（点一下就看），
 * 作者 / 指派 / 里程碑 / 时间放弹层（见 `IssueFilterSheet`）——
 * 五个维度堆在一排 chips 里会挤出屏幕，而且「指派给我」和「无人指派」互斥。
 */
export function IssuesPage(p: {
  client: GitHubClient | null
  owner: string
  repo: string
  /** 当前账号登录名，用于筛选里的「我」快捷值 */
  me?: string | null
  onOpen: (n: number) => void
}) {
  const [filter, setFilter] = useState<Filter>('open')
  const [query, setQuery] = useState('')
  const [adv, setAdv] = useState<IssueFilter>(EMPTY_FILTER)
  const [sheet, setSheet] = useState(false)
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [msLoading, setMsLoading] = useState(false)

  // 对象每次渲染都是新引用，直接当依赖会无限重拉，所以比字符串
  const advKey = JSON.stringify(adv)

  const { data, loading, error, reload } = useLoad(
    () =>
      p.client
        ? listIssues(p.client, p.owner, p.repo, {
            state: filter,
            perPage: 50,
            extra: buildIssueParams(adv),
          })
        : null,
    [p.client, p.owner, p.repo, filter, advKey],
  )

  // 首屏之外再往后翻。筛选条件变了由 useMore 自己清空，不会混进上一轮的页
  const more = useMore(
    (page) =>
      p.client
        ? listIssues(p.client, p.owner, p.repo, {
            state: filter,
            perPage: 50,
            page,
            extra: buildIssueParams(adv),
          }).then((r) => r.items)
        : Promise.resolve([]),
    50,
    [p.client, p.owner, p.repo, filter, advKey],
  )

  // 服务端筛过一遍，客户端再判一次：镜像站偶尔吞 query，
  // 而且 label 在服务端是「全都要有」的 AND 语义，这里只支持单选，判严一点更安全
  const all = useMemo(() => [...(data?.items ?? []), ...more.items], [data, more.items])
  const items = useMemo(() => all.filter((i) => matchesFilter(i, adv)), [all, adv])
  const shown = useMemo(() => filterIssues(items, query), [items, query])
  const counts = useMemo(() => labelCounts(items), [items])
  const advN = activeCount(adv)
  const summary = useMemo(() => filterSummary(adv), [adv])

  const refresh = useCallback(() => void reload(true), [reload])

  const openSheet = useCallback(() => {
    setSheet(true)
    if (!p.client || msLoading || milestones.length > 0) return
    setMsLoading(true)
    listMilestones(p.client, p.owner, p.repo)
      .then(setMilestones)
      // 没权限 / 网络抖动都当「没有里程碑」：不能因为读不到就不让人筛别的
      .catch(() => setMilestones([]))
      .finally(() => setMsLoading(false))
  }, [p.client, p.owner, p.repo, msLoading, milestones.length])

  return (
    <>
      <div className="flt-bar">
        <div className="seg" style={{ flex: 1 }}>
          {(['open', 'closed', 'all'] as Filter[]).map((k) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {k === 'open' ? '开启中' : k === 'closed' ? '已关闭' : '全部'}
            </button>
          ))}
        </div>
        <button
          className={`flt-btn${advN > 0 ? ' on' : ''}`}
          onClick={openSheet}
          aria-label="高级筛选"
        >
          <Icon name="filter" size={14} />
          {advN > 0 ? `筛选 ${advN}` : '筛选'}
        </button>
      </div>

      {summary.length > 0 && (
        <div className="flt-sum">
          <span className="ellipsis">{summary.join(' · ')}</span>
          <button className="linkbtn" onClick={() => setAdv(EMPTY_FILTER)}>
            清除
          </button>
        </div>
      )}

      <div className="search" style={{ margin: '10px 16px 0' }}>
        <Icon name="search" size={15} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="在当前结果里找标题、正文、编号"
        />
        {query && (
          <button className="icon-btn" onClick={() => setQuery('')} aria-label="清空">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      {counts.length > 0 && (
        <div className="chips">
          <button
            className={`chip${adv.label === '' ? ' on' : ''}`}
            onClick={() => setAdv({ ...adv, label: '' })}
          >
            全部标签
          </button>
          {counts.slice(0, 12).map((c) => (
            <button
              key={c.name}
              className={`chip${adv.label === c.name ? ' on' : ''}`}
              onClick={() => setAdv({ ...adv, label: adv.label === c.name ? '' : c.name })}
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
            ? advN > 0
              ? '这个筛选下没有 Issue，放宽条件试试'
              : filter === 'open'
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

      {shown.length > 0 && !more.done && (
        <button className="btn ghost block" style={{ marginTop: 10 }} onClick={more.loadMore} disabled={more.loading}>
          {more.loading ? '加载中…' : more.error ? '加载失败，点此重试' : '加载更多'}
        </button>
      )}
      {more.done && shown.length > 0 && (
        <div className="hint" style={{ textAlign: 'center', marginTop: 10 }}>
          没有更多了
        </div>
      )}

      {sheet && (
        <IssueFilterSheet
          filter={adv}
          milestones={milestones}
          milestonesLoading={msLoading}
          me={p.me ?? null}
          onChange={setAdv}
          onClose={() => setSheet(false)}
        />
      )}
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
          {i.milestone ? ` · ${i.milestone.title}` : ''}
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
