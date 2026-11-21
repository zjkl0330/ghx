import type { Block } from '../lib/markdown'
import type { LinkContext } from '../lib/mdlink'
import type { Route } from '../lib/routes'
import { tocAnchor } from '../lib/toc'
import { MdImage } from './MdImage'
import { SpanText } from './SpanText'

/**
 * 通用 Markdown 渲染（Issue / PR 正文、评论、发行版说明）。
 *
 * 自述阅读器有自己的一套（带机翻与图片加速），这里只做「原样呈现」，
 * 避免把翻译状态塞进一个通用组件里。
 */

export function Table({
  b,
  ctx,
  onAnchor,
  onRoute,
}: {
  b: Extract<Block, { kind: 'table' }>
  ctx?: LinkContext | null
  onAnchor?: (id: string) => void
  onRoute?: (r: Route) => void
}) {
  const alignStyle = (i: number) =>
    ({ textAlign: b.align[i] === 'r' ? 'right' : b.align[i] === 'c' ? 'center' : 'left' }) as const
  return (
    <div className="md-tablewrap">
      <table className="md-table">
        <thead>
          <tr>
            {b.head.map((h, i) => (
              <th key={i} style={alignStyle(i)}>
                <SpanText text={h} ctx={ctx} onAnchor={onAnchor} onRoute={onRoute} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.rows.map((row, ri) => (
            <tr key={ri}>
              {b.head.map((_, ci) => (
                <td key={ci} style={alignStyle(ci)}>
                  <SpanText text={row[ci] ?? ''} ctx={ctx} onAnchor={onAnchor} onRoute={onRoute} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function MarkdownView({
  blocks,
  mirror,
  ctx,
  onAnchor,
  onRoute,
}: {
  blocks: Block[]
  mirror?: string
  /** 仓库上下文：有它自述里的相对链接才能解析成正确地址 */
  ctx?: LinkContext | null
  onAnchor?: (id: string) => void
  /** GitHub 链接的 App 内打开入口；不传则全部走外部浏览器 */
  onRoute?: (r: Route) => void
}) {
  const rich = (b: Extract<Block, { kind: 'h' | 'p' | 'li' | 'quote' }>) => (
    <SpanText text={b.text} spans={b.spans} spansFor={b.spansFor} ctx={ctx} onAnchor={onAnchor} onRoute={onRoute} />
  )

  return (
    <div className="md">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'h':
            return (
              // 优先用文档自带的锚点（`<h2 id="en-v1.3.10">` 或 GitHub slug），
              // 发行说明里的 [English](#en-v1.3.10) 才跳得过去；没有才退回下标式
              <div className={`md-h md-h${Math.min(b.level, 4)}`} key={i} id={b.anchor ?? tocAnchor(i)}>
                {rich(b)}
              </div>
            )
          case 'p':
            return (
              <p className="md-p" key={i}>
                {rich(b)}
              </p>
            )
          case 'li':
            return (
              <div className={`md-li d${b.depth}`} key={i}>
                <span className="md-bullet">{b.checked !== undefined ? (b.checked ? '☑' : '☐') : b.ordered ? '·' : '•'}</span>
                <span style={b.checked ? { color: 'var(--text-dim)' } : undefined}>
                  {b.text ? rich(b) : '\u00a0'}
                </span>
              </div>
            )
          case 'quote':
            return (
              <div className="md-quote" key={i}>
                {rich(b)}
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
            return <Table key={i} b={b} ctx={ctx} onAnchor={onAnchor} onRoute={onRoute} />
          default:
            return null
        }
      })}
    </div>
  )
}
