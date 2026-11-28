import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import {
  addComment,
  getIssue,
  listCommentPage,
  listLatestComments,
  listLabels,
  listTimeline,
  setAssignees,
  setIssueLabels,
  setLocked,
  updateIssue,
  type Issue,
  type IssueComment,
  type IssueLabel,
  type IssueUser,
} from '../lib/issues'
import {
  dueInfo,
  listMilestones,
  milestoneProgress,
  setMilestone,
  type Milestone,
} from '../lib/milestones'
import { listCollaborators } from '../lib/repo-admin'
import { parseMarkdown } from '../lib/markdown'
import type { LinkContext } from '../lib/mdlink'
import type { Route } from '../lib/routes'
import type { TargetLang, TranslateChannel, TranslationStore } from '../lib/translate'
import { relTime, shortDate } from '../lib/format'
import type { TimelineItem } from '../lib/timeline'
import { PageHeader, PageState } from './PageHeader'
import { TimelineList } from './TimelineList'
import { MarkdownView } from './MarkdownView'
import { TransHead } from './TransHead'
import { useDocTranslation } from './useDocTranslation'
import { Icon } from './icons'

/**
 * Issue 详情：正文 + 评论 + 关/重开 + 标签。
 *
 * 写操作后统一走 `reload`，因为 GitHub 会顺手改 updated_at / comments 计数，
 * 本地拼一份很容易和服务器不一致。
 */
export function IssuePage(p: {
  client: GitHubClient | null
  owner: string
  repo: string
  number: number
  onBack: () => void
  onToast: (s: string) => void
  /** 点作者看主页 */
  onOpenUser?: (login: string) => void
  /** 网页加速前缀：正文里 github.com 的链接要换成能打开的地址 */
  mirror?: string
  /** GitHub 链接的 App 内打开入口。不传的话正文链接只能交给系统浏览器 */
  onOpenRoute?: (r: Route) => void
  /** 设置里的「Issue 与 PR」开关 */
  autoTranslate?: boolean
  channel?: TranslateChannel
  target?: TargetLang
  azureKey?: string
  store?: TranslationStore | null
}) {
  /**
   * 正文/评论的行内链接上下文。
   *
   * Issue 正文里的相对路径按仓库根算（basePath 空串）；默认分支这里拿不到，
   * 用 `HEAD` —— GitHub 网页与 API 都认它，会解析到仓库真正的默认分支。
   */
  const linkCtx: LinkContext = {
    owner: p.owner,
    repo: p.repo,
    branch: 'HEAD',
    basePath: '',
    mirror: p.mirror ?? '',
  }
  const [issue, setIssue] = useState<Issue | null>(null)
  const [comments, setComments] = useState<IssueComment[]>([])
  /** 当前显示的是第几页评论 / 最后一页是第几页 —— 用来决定「加载更早」还点不点得动 */
  const [cpage, setCpage] = useState({ page: 1, last: 1 })
  const [olderBusy, setOlderBusy] = useState(false)
  /** 标签变更、关闭、指派这类事件；评论区不显示它们，但确实发生过 */
  const [events, setEvents] = useState<TimelineItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [labels, setLabels] = useState<IssueLabel[] | null>(null)
  const [pickingLabels, setPickingLabels] = useState(false)
  const [people, setPeople] = useState<IssueUser[] | null>(null)
  const [pickingPeople, setPickingPeople] = useState(false)
  const [pickingLock, setPickingLock] = useState(false)
  const [milestones, setMilestones] = useState<Milestone[] | null>(null)
  const [pickingMilestone, setPickingMilestone] = useState(false)

  /**
   * 正文与评论各走一套翻译：正文换了要立刻重翻，评论是后到的，
   * 两个生命周期不一样，混在一个 hook 里会互相取消。
   */
  const bodyBlocks = useMemo(
    () => (issue?.body?.trim() ? parseMarkdown(issue.body, { maxBlocks: 300 }) : []),
    [issue?.body],
  )
  const commentBlocks = useMemo(
    () => comments.map((c) => (c.body?.trim() ? parseMarkdown(c.body, { maxBlocks: 200 }) : [])),
    [comments],
  )
  const flatComments = useMemo(() => commentBlocks.flat(), [commentBlocks])
  const transBody = useDocTranslation({
    enabled: !!p.autoTranslate,
    channel: p.channel ?? 'auto',
    target: p.target ?? 'zh-CN',
    azureKey: p.azureKey ?? '',
    store: p.store ?? null,
  })
  const transTalk = useDocTranslation({
    enabled: !!p.autoTranslate,
    channel: p.channel ?? 'auto',
    target: p.target ?? 'zh-CN',
    azureKey: p.azureKey ?? '',
    store: p.store ?? null,
  })
  const [view, setView] = useState<'zh' | 'src'>('zh')

  // 换了一条 Issue 就取消在途任务，免得上一条的译文糊到这一条上
  useEffect(() => {
    transBody.reset()
    if (p.autoTranslate) void transBody.translate(bodyBlocks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue?.number, issue?.body, p.autoTranslate])

  useEffect(() => {
    transTalk.reset()
    if (p.autoTranslate && flatComments.length > 0) void transTalk.translate(flatComments)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, p.autoTranslate])

  /** 第 ci 条评论该显示哪一份块：译文是拍平的，按前面的块数切回来 */
  const commentShown = (ci: number) => {
    const blocks = commentBlocks[ci] ?? []
    if (view !== 'zh' || !transTalk.zh) return blocks
    const start = commentBlocks.slice(0, ci).reduce((n, b) => n + b.length, 0)
    return transTalk.zh.slice(start, start + blocks.length)
  }

  /**
   * 往前翻一页评论。
   *
   * 不放 useCallback：它只被按钮点用，进不了任何 effect 的依赖链，
   * 包一层反而让 useCallback 的依赖表变长。
   */
  async function loadOlder() {
    if (!p.client || olderBusy || cpage.page <= 1) return
    setOlderBusy(true)
    try {
      const res = await listCommentPage(p.client, p.owner, p.repo, p.number, cpage.page - 1)
      // 前置插入：更早的评论要排在上面，不能追加到末尾
      setComments((prev) => [...res.items, ...prev])
      setCpage((cur) => ({ page: res.page, last: Math.max(res.last, cur.last) }))
    } catch (err) {
      p.onToast((err as Error).message)
    } finally {
      setOlderBusy(false)
    }
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
        const [it, cs, tl] = await Promise.all([
          getIssue(p.client, p.owner, p.repo, p.number, silent),
          listLatestComments(p.client, p.owner, p.repo, p.number, silent),
          // 动态拿不到不该把整页拖垮：老仓库、镜像站都可能没有这个端点
          listTimeline(p.client, p.owner, p.repo, p.number, silent).catch(() => [] as TimelineItem[]),
        ])
        setIssue(it)
        setComments(cs.items)
        setCpage({ page: cs.page, last: cs.last })
        setEvents(tl)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [p.client, p.owner, p.repo, p.number],
  )

  // 换仓库或换编号时重新拉；load 的依赖已经覆盖了这些
  useEffect(() => {
    void load()
  }, [load])

  async function guard(fn: () => Promise<unknown>, okText: string) {
    if (!p.client || busy) return
    setBusy(true)
    try {
      await fn()
      p.onToast(okText)
      await load(true)
    } catch (err) {
      p.onToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function toggleState() {
    if (!issue || !p.client) return
    const closing = issue.state === 'open'
    await guard(
      () =>
        updateIssue(p.client!, p.owner, p.repo, p.number, {
          state: closing ? 'closed' : 'open',
          ...(closing ? { state_reason: 'completed' as const } : {}),
        }),
      closing ? '已关闭' : '已重新打开',
    )
  }

  async function openLabelPicker() {
    if (!p.client) return
    setPickingLabels((v) => !v)
    if (labels) return
    try {
      setLabels(await listLabels(p.client, p.owner, p.repo))
    } catch (err) {
      p.onToast((err as Error).message)
    }
  }

  async function toggleLabel(name: string) {
    if (!issue || !p.client) return
    const has = issue.labels.some((l) => l.name === name)
    // PUT labels 是整体替换，必须把没动过的也带上
    const next = has ? issue.labels.filter((l) => l.name !== name).map((l) => l.name) : [...issue.labels.map((l) => l.name), name]
    await guard(() => setIssueLabels(p.client!, p.owner, p.repo, p.number, next), has ? '已移除标签' : '已添加标签')
  }

  /**
   * 协作员列表拿不到时（没 push 权限会 403）退化成「只列当前指派人与自己」，
   * 至少还能把已指派的人取消掉。
   */
  async function openPeoplePicker() {
    if (!p.client) return
    setPickingPeople((v) => !v)
    if (people) return
    try {
      setPeople(await listCollaborators(p.client, p.owner, p.repo))
    } catch {
      setPeople(issue?.assignees ?? [])
      p.onToast('读不到协作员名单，只能看到当前指派的人')
    }
  }

  async function toggleAssignee(login: string) {
    if (!issue || !p.client) return
    const cur = (issue.assignees ?? []).map((u) => u.login)
    const next = cur.includes(login) ? cur.filter((x) => x !== login) : [...cur, login]
    await guard(() => setAssignees(p.client!, p.owner, p.repo, p.number, next), '指派已更新')
  }

  async function openMilestonePicker() {
    if (!p.client) return
    setPickingMilestone((v) => !v)
    if (milestones) return
    try {
      setMilestones(await listMilestones(p.client, p.owner, p.repo))
    } catch (err) {
      setMilestones([])
      p.onToast((err as Error).message)
    }
  }

  /**
   * 设置里程碑。
   *
   * 走 Issue 的 PATCH 而不是独立端点（GitHub 没有）；传 null 是移出。
   * 成功后重拉——`updated_at` 会变，本地改一个字段会让「最后更新」显示成旧的。
   */
  async function applyMilestone(number: number | null) {
    if (!p.client || !issue) return
    const cur = issue.milestone?.number ?? null
    const next = cur === number ? null : number
    await guard(
      () => setMilestone(p.client!, p.owner, p.repo, p.number, next),
      next === null ? '已移出里程碑' : '里程碑已更新',
    )
    setPickingMilestone(false)
  }

  /**
   * 锁定/解锁不走 `guard`。
   *
   * 这两个操作只改 `locked` 一个字段，但 GitHub 的写后读偶尔会拿到旧值，
   * 立刻重拉会出现「点了解锁又变回已锁定」。本地直接按请求结果置位更准，
   * 失败再回滚。
   */
  async function applyLock(next: boolean, reason?: 'off-topic' | 'too heated' | 'resolved' | 'spam') {
    if (!p.client || !issue || busy) return
    const before = issue.locked ?? false
    setBusy(true)
    setPickingLock(false)
    setIssue({ ...issue, locked: next })
    try {
      await setLocked(p.client, p.owner, p.repo, p.number, next, reason)
      p.onToast(next ? '已锁定对话' : '已解除锁定')
    } catch (err) {
      setIssue({ ...issue, locked: before })
      p.onToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function sendComment() {
    const body = draft.trim()
    if (!body || !p.client) return
    await guard(() => addComment(p.client!, p.owner, p.repo, p.number, body), '评论已发送')
    setDraft('')
  }

  const open = issue?.state === 'open'

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
        <PageState loading={loading && !issue} error={error} onRetry={() => void load()} />

        {issue && (
          <>
            <div className="detail-head">
              <div className="detail-title">{issue.title}</div>
              <div className="detail-meta">
                <span className={`pill ${open ? 'pill-open' : 'pill-closed'}`}>{open ? '开启中' : '已关闭'}</span>
                <span>
                  {issue.user?.login && p.onOpenUser ? (
                    <button className="user-link" onClick={() => p.onOpenUser?.(issue.user!.login)}>
                      {issue.user.login}
                    </button>
                  ) : (
                    (issue.user?.login ?? '未知')
                  )}{' '}
                  创建于 {shortDate(issue.created_at)}
                </span>
                {issue.locked && <span className="pill">已锁定</span>}
              </div>
              {(issue.labels?.length ?? 0) > 0 && (
                <div className="detail-labels">
                  {(issue.labels ?? []).map((l) => (
                    <span key={l.name} className="issue-label" style={{ background: `#${l.color}` }}>
                      {l.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="detail-body">
              {issue.body?.trim() ? (
                <>
                  <TransHead
                    label="正文"
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
                <div className="muted">（没有正文）</div>
              )}
            </div>

            <div className="btnrow">
              <button className="btn ghost" disabled={busy} onClick={() => void toggleState()}>
                <Icon name={open ? 'archive' : 'refresh'} size={14} />
                {open ? '关闭 Issue' : '重新打开'}
              </button>
              <button className="btn ghost" disabled={busy} onClick={() => void openLabelPicker()}>
                <Icon name="tag" size={14} />
                标签
              </button>
              <button className="btn ghost" disabled={busy} onClick={() => void openPeoplePicker()}>
                <Icon name="user" size={14} />
                指派
              </button>
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() => void openMilestonePicker()}
              >
                <Icon name="tag" size={14} />
                {issue.milestone ? '里程碑' : '加里程碑'}
              </button>
              <button className="btn ghost" disabled={busy} onClick={() => setPickingLock((v) => !v)}>
                <Icon name={issue.locked ? 'eye' : 'lock'} size={14} />
                {issue.locked ? '解锁' : '锁定'}
              </button>
            </div>

            {((issue.assignees?.length ?? 0) > 0 || issue.milestone) && (
              <div className="detail-pills">
                {issue.milestone && <span className="pill">{issue.milestone.title}</span>}
                {issue.assignees?.map((u) => (
                  <span key={u.login} className="pill">
                    @{u.login}
                  </span>
                ))}
              </div>
            )}

            {pickingMilestone && (
              <div className="labelpick">
                {milestones === null && <div className="muted">正在读取里程碑…</div>}
                {milestones?.length === 0 && (
                  <div className="muted">这个仓库还没有里程碑，去网页端建一个</div>
                )}
                <div className="chips" style={{ padding: '0' }}>
                  {milestones?.map((m) => {
                    const on = issue.milestone?.number === m.number
                    const due = dueInfo(m)
                    return (
                      <button
                        key={m.number}
                        className={`chip${on ? ' on' : ''}`}
                        disabled={busy}
                        onClick={() => void applyMilestone(m.number)}
                      >
                        {m.title}
                        <span className="chip-n">
                          {milestoneProgress(m)}%
                          {m.state === 'closed' ? ' 已关' : due.tone === 'over' ? ` ${due.text}` : ''}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div className="hint" style={{ marginTop: 6 }}>
                  再点一次当前里程碑即可移出；没有推送权限时 GitHub 会静默忽略。
                </div>
              </div>
            )}

            {pickingPeople && (
              <div className="labelpick">
                {people === null && <div className="muted">正在读取协作员…</div>}
                {people?.length === 0 && <div className="muted">这个仓库没有协作员可指派</div>}
                <div className="chips" style={{ padding: '0' }}>
                  {people?.map((u) => {
                    const on = (issue.assignees ?? []).some((a) => a.login === u.login)
                    return (
                      <button
                        key={u.login}
                        className={`chip${on ? ' on' : ''}`}
                        disabled={busy}
                        onClick={() => void toggleAssignee(u.login)}
                      >
                        @{u.login}
                      </button>
                    )
                  })}
                </div>
                <div className="hint" style={{ marginTop: 6 }}>
                  勾选结果是最终名单；没有推送权限时 GitHub 会静默忽略。
                </div>
              </div>
            )}

            {pickingLock && (
              <div className="labelpick">
                {issue.locked ? (
                  <button className="btn ghost block" disabled={busy} onClick={() => void applyLock(false)}>
                    解除锁定
                  </button>
                ) : (
                  <>
                    <div className="hint">选一个锁定原因（锁定后只有协作者能评论）：</div>
                    <div className="chips" style={{ padding: '6px 0 0' }}>
                      {(
                        [
                          ['resolved', '已解决'],
                          ['off-topic', '跑题'],
                          ['too heated', '过于激烈'],
                          ['spam', '垃圾信息'],
                        ] as const
                      ).map(([k, label]) => (
                        <button key={k} className="chip" disabled={busy} onClick={() => void applyLock(true, k)}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {pickingLabels && (
              <div className="labelpick">
                {labels === null && <div className="muted">正在读取仓库标签…</div>}
                {labels?.length === 0 && <div className="muted">这个仓库还没有定义标签</div>}
                <div className="chips" style={{ padding: '0' }}>
                  {labels?.map((l) => {
                    const on = issue.labels.some((x) => x.name === l.name)
                    return (
                      <button
                        key={l.name}
                        className={`chip${on ? ' on' : ''}`}
                        disabled={busy}
                        onClick={() => void toggleLabel(l.name)}
                      >
                        <span className="chip-dot" style={{ background: `#${l.color}` }} />
                        {l.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <TimelineList items={events} />

            <div className="section-title" style={{ padding: '4px 16px' }}>
              评论 {comments.length > 0 ? `· ${comments.length}${cpage.page > 1 ? '+' : ''}` : ''}
            </div>

            {cpage.page > 1 && (
              <button
                type="button"
                className="more-btn"
                disabled={olderBusy}
                onClick={() => void loadOlder()}
              >
                {olderBusy ? '加载中…' : `加载更早的评论（还有 ${cpage.page - 1} 页）`}
              </button>
            )}

            {comments.length > 0 && (
              <div style={{ padding: '0 16px' }}>
                <TransHead
                  view={view}
                  onToggle={() => setView((v) => (v === 'zh' ? 'src' : 'zh'))}
                  ready={!!transTalk.zh}
                  busy={transTalk.busy}
                  enabled={!!p.autoTranslate}
                  onTranslate={() => void transTalk.translate(flatComments)}
                  error={transTalk.error}
                />
              </div>
            )}

            {comments.map((c, ci) => (
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
                      blocks={commentShown(ci)}
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

            <div className="comment-form">
              <textarea
                className="textarea"
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="写条评论…（支持 Markdown）"
              />
              <div className="btnrow" style={{ marginTop: 8 }}>
                <button
                  className="btn primary"
                  disabled={busy || !draft.trim()}
                  onClick={() => void sendComment()}
                >
                  <Icon name="chat" size={14} />
                  发送
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}
