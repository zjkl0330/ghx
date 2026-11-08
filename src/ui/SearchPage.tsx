import { useState } from 'react'
import type { GitHubClient } from '../lib/api'
import {
  SEARCH_KINDS,
  emptyQueryHint,
  normalizeUserTerm,
  searchCode,
  searchCommits,
  searchIssues,
  searchQuotaHint,
  searchUsers,
  splitFullName,
  type SearchKind,
} from '../lib/search-ext'
import { relTime } from '../lib/format'
import { compactNumber } from '../lib/format'
import { PageState } from './PageHeader'
import { PageHeader } from './PageHeader'
import { Icon } from './icons'

type Row =
  | { kind: 'repo'; full: string; title: string; sub: string; stars?: number }
  | { kind: 'code'; full: string; path: string; title: string }
  | { kind: 'issue'; full: string; number: number; title: string; sub: string }
  | { kind: 'user'; login: string; title: string; sub: string; avatar?: string; badge?: string }

/**
 * 全局搜索：仓库 / 代码 / Issue / PR / 用户 / 提交。
 *
 * 不做输入即搜 —— 代码搜索 10 次/分钟的配额经不起边打边搜。
 * 必须点「搜索」或回车才发请求。
 */
export function SearchPage(p: {
  client: GitHubClient | null
  onBack: () => void
  onOpenRepo: (full: string) => void
  onOpenUser: (login: string) => void
  onOpenIssue: (owner: string, repo: string, n: number) => void
  onToast: (s: string) => void
}) {
  const [kind, setKind] = useState<SearchKind>('repos')
  const [term, setTerm] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [incomplete, setIncomplete] = useState(false)
  /** 头像取不到就退回首字母，避免列表里出现一排破图 */
  const [failedAvatars, setFailedAvatars] = useState<Record<string, boolean>>({})

  async function run(k: SearchKind = kind, t: string = term) {
    if (!p.client) return
    // 用户搜索去掉前导 @，否则「@zjkl0330」搜不到人
    const term2 = k === 'users' ? normalizeUserTerm(t) : t
    const hint = emptyQueryHint(k, term2)
    if (hint) {
      p.onToast(hint)
      return
    }
    setLoading(true)
    setError(null)
    setRows(null)
    try {
      if (k === 'repos') {
        const r = await p.client.searchRepos(t, { perPage: 30, fresh: true })
        setTotal(r.total)
        setIncomplete(false)
        setRows(
          r.data.map((repo) => ({
            kind: 'repo' as const,
            full: repo.full_name,
            title: repo.full_name,
            sub: repo.description ?? '没有简介',
            stars: repo.stargazers_count,
          })),
        )
      } else if (k === 'code') {
        const r = await searchCode(p.client, t, { fresh: true })
        setTotal(r.total)
        setIncomplete(r.incomplete)
        setRows(
          r.items.map((h) => ({
            kind: 'code' as const,
            full: h.repository?.full_name ?? '',
            path: h.path,
            title: h.path,
          })),
        )
      } else if (k === 'issues' || k === 'pulls') {
        const r = await searchIssues(p.client, t, k, { fresh: true })
        setTotal(r.total)
        setIncomplete(r.incomplete)
        setRows(
          r.items.map((i) => {
            const full = i.html_url ? i.html_url.split('/issues/')[0].replace('https://github.com/', '') : ''
            return {
              kind: 'issue' as const,
              full,
              number: i.number,
              title: i.title,
              sub: `${i.state === 'open' ? '开启' : '关闭'} · ${i.user?.login ?? ''} · ${relTime(i.updated_at)}`,
            }
          }),
        )
      } else if (k === 'users') {
        const r = await searchUsers(p.client, t, { fresh: true })
        setTotal(r.total)
        setIncomplete(r.incomplete)
        setRows(
          r.items.map((u) => ({
            kind: 'user' as const,
            login: u.login,
            title: u.login,
            // 搜索接口只给 type，没有昵称与粉丝数；别在这里编一个「暂无」出来
            sub: u.type === 'Organization' ? '组织' : '用户',
            avatar: u.avatar_url,
            badge: u.type === 'Organization' ? '组织' : undefined,
          })),
        )
      } else {
        const r = await searchCommits(p.client, t, { fresh: true })
        setTotal(r.total)
        setIncomplete(r.incomplete)
        setRows(
          r.items.map((c) => ({
            kind: 'code' as const,
            full: c.repository?.full_name ?? '',
            path: c.sha.slice(0, 7),
            title: c.commit.message.split('\n')[0],
          })),
        )
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function openRow(r: Row) {
    if (r.kind === 'user') {
      p.onOpenUser(r.login)
      return
    }
    const parts = splitFullName(r.full)
    if (!parts) {
      p.onToast('这条结果没有仓库信息')
      return
    }
    if (r.kind === 'issue') {
      p.onOpenIssue(parts.owner, parts.repo, r.number)
      return
    }
    p.onOpenRepo(r.full)
  }

  const quota = searchQuotaHint(kind)

  return (
    <>
      <PageHeader title="搜索" sub="GitHub 全区" onBack={p.onBack} />

      <div className="page" style={{ marginTop: 0 }}>
        <div className="search" style={{ margin: '4px 16px 0' }}>
          <Icon name="search" size={15} />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run()
            }}
            placeholder="关键词，回车搜索"
            autoFocus
          />
          <button className="btn ghost tiny" disabled={loading} onClick={() => void run()}>
            搜索
          </button>
        </div>

        <div className="chips">
          {SEARCH_KINDS.map((k) => (
            <button
              key={k.key}
              className={`chip${kind === k.key ? ' on' : ''}`}
              onClick={() => {
                setKind(k.key)
                if (term.trim()) void run(k.key)
              }}
            >
              {k.label}
            </button>
          ))}
        </div>

        {quota && <div className="hint" style={{ padding: '0 16px 4px' }}>{quota}</div>}

        {rows !== null && (
          <div className="list-head">
            <span>
              {incomplete ? '约 ' : ''}
              {compactNumber(total)} 个结果{rows.length < total ? ` · 显示前 ${rows.length} 个` : ''}
            </span>
          </div>
        )}

        <PageState loading={loading} error={error} onRetry={() => void run()} />

        <div className="rows">
          {(rows ?? []).map((r, i) => (
            <div
              key={`${r.kind}-${i}`}
              role="button"
              tabIndex={0}
              className="row"
              onClick={() => openRow(r)}
            >
              {r.kind === 'user' ? (
                <span className="avatar" style={{ width: 28, height: 28 }}>
                  {r.avatar && !failedAvatars[r.login] ? (
                    <img
                      className="avatar-img"
                      src={r.avatar}
                      alt={r.login}
                      onError={() => setFailedAvatars((cur) => ({ ...cur, [r.login]: true }))}
                    />
                  ) : (
                    r.login.slice(0, 1).toUpperCase()
                  )}
                </span>
              ) : (
                <span className="file-ic">
                  <Icon name={r.kind === 'repo' ? 'repo' : r.kind === 'code' ? 'file' : 'issue'} size={16} />
                </span>
              )}
              <span className="row-main">
                <span className="row-l1">
                  <span className="row-name ellipsis">{r.title}</span>
                  {r.kind === 'user' && r.badge && <span className="badge">{r.badge}</span>}
                </span>
                <span className="row-meta ellipsis">
                  {r.kind === 'repo' ? r.sub : r.kind === 'code' ? r.full : r.kind === 'issue' ? `${r.full} #${r.number} · ${r.sub}` : r.sub}
                </span>
              </span>
              {r.kind === 'repo' && r.stars !== undefined && (
                <span className="row-meta">{compactNumber(r.stars)} 星</span>
              )}
              {r.kind === 'user' && <Icon name="chevron" size={13} className="linkrow-arrow" />}
            </div>
          ))}
        </div>

        {rows !== null && rows.length === 0 && !loading && (
          <div className="empty">没有结果。换个关键词，或去掉限定条件。</div>
        )}

        <div className="hint" style={{ padding: '12px 16px 24px' }}>
          代码搜索只搜默认分支，这是 GitHub 的限制。Issue 与 PR 分开搜，因为搜索接口会把两类混在一起。
        </div>
      </div>
    </>
  )
}
