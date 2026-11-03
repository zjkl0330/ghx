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
  updated_at?: string
  /** 搜索接口会返回，普通列表不一定有；热门页用它算日均 star */
  created_at?: string
  topics?: string[]
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

/** 工作流状态：active 正常；disabled_manually 手动停用；disabled_inactivity 因长期无活动被自动停用。 */
export type WorkflowState = 'active' | 'disabled_manually' | 'disabled_inactivity'

export interface Workflow {
  id: number
  name: string
  path: string
  state: WorkflowState
  html_url?: string
  updated_at?: string
}

export type RunStatus = 'queued' | 'in_progress' | 'completed' | 'requested' | 'waiting' | 'pending'

export type RunConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required'
  | 'neutral'
  | 'stale'
  | null

export interface WorkflowRun {
  id: number
  name: string | null
  display_title?: string
  head_branch: string | null
  head_sha: string
  event: string
  status: RunStatus
  conclusion: RunConclusion
  run_number: number
  workflow_id: number
  created_at: string
  run_started_at?: string | null
  updated_at: string
  html_url: string
  path?: string
  actor?: { login: string } | null
}

export interface WorkflowStep {
  name: string
  status: RunStatus
  conclusion: RunConclusion
  number: number
}

export interface WorkflowJob {
  id: number
  name: string
  status: RunStatus
  conclusion: RunConclusion
  started_at: string | null
  completed_at: string | null
  steps?: WorkflowStep[]
}

export interface ReleaseAsset {
  id: number
  name: string
  size: number
  download_count: number
  browser_download_url: string
  content_type?: string
}

export interface Release {
  id: number
  tag_name: string
  name: string | null
  body: string | null
  draft: boolean
  prerelease: boolean
  created_at: string
  published_at: string | null
  html_url: string
  assets: ReleaseAsset[]
}

/** 复刻沿用仓库结构，只多一个创建时间，用于「复刻于」展示。 */
export type Fork = Repo & { created_at: string }

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
    | 'workflow'
    | 'release'
    | 'fork'
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
