/**
 * 多账号视图模型。
 *
 * 保险库本来就能存多条令牌，但界面一直按「唯一令牌」展示：
 * 列表里只有名字和指纹，分不清哪条是哪个 GitHub 账号。
 * 这里把 TokenRecord 整理成账号视图，让切换、排序、提示都有统一口径。
 *
 * 纯逻辑，不碰网络与存储 —— 单测直接喂假数据。
 */

import type { TokenKind, TokenRecord, TokenStatus } from './types'

export interface AccountView {
  id: string
  /** 列表里的主标题：优先 @login，未校验时退回令牌名 */
  label: string
  name: string
  login: string | null
  avatarUrl: string | null
  kind: TokenKind
  /** 脱敏指纹，登录名缺失时用来区分同名的两个令牌 */
  preview: string
  active: boolean
  status: TokenStatus
  expiresAt: string | null
  /** 是否已经联网确认过归属。没确认的账号切过去可能拿不到仓库列表 */
  verified: boolean
}

/** 令牌名兜底。用户可能导入时没写名字，别在界面上留空白。 */
export function accountLabel(rec: Pick<TokenRecord, 'login' | 'name'>): string {
  const login = rec.login?.trim()
  if (login) return `@${login}`
  const name = rec.name?.trim()
  return name || '未命名令牌'
}

/**
 * 当前账号置顶，其余保持导入顺序。
 *
 * 不做字母排序是有意的：用户记住的是「第二个是我小号」，
 * 按名字重排会让每次切完账号列表都跳一下。
 */
export function buildAccounts(records: TokenRecord[], activeId: string | null): AccountView[] {
  const views = records.map<AccountView>((r) => ({
    id: r.id,
    label: accountLabel(r),
    name: r.name,
    login: r.login ?? null,
    avatarUrl: r.avatarUrl ?? null,
    kind: r.kind,
    preview: r.preview,
    active: r.id === activeId,
    status: r.lastStatus,
    expiresAt: r.expiresAt ?? null,
    verified: !!r.login,
  }))

  if (!activeId) return views
  const idx = views.findIndex((v) => v.id === activeId)
  if (idx <= 0) return views
  return [views[idx], ...views.slice(0, idx), ...views.slice(idx + 1)]
}

/** 当前账号；没有选中或列表为空时返回 null */
export function activeAccount(records: TokenRecord[], activeId: string | null): AccountView | null {
  return buildAccounts(records, activeId).find((v) => v.active) ?? null
}

/**
 * 下一个要切的账号，用于「长按头像快速轮换」。
 * 只有一个账号时返回 null —— 没有可切的，调用方别弹提示。
 */
export function nextAccount(records: TokenRecord[], activeId: string | null): TokenRecord | null {
  if (records.length < 2) return null
  const idx = records.findIndex((r) => r.id === activeId)
  if (idx < 0) return records[0]
  return records[(idx + 1) % records.length]
}

/** 切换后的提示文案。带上登录名，切完一眼能确认切对了。 */
export function switchMessage(view: AccountView | null): string {
  if (!view) return '已切换账号'
  if (!view.verified) return `已切到「${view.name}」，尚未校验归属`
  return `已切到 ${view.label}`
}

/**
 * 切账号必须清掉的界面状态。
 *
 * 返回的是「要不要重置」而不是直接改 state —— App 里状态太多，
 * 这里只定义规则，具体 setter 由调用方执行，方便单测。
 */
export function needsAccountReset(prevId: string | null, nextId: string | null): boolean {
  return prevId !== nextId
}

/**
 * 账号列表的副标题。
 * 多个账号时点明「当前是谁」，只有一个时不啰嗦。
 */
export function accountsSummary(records: TokenRecord[], activeId: string | null): string {
  if (records.length === 0) return '还没有账号'
  const cur = activeAccount(records, activeId)
  const who = cur ? cur.label : '未选中'
  if (records.length === 1) return `当前 ${who}`
  return `${records.length} 个账号 · 当前 ${who}`
}
