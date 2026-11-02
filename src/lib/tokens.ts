import type { GitHubClient } from './api'
import type { RateLimit, TokenStatus } from './types'

export interface ProbeResult {
  login: string
  name: string | null
  scopes: string[]
  rate: RateLimit | null
  status: TokenStatus
  checkedAt: string
}

/**
 * 联网确认令牌归属与 scopes。注意 classic 令牌的 scopes 来自响应头
 * x-oauth-scopes；fine-grained 令牌该头为空，这是 GitHub 的既有行为，
 * 不代表令牌无效。
 */
export async function probeToken(client: GitHubClient, expiresAt: string | null = null): Promise<ProbeResult> {
  const { data, scopes, rate } = await client.whoami()
  return {
    login: data.login,
    name: data.name,
    scopes,
    rate,
    status: classifyExpiry(expiresAt),
    checkedAt: new Date().toISOString(),
  }
}

/** 剩余天数，向上取整；无过期时间返回 null。 */
export function daysUntil(iso: string | null, now: number = Date.now()): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.ceil((t - now) / 86_400_000)
}

/** 7 天内到期视为 expiring，负数为 expired。 */
export function classifyExpiry(iso: string | null, now: number = Date.now()): TokenStatus {
  const d = daysUntil(iso, now)
  if (d === null) return 'ok'
  if (d < 0) return 'expired'
  if (d <= 7) return 'expiring'
  return 'ok'
}

const RISKY = new Set([
  'admin:org',
  'delete_repo',
  'admin:repo_hook',
  'admin:public_key',
  'write:org',
  'admin:gpg_key',
])

/** 列出具备破坏性的 scope，界面上标红提醒。 */
export function riskyScopes(scopes: string[]): string[] {
  return scopes.filter((s) => RISKY.has(s))
}

/** 修改可见度所需的最小权限判断，仅用于本地预检，最终以接口为准。 */
export function canManageVisibility(scopes: string[], kind: 'classic' | 'fine-grained'): boolean {
  if (kind === 'fine-grained') return true // 细粒度权限不在 scopes 头里，交给接口判定
  if (scopes.length === 0) return false
  return scopes.includes('repo') || scopes.includes('public_repo')
}
