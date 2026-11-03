/** 仓库可见度。GitHub 企业版另有 internal，个人账号不会出现。 */
export type Visibility = 'public' | 'private' | 'internal'

export type TokenKind = 'classic' | 'fine-grained'

export type TokenStatus = 'ok' | 'expiring' | 'expired' | 'invalid' | 'unknown'

/** 保险库中的一条令牌记录。密文与记录分开存放，避免明文混进列表。 */
export interface TokenRecord {
  id: string
  name: string
  kind: TokenKind
  /** 脱敏后的指纹，如 github_pat_11••••4f2a */
  preview: string
  createdAt: string
  expiresAt: string | null
  scopes: string[]
  login: string | null
  lastCheckedAt: string | null
  lastStatus: TokenStatus
  baseUrl: string
}

export interface Repo {
  id: number
  name: string
  full_name: string
  owner: string
  private: boolean
  visibility: Visibility
  archived: boolean
  disabled: boolean
  description: string | null
  language: string | null
  stargazers_count: number
  forks_count: number
  pushed_at: string
  default_branch: string
  /** /user/repos 会返回；缺失时按“未知权限”处理，不预判为 blocked */
  permissions?: { admin: boolean; maintain?: boolean; push: boolean; pull: boolean }
}

export interface RateLimit {
  limit: number
  remaining: number
  /** UTC 秒级时间戳 */
  reset: number
}

export interface Page<T> {
  data: T
  rate: RateLimit | null
  scopes: string[]
}

export type BatchStatus = 'ok' | 'failed'

export interface BatchResult {
  repo: string
  status: BatchStatus
  message?: string
  httpStatus?: number
}

export interface AuditEntry {
  id: string
  at: string
  action:
    | 'visibility'
    | 'token-add'
    | 'token-remove'
    | 'token-check'
    | 'unlock'
    | 'repo-star'
    | 'repo-archive'
    | 'repo-delete'
    | 'repo-create'
    | 'security'
  target: string
  result: 'ok' | 'failed'
  detail: string
}

/** 批量修改前对单条仓库的判定，用于在确认层里提前暴露风险。 */
export interface VisibilityPlan {
  repo: Repo
  from: Visibility
  to: Visibility
  /** 公开转私有会丢 star 与 watcher */
  destructive: boolean
  /** 无 admin 权限或组织策略禁止，预判会 422 */
  blocked: boolean
  reason?: string
}
