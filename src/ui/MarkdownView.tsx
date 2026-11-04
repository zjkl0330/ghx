import { useState } from 'react'
import type { Block } from '../lib/markdown'

/**
 * 通用 Markdown 渲染（Issue / PR 正文、评论、发行版说明）。
 *
 * 自述阅读器有自己的一套（带机翻与图片加速），这里只做「原样呈现」，
 * 避免把翻译状态塞进一个通用组件里。
 */

function MdImage({ b }: { b: Extract<Block, { kind: 'img' }> }) {
  const [failed, setFailed] = useState(false)
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
      src={b.src}
      alt={b.alt}
      loading="lazy"
      style={{
        ...(b.width ? { width: b.width } : {}),
        ...(b.height ? { height: b.height } : {}),
      }}
      onError={() => setFailed(true)}
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

export function MarkdownView({ blocks }: { blocks: Block[] }) {
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
            return <MdImage key={i} b={b} />
          case 'table':
            return <Table key={i} b={b} />
          default:
            return null
        }
      })}
    </div>
  )
}
