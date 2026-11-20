/**
 * 多账号并行工作区。
 *
 * 每个账号一份「现场」：停在哪个页面、列表有什么、筛了什么、钉了哪些仓库。
 * 切走时存下来，切回来原样恢复 —— 早先切账号会把这一切清空，等于每次都要重走一遍。
 *
 * 这里只做不可变的表操作，不碰 React 也不碰存储，方便单测。
 */

import type { RepoFilterVisibility } from './repos'
import type { Route } from './routes'
import type { RepoSort } from './sort'
import type { Repo } from './types'

export interface Workspace {
  /** 路由栈：切回来还停在上次的那个 Issue / 文件页 */
  routeStack: Route[]
  repos: Repo[]
  /** 列表来自本地快照的时间戳；null 表示就是刚拉的 */
  snapshotAt: number | null
  query: string
  visibility: RepoFilterVisibility
  sort: RepoSort
  unread: number
  /** 置顶的仓库（full_name） */
  pins: string[]
}

export type WorkspaceTable = Record<string, Workspace>

export function emptyWorkspace(sort: RepoSort): Workspace {
  return {
    routeStack: [],
    repos: [],
    snapshotAt: null,
    query: '',
    visibility: 'all',
    sort,
    unread: 0,
    pins: [],
  }
}

/**
 * 存一份现场。同一账号再存就是覆盖，别的账号不受影响。
 * 存副本（浅拷贝）而不是引用：外面那份 state 还在被 React 改，直接把对象塞进表里
 * 会让下次读出来的「历史现场」跟着变。
 */
export function saveWorkspace(table: WorkspaceTable, id: string, ws: Workspace): WorkspaceTable {
  if (!id) return table
  // 数组字段要各复制一份：`{...ws}` 只拷引用，外面继续 push 会把「历史现场」也改掉
  return {
    ...table,
    [id]: { ...ws, routeStack: [...ws.routeStack], repos: [...ws.repos], pins: [...ws.pins] },
  }
}

/** 取现场。没有就返回 null，由调用方决定怎么初始化（通常是读本地快照） */
export function restoreWorkspace(table: WorkspaceTable, id: string): Workspace | null {
  return table[id] ?? null
}

/**
 * 丢掉现场。不传 id 清空整表（锁定保险库时用）。
 * 删号只丢那一个账号的，别顺手把其它账号的位置也清了。
 */
export function dropWorkspace(table: WorkspaceTable, id?: string): WorkspaceTable {
  if (!id) return {}
  if (!(id in table)) return table
  const next = { ...table }
  delete next[id]
  return next
}

/**
 * 只更新现场里的某几个字段。
 * 用于「不在 activate 流程里也要改一处」的场景，比如未读角标变了。
 */
export function patchWorkspace(
  table: WorkspaceTable,
  id: string,
  patch: Partial<Workspace>,
): WorkspaceTable {
  const cur = table[id]
  if (!cur) return table
  return { ...table, [id]: { ...cur, ...patch } }
}

/** 这份现场值不值得信任：有列表内容，或者至少停在某个页面上 */
export function hasContent(ws: Workspace | null): boolean {
  if (!ws) return false
  return ws.repos.length > 0 || ws.routeStack.length > 0
}
