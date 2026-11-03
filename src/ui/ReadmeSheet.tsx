import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { githubUrlAt } from '../lib/mirrors'
import type { GitHubClient } from '../lib/api'
import { mirrorImage, rawBase } from '../lib/images'
import { parseMarkdown, type Block } from '../lib/markdown'
import { looksChinese, type ReadmeFile } from '../lib/readme'
import { openExternal } from '../lib/update'
import {
  TARGET_LANGS,
  translateBlocks,
  type TargetLang,
  type TranslateChannel,
  type TranslationStore,
} from '../lib/translate'
import type { Repo } from '../lib/types'
import { Icon } from './icons'

interface Props {
  repo: Repo
  client: GitHubClient | null
  /** 下载/网页加速前缀，网页版走它而不是 github.com */
  mirror: string
  /** 设置里「自动翻译自述」的开关 */
  autoTranslate: boolean
  channel: TranslateChannel
  /** 译文语言 */
  target: TargetLang
  /** 微软翻译密钥；有值时一次能翻整段 */
  azureKey: string
  store: TranslationStore | null
  onClose: () => void
  onToast: (msg: string) => void
}

type View = 'zh' | 'source'

/**
 * 单张图片。
 *
 * 仓库里的图基本都在 raw.githubusercontent.com，国内直连要么不通、要么慢到
 * 十几秒还没响应 —— 而 img 在「还在等」的时候不会触发 onerror，界面就是一块空白。
 * 所以这里有两条路：优先走加速前缀，失败或超时再换回 raw；两边都失败才显示占位。
 */
function MdImage({ b, mirror }: { b: Extract<Block, { kind: 'img' }>; mirror: string }) {
  const accelerated = mirrorImage(b.src, mirror)
  const primary = accelerated ?? b.src
  const other = accelerated ? b.src : null

  const [src, setSrc] = useState(primary)
  const [failed, setFailed] = useState(false)
  const tried = useRef(false)

  const giveUpOrSwap = useCallback(() => {
    if (!tried.current && other && other !== src) {
      tried.current = true
      setSrc(other)
      return
    }
    setFailed(true)
  }, [other, src])

  // 没有 onerror 的那种「假死」也要有个了断
  useEffect(() => {
    if (failed || !other || tried.current) return
    const t = window.setTimeout(giveUpOrSwap, 12_000)
    return () => window.clearTimeout(t)
  }, [failed, other, src, giveUpOrSwap])

  if (failed) {
    return (
      <span className="md-img-fail" title={b.alt || b.src}>
        {b.alt ? `图片没能加载：${b.alt}` : '图片没能加载'}
      </span>
    )
  }

  return (
    <img
      className={`md-img${b.badge ? ' badge' : ''}${b.inline ? ' inline' : ''}`}
      src={src}
      alt={b.alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      style={
        b.badge
          ? undefined
          : b.height
            ? { height: b.height }
            : b.width
              ? { maxWidth: b.width }
              : undefined
      }
      onError={giveUpOrSwap}
    />
  )
}

function renderBlock(
  b: Block,
  key: number,
  showCode: boolean,
  mirror: string,
) {
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
    case 'img':
      return <MdImage key={key} b={b} mirror={mirror} />
    default:
      return null
  }
}

export function ReadmeSheet(p: Props) {
  const owner = p.repo.owner
  const name = p.repo.name

  const [file, setFile] = useState<ReadmeFile | null>(null)
  const [blocks, setBlocks] = useState<Block[]>([])
  /** 仓库自带的中文版 README（作者自己写的译文，优先于机翻） */
  const [zhFile, setZhFile] = useState<ReadmeFile | null>(null)
  const [zhBlocks, setZhBlocks] = useState<Block[]>([])
  const [translated, setTranslated] = useState<Block[] | null>(null)
  const [view, setView] = useState<View>('zh')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [translating, setTranslating] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [translateError, setTranslateError] = useState<string | null>(null)
  /** 下一批从哪开始、还剩多少段：长 README 分批判，不静悄悄漏掉后半 */
  const [pending, setPending] = useState({ next: 0, remaining: 0 })
  /** 已翻好的块：续翻时要在这份基础上改，否则前一批的译文会被原文覆盖 */
  const translatedRef = useRef<Block[] | null>(null)
  /** 只跑一次的翻译；用户手动重试时会清掉 */
  const startedRef = useRef(false)

  const applyTranslated = useCallback((next: Block[]) => {
    translatedRef.current = next
    setTranslated(next)
  }, [])

  const seemsChinese = useMemo(() => (file ? looksChinese(file.text) : false), [file])

  const doTranslate = useCallback(
    async (source: Block[], skip = 0) => {
      if (!p.store) return
      setTranslating(true)
      setTranslateError(null)
      setProgress({ done: 0, total: 0 })
      // 续翻时接在已翻结果后面；首次先把原文铺满，翻好一段替换一段
      const base =
        skip > 0 && translatedRef.current ? translatedRef.current : source.map((b) => ({ ...b }))
      if (skip === 0) applyTranslated(base)
      try {
        // Edge 与微软单次都能吞整段，批量和并发可以开大；MyMemory 要克制，否则被限流
        const bulk = !!p.azureKey.trim() || p.channel === 'edge' || p.channel === 'auto'
        const res = await translateBlocks(base, {
          channel: p.channel,
          store: p.store,
          target: p.target,
          azureKey: p.azureKey,
          maxBlocks: bulk ? 40 : 20,
          concurrency: bulk ? 6 : 3,
          skip,
          onProgress: (done, total) => setProgress({ done, total }),
          onBlock: (index, text) => {
            const cur = translatedRef.current
            if (!cur) return
            applyTranslated(cur.map((b, i) => (i === index ? { ...b, text } : b)))
          },
        })
        applyTranslated(res.blocks)
        setPending({ next: res.next, remaining: res.remaining })
        if (res.translated === 0 && skip === 0) {
          setView('source')
          if (res.total > 0) setTranslateError('所有段落都没翻成功，网络可能不通，先看原文吧')
        } else if (res.translated < res.total) {
          // 部分失败也要说清楚，否则用户只会看到「怎么还有几段英文」
          setTranslateError(
            `有 ${res.total - res.translated} 段没翻成（免费通道容易限流），点重试只补翻这些段`,
          )
        }
      } catch (err) {
        setTranslateError((err as Error).message)
        setView('source')
      } finally {
        setTranslating(false)
      }
    },
    [p.channel, p.store, p.target, p.azureKey, applyTranslated],
  )

  const load = useCallback(
    async (fresh = false) => {
      if (!p.client) return
      setLoading(true)
      setError(null)
      startedRef.current = false
      setTranslated(null)
      translatedRef.current = null
      setPending({ next: 0, remaining: 0 })
      setZhFile(null)
      setZhBlocks([])
      try {
        const res = await p.client.readme(owner, name, fresh)
        const f = res.data
        setFile(f)
        if (!f) {
          setBlocks([])
          return
        }
        const parsed = parseMarkdown(f.text, {
          maxBlocks: 300,
          imageBase: rawBase(owner, name, p.repo.default_branch, f.path),
        })
        setBlocks(parsed)
        setView('source')
        // 原文本来就是中文，直接看原文
        if (looksChinese(f.text)) return

        // 仓库带了中文版就直接显示：作者自己翻的，比机翻准，也不花翻译额度
        const zh = await p.client.chineseReadme(owner, name, f)
        if (zh && looksChinese(zh.text)) {
          setZhFile(zh)
          setZhBlocks(
            parseMarkdown(zh.text, {
              maxBlocks: 300,
              imageBase: rawBase(owner, name, p.repo.default_branch, zh.path),
            }),
          )
          setView('zh')
          return
        }
        if (p.autoTranslate) {
          startedRef.current = true
          setView('zh')
          void doTranslate(parsed)
        }
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [p.client, p.autoTranslate, p.repo.default_branch, owner, name, doTranslate],
  )

  useEffect(() => {
    void load()
    // 只在打开时拉一次，依赖变化由 load 内部处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shown = view === 'zh' ? (zhFile ? zhBlocks : (translated ?? blocks)) : blocks

  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '88vh' }}>
        <div className="grab" />
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ minWidth: 0 }}>
            <h3 className="ellipsis">项目自述</h3>
            <div className="sheet-sub ellipsis">
              {p.repo.full_name}
              {file ? ` · ${view === 'zh' && zhFile ? zhFile.name : file.name}` : ''}
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
                if (zhFile) return
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

        {zhFile && view === 'zh' && (
          <div className="chip" style={{ marginBottom: 8 }}>
            <Icon name="check" size={12} />
            仓库自带中文版 {zhFile.name}，未经过机翻
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
          <div className="md">
            {shown.map((b, i) => renderBlock(b, i, view === 'source', p.mirror))}
          </div>
        )}

        {!loading && !translating && !zhFile && pending.remaining > 0 && (
          <button
            className="btn ghost block"
            style={{ marginTop: 12 }}
            onClick={() => {
              setView('zh')
              void doTranslate(blocks, pending.next)
            }}
          >
            <Icon name="chevron" size={14} />
            继续翻译剩余 {pending.remaining} 段
          </button>
        )}

        {!loading && file && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              className="btn ghost"
              style={{ flex: 1 }}
              onClick={() =>
                void openExternal(`${githubUrlAt(p.mirror, p.repo.full_name)}#readme`)
              }
            >
              <Icon name="globe" size={14} />
              网页版
            </button>
            {zhFile ? (
              <button
                className="btn ghost"
                style={{ flex: 1 }}
                onClick={() => setView(view === 'zh' ? 'source' : 'zh')}
              >
                <Icon name="repo" size={14} />
                看{view === 'zh' ? '英文原版' : '中文版'}
              </button>
            ) : (
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
            )}
          </div>
        )}

        <div className="hint" style={{ marginTop: 10 }}>
          {zhFile
            ? '上面显示的是仓库自带的中文版，原样呈现，未做机翻。'
            : p.channel === 'google'
              ? '当前使用 Google 通道，国内网络可能连不上，可在设置里换成 Edge 或 MyMemory。'
              : p.channel === 'edge'
                ? `当前使用 Edge 免密钥通道，单次能翻整篇。目标语言：${
                    TARGET_LANGS.find((t) => t.key === p.target)?.label ?? p.target
                  }。译文按内容缓存，同一份自述不会重复消耗额度。`
                : `机翻仅作参考，代码块与专有名词不翻译。译文按内容缓存，同一份自述不会重复消耗额度。目标语言：${
                    TARGET_LANGS.find((t) => t.key === p.target)?.label ?? p.target
                  }。`}
        </div>
      </div>
    </div>
  )
}
