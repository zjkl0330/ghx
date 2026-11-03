import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import { parseMarkdown, type Block } from '../lib/markdown'
import type { ReadmeFile } from '../lib/readme'
import { openExternal } from '../lib/update'
import {
  hasChinese,
  translateBlocks,
  type TranslateChannel,
  type TranslationStore,
} from '../lib/translate'
import type { Repo } from '../lib/types'
import { Icon } from './icons'

interface Props {
  repo: Repo
  client: GitHubClient | null
  /** 设置里「自动翻译自述」的开关 */
  autoTranslate: boolean
  channel: TranslateChannel
  store: TranslationStore | null
  onClose: () => void
  onToast: (msg: string) => void
}

type View = 'zh' | 'source'

function renderBlock(b: Block, key: number, showCode: boolean) {
  switch (b.kind) {
    case 'h':
      return (
        <div className={`md-h md-h${Math.min(b.level, 4)}`} key={key}>
          {b.text}
        </div>
      )
    case 'p':
      return (
        <p className="md-p" key={key}>
          {b.text}
        </p>
      )
    case 'li':
      return (
        <div className={`md-li d${b.depth}`} key={key}>
          <span className="md-bullet">{b.ordered ? '·' : '•'}</span>
          <span>{b.text}</span>
        </div>
      )
    case 'quote':
      return (
        <div className="md-quote" key={key}>
          {b.text}
        </div>
      )
    case 'code':
      return showCode ? (
        <pre className="md-code" key={key}>
          {b.text}
        </pre>
      ) : null
    case 'hr':
      return <div className="md-hr" key={key} />
    default:
      return null
  }
}

export function ReadmeSheet(p: Props) {
  const owner = p.repo.owner
  const name = p.repo.name

  const [file, setFile] = useState<ReadmeFile | null>(null)
  const [blocks, setBlocks] = useState<Block[]>([])
  const [translated, setTranslated] = useState<Block[] | null>(null)
  const [view, setView] = useState<View>('zh')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [translateError, setTranslateError] = useState<string | null>(null)
  /** 只跑一次的翻译；用户手动重试时会清掉 */
  const startedRef = useRef(false)

  const seemsChinese = useMemo(
    () => (file ? hasChinese(file.text.slice(0, 2000)) : false),
    [file],
  )

  const doTranslate = useCallback(
    async (source: Block[]) => {
      if (!p.store) return
      setTranslating(true)
      setTranslateError(null)
      setProgress({ done: 0, total: 0 })
      // 先把原文铺上去，翻好一段就替换一段 —— 不必盯着空白等全部完成
      setTranslated(source.map((b) => ({ ...b })))
      try {
        const res = await translateBlocks(source, {
          channel: p.channel,
          store: p.store,
          maxBlocks: 30,
          concurrency: 3,
          onProgress: (done, total) => setProgress({ done, total }),
          onBlock: (index, text) =>
            setTranslated((prev) =>
              prev ? prev.map((b, i) => (i === index ? { ...b, text } : b)) : prev,
            ),
        })
        setTranslated(res.blocks)
        if (res.translated === 0) {
          setView('source')
          if (res.total > 0) setTranslateError('所有段落都没翻成功，网络可能不通，先看原文吧')
        }
      } catch (err) {
        setTranslateError((err as Error).message)
        setView('source')
      } finally {
        setTranslating(false)
      }
    },
    [p.channel, p.store],
  )

  const load = useCallback(
    async (fresh = false) => {
      if (!p.client) return
      setLoading(true)
      setError(null)
      startedRef.current = false
      setTranslated(null)
      try {
        const res = await p.client.readme(owner, name, fresh)
        const f = res.data
        setFile(f)
        if (!f) {
          setBlocks([])
          return
        }
        const parsed = parseMarkdown(f.text, { maxBlocks: 300 })
        setBlocks(parsed)
        // 原文已经是中文就别翻了，直接看原文
        if (p.autoTranslate && !hasChinese(f.text.slice(0, 2000))) {
          startedRef.current = true
          setView('zh')
          void doTranslate(parsed)
        } else {
          setView('source')
        }
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [p.client, p.autoTranslate, owner, name, doTranslate],
  )

  useEffect(() => {
    void load()
    // 只在打开时拉一次，依赖变化由 load 内部处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shown = view === 'zh' && translated ? translated : blocks

  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '88vh' }}>
        <div className="grab" />
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ minWidth: 0 }}>
            <h3 className="ellipsis">项目自述</h3>
            <div className="sheet-sub ellipsis">
              {p.repo.full_name}
              {file ? ` · ${file.name}` : ''}
            </div>
          </div>
          <div className="spacer" />
          <button className="icon-btn" onClick={() => void load(true)} aria-label="重新拉取">
            <Icon name="refresh" size={15} />
          </button>
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭">
            <Icon name="close" size={16} />
          </button>
        </div>

        {file && blocks.length > 0 && (
          <div className="seg" style={{ margin: '4px 0 8px' }}>
            <button
              className={view === 'zh' ? 'on' : ''}
              onClick={() => {
                setView('zh')
                if (!translated && !translating) {
                  if (seemsChinese) {
                    p.onToast('这份自述已经是中文，无需翻译')
                    setView('source')
                    return
                  }
                  void doTranslate(blocks)
                }
              }}
            >
              中文
            </button>
            <button className={view === 'source' ? 'on' : ''} onClick={() => setView('source')}>
              原文
            </button>
          </div>
        )}

        {translating && (
          <div className="md-status">
            <span className="spin" style={{ width: 12, height: 12 }} />
            正在翻译 {progress.total ? `${progress.done}/${progress.total}` : '…'}
          </div>
        )}

        {translateError && (
          <div className="warnbox" style={{ marginTop: 8 }}>
            <Icon name="warn" size={14} />
            <span>
              翻译没成功：{translateError}。可以先看原文，或换个通道再试。
              <button className="linkbtn" onClick={() => void doTranslate(blocks)}>
                重试
              </button>
            </span>
          </div>
        )}

        {loading && <div className="empty">正在拉取自述…</div>}

        {!loading && error && (
          <div className="warnbox" style={{ marginTop: 8 }}>
            <Icon name="warn" size={14} />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && !file && (
          <div className="empty">
            <b>这个仓库没有 README</b>
            作者还没写说明文档，可以看看仓库里的其他文件。
          </div>
        )}

        {!loading && file && blocks.length === 0 && (
          <div className="empty">
            <b>自述里没有可显示的文字</b>
            内容可能全是图片或徽章。
          </div>
        )}

        {!loading && shown.length > 0 && (
          <div className="md">{shown.map((b, i) => renderBlock(b, i, view === 'source'))}</div>
        )}

        {!loading && file && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              className="btn ghost"
              style={{ flex: 1 }}
              onClick={() => void openExternal(`https://github.com/${p.repo.full_name}#readme`)}
            >
              <Icon name="globe" size={14} />
              网页版
            </button>
            <button
              className="btn blue"
              style={{ flex: 1 }}
              onClick={() => {
                if (!blocks.length) return
                if (seemsChinese) {
                  p.onToast('已经是中文，不需要翻译')
                  return
                }
                setView('zh')
                void doTranslate(blocks)
              }}
              disabled={translating || !p.store}
            >
              <Icon name="refresh" size={14} />
              {translating ? '翻译中…' : translated ? '重新翻译' : '翻译成中文'}
            </button>
          </div>
        )}

        <div className="hint" style={{ marginTop: 10 }}>
          {p.channel === 'google'
            ? '当前使用 Google 通道，国内网络可能连不上，可在设置里换成 MyMemory。'
            : '机翻仅作参考，代码块与专有名词不翻译。译文按内容缓存，同一份自述不会重复消耗额度。'}
        </div>
      </div>
    </div>
  )
}
