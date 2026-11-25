import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import { relTime } from '../lib/format'
import { parseMarkdown } from '../lib/markdown'
import type { LinkContext } from '../lib/mdlink'
import type { Route } from '../lib/routes'
import type { TargetLang, TranslateChannel, TranslationStore } from '../lib/translate'
import {
  getPull,
  listPulls,
  listReviews,
  mergeFailure,
  mergeableHint,
  mergePull,
  pullCommits,
  pullFiles,
  pullStateText,
  reviewFailure,
  setPullState,
  submitReview,
  totalStats,
  type MergeMethod,
  type PullCommit,
  type PullFile,
  type PullRequest,
  type PullReview,
} from '../lib/pulls'
import { addComment, listComments, listTimeline, type IssueComment } from '../lib/issues'
import type { TimelineItem } from '../lib/timeline'
import { PageHeader, PageState } from './PageHeader'
import { TimelineList } from './TimelineList'
import { MarkdownView } from './MarkdownView'
import { TransHead } from './TransHead'
import { useDocTranslation } from './useDocTranslation'
import { DiffView } from './DiffView'
import { Icon } from './icons'
import { EMPTY_FILTER, activeCount, filterSummary, matchesFilter, type IssueFilter } from '../lib/issue-filter'
import { listMilestones, type Milestone } from '../lib/milestones'
import { IssueFilterSheet } from './IssueFilterSheet'
import { useLoad } from './useLoad'
import { useMore } from './useMore'

/** PR 列表 */
export function PullsPage(p: {
  client: GitHubClient | null
  owner: string
  repo: string
  /** 当前账号登录名，用于筛选里的「我」快捷值 */
  me?: string | null
  onOpen: (n: number) => void
}) {
  const [filter, setFilter] = useState<'open' | 'closed' | 'all'>('open')
  const [query, setQuery] = useState('')
  const [adv, setAdv] = useState<IssueFilter>(EMPTY_FILTER)
  const [sheet, setSheet] = useState(false)
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [msLoading, setMsLoading] = useState(false)

  const { data, loading, error, reload } = useLoad(
    () => (p.client ? listPulls(p.client, p.owner, p.repo, { state: filter, perPage: 40 }) : null),
    [p.client, p.owner, p.repo, filter],
  )

  const more = useMore(
    (page) =>
      p.client
        ? listPulls(p.client, p.owner, p.repo, { state: filter, perPage: 40, page })
        : Promise.resolve([]),
    40,
    [p.client, p.owner, p.repo, filter],
  )

  const all = useMemo(() => [...(data ?? []), ...more.items], [data, more.items])

  // PR 列表端点不支持 labels / assignee / creator / milestone / since，
  // 所以筛选只能在这一页里做 —— 弹层里已经写明，避免被当成「全仓库没有」
  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = all.filter((pr) => matchesFilter(pr, adv))
    if (!q) return list
    return list.filter(
      (pr) =>
        pr.title.toLowerCase().includes(q) ||
        String(pr.number) === q ||
        pr.user?.login?.toLowerCase().includes(q),
    )
  }, [all, query, adv])

  const advN = activeCount(adv)
  const summary = useMemo(() => filterSummary(adv), [adv])

  const openSheet = useCallback(() => {
    setSheet(true)
    if (!p.client || msLoading || milestones.length > 0) return
    setMsLoading(true)
    listMilestones(p.client, p.owner, p.repo)
      .then(setMilestones)
      .catch(() => setMilestones([]))
      .finally(() => setMsLoading(false))
  }, [p.client, p.owner, p.repo, msLoading, milestones.length])

  return (
    <>
      <div className="flt-bar">
        <div className="seg" style={{ flex: 1 }}>
          {(['open', 'closed', 'all'] as const).map((k) => (
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
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="筛选标题、编号、作者" />
      </div>

      <PageState
        loading={loading && !data}
        error={error}
        onRetry={() => void reload(true)}
        empty={
          data && items.length === 0
            ? advN > 0
              ? '这一页里没有匹配的 PR，放宽条件或翻页试试'
              : filter === 'open'
                ? '没有开启中的 PR'
                : '这个筛选下没有 PR'
            : undefined
        }
      />

      <div className="rows">
        {items.map((pr) => (
          <PullRow key={pr.number} pr={pr} onOpen={() => p.onOpen(pr.number)} />
        ))}
      </div>

      {items.length > 0 && !more.done && (
        <button className="btn ghost block" style={{ marginTop: 10 }} onClick={more.loadMore} disabled={more.loading}>
          {more.loading ? '加载中…' : more.error ? '加载失败，点此重试' : '加载更多'}
        </button>
      )}
      {more.done && items.length > 0 && (
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
          pulls
          onChange={setAdv}
          onClose={() => setSheet(false)}
        />
      )}
    </>
  )
}

function PullRow(p: { pr: PullRequest; onOpen: () => void }) {
  const pr = p.pr
  const state = pullStateText(pr)
  return (
    <button className="row issue-row" onClick={p.onOpen}>
      <span className={`issue-ic${pr.state === 'open' ? ' open' : ' merged'}`} aria-hidden="true">
        <Icon name={pr.merged_at ? 'merge' : 'pull'} size={15} />
      </span>
      <span className="row-main">
        <span className="row-l1">
          <span className="row-name ellipsis">{pr.title}</span>
        </span>
        <span className="row-meta">
          #{pr.number} · {pr.user?.login ?? '未知'} · {state} · {relTime(pr.updated_at)}
        </span>
        <span className="row-meta">
          {pr.head.ref} → {pr.base.ref}
          {/* 列表接口不给增删行数，只有详情接口才有，所以这里要判空 */}
          {typeof pr.additions === 'number' && (
            <>
              {' · '}
              <b className="add">+{pr.additions}</b> <b className="del">−{pr.deletions}</b>
            </>
          )}
          {typeof pr.changed_files === 'number' ? ` · ${pr.changed_files} 个文件` : ''}
        </span>
      </span>
    </button>
  )
}

/** PR 详情：对话 + 更改 + 合并 + 审核 */
export function PullPage(p: {
  client: GitHubClient | null
  owner: string
  repo: string
  number: number
  login: string | null
  onBack: () => void
  onToast: (s: string) => void
  /** 点作者 / 审核人看主页 */
  onOpenUser?: (login: string) => void
  /** 网页加速前缀：描述里 github.com 的链接要换成能打开的地址 */
  mirror?: string
  /** GitHub 链接的 App 内打开入口。不传的话描述里的链接只能交给系统浏览器 */
  onOpenRoute?: (r: Route) => void
  /** 设置里的「Issue 与 PR」开关 */
  autoTranslate?: boolean
  channel?: TranslateChannel
  target?: TargetLang
  azureKey?: string
  store?: TranslationStore | null
}) {
  /** 描述与审核意见的行内链接上下文（分支用 HEAD，GitHub 会解析到默认分支） */
  const linkCtx: LinkContext = {
    owner: p.owner,
    repo: p.repo,
    branch: 'HEAD',
    basePath: '',
    mirror: p.mirror ?? '',
  }
  const [pr, setPr] = useState<PullRequest | null>(null)
  const [files, setFiles] = useState<PullFile[]>([])
  const [commits, setCommits] = useState<PullCommit[]>([])
  const [reviews, setReviews] = useState<PullReview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'talk' | 'diff'>('talk')
  const [busy, setBusy] = useState(false)
  const [mergePanel, setMergePanel] = useState(false)
  const [method, setMethod] = useState<MergeMethod>('squash')
  const [confirm, setConfirm] = useState(false)
  const [reviewPanel, setReviewPanel] = useState<'APPROVE' | 'REQUEST_CHANGES' | null>(null)
  const [reviewBody, setReviewBody] = useState('')
  /** 对话区：普通评论与动态（标签/指派/关闭）分开拉，任一失败不影响详情 */
  const [comments, setComments] = useState<IssueComment[]>([])
  const [events, setEvents] = useState<TimelineItem[]>([])
  const [commentDraft, setCommentDraft] = useState('')

  /** 描述与审核意见各一套：描述先到，审核是随后拉的，混在一起会互相取消 */
  const bodyBlocks = useMemo(
    () => (pr?.body?.trim() ? parseMarkdown(pr.body, { maxBlocks: 300 }) : []),
    [pr?.body],
  )
  const reviewBlocks = useMemo(
    () => reviews.map((r) => (r.body?.trim() ? parseMarkdown(r.body, { maxBlocks: 120 }) : [])),
    [reviews],
  )
  const flatReviews = useMemo(() => reviewBlocks.flat(), [reviewBlocks])
  const transBody = useDocTranslation({
    enabled: !!p.autoTranslate,
    channel: p.channel ?? 'auto',
    target: p.target ?? 'zh-CN',
    azureKey: p.azureKey ?? '',
    store: p.store ?? null,
  })
  const transReview = useDocTranslation({
    enabled: !!p.autoTranslate,
    channel: p.channel ?? 'auto',
    target: p.target ?? 'zh-CN',
    azureKey: p.azureKey ?? '',
    store: p.store ?? null,
  })
  const [view, setView] = useState<'zh' | 'src'>('zh')

  useEffect(() => {
    transBody.reset()
    if (p.autoTranslate) void transBody.translate(bodyBlocks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr?.number, pr?.body, p.autoTranslate])

  useEffect(() => {
    transReview.reset()
    if (p.autoTranslate && flatReviews.length > 0) void transReview.translate(flatReviews)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviews, p.autoTranslate])

  /** 第 ri 条审核意见显示哪份块：译文拍平了，按前面的块数切回来 */
  const reviewShown = (ri: number) => {
    const blocks = reviewBlocks[ri] ?? []
    if (view !== 'zh' || !transReview.zh) return blocks
    const start = reviewBlocks.slice(0, ri).reduce((n, b) => n + b.length, 0)
    return transReview.zh.slice(start, start + blocks.length)
  }

  const load = useCallback(
    async (silent = false) => {
      if (!p.client) {
        setLoading(false)
        return
      }
      if (!silent) setLoading(true)
      setError(null)
      try {
        const [d, f, c, r, cs, tl] = await Promise.all([
          getPull(p.client, p.owner, p.repo, p.number, silent),
          pullFiles(p.client, p.owner, p.repo, p.number, silent),
          pullCommits(p.client, p.owner, p.repo, p.number, silent),
          listReviews(p.client, p.owner, p.repo, p.number, silent),
          listComments(p.client, p.owner, p.repo, p.number, silent).catch(() => [] as IssueComment[]),
          listTimeline(p.client, p.owner, p.repo, p.number, silent).catch(() => [] as TimelineItem[]),
        ])
        setPr(d)
        setFiles(f)
        setCommits(c)
        setReviews(r)
        setComments(cs)
        setEvents(tl)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [p.client, p.owner, p.repo, p.number],
  )

  useEffect(() => {
    void load()
  }, [load])

  // mergeable 初始是 null，服务端要后台算；等一会儿再问一次
  useEffect(() => {
    if (pr?.state !== 'open' || pr.mergeable !== null) return
    const t = window.setTimeout(() => void load(true), 2000)
    return () => window.clearTimeout(t)
  }, [pr, load])

  const stats = useMemo(() => totalStats(files), [files])
  const hint = pr ? mergeableHint(pr) : null

  async function doMerge() {
    if (!pr || !p.client || busy) return
    setBusy(true)
    try {
      await mergePull(p.client, p.owner, p.repo, p.number, { method, sha: pr.head.sha })
      p.onToast(`已用 ${method === 'squash' ? 'squash' : method === 'rebase' ? 'rebase' : '合并提交'} 合并`)
      setMergePanel(false)
      setConfirm(false)
      await load(true)
    } catch (err) {
      const status = (err as { status?: number }).status ?? 0
      p.onToast(mergeFailure(status, (err as { body?: unknown }).body))
    } finally {
      setBusy(false)
    }
  }

  async function doReview() {
    if (!pr || !p.client || !reviewPanel || busy) return
    setBusy(true)
    try {
      await submitReview(p.client, p.owner, p.repo, p.number, {
        event: reviewPanel,
        body: reviewBody.trim(),
      })
      p.onToast(reviewPanel === 'APPROVE' ? '已批准' : '已提出修改意见')
      setReviewPanel(null)
      setReviewBody('')
      await load(true)
    } catch (err) {
      const status = (err as { status?: number }).status ?? 0
      p.onToast(reviewFailure(status, (err as { body?: unknown }).body))
    } finally {
      setBusy(false)
    }
  }

  async function sendComment() {
    const body = commentDraft.trim()
    if (!body || !p.client || busy) return
    setBusy(true)
    try {
      await addComment(p.client, p.owner, p.repo, p.number, body)
      setCommentDraft('')
      p.onToast('评论已发送')
      await load(true)
    } catch (err) {
      p.onToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function toggleState() {
    if (!pr || !p.client || busy) return
    const closing = pr.state === 'open'
    setBusy(true)
    try {
      await setPullState(p.client, p.owner, p.repo, p.number, closing ? 'closed' : 'open')
      p.onToast(closing ? '已关闭 PR' : '已重新打开')
      await load(true)
    } catch (err) {
      p.onToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title={`#${p.number}`}
        sub={`${p.owner}/${p.repo}`}
        onBack={p.onBack}
        right={
          <button className="icon-btn" onClick={() => void load(true)} aria-label="刷新">
            <Icon name="refresh" size={17} />
          </button>
        }
      />

      <div className="page" style={{ marginTop: 0 }}>
        <PageState loading={loading && !pr} error={error} onRetry={() => void load()} />

        {pr && (
          <>
            <div className="detail-head">
              <div className="detail-title">{pr.title}</div>
              <div className="detail-meta">
                <span className={`pill ${pr.merged_at ? 'pill-merged' : pr.state === 'open' ? 'pill-open' : 'pill-closed'}`}>
                  {pullStateText(pr)}
                </span>
                <span>
                  {pr.user?.login && p.onOpenUser ? (
                    <button className="user-link" onClick={() => p.onOpenUser?.(pr.user!.login)}>
                      {pr.user.login}
                    </button>
                  ) : (
                    (pr.user?.login ?? '未知')
                  )}{' '}
                  · {relTime(pr.updated_at)}
                </span>
              </div>
              <div className="branchline mono">
                {pr.head.ref} → {pr.base.ref}
              </div>
              <div className="detail-meta">
                {pr.commits} 个提交 · <b className="add">+{stats.additions}</b>{' '}
                <b className="del">−{stats.deletions}</b> · {stats.changed_files} 个文件
              </div>
              {hint && <div className="warnbox slim">{hint}</div>}
            </div>

            <div className="seg" style={{ margin: '10px 16px 0' }}>
              <button className={tab === 'talk' ? 'on' : ''} onClick={() => setTab('talk')}>
                对话
              </button>
              <button className={tab === 'diff' ? 'on' : ''} onClick={() => setTab('diff')}>
                更改 {files.length > 0 ? `· ${files.length}` : ''}
              </button>
            </div>

            {tab === 'talk' && (
              <>
                <div className="detail-body">
                  {pr.body?.trim() ? (
                    <>
                      <TransHead
                        label="描述"
                        view={view}
                        onToggle={() => setView((v) => (v === 'zh' ? 'src' : 'zh'))}
                        ready={!!transBody.zh}
                        busy={transBody.busy}
                        enabled={!!p.autoTranslate}
                        onTranslate={() => void transBody.translate(bodyBlocks)}
                        error={transBody.error}
                      />
                      <MarkdownView
                        blocks={view === 'zh' && transBody.zh ? transBody.zh : bodyBlocks}
                        mirror={p.mirror}
                        ctx={linkCtx}
                        onRoute={p.onOpenRoute}
                      />
                    </>
                  ) : (
                    <div className="muted">（没有描述）</div>
                  )}
                </div>

                <TimelineList items={events} />

                {commits.length > 0 && (
                  <>
                    <div className="section-title">提交 · {commits.length}</div>
                    <div className="commitlist">
                      {commits.slice(0, 30).map((c) => (
                        <div className="commitrow" key={c.sha}>
                          <Icon name="package" size={13} />
                          <span className="ellipsis">{c.commit.message.split('\n')[0]}</span>
                          <code className="mono">{c.sha.slice(0, 7)}</code>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {reviews.length > 0 && (
                  <>
                    <div className="section-title">审核 · {reviews.length}</div>
                    <div style={{ padding: '0 16px' }}>
                      <TransHead
                        view={view}
                        onToggle={() => setView((v) => (v === 'zh' ? 'src' : 'zh'))}
                        ready={!!transReview.zh}
                        busy={transReview.busy}
                        enabled={!!p.autoTranslate}
                        onTranslate={() => void transReview.translate(flatReviews)}
                        error={transReview.error}
                      />
                    </div>
                    {reviews.map((r, ri) => (
                      <div className="comment" key={r.id}>
                        <div className="comment-head">
                          {r.user?.login && p.onOpenUser ? (
                            <button className="user-link" onClick={() => p.onOpenUser?.(r.user!.login)}>
                              <b>{r.user.login}</b>
                            </button>
                          ) : (
                            <b>{r.user?.login ?? '未知'}</b>
                          )}
                          <span className={`pill ${r.state === 'APPROVED' ? 'pill-open' : r.state === 'CHANGES_REQUESTED' ? 'pill-closed' : ''}`}>
                            {r.state === 'APPROVED' ? '已批准' : r.state === 'CHANGES_REQUESTED' ? '要求修改' : '已评论'}
                          </span>
                        </div>
                        {r.body?.trim() && (
                          <div className="comment-body">
                            <MarkdownView
                              blocks={reviewShown(ri)}
                              mirror={p.mirror}
                              ctx={linkCtx}
                              onRoute={p.onOpenRoute}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}
                {comments.length > 0 && (
                  <>
                    <div className="section-title">评论 · {comments.length}</div>
                    {comments.map((c) => (
                      <div className="comment" key={c.id}>
                        <div className="comment-head">
                          {c.user?.login && p.onOpenUser ? (
                            <button className="user-link" onClick={() => p.onOpenUser?.(c.user!.login)}>
                              <b>{c.user.login}</b>
                            </button>
                          ) : (
                            <b>{c.user?.login ?? '未知'}</b>
                          )}
                          <span>{relTime(c.created_at)}</span>
                        </div>
                        <div className="comment-body">
                          {c.body?.trim() ? (
                            <MarkdownView
                              blocks={parseMarkdown(c.body, { maxBlocks: 120 })}
                              mirror={p.mirror}
                              ctx={linkCtx}
                              onRoute={p.onOpenRoute}
                            />
                          ) : (
                            <span className="muted">（空评论）</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </>
                )}

                <div className="comment-form">
                  <textarea
                    className="textarea"
                    rows={3}
                    value={commentDraft}
                    onChange={(e) => setCommentDraft(e.target.value)}
                    placeholder="写条评论…（支持 Markdown）"
                  />
                  <div className="btnrow" style={{ marginTop: 8 }}>
                    <button
                      className="btn primary"
                      disabled={busy || !commentDraft.trim()}
                      onClick={() => void sendComment()}
                    >
                      <Icon name="chat" size={14} />
                      发送
                    </button>
                  </div>
                </div>
              </>
            )}

            {tab === 'diff' && <DiffView files={files} />}

            {pr.state === 'open' && !pr.merged_at && (
              <>
                <div className="btnrow">
                  <button
                    className="btn primary"
                    disabled={pr.mergeable !== true || busy}
                    onClick={() => {
                      setMergePanel((v) => !v)
                      setConfirm(false)
                    }}
                  >
                    <Icon name="merge" size={14} />
                    合并
                  </button>
                  <button className="btn ghost" disabled={busy} onClick={() => setReviewPanel('APPROVE')}>
                    <Icon name="check" size={14} />
                    批准
                  </button>
                  <button className="btn ghost" disabled={busy} onClick={() => setReviewPanel('REQUEST_CHANGES')}>
                    要求修改
                  </button>
                </div>

                {mergePanel && (
                  <div className="panel" style={{ margin: '0 16px 16px' }}>
                    <div className="section-title" style={{ padding: 0 }}>
                      合并方式
                    </div>
                    <div className="seg" style={{ margin: '8px 0 0' }}>
                      {(['squash', 'merge', 'rebase'] as MergeMethod[]).map((m) => (
                        <button key={m} className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>
                          {m === 'squash' ? '压缩' : m === 'merge' ? '合并提交' : '变基'}
                        </button>
                      ))}
                    </div>
                    <div className="hint" style={{ marginTop: 8 }}>
                      压缩：所有提交压成一个；合并提交：保留分支结构；变基：线性历史。
                    </div>
                    {confirm ? (
                      <div className="btnrow" style={{ marginTop: 10 }}>
                        <button className="btn ghost" disabled={busy} onClick={() => setConfirm(false)}>
                          取消
                        </button>
                        <button className="btn primary" disabled={busy} onClick={() => void doMerge()}>
                          确认合并
                        </button>
                      </div>
                    ) : (
                      <button className="btn primary" style={{ marginTop: 10 }} onClick={() => setConfirm(true)}>
                        下一步
                      </button>
                    )}
                  </div>
                )}
              </>
            )}

            {pr.state === 'open' && (
              <div className="btnrow">
                <button className="btn ghost danger" disabled={busy} onClick={() => void toggleState()}>
                  关闭 PR
                </button>
              </div>
            )}

            {reviewPanel && (
              <div className="panel" style={{ margin: '0 16px 16px' }}>
                <div className="section-title" style={{ padding: 0 }}>
                  {reviewPanel === 'APPROVE' ? '批准这个 PR' : '要求修改'}
                </div>
                <textarea
                  className="textarea"
                  rows={3}
                  value={reviewBody}
                  onChange={(e) => setReviewBody(e.target.value)}
                  placeholder={reviewPanel === 'APPROVE' ? '可以留一句说明（可选）' : '说明需要改什么'}
                />
                <div className="btnrow" style={{ marginTop: 8 }}>
                  <button className="btn ghost" onClick={() => setReviewPanel(null)}>
                    取消
                  </button>
                  <button
                    className="btn primary"
                    disabled={busy || (reviewPanel === 'REQUEST_CHANGES' && !reviewBody.trim())}
                    onClick={() => void doReview()}
                  >
                    提交
                  </button>
                </div>
                {p.login && <div className="hint">不能给自己的 PR 投票，这种情况请留评论。</div>}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
