import { useCallback, useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import {
  addComment,
  getIssue,
  listComments,
  listLabels,
  setAssignees,
  setIssueLabels,
  setLocked,
  updateIssue,
  type Issue,
  type IssueComment,
  type IssueLabel,
  type IssueUser,
} from '../lib/issues'
import { listCollaborators } from '../lib/repo-admin'
import { parseMarkdown } from '../lib/markdown'
import { relTime, shortDate } from '../lib/format'
import { PageHeader, PageState } from './PageHeader'
import { MarkdownView } from './MarkdownView'
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
}) {
  const [issue, setIssue] = useState<Issue | null>(null)
  const [comments, setComments] = useState<IssueComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [labels, setLabels] = useState<IssueLabel[] | null>(null)
  const [pickingLabels, setPickingLabels] = useState(false)
  const [people, setPeople] = useState<IssueUser[] | null>(null)
  const [pickingPeople, setPickingPeople] = useState(false)
  const [pickingLock, setPickingLock] = useState(false)

  const load = useCallback(
    async (silent = false) => {
      if (!p.client) {
        setLoading(false)
        return
      }
      if (!silent) setLoading(true)
      setError(null)
      try {
        const [it, cs] = await Promise.all([
          getIssue(p.client, p.owner, p.repo, p.number, silent),
          listComments(p.client, p.owner, p.repo, p.number, silent),
        ])
        setIssue(it)
        setComments(cs)
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
                  {issue.user?.login ?? '未知'} 创建于 {shortDate(issue.created_at)}
                </span>
                {issue.locked && <span className="pill">已锁定</span>}
              </div>
              {issue.labels.length > 0 && (
                <div className="detail-labels">
                  {issue.labels.map((l) => (
                    <span key={l.name} className="issue-label" style={{ background: `#${l.color}` }}>
                      {l.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="detail-body">
              {issue.body?.trim() ? (
                <MarkdownView blocks={parseMarkdown(issue.body, { maxBlocks: 300 })} />
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
              <button className="btn ghost" disabled={busy} onClick={() => setPickingLock((v) => !v)}>
                <Icon name={issue.locked ? 'eye' : 'lock'} size={14} />
                {issue.locked ? '解锁' : '锁定'}
              </button>
            </div>

            {(issue.assignees?.length ?? 0) > 0 && (
              <div className="detail-labels">
                {issue.assignees?.map((u) => (
                  <span key={u.login} className="pill">
                    @{u.login}
                  </span>
                ))}
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

            <div className="section-title" style={{ padding: '4px 16px' }}>
              评论 {comments.length > 0 ? `· ${comments.length}` : ''}
            </div>

            {comments.map((c) => (
              <div className="comment" key={c.id}>
                <div className="comment-head">
                  <b>{c.user?.login ?? '未知'}</b>
                  <span>{relTime(c.created_at)}</span>
                </div>
                <div className="comment-body">
                  {c.body?.trim() ? (
                    <MarkdownView blocks={parseMarkdown(c.body, { maxBlocks: 200 })} />
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
