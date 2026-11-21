import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import { relTime } from '../lib/format'
import { parseMarkdown } from '../lib/markdown'
import {
  isFreshComment,
  reasonText,
  subjectMeta,
  threadComments,
  threadNumber,
  type NotificationThread,
  type ThreadComment,
} from '../lib/notifications'
import { MarkdownView } from './MarkdownView'
import { TransHead } from './TransHead'
import { useDocTranslation } from './useDocTranslation'
import type { LinkContext } from '../lib/mdlink'
import type { Route } from '../lib/routes'
import type { TargetLang, TranslateChannel, TranslationStore } from '../lib/translate'
import { PageState } from './PageHeader'
import { Icon } from './icons'

/**
 * 通知直读。
 *
 * 早先点通知只能跳到 Issue / PR 详情，等于「先告诉你有人回复，再让你自己翻过去找」。
 * 这里把最近几条评论直接拉进面板，读完想细看再跳。
 *
 * 只拉最近 8 条：通知是「有新动静」的提醒，不是阅读器。
 */
export function ThreadSheet(p: {
  client: GitHubClient | null
  thread: NotificationThread
  mirror: string
  onClose: () => void
  /** 打开完整页面（Issue / PR 详情） */
  onOpenFull: () => void
  /** 评论里的 GitHub 链接在 App 内打开；不传就退回系统浏览器 */
  onOpenRoute?: (r: Route) => void
  /** 设置里的「Issue 与 PR」开关：通知直读的评论跟着它 */
  autoTranslate?: boolean
  channel?: TranslateChannel
  target?: TargetLang
  azureKey?: string
  store?: TranslationStore | null
  /** 标记完成，移出收件箱 */
  onDone: () => void
  onToast: (s: string) => void
}) {
  const [items, setItems] = useState<ThreadComment[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const meta = subjectMeta(p.thread.subject.type)
  const number = threadNumber(p.thread)
  const repo = p.thread.repository?.full_name ?? ''
  // 通知一定绑着仓库：评论里的相对链接按仓库根 + HEAD 解析
  const [owner, repoName] = repo.split('/')
  const linkCtx: LinkContext | null =
    owner && repoName
      ? { owner, repo: repoName, branch: 'HEAD', basePath: '', mirror: p.mirror }
      : null

  const load = useCallback(async () => {
    if (!p.client) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await threadComments(p.client, p.thread)
      setItems(res.items)
      setHasMore(res.hasMore)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [p.client, p.thread])

  useEffect(() => {
    void load()
  }, [load])

  /** 先把正文解析好，免得每次重渲染都重解析一遍 Markdown */
  const blocks = useMemo(
    () => items.map((c) => parseMarkdown(c.body ?? '', { maxBlocks: 60 })),
    [items],
  )

  const flatBlocks = useMemo(() => blocks.flat(), [blocks])
  const trans = useDocTranslation({
    enabled: !!p.autoTranslate,
    channel: p.channel ?? 'auto',
    target: p.target ?? 'zh-CN',
    azureKey: p.azureKey ?? '',
    store: p.store ?? null,
  })
  const [view, setView] = useState<'zh' | 'src'>('zh')

  useEffect(() => {
    trans.reset()
    if (p.autoTranslate && flatBlocks.length > 0) void trans.translate(flatBlocks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, p.autoTranslate])

  /** 第 i 条评论显示哪份块：译文拍平了，按前面条目的块数切回来 */
  const shown = (i: number) => {
    const own = blocks[i] ?? []
    if (view !== 'zh' || !trans.zh) return own
    const start = blocks.slice(0, i).reduce((n, b) => n + b.length, 0)
    return trans.zh.slice(start, start + own.length)
  }

  function markDone() {
    if (busy) return
    // 真正的 DELETE 在 App 里做（那边要顺带刷未读角标），这里只防连点
    setBusy(true)
    p.onDone()
    setBusy(false)
  }

  return (
    <>
      <div className="mask" onClick={p.onClose} />
      <div className="sheet thread-sheet" style={{ maxHeight: '88vh' }}>
        <div className="grab" />
        <div className="sheet-head">
          <div style={{ minWidth: 0 }}>
            <h3 className="ellipsis">{p.thread.subject.title}</h3>
            <div className="sheet-sub ellipsis">
              <Icon name={meta.icon} size={11} /> {meta.label}
              {repo ? ` · ${repo}` : ''}
              {number ? ` #${number}` : ''} · {reasonText(p.thread.reason)}
            </div>
          </div>
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭">
            <Icon name="close" size={16} />
          </button>
        </div>

        <PageState
          loading={loading}
          error={error}
          onRetry={() => void load()}
          empty={!loading && !error && items.length === 0 ? '这条通知下面还没有评论' : undefined}
          loadingText="正在读取最新评论…"
        />

        {items.length > 0 && (
          <div style={{ padding: '0 2px' }}>
            <TransHead
              view={view}
              onToggle={() => setView((v) => (v === 'zh' ? 'src' : 'zh'))}
              ready={!!trans.zh}
              busy={trans.busy}
              enabled={!!p.autoTranslate}
              onTranslate={() => void trans.translate(flatBlocks)}
              error={trans.error}
            />
          </div>
        )}

        {items.length > 0 && (
          <div className="thread-list">
            {items.map((c, i) => (
              <div className="thread-comment" key={c.id}>
                <div className="thread-who">
                  <b>{c.user?.login ?? '未知'}</b>
                  <span className="muted">{relTime(c.created_at)}</span>
                  {isFreshComment(c) && <span className="pill fresh">24 小时内</span>}
                </div>
                <MarkdownView blocks={shown(i)} mirror={p.mirror} ctx={linkCtx} onRoute={p.onOpenRoute} />
              </div>
            ))}
          </div>
        )}

        {hasMore && (
          <div className="hint" style={{ marginTop: 8 }}>
            只显示最近 8 条评论。更早的对话在完整页面里。
          </div>
        )}

        <div className="btns" style={{ marginTop: 12 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={markDone} disabled={busy}>
            <Icon name="check" size={14} />
            标记完成
          </button>
          <button className="btn primary" style={{ flex: 1 }} onClick={p.onOpenFull}>
            <Icon name="arrowRight" size={14} />
            打开完整页面
          </button>
        </div>
      </div>
    </>
  )
}
