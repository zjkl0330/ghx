import { useCallback, useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import { userFollowers } from '../lib/repo-admin'
import type { IssueUser } from '../lib/issues'
import { FOLLOW_PAGE_SIZE, hasMoreFollowers, type FollowKind } from '../lib/users'
import { Icon } from './icons'

/**
 * 关注者 / 正在关注 列表。
 *
 * 这个接口只回 login + avatar_url，没有昵称和粉丝数 —— 所以这里不显示副标题，
 * 只给「点进去看完整资料」。硬凑一行「—」比留白更让人以为加载失败。
 */
export function UserListSheet(p: {
  client: GitHubClient | null
  login: string
  kind: FollowKind
  onClose: () => void
  onPick: (login: string) => void
}) {
  const [items, setItems] = useState<IssueUser[]>([])
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [moreBusy, setMoreBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failedAvatars, setFailedAvatars] = useState<Record<string, boolean>>({})

  const title = p.kind === 'followers' ? '关注者' : '正在关注'

  const load = useCallback(
    async (next: number) => {
      if (!p.client) {
        setLoading(false)
        return
      }
      if (next === 1) {
        setLoading(true)
        setError(null)
      } else {
        setMoreBusy(true)
      }
      try {
        const list = await userFollowers(p.client, p.login, p.kind, { page: next, perPage: FOLLOW_PAGE_SIZE })
        setItems((cur) => {
          if (next === 1) return list
          const seen = new Set(cur.map((u) => u.login.toLowerCase()))
          return [...cur, ...list.filter((u) => !seen.has(u.login.toLowerCase()))]
        })
        setPage(next)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
        setMoreBusy(false)
      }
    },
    [p.client, p.login, p.kind],
  )

  useEffect(() => {
    void load(1)
  }, [load])

  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet sheet-tall" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            <h3>{title}</h3>
            <div className="sheet-sub">
              @{p.login}
              {items.length > 0 ? ` · 已载入 ${items.length} 人` : ''}
            </div>
          </div>
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="rows" style={{ marginTop: 6 }}>
          {loading && (
            <div className="empty">
              <span className="spin" /> 正在读取
            </div>
          )}
          {error && (
            <div className="empty">
              {error}
              <button className="btn ghost tiny" style={{ marginLeft: 8 }} onClick={() => void load(1)}>
                重试
              </button>
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <div className="empty">
              {p.kind === 'followers' ? '还没有人关注这个账号' : '这个账号还没有关注任何人'}
            </div>
          )}
          {items.map((u) => (
            <div
              key={u.login}
              role="button"
              tabIndex={0}
              className="row"
              onClick={() => p.onPick(u.login)}
            >
              <span className="avatar avatar-sm" style={{ marginTop: 0 }}>
                {u.avatar_url && !failedAvatars[u.login] ? (
                  <img
                    className="avatar-img"
                    src={u.avatar_url}
                    alt={u.login}
                    onError={() => setFailedAvatars((cur) => ({ ...cur, [u.login]: true }))}
                  />
                ) : (
                  u.login.slice(0, 1).toUpperCase()
                )}
              </span>
              <span className="row-main">
                <span className="row-l1">
                  <span className="row-name ellipsis">{u.login}</span>
                </span>
              </span>
              <Icon name="chevron" size={13} className="linkrow-arrow" />
            </div>
          ))}
        </div>

        {hasMoreFollowers(items.length) && (
          <button
            className="btn ghost"
            style={{ marginTop: 12, width: '100%' }}
            disabled={moreBusy}
            onClick={() => void load(page + 1)}
          >
            {moreBusy ? '正在加载…' : '加载更多'}
          </button>
        )}
      </div>
    </div>
  )
}
