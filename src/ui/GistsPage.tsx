import { useCallback, useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import { gistFiles, gistLanguage, gistTitle, listGists, type Gist } from '../lib/gists'
import { relTime } from '../lib/format'
import { PageHeader, PageState } from './PageHeader'
import { Icon } from './icons'

/**
 * Gist 列表。
 *
 * `GET /gists` 只返回**自己**的（含私有），要看他人的走 `/users/{login}/gists`。
 * 两边的返回结构一样，只是可见范围不同，所以这里用一个 login 参数切换。
 */
export function GistsPage(p: {
  client: GitHubClient | null
  /** null = 自己的（含私有）；填用户名 = 那个人的公开 Gist */
  login: string | null
  onBack: () => void
  onOpen: (id: string) => void
  onCreate: () => void
  onToast: (s: string) => void
}) {
  const [list, setList] = useState<Gist[] | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [moreBusy, setMoreBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (nextPage: number) => {
      if (!p.client) return
      if (nextPage === 1) setLoading(true)
      else setMoreBusy(true)
      setError(null)
      try {
        const r = await listGists(p.client, p.login, nextPage)
        setList((cur) => (nextPage === 1 ? r.list : [...(cur ?? []), ...r.list]))
        setHasMore(r.hasMore)
        setPage(nextPage)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
        setMoreBusy(false)
      }
    },
    [p.client, p.login],
  )

  useEffect(() => {
    void load(1)
  }, [load])

  return (
    <>
      <PageHeader
        title="Gist"
        sub={p.login ? `@${p.login} 的公开片段` : '我的代码片段'}
        onBack={p.onBack}
        right={
          <button className="icon-btn" onClick={() => void load(1)} aria-label="刷新">
            <Icon name="refresh" size={17} />
          </button>
        }
        action={p.login ? undefined : { label: '新建', icon: 'plus', onClick: p.onCreate }}
      />

      <div className="page" style={{ marginTop: 0 }}>
        <PageState loading={loading} error={error} onRetry={() => void load(1)} />

        {list !== null && list.length > 0 && (
          <div className="list-head">
            <span>{list.length} 个片段</span>
          </div>
        )}

        <div className="rows">
          {(list ?? []).map((g) => {
            const files = gistFiles(g)
            const lang = gistLanguage(g)
            return (
              <div key={g.id} role="button" tabIndex={0} className="row" onClick={() => p.onOpen(g.id)}>
                <span className="file-ic">
                  <Icon name="file" size={16} />
                </span>
                <span className="row-main">
                  <span className="row-l1">
                    <span className="row-name ellipsis">{gistTitle(g)}</span>
                    {!g.public && <span className="badge">私有</span>}
                  </span>
                  <span className="row-meta ellipsis">
                    {files.length} 个文件 · {lang ?? '纯文本'} · {relTime(g.updated_at)}
                  </span>
                </span>
                <Icon name="chevron" size={13} className="linkrow-arrow" />
              </div>
            )
          })}
        </div>

        {hasMore && (
          <button
            className="btn ghost block"
            style={{ marginTop: 12 }}
            disabled={moreBusy}
            onClick={() => void load(page + 1)}
          >
            {moreBusy ? '加载中…' : '加载更多'}
          </button>
        )}

        {list !== null && list.length === 0 && !loading && (
          <div className="empty">
            <b>{p.login ? '没有公开片段' : '还没有 Gist'}</b>
            {p.login ? '这个人还没有公开的 Gist。' : 'Gist 适合放零散代码、配置片段、临时笔记。右上角可以建一个。'}
          </div>
        )}

        <div className="hint" style={{ padding: '12px 16px 24px' }}>
          Gist 是平铺的：一个片段里放多个文件，文件名不能带路径。私有 Gist 只有自己和拿到链接的人能看。
        </div>
      </div>
    </>
  )
}
