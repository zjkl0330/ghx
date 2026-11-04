import { useCallback, useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import { commitTitle, getCommit, listCommits, type CommitDetail, type CommitItem } from '../lib/code'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (!p.client) {
        setLoading(false)
        return
      }
      if (!silent) setLoading(true)
      setError(null)
      try {
        const data = await listCommits(p.client, p.owner, p.repo, { path: p.path, ref: p.ref, fresh: silent })
        setList(data)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [p.client, p.owner, p.repo, p.path, p.ref],
  )

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
        <div className="hint" style={{ padding: '4px 16px 24px' }}>
          只列最近 30 条。更早的记录请在网页端按日期翻页。
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
