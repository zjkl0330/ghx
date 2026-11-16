import { useCallback, useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import {
  commitTitle,
  getCommit,
  listCommitsPage,
  mergeCommits,
  type CommitDetail,
  type CommitItem,
} from '../lib/code'
import type { PullFile } from '../lib/pulls'
import { relTime, shortDate } from '../lib/format'
import { DiffView } from './DiffView'
import { PageHeader, PageState } from './PageHeader'
import { Icon } from './icons'

/** 提交历史。带 path 时就是「这个文件的历史」 */
export function CommitsPage(p: {
  client: GitHubClient | null
  owner: string
  repo: string
  path?: string
  ref?: string
  onBack: () => void
  onOpenCommit: (sha: string) => void
}) {
  const [list, setList] = useState<CommitItem[]>([])
  /** 下一页页码；null 表示已经到底 */
  const [next, setNext] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (!p.client) {
        setLoading(false)
        return
      }
      if (!silent) setLoading(true)
      setError(null)
      setMoreError(null)
      try {
        // 刷新一律回到第 1 页：用户点刷新是想要「最新的」，不是想接着往下翻
        const res = await listCommitsPage(p.client, p.owner, p.repo, {
          path: p.path,
          ref: p.ref,
          fresh: silent,
        })
        setList(res.items)
        setNext(res.next)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [p.client, p.owner, p.repo, p.path, p.ref],
  )

  const loadMore = useCallback(async () => {
    if (!p.client || next === null || more) return
    setMore(true)
    setMoreError(null)
    try {
      const res = await listCommitsPage(p.client, p.owner, p.repo, {
        path: p.path,
        ref: p.ref,
        page: next,
      })
      setList((prev) => mergeCommits(prev, res.items))
      setNext(res.next)
    } catch (err) {
      setMoreError((err as Error).message)
    } finally {
      setMore(false)
    }
  }, [p.client, p.owner, p.repo, p.path, p.ref, next, more])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="page">
      <PageHeader
        title={p.path ? '文件历史' : '提交历史'}
        sub={p.path ? `${p.owner}/${p.repo} · ${p.path}` : `${p.owner}/${p.repo}`}
        onBack={p.onBack}
        right={
          <button className="icon-btn" onClick={() => void load(true)} aria-label="刷新">
            <Icon name="refresh" size={16} />
          </button>
        }
      />

      <PageState
        loading={loading && list.length === 0}
        error={error}
        onRetry={() => void load()}
        empty={!loading && list.length === 0 ? '这个分支还没有提交记录' : undefined}
        loadingText="正在读取提交…"
      />

      <div className="clist">
        {list.map((c) => {
          const title = commitTitle(c.commit.message)
          const who = c.author?.login ?? c.commit.author?.name ?? '未知'
          const when = c.commit.author?.date
          return (
            <button className="commit-item" key={c.sha} onClick={() => p.onOpenCommit(c.sha)}>
              <span className="commit-line1">
                <span className="commit-title ellipsis">{title}</span>
                <code className="mono">{c.sha.slice(0, 7)}</code>
              </span>
              <span className="commit-line2">
                {who}
                {when && <span> · {shortDate(when)}（{relTime(when)}）</span>}
              </span>
            </button>
          )
        })}
      </div>

      {list.length > 0 && (
        <div className="more-wrap">
          {moreError && (
            <div className="warnbox" style={{ marginBottom: 10 }}>
              <Icon name="warn" size={14} />
              <span>翻页失败：{moreError}</span>
              <button className="warn-retry" onClick={() => void loadMore()}>
                重试
              </button>
            </div>
          )}
          {next !== null ? (
            <button className="btn ghost block" onClick={() => void loadMore()} disabled={more}>
              {more ? <span className="spin" style={{ width: 12, height: 12 }} /> : <Icon name="chevron" size={14} />}
              {more ? '正在加载…' : `加载更早的提交（已有 ${list.length} 条）`}
            </button>
          ) : (
            <div className="hint" style={{ textAlign: 'center' }}>
              已到最早一条，共 {list.length} 条
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 单次提交：提交信息 + 改动文件 + diff */
export function CommitPage(p: {
  client: GitHubClient | null
  owner: string
  repo: string
  sha: string
  onBack: () => void
}) {
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!p.client) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setDetail(await getCommit(p.client, p.owner, p.repo, p.sha))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [p.client, p.owner, p.repo, p.sha])

  useEffect(() => {
    void load()
  }, [load])

  // getCommit 的 files 少一个 changes 字段，补齐后才能喂给 DiffView
  const files: PullFile[] = (detail?.files ?? []).map((f) => ({
    filename: f.filename,
    status: f.status as PullFile['status'],
    additions: f.additions,
    deletions: f.deletions,
    changes: f.additions + f.deletions,
    patch: f.patch,
  }))

  const message = detail?.commit.message ?? ''
  const lines = message.split('\n')
  const title = commitTitle(message)
  const body = lines.slice(1).join('\n').trim()

  return (
    <div className="page">
      <PageHeader title={p.sha.slice(0, 7)} sub={`${p.owner}/${p.repo}`} onBack={p.onBack} />

      <PageState
        loading={loading && !detail}
        error={error}
        onRetry={() => void load()}
        loadingText="正在读取提交…"
      />

      {detail && (
        <>
          <div className="commit-head">
            <div className="commit-subject">{title}</div>
            {body && <pre className="commit-body">{body}</pre>}
            <div className="commit-meta">
              {detail.author?.login ? `@${detail.author.login}` : detail.commit.author?.name ?? '未知'}
              {detail.commit.author?.date && ` · ${shortDate(detail.commit.author.date)}`}
              {detail.stats && (
                <span className="diff-stat" style={{ marginLeft: 'auto' }}>
                  <b className="add">+{detail.stats.additions}</b>
                  <b className="del">−{detail.stats.deletions}</b>
                </span>
              )}
            </div>
          </div>

          {files.length === 0 ? (
            <div className="empty">这次提交没有文件改动（可能是合并提交）。</div>
          ) : (
            <>
              <div className="section-title" style={{ padding: '0 16px' }}>
                改动 · {files.length} 个文件
              </div>
              <DiffView files={files} />
            </>
          )}
        </>
      )}
    </div>
  )
}
