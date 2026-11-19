/**
 * 把行内片段渲染出来。
 *
 * 为什么不用 `<a href>`：WebView 里点 `<a>` 会先走一次真实导航，即使
 * `preventDefault` 了，长按、中键、无障碍焦点这些路径仍可能把当前页顶掉。
 * 用 `<button>` + `openExternal` 只有一条路径，行为可预期（仓库里
 * 发行版附件那一行也是这么改的）。
 */

import { parseInline, type Span } from '../lib/markdown'
import { resolveHref, safeHref, type LinkContext, type LinkTarget } from '../lib/mdlink'
import { openExternal } from '../lib/update'

interface Props {
  /** 纯文本，与 Block.text 同源 */
  text: string
  /** 解析时产出的行内结构 */
  spans?: Span[]
  /** 生成 spans 时的纯文本快照 */
  spansFor?: string
  /** 仓库上下文。没有它也能渲染，只是相对链接解析不出来 */
  ctx?: LinkContext | null
  /** 点内部锚点。不传就退化成「什么都不做」 */
  onAnchor?: (id: string) => void
}

/**
 * 没有仓库上下文时（个人主页自述、Release 说明）的兜底。
 *
 * 只认绝对地址、锚点、mailto —— 相对路径在这里没法算基准，硬当成外部
 * 地址去 `openExternal` 会打开一个拼错的 URL（网页端会拼到当前域名下），
 * 那种「点了跳错地方」比不给点更糟。
 */
function fallback(href: string): LinkTarget | null {
  const s = safeHref(href)
  if (!s) return null
  if (s.startsWith('#')) return s.length > 1 ? { kind: 'anchor', id: s.slice(1) } : null
  if (/^(?:https?:|mailto:|tel:)/i.test(s)) return { kind: 'external', url: s }
  return null
}

export function SpanText({ text, spans, spansFor, ctx, onAnchor }: Props) {
  // 机翻会把 text 换掉却碰不到 spans，这时 spans 里是原文，直接用会串味。
  // 退一步现场解析译文：译文里已经不含链接地址（inline() 早把地址丢了），
  // 所以解析结果只会是纯文字，不会凭空长出假链接。
  const list = spans && spansFor === text ? spans : parseInline(text)

  return (
    <>
      {list.map((sp, i) => {
        switch (sp.t) {
          case 'code':
            return (
              <code className="md-icode" key={i}>
                {sp.v}
              </code>
            )
          case 'strong':
            return <b key={i}>{sp.v}</b>
          case 'em':
            return <i key={i}>{sp.v}</i>
          case 'del':
            return <s key={i}>{sp.v}</s>
          case 'link': {
            const target = ctx ? resolveHref(sp.href, ctx) : fallback(sp.href)
            if (!target) return <span key={i}>{sp.v}</span>
            // 没有滚动容器可跳时，锚点也只当普通文字 —— 渲染成按钮却点不动更糟
            if (target.kind === 'anchor' && !onAnchor) return <span key={i}>{sp.v}</span>
            const isAnchor = target.kind === 'anchor'
            return (
              <button
                type="button"
                className="md-link"
                key={i}
                title={isAnchor ? '跳到本节' : target.url}
                onClick={() => {
                  if (isAnchor) onAnchor?.(target.id)
                  else void openExternal(target.url)
                }}
              >
                {sp.v || sp.href}
              </button>
            )
          }
          default:
            return <span key={i}>{sp.v}</span>
        }
      })}
    </>
  )
}
