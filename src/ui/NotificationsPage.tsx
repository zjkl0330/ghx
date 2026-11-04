import { useCallback, useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import {
  canUseNotifications,
  groupByRepo,
  listNotifications,
  markAllRead,
  markThreadDone,
  markThreadRead,
  notificationsUnsupportedHint,
  reasonText,
  subjectMeta,
  subjectTarget,
  unreadCount,
  type NotificationThread,
} from '../lib/notifications'
import { relTime } from '../lib/format'
import { PageHeader, PageState } from './PageHeader'
import { Icon } from './icons'

/**
 * 通知收件箱。
 *
 * 用 ETag 条件请求：没新通知时服务端回 304，界面显示「没有新通知」而不是转圈。
 * fine-grained 令牌直接不给进，把原因写在空态里。
 */
export function NotificationsPage(p: {
  client: GitHubClient | null
  scopes: string[]
  tokenKind: 'classic' | 'fine-grained'
  onBack: () => void
  onOpen: (t: NotificationThread) => void
  onToast: (s: string) => void
  /** 未读数变化时回传给底栏角标 */
  onUnread: (n: number) => void
}) {
  const [items, setItems] = useState<NotificationThread[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notModified, setNotModified] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(true)
  const [busy, setBusy] = useState(false)

  const supported = canUseNotifications(p.scopes, p.tokenKind)

  const load = useCallback(
    async (silent = false) => {
      if (!p.client || !supported) {
        setLoading(false)
        return
      }
      if (!silent) setLoading(true)
      setError(null)
      try {
        const r = await listNotifications(p.client, { fresh: true, conditional: silent })
        setNotModified(r.notModified)
        if (!r.notModified) {
          setItems(r.items)
          p.onUnread(unreadCount(r.items))
        }
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    // onUnread 可能每次渲染都变，故意不入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.client, supported],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function act(fn: () => Promise<unknown>, ok: string) {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      p.onToast(ok)
      await load(true)
    } catch (err) {
      p.onToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const shown = unreadOnly ? items.filter((t) => t.unread) : items
  const groups = groupByRepo(shown)
  const unread = unreadCount(items)

  if (!supported) {
    return (
      <>
        <PageHeader title="通知" sub="当前令牌不支持" onBack={p.onBack} />
        <div className="page" style={{ marginTop: 0 }}>
          <div className="empty">
            <b>这个令牌用不了通知接口</b>
            {notificationsUnsupportedHint()}
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="通知"
        sub={unread > 0 ? `${unread} 条未读` : notModified ? '没有新通知' : '全部已读'}
        onBack={p.onBack}
        right={
          <button className="icon-btn" onClick={() => void load(true)} aria-label="刷新">
            <Icon name="refresh" size={17} />
          </button>
        }
        action={{
          label: '全标已读',
          icon: 'check',
          disabled: busy || unread === 0,
          onClick: () => void act(() => markAllRead(p.client!), '已全部标记为已读'),
        }}
      />

      <div className="page" style={{ marginTop: 0 }}>
        <div className="seg" style={{ margin: '8px 16px 0' }}>
          <button className={unreadOnly ? 'on' : ''} onClick={() => setUnreadOnly(true)}>
            未读 {unread > 0 ? `· ${unread}` : ''}
          </button>
          <button className={!unreadOnly ? 'on' : ''} onClick={() => setUnreadOnly(false)}>
            全部
          </button>
        </div>

        <PageState
          loading={loading && items.length === 0}
          error={error}
          onRetry={() => void load()}
          empty={shown.length === 0 ? (unreadOnly ? '没有未读通知' : '收件箱是空的') : undefined}
        />

        {groups.map((g) => (
          <div key={g.repo} className="notif-group">
            <div className="list-head">
              <span className="mono ellipsis">{g.repo}</span>
              <span className="muted">{g.threads.length}</span>
            </div>
            {g.threads.map((t) => {
              const meta = subjectMeta(t.subject.type)
              return (
                <div className={`row notif-row${t.unread ? ' unread' : ''}`} key={t.id}>
                  <span className="file-ic">
                    <Icon name={meta.icon} size={16} />
                  </span>
                  <div
                    className="row-main"
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (t.unread) void act(() => markThreadRead(p.client!, t.id), '已标记已读')
                      p.onOpen(t)
                    }}
                  >
                    <span className="row-l1">
                      <span className="row-name ellipsis">{t.subject.title}</span>
                    </span>
                    <span className="row-meta">
                      {meta.label} · {reasonText(t.reason)} · {relTime(t.updated_at)}
                    </span>
                  </div>
                  <button
                    className="icon-btn"
                    aria-label="标记完成"
                    disabled={busy}
                    onClick={() => void act(() => markThreadDone(p.client!, t.id), '已移出收件箱')}
                  >
                    <Icon name="check" size={16} />
                  </button>
                </div>
              )
            })}
          </div>
        ))}

        <div className="hint" style={{ padding: '4px 16px 24px' }}>
          标记完成（✓）会让这条通知不再出现在收件箱里，等同于网页上的 Done。
          点标题会跳到对应的 Issue / PR。
        </div>
      </div>
    </>
  )
}

/** 通知目标 → 该压哪条路由。App 里直接用，避免两边各写一份判断 */
export function targetRoute(t: NotificationThread) {
  const target = subjectTarget(t)
  if (!target) return null
  if (target.kind === 'issue' && target.number) {
    return { kind: 'issue' as const, owner: target.owner, repo: target.repo, number: target.number }
  }
  if (target.kind === 'pull' && target.number) {
    return { kind: 'pull' as const, owner: target.owner, repo: target.repo, number: target.number }
  }
  return { kind: 'repo' as const, owner: target.owner, repo: target.repo, tab: 'code' as const }
}
