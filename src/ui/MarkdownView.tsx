import { useEffect, useRef, useState } from 'react'
import { mirrorImage } from '../lib/images'
import type { Block } from '../lib/markdown'

/**
 * 通用 Markdown 渲染（Issue / PR 正文、评论、发行版说明）。
 *
 * 自述阅读器有自己的一套（带机翻与图片加速），这里只做「原样呈现」，
 * 避免把翻译状态塞进一个通用组件里。
 */

/**
 * 正文里的图片。
 *
 * 传了 mirror 就优先走加速前缀：raw.githubusercontent.com 在国内经常
 * 连不上，而 <img> 在「还在等」的时候不会触发 onerror，界面就是一块空白。
 * 所以加速失败或超时都要能退回原图，两边都不行才显示占位。
 */
function MdImage({ b, mirror }: { b: Extract<Block, { kind: 'img' }>; mirror?: string }) {
  const accelerated = mirror ? mirrorImage(b.src, mirror) : null
  const primary = accelerated ?? b.src
  const fallback = accelerated ? b.src : null

  const [src, setSrc] = useState(primary)
  const [failed, setFailed] = useState(false)
  const tried = useRef(false)

  // 换了一张图（列表复用组件）要重置，否则会沿用上一张的失败状态
  useEffect(() => {
    setSrc(primary)
    setFailed(false)
    tried.current = false
  }, [primary])

  useEffect(() => {
    if (failed || !fallback || tried.current) return
    const t = window.setTimeout(() => {
      if (tried.current) return
      tried.current = true
      setSrc(fallback)
    }, 12_000)
    return () => window.clearTimeout(t)
  }, [failed, fallback, src])

  if (failed) {
    return (
      <span className="md-img-fail" title={b.alt || b.src}>
        [图片加载失败{b.alt ? `：${b.alt}` : ''}]
      </span>
    )
  }
  return (
    <img
      className={`md-img${b.badge ? ' badge' : ''}${b.inline ? ' inline' : ''}`}
      src={src}
      alt={b.alt}
      loading="lazy"
      style={{
        ...(b.width ? { width: b.width } : {}),
        ...(b.height ? { height: b.height } : {}),
      }}
      onError={() => {
        if (!tried.current && fallback && fallback !== src) {
          tried.current = true
          setSrc(fallback)
          return
        }
        setFailed(true)
      }}
    />
  )
}

function Table({ b }: { b: Extract<Block, { kind: 'table' }> }) {
  return (
    <div className="md-tablewrap">
      <table className="md-table">
        <thead>
          <tr>
            {b.head.map((h, i) => (
              <th key={i} style={{ textAlign: b.align[i] === 'r' ? 'right' : b.align[i] === 'c' ? 'center' : 'left' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.rows.map((row, ri) => (
            <tr key={ri}>
              {b.head.map((_, ci) => (
                <td
                  key={ci}
                  style={{ textAlign: b.align[ci] === 'r' ? 'right' : b.align[ci] === 'c' ? 'center' : 'left' }}
                >
                  {row[ci] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function MarkdownView({ blocks, mirror }: { blocks: Block[]; mirror?: string }) {
  return (
    <div className="md">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'h':
            return (
              <div className={`md-h md-h${Math.min(b.level, 4)}`} key={i}>
                {b.text}
              </div>
            )
          case 'p':
            return (
              <p className="md-p" key={i}>
                {b.text}
              </p>
            )
          case 'li':
            return (
              <div className={`md-li d${b.depth}`} key={i}>
                <span className="md-bullet">{b.checked !== undefined ? (b.checked ? '☑' : '☐') : b.ordered ? '·' : '•'}</span>
                <span style={b.checked ? { color: 'var(--text-dim)' } : undefined}>{b.text || '\u00a0'}</span>
              </div>
            )
          case 'quote':
            return (
              <div className="md-quote" key={i}>
                {b.text}
              </div>
            )
          case 'code':
            return (
              <pre className="md-code" key={i}>
                {b.text}
              </pre>
            )
          case 'hr':
            return <div className="md-hr" key={i} />
          case 'img':
            return <MdImage key={i} b={b} mirror={mirror} />
          case 'table':
            return <Table key={i} b={b} />
          default:
            return null
        }
      })}
    </div>
  )
}
