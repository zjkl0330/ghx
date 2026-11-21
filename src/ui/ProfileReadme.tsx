import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import { compactNumber } from '../lib/format'
import { rawBase } from '../lib/images'
import { parseMarkdown, type Block } from '../lib/markdown'
import { branchFromBlobUrl, type ReadmeFile } from '../lib/readme'
import { MarkdownView } from './MarkdownView'
import type { Route } from '../lib/routes'
import { Icon } from './icons'

/**
 * 个人主页自述。
 *
 * GitHub 的个人主页 README 不在 `/users/{login}` 里，它其实就是
 * `{login}/{login}` 这个同名仓库的 README。网页端点开个人主页时，
 * 服务端会额外把这层拉出来渲染在资料下面。
 *
 * 之前 UserPage 只拉了 user + repos，所以这块一直是空的 ——
 * 用户看到的「我的主页没有 MD」就是这个原因，不是渲染失败。
 */
export function ProfileReadme(p: {
  client: GitHubClient | null
  login: string
  /** 图片加速前缀；空串表示直连 raw */
  mirror: string
  /** 自己的账号才给编辑入口 */
  canEdit: boolean
  onEdit: (sha: string | undefined) => void
  /** 自述里的 GitHub 链接在 App 内打开；不传就退回系统浏览器 */
  onOpenRoute?: (r: Route) => void
}) {
  const [file, setFile] = useState<ReadmeFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!p.client) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      // 404 由 client.readme 内部吞掉，返回 null —— 没有自述是常态，不是错误
      const res = await p.client.readme(p.login, p.login)
      setFile(res.data)
    } catch {
      // 网络抖动就让这块留空，不打断整页资料
      setFile(null)
    } finally {
      setLoading(false)
    }
  }, [p.client, p.login])

  useEffect(() => {
    void load()
  }, [load])

  const blocks = useMemo<Block[]>(() => {
    if (!file) return []
    const branch = branchFromBlobUrl(file.html, file.path) ?? 'main'
    return parseMarkdown(file.text, {
      maxBlocks: 220,
      imageBase: rawBase(p.login, p.login, branch, file.path),
    })
  }, [file, p.login])

  /*
   * 折叠判定。
   * 图片高度是异步的，量一次不够 —— 用 ResizeObserver 盯住内容盒，
   * 图加载完变高之后「展开」按钮才会正确出现或消失。
   */
  useEffect(() => {
    const el = bodyRef.current
    if (!el || !file) {
      setOverflowing(false)
      return
    }
    const LIMIT = 300
    const measure = () => setOverflowing(el.scrollHeight > LIMIT + 8)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [file, blocks])

  if (loading) {
    return (
      <>
        <div className="section-title">主页自述</div>
        <div className="panel">
          <div className="preadme-skel">
            <i style={{ width: '62%' }} />
            <i style={{ width: '88%' }} />
            <i style={{ width: '76%' }} />
          </div>
        </div>
      </>
    )
  }

  if (!file) {
    return (
      <>
        <div className="section-title">主页自述</div>
        <div className="panel">
          <div className="preadme-empty">
            <Icon name="book" size={15} />
            <div>
              <b>还没有主页自述</b>
              <span>
                GitHub 会展示 <code>{p.login}/{p.login}</code> 仓库里的 README。
                建一个同名仓库就能让个人主页有内容。
              </span>
            </div>
          </div>
          {p.canEdit && (
            <button
              className="btn ghost block"
              style={{ marginTop: 10 }}
              onClick={() => p.onEdit(undefined)}
            >
              <Icon name="plus" size={14} />
              创建主页自述
            </button>
          )}
        </div>
      </>
    )
  }

  return (
    <>
      <div className="section-title">主页自述</div>
      <div className="panel">
        <div className={`preadme-body${expanded ? ' open' : ''}`} ref={bodyRef}>
          <MarkdownView
            blocks={blocks}
            mirror={p.mirror}
            // 主页自述就是 {login}/{login} 这个仓库的 README。分支写 HEAD：
            // 它由 GitHub 解析到默认分支，不用去猜是 main 还是 master
            ctx={{
              owner: p.login,
              repo: p.login,
              branch: 'HEAD',
              basePath: 'README.md',
              mirror: p.mirror,
            }}
            onRoute={p.onOpenRoute}
          />
        </div>
        {overflowing && !expanded && <div className="preadme-fade" />}
        {overflowing && (
          <button className="preadme-more" onClick={() => setExpanded((v) => !v)}>
            {expanded ? '收起' : '展开全文'}
            <Icon name="chevron" size={12} />
          </button>
        )}
        <div className="preadme-foot">
          <span className="ellipsis">
            {file.path} · {compactNumber(file.size)} B
          </span>
          <div className="spacer" />
          {p.canEdit && (
            <button className="preadme-link" onClick={() => p.onEdit(file.sha)}>
              编辑
            </button>
          )}
        </div>
      </div>
    </>
  )
}
