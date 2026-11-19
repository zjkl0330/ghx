/**
 * 剪贴板里的一串文字，能不能变成一个可跳转的页面。
 *
 * 场景：在浏览器/微信里看到 `github.com/a/b`，复制，切回 App —— 应该直接落到
 * 那个仓库，而不是让人重新搜一遍。目标用户打不开 github.com，这个入口往往比
 * 搜索更快。
 *
 * 三条硬规矩：
 * 1. **只认带 github.com 的地址**。裸 `owner/repo` 不接：`src/lib`、`docs/api`
 *    这类东西在代码里到处都是，误判的代价是把人从当前页面硬生生弹走。
 * 2. **疑似令牌的内容一律不碰**。剪贴板里可能是 `ghp_...`，读了不能留、不能记，
 *    连指纹都不写 —— 指纹虽然不可逆，但没有理由把凭据的存在痕迹落盘。
 * 3. **指纹而非原文落盘**。用于「同一条内容只跳一次」，原文只在内存里过一遍。
 */

import type { Route } from './routes'

/** 是否开启「切回来读剪贴板」。老版本没有这个键，默认开 */
export const CLIP_OPEN_KEY = 'ghx.clip.open'
/** 上次处理过的内容指纹。不留原文，只留这一条 */
export const CLIP_SEEN_KEY = 'ghx.clip.seen'

/** 超过这个长度的不可能是「一条链接」，多半是整篇文档，直接放弃 */
const MAX_LEN = 4096

/** 用户名：字母数字开头，可带连字符，上限 39 */
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
/** 仓库名：字母数字点横线下划线，不能是 `.` 或 `..` */
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/

/**
 * github.com 的第一段不是用户名的路径。
 *
 * 不排除的话 `github.com/issues` 会被当成「用户 issues 的仓库 issues」，
 * 跳到一个不存在的仓库上。
 */
const RESERVED = new Set([
  'about', 'account', 'apps', 'blog', 'codespaces', 'collections', 'contact',
  'copilot', 'dashboard', 'enterprise', 'events', 'explore', 'features', 'gist',
  'gists', 'home', 'issues', 'join', 'login', 'marketplace', 'new', 'notifications',
  'organizations', 'orgs', 'pricing', 'pulls', 'readme', 'repositories', 'search',
  'security', 'sessions', 'settings', 'site', 'sponsors', 'stars', 'team', 'topics',
  'trending', 'users', 'watching',
])

/** `git@github.com:owner/repo.git` */
const SSH_RE = /git@github\.com:([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?=$|[\s,，。;；、])/
/**
 * `https://github.com/...`、`github.com/...`、`www.github.com/...`
 *
 * 前面那句 `[^\w.-]` 是边界：没有它，`notgithub.com/a/b` 会被从中间截出
 * `github.com/a/b` 当成真地址。`gist.github.com` 同理被挡住（前面是点）。
 */
const WEB_RE =
  /(?:^|[^\w.-])(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9][^\s<>"'`）)】]*)/i

/** 各类 GitHub 令牌。/ 用于识别「这条内容是凭据，别动」 */
const SECRET_RE =
  /(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9]{20,})/

/** 容错解析开关：只认 '0' 为关，其余（含缺省）都算开 */
export function parseClipOpen(raw: string | null | undefined): boolean {
  return raw !== '0'
}

export function serializeClipOpen(on: boolean): string {
  return on ? '1' : '0'
}

/** 剪贴板里像不像一枚凭据。命中就什么都不做 */
export function looksSecret(text: string): boolean {
  return SECRET_RE.test(text)
}

/**
 * 内容指纹。
 *
 * djb2 + 长度：不保存原文，只用来回答「这条是不是刚处理过的那条」。
 * 加长度是为了压低碰撞 —— 不同内容同哈希且同长度的概率可以忽略。
 */
export function clipFingerprint(text: string): string {
  const s = text.trim()
  let h = 5381
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return `${(h >>> 0).toString(16)}-${s.length}`
}

/** 去掉 URL 尾巴上被顺手带进来的标点与引号 */
function trimTail(s: string): string {
  return s.replace(/[.,;:!?)\]}>"'）】，。；：！？》」』]+$/u, '')
}

/**
 * 把一段剪贴板文字解析成路由。
 *
 * 返回 null 表示「没什么可跳的」，调用方应保持当前页面不动。
 * 支持仓库首页、issue、PR、代码目录/文件、单次提交；认不出的子路径退化成仓库首页。
 */
export function parseClipRoute(text: string): Route | null {
  const raw = (text || '').trim()
  if (!raw || raw.length > MAX_LEN) return null
  if (looksSecret(raw)) return null

  const ssh = SSH_RE.exec(raw)
  if (ssh) return buildRoute(ssh[1], ssh[2].replace(/\.git$/i, ''), [])

  const web = WEB_RE.exec(raw)
  if (!web) return null

  const segs = trimTail(web[1]).split('/').filter(Boolean)
  if (segs.length < 2) {
    // 只有用户名：跳到个人主页。`github.com/issues` 这类靠 RESERVED 挡住
    const only = segs[0]
    if (only && OWNER_RE.test(only) && !RESERVED.has(only.toLowerCase())) {
      return { kind: 'user', login: only }
    }
    return null
  }
  const repo = segs[1].replace(/\.git$/i, '')
  return buildRoute(segs[0], repo, segs.slice(2))
}

function buildRoute(owner: string, repo: string, rest: string[]): Route | null {
  if (!OWNER_RE.test(owner) || RESERVED.has(owner.toLowerCase())) return null
  if (!REPO_RE.test(repo) || repo === '.' || repo === '..') return null

  const [a, b, ...more] = rest
  if (!a) return { kind: 'repo', owner, repo, tab: 'code' }

  if (a === 'issues') {
    if (b && /^\d+$/.test(b)) return { kind: 'issue', owner, repo, number: Number(b) }
    return { kind: 'issues', owner, repo }
  }
  if (a === 'pull') {
    if (b && /^\d+$/.test(b)) return { kind: 'pull', owner, repo, number: Number(b) }
    return { kind: 'pulls', owner, repo }
  }
  if (a === 'pulls') return { kind: 'pulls', owner, repo }
  if (a === 'actions') return { kind: 'actions', owner, repo }
  if (a === 'settings') return { kind: 'admin', owner, repo }
  if (a === 'commit' && b && /^[0-9a-f]{7,40}$/i.test(b)) {
    return { kind: 'commit', owner, repo, sha: b }
  }
  if ((a === 'tree' || a === 'blob') && b) {
    // ref 里本身可以带斜杠（feature/x），URL 上跟路径分不开；
    // 分享链接绝大多数是 main/master，取首段能覆盖绝大多数情况
    return { kind: 'code', owner, repo, ref: b, path: more.join('/') }
  }

  // releases / tags / 分支页之类统一落到仓库首页，不做更细的映射
  return { kind: 'repo', owner, repo, tab: 'code' }
}

/** 给提示语用的短标签，如 `zjkl0330/ghx`、`zjkl0330/ghx #12` */
export function clipRouteLabel(r: Route): string {
  if (r.kind === 'user') return `@${r.login}`
  const repo = 'owner' in r && 'repo' in r ? `${r.owner}/${r.repo}` : ''
  if (!repo) return ''
  if (r.kind === 'issue' || r.kind === 'pull') return `${repo} #${r.number}`
  if (r.kind === 'code') return r.path ? `${repo} · ${r.path}` : repo
  if (r.kind === 'commit') return `${repo} · ${r.sha.slice(0, 7)}`
  return repo
}

/** 这两个页面里有未提交的输入，自动跳转会把它冲掉 */
export function clipBlockedByRoute(r: Route | undefined): boolean {
  if (!r) return false
  return r.kind === 'edit' || r.kind === 'gist'
}
