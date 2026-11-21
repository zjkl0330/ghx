/**
 * 自述里的链接往哪跳。
 *
 * 这里只做「把 Markdown 里写的那串地址翻译成可执行动作」，不碰 DOM。
 * 拆出来是因为它全是纯逻辑：相对路径、`../`、根相对、锚点、加速站前缀，
 * 每一条都能单独断言，不用起浏览器。
 *
 * 三条规矩：
 * 1. **只放行 http(s) / mailto / tel / 锚点**。`javascript:` 与 `data:` 一律
 *    当无效链接（渲染成纯文字），README 是别人写的，不能让它执行东西。
 * 2. **相对路径按「自述文件所在目录」解析**，不是按仓库根。`docs/README.md`
 *    里写 `../img/a.png` 要指到 `img/a.png`，按根解析会指错。
 * 3. **指向 github.com 的地址统一改走加速前缀**。目标用户打不开 github.com，
 *    原样抛出去等于点了没反应。
 */

import { githubUrlAt } from './mirrors'
import type { Route } from './routes'

/** 链接动作：打开外部地址，或在自述内部滚动到某个标题。
 *  route 有值时说明这条 GitHub 链接能在 App 内直接打开，调用方优先走它。 */
export type LinkTarget =
  | { kind: 'external'; url: string; route?: Route }
  | { kind: 'anchor'; id: string }

export interface LinkContext {
  owner: string
  repo: string
  /** 默认分支，拼 blob 地址用 */
  branch: string
  /** 自述自身的路径（如 `docs/README.md`），相对链接的基准 */
  basePath: string
  /** 网页加速前缀；空串表示直连 github.com */
  mirror: string
}

/** 允许的协议。其余带协议的（javascript:、data:、file:）一律不认 */
const SAFE_SCHEME = /^(?:https?:|mailto:|tel:)/i
/** 任意协议前缀，用来识别「有协议但不在白名单里」 */
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * 过滤掉不安全的地址。
 *
 * 返回 null 表示这条链接不该被渲染成可点的东西；返回原样的字符串表示
 * 可以继续交给 `resolveHref` 判断它到底是外链还是相对路径。
 */
export function safeHref(raw: string): string | null {
  // 控制字符会把 URL 解析搞乱（`java\tscript:` 之类），先剔掉
  const s = raw.trim().replace(/[\u0000-\u001f\u007f]/g, '')
  if (!s) return null
  if (s.startsWith('#')) return s
  if (SAFE_SCHEME.test(s)) return s
  if (ANY_SCHEME.test(s)) return null
  return s
}

/** 拆出 `#` 后面的锚点，没写片段时 hash 为空串 */
export function splitHash(href: string): [path: string, hash: string] {
  const i = href.indexOf('#')
  if (i < 0) return [href, '']
  return [href.slice(0, i), href.slice(i + 1)]
}

/**
 * 相对路径规范化：吃掉 `.` 与 `..`，合并多余斜杠。
 *
 * `..` 顶到仓库根之后再往上就停在根 —— 返回空串让调用方判无效，
 * 而不是拼出 `../../x` 这种 GitHub 会 404 的地址。
 */
export function joinPath(baseDir: string, rel: string): string {
  const parts = `${baseDir}/${rel}`.split('/')
  const out: string[] = []
  for (const seg of parts) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (out.length === 0) return ''
      out.pop()
      continue
    }
    out.push(seg)
  }
  return out.join('/')
}

/** 自述所在目录（含末尾斜杠）；自述在仓库根时返回空串 */
export function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
}

/**
 * GitHub 站内路径 → App 内路由。
 *
 * README 里最常见的就是指向自己仓库的链接（源码目录、Issues、发行页）。
 * 全扔给系统浏览器等于「点一下就跳出软件」，用户为此专门提了意见；
 * 能在 App 里看的就给路由，App 没有的页面（releases、wiki、discussions）
 * 才退回外部浏览器。
 *
 * path 是 github.com 后面的部分（含开头的 `/`，如 `/o/r/blob/main/x.md`）。
 * 返回 null 表示 App 内没有对应页面。
 */
export function routeForGithubPath(path: string): Route | null {
  const segs = path.replace(/^\/+/, '').split('/')
  if (segs.length === 0 || !segs[0]) return null
  // 只有一段：用户主页
  if (segs.length === 1) return { kind: 'user', login: segs[0] }
  const owner = segs[0]
  const repo = segs[1]
  if (!repo) return null
  const rest = segs.slice(2)
  const kind = rest[0] ?? ''

  const num = (s: string | undefined): number | null => {
    const n = Number(s)
    return Number.isInteger(n) && n > 0 ? n : null
  }

  switch (kind) {
    case '':
      return { kind: 'repo', owner, repo }
    // blob 与 tree 都映射到代码浏览；ref 取第一段，剩下的是路径
    case 'blob':
    case 'tree': {
      const [ref, ...tail] = rest.slice(1)
      return { kind: 'code', owner, repo, path: tail.join('/'), ref: ref || undefined }
    }
    case 'issues': {
      const n = num(rest[1])
      return n ? { kind: 'issue', owner, repo, number: n } : { kind: 'issues', owner, repo }
    }
    case 'pull':
      return (() => {
        const n = num(rest[1])
        return n ? { kind: 'pull', owner, repo, number: n } : null
      })()
    case 'pulls':
      return { kind: 'pulls', owner, repo }
    case 'commits':
      return {
        kind: 'commits',
        owner,
        repo,
        ref: rest[1] || undefined,
        path: rest.slice(2).join('/') || undefined,
      }
    case 'actions':
      return { kind: 'actions', owner, repo }
    // releases / tags / wiki / discussions / security 等页面 App 还没有，走外部
    default:
      return null
  }
}

/**
 * 把 Markdown 里的地址解析成动作。
 *
 * 认这几种写法：
 * - `#小节` → 自述内部滚动
 * - `https://github.com/a/b/...` → 加速前缀 + 同一段路径
 * - `https://example.com/x` → 原样（不碰非 GitHub 的站点）
 * - `/docs/x.md` → 仓库根相对
 * - `x.md` / `../img/a.png` → 自述所在目录相对
 */
export function resolveHref(href: string, ctx: LinkContext): LinkTarget | null {
  const s = safeHref(href)
  if (!s) return null
  if (s.startsWith('#')) {
    const id = s.slice(1)
    return id ? { kind: 'anchor', id } : null
  }
  if (/^(?:mailto:|tel:)/i.test(s)) return { kind: 'external', url: s }

  if (/^https?:\/\//i.test(s)) {
    const m = /^https?:\/\/(?:www\.)?github\.com(\/[^\s]*)?$/i.exec(s)
    // 非 GitHub 站点原样打开；GitHub 的换成加速地址，并尽量给 App 内路由
    if (!m) return { kind: 'external', url: s }
    const route = routeForGithubPath(m[1] ?? '/')
    return { kind: 'external', url: githubUrlAt(ctx.mirror, m[1] || '/'), route: route ?? undefined }
  }

  const [pathPart, hash] = splitHash(s)
  if (!pathPart) return hash ? { kind: 'anchor', id: hash } : null
  const tail = hash ? `#${hash}` : ''
  const repoPath = pathPart.startsWith('/')
    ? pathPart.replace(/^\/+/, '')
    : joinPath(dirOf(ctx.basePath), pathPart)
  if (!repoPath) return null
  const blob = `${ctx.owner}/${ctx.repo}/blob/${ctx.branch || 'main'}/${repoPath}${tail}`
  const route: Route = { kind: 'code', owner: ctx.owner, repo: ctx.repo, path: repoPath, ref: ctx.branch || undefined }
  return { kind: 'external', url: githubUrlAt(ctx.mirror, blob), route }
}

/**
 * 链接指向的是不是仓库内的文件/目录。
 *
 * 用来决定副标题文案（「打开文件」还是「浏览器打开」）—— 两者都走
 * 外部浏览器，但对用户来说「文件」和「网站」的心理预期不一样。
 */
export function isRepoPath(href: string): boolean {
  const s = safeHref(href)
  if (!s) return false
  if (/^https?:\/\//i.test(s)) return /^https?:\/\/(?:www\.)?github\.com\//i.test(s)
  return !s.startsWith('#') && !/^(?:mailto:|tel:)/i.test(s)
}
