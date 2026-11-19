import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { githubUrlAt } from '../lib/mirrors'
import type { GitHubClient } from '../lib/api'
import { mirrorImage, rawBase } from '../lib/images'
import { parseMarkdown, type Block } from '../lib/markdown'
import type { LinkContext } from '../lib/mdlink'
import { looksChinese, type ReadmeFile } from '../lib/readme'
import { activeHeading, anchorIndexOf, buildToc, tocAnchor, tocIndent } from '../lib/toc'
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
import { Table } from './MarkdownView'
import { SpanText } from './SpanText'

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
  ctx: LinkContext,
  onAnchor: (id: string) => void,
) {
  const rich = (x: Extract<Block, { kind: 'h' | 'p' | 'li' | 'quote' }>) => (
    <SpanText text={x.text} spans={x.spans} spansFor={x.spansFor} ctx={ctx} onAnchor={onAnchor} />
  )

  switch (b.kind) {
    case 'h':
      return (
        <div className={`md-h md-h${Math.min(b.level, 4)}`} key={key} id={tocAnchor(key)}>
          {rich(b)}
        </div>
      )
    case 'p':
      return (
        <p className="md-p" key={key}>
          {rich(b)}
        </p>
      )
    case 'li':
      return (
        <div className={`md-li d${b.depth}`} key={key}>
          <span className="md-bullet">{b.ordered ? '·' : '•'}</span>
          <span>{b.text ? rich(b) : '\u00a0'}</span>
        </div>
      )
    case 'quote':
      return (
        <div className="md-quote" key={key}>
          {rich(b)}
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
    case 'table':
      return <Table key={key} b={b} ctx={ctx} onAnchor={onAnchor} />
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

  /** 目录跟着当前显示的这份走：切到原文就是原文的标题结构 */
  const toc = useMemo(() => buildToc(shown), [shown])
  const [tocOpen, setTocOpen] = useState(false)
  const [tocActive, setTocActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  /** 标题相对滚动容器的 y 坐标；拿不到的排到最后，不参与高亮 */
  const headingOffsets = useCallback(() => {
    const box = boxRef.current
    if (!box) return []
    const base = box.getBoundingClientRect().top - box.scrollTop
    return toc.map((t) => {
      const el = document.getElementById(tocAnchor(t.index))
      return el ? el.getBoundingClientRect().top - base : Number.MAX_SAFE_INTEGER
    })
  }, [toc])

  const jumpTo = useCallback((index: number) => {
    const el = document.getElementById(tocAnchor(index))
    const box = boxRef.current
    setTocOpen(false)
    if (!el || !box) return
    // 自己算偏移而不是用 scrollIntoView：后者会连带滚动外层，
    // 弹层场景下表现为「点一下整页跳走」，很难受
    const top =
      el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 8
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }, [])

  // 目录打开时才监听滚动：关着的时候没必要每帧算一次位置
  useEffect(() => {
    const box = boxRef.current
    if (!box || !tocOpen || toc.length === 0) return
    const onScroll = () => setTocActive(activeHeading(headingOffsets(), box.scrollTop))
    onScroll()
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => box.removeEventListener('scroll', onScroll)
  }, [tocOpen, toc.length, headingOffsets])

  /**
   * 链接的基准目录跟着「当前显示的那份」走。
   * 中文版可能叫 `README.zh-CN.md` 躺在别的目录里，用英文版的路径算相对链接会指错。
   */
  const shownPath = view === 'zh' && zhFile ? zhFile.path : (file?.path ?? '')
  const linkCtx = useMemo<LinkContext>(
    () => ({
      owner,
      repo: name,
      branch: p.repo.default_branch || 'main',
      basePath: shownPath,
      mirror: p.mirror,
    }),
    [owner, name, p.repo.default_branch, shownPath, p.mirror],
  )

  /** `#某个小节` → 块下标 → 滚动。对不上就说清楚，别装作点了没反应 */
  const jumpAnchor = useCallback(
    (id: string) => {
      const idx = anchorIndexOf(shown, id)
      if (idx === null) {
        p.onToast(`自述里没有「${id}」这一节，可能指到别的文件去了`)
        return
      }
      jumpTo(idx)
    },
    [shown, jumpTo, p],
  )

  return (
    <>
    <div className="mask" onClick={p.onClose}>
      <div
        className="sheet"
        ref={boxRef}
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: '88vh' }}
      >
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
          {toc.length > 0 && (
            <button
              className="icon-btn"
              onClick={() => setTocOpen((v) => !v)}
              aria-label="目录"
              aria-expanded={tocOpen}
              style={tocOpen ? { color: 'var(--blue)' } : undefined}
            >
              <Icon name="sort" size={15} />
            </button>
          )}
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
            {shown.map((b, i) => renderBlock(b, i, view === 'source', p.mirror, linkCtx, jumpAnchor))}
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

      {/*
        目录做成浮层而不是流内面板：流内会把正文整体推下去，
        跳转位置算在「有目录」的布局上，一收起就偏。
      */}
      {tocOpen && toc.length > 0 && (
        <div className="toc-mask" onClick={() => setTocOpen(false)}>
          <div className="toc-panel" onClick={(e) => e.stopPropagation()}>
            <div className="toc-head">
              <span>目录</span>
              <span className="toc-count">{toc.length} 节</span>
            </div>
            <div className="toc-list">
              {toc.map((t, i) => (
                <button
                  key={t.index}
                  className={`toc-item${i === tocActive ? ' on' : ''}`}
                  style={{ paddingLeft: 10 + tocIndent(t.depth) }}
                  onClick={() => jumpTo(t.index)}
                >
                  {t.text}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
