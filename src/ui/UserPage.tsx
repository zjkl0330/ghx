import { useCallback, useEffect, useMemo, useState } from 'react'
import { GitHubError, type GitHubClient } from '../lib/api'
import { getUser, isFollowing, setFollowing, userRepos, type UserProfile } from '../lib/repo-admin'
import { compactNumber, relTime } from '../lib/format'
import type { Repo } from '../lib/types'
import {
  USER_REPO_SORTS,
  displayName,
  forkCount,
  userFacts,
  userKindLabel,
  userRepoSummary,
  visibleUserRepos,
  type FollowKind,
  type UserRepoSort,
} from '../lib/users'
import { repoPageUrl } from '../lib/mirrors'
import { openExternal } from '../lib/update'
import { PageHeader, PageState } from './PageHeader'
import { Icon } from './icons'
import { UserListSheet } from './UserListSheet'

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
  C: '#555555',
  'C#': '#178600',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Vue: '#41b883',
  Svelte: '#ff3e00',
}

const REPO_PAGE = 30

/**
 * 用户主页：资料 + 仓库 + 关注关系。
 *
 * 这一版是重写的。旧版把 <img> 塞进 .avatar 容器里，图片没有尺寸约束，
 * 460px 的原图把整页横向撑爆：统计卡片飘到头像上、仓库列表被推出屏幕，
 * 看起来就是「个人主页打不开」。现在头像和仓库列表都按列表页那套结构来，
 * 布局不再依赖图片原始尺寸。
 */
export function UserPage(p: {
  client: GitHubClient | null
  login: string
  selfLogin: string | null
  mirror: string
  onBack: () => void
  onOpenRepo: (full: string) => void
  onOpenUser: (login: string) => void
  onToast: (s: string) => void
}) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [repos, setRepos] = useState<Repo[]>([])
  const [page, setPage] = useState(1)
  const [moreBusy, setMoreBusy] = useState(false)
  const [following, setFollowingState] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [sort, setSort] = useState<UserRepoSort>('pushed')
  const [sourceOnly, setSourceOnly] = useState(false)
  const [followSheet, setFollowSheet] = useState<FollowKind | null>(null)

  const isSelf = !!p.selfLogin && p.selfLogin.toLowerCase() === p.login.toLowerCase()

  const load = useCallback(
    async (fresh = false) => {
      if (!p.client) {
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const [u, rs] = await Promise.all([
          getUser(p.client, p.login, fresh),
          userRepos(p.client, p.login, { perPage: REPO_PAGE, fresh }),
        ])
        setUser(u)
        setRepos(rs)
        setPage(1)
        // 关注关系单独失败不该把整页判成错误
        if (!isSelf) setFollowingState(await isFollowing(p.client, p.login).catch(() => null))
      } catch (err) {
        const status = err instanceof GitHubError ? err.status : 0
        setError(status === 404 ? `没找到 @${p.login}，可能改名或注销了` : (err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [p.client, p.login, isSelf],
  )

  useEffect(() => {
    void load()
  }, [load])

  const shown = useMemo(() => visibleUserRepos(repos, { sort, sourceOnly }), [repos, sort, sourceOnly])
  const forks = useMemo(() => forkCount(repos), [repos])

  async function loadMore() {
    if (!p.client || moreBusy) return
    setMoreBusy(true)
    try {
      const next = page + 1
      const list = await userRepos(p.client, p.login, { page: next, perPage: REPO_PAGE })
      setRepos((cur) => {
        const seen = new Set(cur.map((r) => r.full_name))
        return [...cur, ...list.filter((r) => !seen.has(r.full_name))]
      })
      setPage(next)
    } catch (err) {
      p.onToast((err as Error).message)
    } finally {
      setMoreBusy(false)
    }
  }

  async function toggleFollow() {
    if (!p.client || busy || following === null) return
    setBusy(true)
    const next = !following
    try {
      await setFollowing(p.client, p.login, next)
      setFollowingState(next)
      setUser((cur) => (cur ? { ...cur, followers: Math.max(0, cur.followers + (next ? 1 : -1)) } : cur))
      p.onToast(next ? `已关注 ${p.login}` : `已取消关注 ${p.login}`)
    } catch (err) {
      p.onToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function openHomepage() {
    // 镜像能翻页就走镜像，否则退回自建站 —— 和仓库页同一套规则
    void openExternal(repoPageUrl(p.mirror, p.login))
  }

  const facts = user ? userFacts(user) : []
  const hasMore = repos.length > 0 && repos.length % REPO_PAGE === 0

  return (
    <>
      <PageHeader
        title={`@${p.login}`}
        sub={user ? userKindLabel(user.type) : '正在读取资料'}
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
            <div className="uhead">
              <div className="avatar avatar-lg">
                {user.avatar_url && !avatarFailed ? (
                  <img
                    className="avatar-img"
                    src={user.avatar_url}
                    alt={user.login}
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  user.login.slice(0, 1).toUpperCase()
                )}
              </div>
              <div className="uhead-main">
                <div className="uhead-name">
                  <span className="ellipsis">{displayName(user)}</span>
                  {/* 「个人」不必标，顶栏副标题已经写了；组织与机器人要标出来 */}
                  {user.type && user.type !== 'User' && (
                    <span className={`badge${user.type === 'Organization' ? ' org' : ''}`}>
                      {userKindLabel(user.type)}
                    </span>
                  )}
                </div>
                <div className="uhead-login ellipsis">@{user.login}</div>
              </div>
              <button className="icon-btn" onClick={openHomepage} aria-label="在浏览器打开主页">
                <Icon name="external" size={16} />
              </button>
            </div>

            {user.bio && <div className="ubio">{user.bio}</div>}

            <div className="ustats">
              <button type="button" className="ustat" onClick={() => setFollowSheet('followers')}>
                <b>{compactNumber(user.followers)}</b>
                <span>关注者</span>
              </button>
              <button type="button" className="ustat" onClick={() => setFollowSheet('following')}>
                <b>{compactNumber(user.following)}</b>
                <span>正在关注</span>
              </button>
              <div className="ustat">
                <b>{compactNumber(user.public_repos)}</b>
                <span>公开仓库</span>
              </div>
            </div>

            {facts.length > 0 && (
              <div className="ufacts">
                {facts.map((f) =>
                  f.href ? (
                    <button
                      key={f.key}
                      type="button"
                      className="ufact asbtn"
                      onClick={() => void openExternal(f.href as string)}
                    >
                      <span className="ufact-k">{f.label}</span>
                      <span className="ufact-v ellipsis">{f.text}</span>
                      <Icon name="external" size={12} />
                    </button>
                  ) : (
                    <div key={f.key} className="ufact">
                      <span className="ufact-k">{f.label}</span>
                      <span className="ufact-v ellipsis">{f.text}</span>
                    </div>
                  ),
                )}
              </div>
            )}

            <div className="btnrow">
              {!isSelf && following !== null && (
                <button
                  className={`btn ${following ? 'ghost' : 'primary'}`}
                  disabled={busy}
                  onClick={() => void toggleFollow()}
                >
                  <Icon name={following ? 'check' : 'plus'} size={14} />
                  {following ? '已关注' : '关注'}
                </button>
              )}
              <button className="btn ghost" onClick={openHomepage}>
                <Icon name="external" size={14} />
                打开主页
              </button>
            </div>

            <div className="usec">
              <div className="usec-head">
                <span className="section-title" style={{ margin: 0 }}>
                  仓库 · {shown.length}
                </span>
                <span className="hint" style={{ margin: 0 }}>
                  {userRepoSummary(repos)}
                </span>
              </div>

              <div className="chips usec-chips">
                {USER_REPO_SORTS.map((s) => (
                  <button
                    key={s.key}
                    className={`chip${sort === s.key ? ' on' : ''}`}
                    onClick={() => setSort(s.key)}
                  >
                    {s.label}
                  </button>
                ))}
                {forks > 0 && (
                  <button
                    className={`chip${sourceOnly ? ' on' : ''}`}
                    onClick={() => setSourceOnly((v) => !v)}
                  >
                    只看源仓库
                  </button>
                )}
              </div>
            </div>

            <div className="rows">
              {shown.length === 0 && (
                <div className="empty">
                  {repos.length === 0
                    ? '这个账号没有公开仓库'
                    : '当前筛选下没有仓库，换排序或关掉「只看源仓库」'}
                </div>
              )}
              {shown.map((r) => (
                <div
                  key={r.full_name}
                  role="button"
                  tabIndex={0}
                  className="row"
                  onClick={() => p.onOpenRepo(r.full_name)}
                >
                  <span className="row-ic">
                    <Icon name="repo" size={15} />
                  </span>
                  <span className="row-main">
                    <span className="row-l1">
                      <span className="row-name">{r.name}</span>
                      {r.fork && <span className="badge">fork</span>}
                      {r.private && <span className="badge">私有</span>}
                      {r.archived && <span className="badge archived">已归档</span>}
                    </span>
                    {r.description && <span className="row-desc">{r.description}</span>}
                    <span className="row-meta">
                      {r.language && (
                        <span>
                          <span
                            className="dot"
                            style={{ background: LANG_COLOR[r.language] ?? '#8b949e' }}
                          />
                          {r.language}
                        </span>
                      )}
                      <span>★ {compactNumber(r.stargazers_count)}</span>
                      <span>⑂ {compactNumber(r.forks_count)}</span>
                      <span>{relTime(r.pushed_at)}</span>
                    </span>
                  </span>
                  <Icon name="chevron" size={13} className="linkrow-arrow" />
                </div>
              ))}
            </div>

            {hasMore && (
              <button
                className="btn ghost"
                style={{ margin: '12px 16px 8px', width: 'calc(100% - 32px)' }}
                disabled={moreBusy}
                onClick={() => void loadMore()}
              >
                {moreBusy ? '正在加载…' : '加载更多仓库'}
              </button>
            )}

            <div className="hint" style={{ padding: '8px 16px 28px' }}>
              每页 30 个仓库，按 GitHub 的默认口径只列这个账号名下的（含 fork）。
              {isSelf ? '私有仓库只有你自己看得到。' : ''}
            </div>
          </>
        )}
      </div>

      {followSheet && user && (
        <UserListSheet
          client={p.client}
          login={user.login}
          kind={followSheet}
          onClose={() => setFollowSheet(null)}
          onPick={(login) => {
            setFollowSheet(null)
            p.onOpenUser(login)
          }}
        />
      )}
    </>
  )
}
