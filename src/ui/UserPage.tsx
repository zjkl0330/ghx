import { useCallback, useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import { getUser, isFollowing, setFollowing, userRepos, type UserProfile } from '../lib/repo-admin'
import { compactNumber, relTime } from '../lib/format'
import type { Repo } from '../lib/types'
import { PageHeader, PageState } from './PageHeader'
import { Icon } from './icons'

/**
 * 用户主页：资料 + 仓库 + 关注/取关。
 * 看自己的主页时没有关注按钮（GitHub 也不允许关注自己）。
 */
export function UserPage(p: {
  client: GitHubClient | null
  login: string
  selfLogin: string | null
  onBack: () => void
  onOpenRepo: (full: string) => void
  onToast: (s: string) => void
}) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [repos, setRepos] = useState<Repo[]>([])
  const [following, setFollowingState] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isSelf = !!p.selfLogin && p.selfLogin.toLowerCase() === p.login.toLowerCase()

  const load = useCallback(
    async (silent = false) => {
      if (!p.client) {
        setLoading(false)
        return
      }
      if (!silent) setLoading(true)
      setError(null)
      try {
        const [u, rs] = await Promise.all([
          getUser(p.client, p.login, silent),
          userRepos(p.client, p.login, { perPage: 30, fresh: silent }),
        ])
        setUser(u)
        setRepos(rs)
        if (!isSelf) setFollowingState(await isFollowing(p.client, p.login))
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [p.client, p.login, isSelf],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function toggleFollow() {
    if (!p.client || busy || following === null) return
    setBusy(true)
    const next = !following
    try {
      await setFollowing(p.client, p.login, next)
      setFollowingState(next)
      p.onToast(next ? `已关注 ${p.login}` : `已取消关注 ${p.login}`)
    } catch (err) {
      p.onToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title={`@${p.login}`}
        sub={user ? (user.name ?? '没有填名字') : '正在读取资料'}
        onBack={p.onBack}
        right={
          <button className="icon-btn" onClick={() => void load(true)} aria-label="刷新">
            <Icon name="refresh" size={17} />
          </button>
        }
      />

      <div className="page" style={{ marginTop: 0 }}>
        <PageState loading={loading && !user} error={error} onRetry={() => void load()} />

        {user && (
          <>
            <div className="userhead">
              <div className="avatar avatar-lg">
                {user.avatar_url ? (
                  <img className="avatar-img" src={user.avatar_url} alt={user.login} />
                ) : (
                  <span>{user.login.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div className="profile-stats" style={{ marginTop: 0 }}>
                <div>
                  <b>{compactNumber(user.public_repos)}</b>
                  <span>仓库</span>
                </div>
                <div>
                  <b>{compactNumber(user.followers)}</b>
                  <span>关注者</span>
                </div>
                <div>
                  <b>{compactNumber(user.following)}</b>
                  <span>正在关注</span>
                </div>
              </div>
            </div>

            {user.bio && <div className="detail-body" style={{ paddingTop: 0 }}>{user.bio}</div>}

            <div className="userfacts">
              {user.company && <span>🏢 {user.company}</span>}
              {user.location && <span>📍 {user.location}</span>}
              {user.blog && <span>🔗 {user.blog}</span>}
              <span>加入于 {relTime(user.created_at)}</span>
            </div>

            {!isSelf && following !== null && (
              <div className="btnrow" style={{ marginTop: 4 }}>
                <button className={`btn ${following ? 'ghost' : 'primary'}`} disabled={busy} onClick={() => void toggleFollow()}>
                  <Icon name={following ? 'check' : 'plus'} size={14} />
                  {following ? '已关注' : '关注'}
                </button>
              </div>
            )}

            <div className="section-title">仓库 · {repos.length}</div>
            <div className="rows">
              {repos.length === 0 && <div className="empty">这个人没有公开仓库</div>}
              {repos.map((r) => (
                <div
                  key={r.full_name}
                  role="button"
                  tabIndex={0}
                  className="row"
                  onClick={() => p.onOpenRepo(r.full_name)}
                >
                  <span className="file-ic">
                    <Icon name="repo" size={16} />
                  </span>
                  <span className="row-main">
                    <span className="row-l1">
                      <span className="row-name ellipsis">{r.name}</span>
                      {r.private && <span className="pill">私有</span>}
                    </span>
                    <span className="row-meta">
                      {r.description ?? '没有简介'} · {compactNumber(r.stargazers_count)} 星 · {relTime(r.pushed_at)}
                    </span>
                  </span>
                  <Icon name="chevron" size={13} className="linkrow-arrow" />
                </div>
              ))}
            </div>
            <div className="hint" style={{ padding: '0 16px 24px' }}>
              只列最近推送的 30 个仓库。私有仓库只有你自己看得到。
            </div>
          </>
        )}
      </div>
    </>
  )
}
