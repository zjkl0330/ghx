import { normalizeRepo, type RawRepo } from './repos'
import type { Page, RateLimit, Visibility } from './types'

export const DEFAULT_BASE_URL = 'https://api.github.com'

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

export class RateLimitError extends GitHubError {
  constructor(readonly resetAt: number) {
    super('触发 GitHub 限流', 403)
    this.name = 'RateLimitError'
  }
}

interface RawError {
  message?: string
  documentation_url?: string
}

/** 把 GitHub 的错误码翻译成可操作的中文提示，避免用户看到裸 422。 */
export function describeError(status: number, body: unknown): string {
  const raw = (body ?? {}) as RawError
  switch (status) {
    case 401:
      return '令牌无效或已被吊销，请重新导入'
    case 403:
      return raw.message?.includes('rate limit')
        ? '触发限流，请等待配额重置'
        : '权限不足：该令牌没有执行此操作的 scope'
    case 404:
      return '仓库不存在，或令牌无权访问'
    case 422:
      return '组织策略拒绝：可见度可能仅允许 owner 修改'
    case 451:
      return '仓库因法律原因不可用'
    default:
      return status >= 500 ? 'GitHub 服务异常，稍后重试' : raw.message ?? `请求失败 (${status})`
  }
}

export interface ClientOptions {
  token: string
  baseUrl?: string
  fetchImpl?: typeof fetch
}

/**
 * GitHub REST 客户端。只做传输与归一化，不含业务判断。
 * baseUrl 可指向镜像，用于直连 github.com 不通时的降级。
 */
export class GitHubClient {
  readonly baseUrl: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch
  rate: RateLimit | null = null
  scopes: string[] = []

  constructor(opts: ClientOptions) {
    this.token = opts.token
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<Page<T>> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`
    const res = await this.fetchImpl(url, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    })

    const rate = this.readRate(res.headers)
    this.rate = rate
    const scopes = res.headers.get('x-oauth-scopes')
    if (scopes !== null) {
      this.scopes = scopes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }

    if (res.status === 204) return { data: null as T, rate, scopes: this.scopes }

    const text = await res.text()
    const body: unknown = text ? safeJson(text) : null

    if (!res.ok) {
      if (res.status === 403 && rate && rate.remaining === 0) {
        throw new RateLimitError(rate.reset)
      }
      throw new GitHubError(describeError(res.status, body), res.status, body)
    }

    return { data: body as T, rate, scopes: this.scopes }
  }

  private readRate(headers: Headers): RateLimit | null {
    const limit = headers.get('x-ratelimit-limit')
    const remaining = headers.get('x-ratelimit-remaining')
    const reset = headers.get('x-ratelimit-reset')
    if (!limit || !remaining || !reset) return null
    return { limit: Number(limit), remaining: Number(remaining), reset: Number(reset) }
  }

  /** 当前登录用户，用于确认令牌归属。 */
  async whoami() {
    return this.request<{ login: string; name: string | null; id: number }>('/user')
  }

  /** 分页拉取当前账号可见的仓库，按最近推送排序。 */
  async listRepos(page = 1, perPage = 30) {
    const query = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
      sort: 'pushed',
      direction: 'desc',
      affiliation: 'owner,collaborator,organization_member',
    })
    const { data, rate, scopes } = await this.request<RawRepo[]>(`/user/repos?${query.toString()}`)
    return { data: (data ?? []).map(normalizeRepo), rate, scopes }
  }

  /** 修改单个仓库的可见度。需要 Administration: write 权限。 */
  async setVisibility(owner: string, repo: string, visibility: Visibility) {
    const { data, rate, scopes } = await this.request<RawRepo>(`/repos/${owner}/${repo}`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility }),
    })
    return { data: normalizeRepo(data), rate, scopes }
  }

  async repo(owner: string, name: string) {
    const { data, rate, scopes } = await this.request<RawRepo>(`/repos/${owner}/${name}`)
    return { data: normalizeRepo(data), rate, scopes }
  }

  /** 归档/取消归档。归档后仓库变只读，编辑文件、开 issue 都会被拒。 */
  async setArchived(owner: string, name: string, archived: boolean) {
    const { data, rate, scopes } = await this.request<RawRepo>(`/repos/${owner}/${name}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived }),
    })
    return { data: normalizeRepo(data), rate, scopes }
  }

  /** 查询是否已 star。404 表示未 star，不是错误。 */
  async isStarred(owner: string, name: string): Promise<boolean> {
    try {
      await this.request<null>(`/user/starred/${owner}/${name}`)
      return true
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return false
      throw err
    }
  }

  async setStarred(owner: string, name: string, starred: boolean) {
    return this.request<null>(`/user/starred/${owner}/${name}`, {
      method: starred ? 'PUT' : 'DELETE',
    })
  }

  /**
   * 删除仓库。不可恢复，调用方必须先做二次确认。
   * 需要 delete_repo scope，缺 scope 时 GitHub 返回 403。
   */
  async deleteRepo(owner: string, name: string) {
    return this.request<null>(`/repos/${owner}/${name}`, { method: 'DELETE' })
  }

  /** 在当前账号下新建仓库。auto_init 会带一个初始提交，否则是空仓库。 */
  async createRepo(input: {
    name: string
    description?: string
    private: boolean
    autoInit?: boolean
  }) {
    const { data, rate, scopes } = await this.request<RawRepo>('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        description: input.description || null,
        private: input.private,
        auto_init: input.autoInit ?? false,
        has_issues: true,
        has_wiki: false,
      }),
    })
    return { data: normalizeRepo(data), rate, scopes }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return { message: text.slice(0, 200) }
  }
}
