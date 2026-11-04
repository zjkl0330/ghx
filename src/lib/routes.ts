/**
 * 路由栈。
 *
 * 早期版本用 `screenStack: Screen[]`，页面种类一多就撑不住：
 * Issue 详情要带编号、文件浏览要带路径，字符串枚举塞不进去。
 * 这里换成可序列化的判别联合，页面 = 数据，返回栈 = 数组。
 *
 * 约定：
 * - 第一层（主界面）不占栈位，`routeStack` 为空就代表在主界面；
 * - 进入目录时压一条新的 code 路由，返回自然就回到上一级目录；
 * - 所有字段都是原始类型，方便以后落盘做「恢复上次位置」。
 */

export type RepoRef = { owner: string; repo: string }

export type Route =
  | { kind: 'profile' }
  | { kind: 'settings' }
  | { kind: 'tokens' }
  | { kind: 'audit' }
  | { kind: 'notifications' }
  | { kind: 'search' }
  | { kind: 'user'; login: string }
  /** 仓库主页，带一个当前页签；页签切换就地替换，不压栈 */
  | { kind: 'repo'; owner: string; repo: string; tab?: RepoTab }
  | { kind: 'issues'; owner: string; repo: string }
  | { kind: 'issue'; owner: string; repo: string; number: number }
  | { kind: 'pulls'; owner: string; repo: string }
  | { kind: 'pull'; owner: string; repo: string; number: number }
  /** 代码浏览：目录与文件共用，path 为空表示仓库根 */
  | { kind: 'code'; owner: string; repo: string; path: string; ref?: string }
  /** 编辑/新建文件。sha 是乐观锁，远端变过就会被 GitHub 409 拒掉 */
  | { kind: 'edit'; owner: string; repo: string; path: string; ref?: string; sha?: string }
  /** 提交历史。带 path 就是「这个文件的历史」 */
  | { kind: 'commits'; owner: string; repo: string; path?: string; ref?: string }
  /** 单次提交：提交信息 + 改动文件 + diff */
  | { kind: 'commit'; owner: string; repo: string; sha: string }
  | { kind: 'refs'; owner: string; repo: string }
  | { kind: 'actions'; owner: string; repo: string }
  | { kind: 'admin'; owner: string; repo: string }

export type RepoTab = 'code' | 'issues' | 'pulls' | 'actions'

/** 压一层。同一个路由连续压两次没意义（连点两下），直接忽略 */
export function pushRoute(stack: Route[], next: Route): Route[] {
  const top = stack[stack.length - 1]
  if (top && routeKey(top) === routeKey(next)) return stack
  return [...stack, next]
}

export function popRoute(stack: Route[]): Route[] {
  return stack.length > 0 ? stack.slice(0, -1) : stack
}

/** 替换栈顶：仓库页签切换、文件内切换 ref 用，不增加返回层级 */
export function replaceTop(stack: Route[], next: Route): Route[] {
  if (stack.length === 0) return [next]
  return [...stack.slice(0, -1), next]
}

/** 稳定且可比较的键，用于 React key 与「同路由去重」 */
export function routeKey(r: Route): string {
  switch (r.kind) {
    case 'user':
      return `user:${r.login.toLowerCase()}`
    case 'repo':
      return `repo:${r.owner}/${r.repo}:${r.tab ?? 'code'}`
    case 'issues':
    case 'pulls':
    case 'refs':
    case 'actions':
    case 'admin':
      return `${r.kind}:${r.owner}/${r.repo}`
    case 'issue':
    case 'pull':
      return `${r.kind}:${r.owner}/${r.repo}#${r.number}`
    case 'code':
      return `code:${r.owner}/${r.repo}:${r.ref ?? ''}:${r.path}`
    case 'edit':
      return `edit:${r.owner}/${r.repo}:${r.ref ?? ''}:${r.path}`
    case 'commits':
      return `commits:${r.owner}/${r.repo}:${r.ref ?? ''}:${r.path ?? ''}`
    case 'commit':
      return `commit:${r.owner}/${r.repo}@${r.sha}`
    default:
      return r.kind
  }
}

/** 这条路由属于哪个仓库；与仓库无关的返回 null */
export function repoOf(r: Route): RepoRef | null {
  if ('owner' in r && 'repo' in r) return { owner: r.owner, repo: r.repo }
  return null
}

/** 路由到顶栏副标题用的短描述 */
export function routeLabel(r: Route): string {
  switch (r.kind) {
    case 'profile':
      return '个人'
    case 'settings':
      return '设置'
    case 'tokens':
      return '令牌'
    case 'audit':
      return '审计日志'
    case 'notifications':
      return '通知'
    case 'search':
      return '搜索'
    case 'user':
      return `@${r.login}`
    case 'repo':
      return `${r.owner}/${r.repo}`
    case 'issues':
      return 'Issues'
    case 'issue':
      return `#${r.number}`
    case 'pulls':
      return 'Pull requests'
    case 'pull':
      return `#${r.number}`
    case 'code':
      return r.path || '代码'
    case 'edit':
      return r.path ? `编辑 ${r.path}` : '新建文件'
    case 'commits':
      return r.path ? `${r.path} 的历史` : '提交历史'
    case 'commit':
      return r.sha.slice(0, 7)
    case 'refs':
      return '分支与标签'
    case 'actions':
      return '工作流'
    case 'admin':
      return '仓库设置'
  }
}

/** 仓库页签名称，给仓库主页用 */
export const REPO_TABS: { key: RepoTab; label: string }[] = [
  { key: 'code', label: '代码' },
  { key: 'issues', label: 'Issues' },
  { key: 'pulls', label: 'PR' },
  { key: 'actions', label: '动作' },
]

/** 把仓库主页切到某个页签 */
export function withRepoTab(r: Route, tab: RepoTab): Route {
  return r.kind === 'repo' ? { ...r, tab } : r
}
