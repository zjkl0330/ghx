/**
 * 把行内片段渲染出来。
 *
 * 为什么不用 `<a href>`：WebView 里点 `<a>` 会先走一次真实导航，即使
 * `preventDefault` 了，长按、中键、无障碍焦点这些路径仍可能把当前页顶掉。
 * 用 `<button>` + `openExternal` 只有一条路径，行为可预期（仓库里
 * 发行版附件那一行也是这么改的）。
 */

import { parseInline, type Span } from '../lib/markdown'
import { isGithubUrl, resolveBareHref, resolveHref, type LinkContext, type LinkTarget } from '../lib/mdlink'
import type { Route } from '../lib/routes'
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
  /** GitHub 链接的 App 内打开入口。不传时 GitHub 链接也不会外跳（硬要求） */
  onRoute?: (r: Route) => void
  /** 没有入口时的兜底提示（一般是「App 内暂缺此页」的 Toast） */
  onBlocked?: (url: string) => void
}

/**
 * 没有仓库上下文时（个人主页自述、Issue 正文、Release 说明）的兜底。
 *
 * 只认绝对地址、锚点、mailto —— 相对路径在这里没法算基准，硬当成外部
 * 地址去 `openExternal` 会打开一个拼错的 URL（网页端会拼到当前域名下），
 * 那种「点了跳错地方」比不给点更糟。
 *
 * 具体规则在 `resolveBareHref` 里（纯逻辑，可单测）：绝对 GitHub 地址
 * 也会给出 App 内路由，不再一律踢去浏览器。
 */
function fallback(href: string): LinkTarget | null {
  return resolveBareHref(href)
}

export function SpanText({ text, spans, spansFor, ctx, onAnchor, onRoute, onBlocked }: Props) {
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
            // GitHub 链接优先在 App 内打开；没有入口回调或没有对应页面才走外部
            const route = target.kind === 'external' ? target.route : undefined
            const inApp = !!route && !!onRoute
            const gh = target.kind === 'external' && isGithubUrl(target.url)
            return (
              <button
                type="button"
                className="md-link"
                key={i}
                title={isAnchor ? '跳到本节' : target.url}
                onClick={() => {
                  if (isAnchor) onAnchor?.(target.id)
                  else if (inApp) onRoute?.(route as Route)
                  // 硬要求：GitHub 地址一律不进系统浏览器。没有入口就给提示，
                  // 静默也比把 App 顶掉强。
                  else if (gh) onBlocked?.(target.url)
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
