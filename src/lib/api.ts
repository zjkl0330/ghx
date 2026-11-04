import { ResponseCache, ttlFor } from './cache'
import {
  findChineseReadmeLink,
  normalizeReadme,
  pickChineseReadmeFile,
  readmeDir,
  type ContentEntry,
  type RawReadme,
  type ReadmeFile,
} from './readme'
import { normalizeRepo, type RawRepo } from './repos'
import { parseLink } from './paging'
import type {
  Fork,
  Page,
  RateLimit,
  Release,
  Visibility,
  Workflow,
  WorkflowJob,
  WorkflowRun,
} from './types'

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
    case 409:
      return '资源状态冲突：工作流可能已停用，或该操作与当前状态不符'
    case 422:
      if (raw.message?.includes('workflow_dispatch')) {
        return '该工作流没有 workflow_dispatch 触发器，不能手动运行'
      }
      if (raw.message?.toLowerCase().includes('no ref found')) {
        return '分支或标签不存在，检查 ref 后重试'
      }
      if (raw.message?.includes('already_exists')) {
        return '同名资源已存在'
      }
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
 * 各领域模块只需要「发请求 + 缓存」这一件事，不必依赖整个客户端。
 * 这样单测里塞一个假对象就能测业务逻辑，不用起 fetch。
 */
export type ApiClient = Pick<GitHubClient, 'request'>

/**
 * GitHub REST 客户端。只做传输与归一化，不含业务判断。
 * baseUrl 可指向镜像，用于直连 github.com 不通时的降级。
 */
export class GitHubClient {
  readonly baseUrl: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch
  /** 请求级缓存，跟着 client 走：换令牌就是新实例，不会串数据 */
  private readonly cache = new ResponseCache()
  rate: RateLimit | null = null
  scopes: string[] = []

  constructor(opts: ClientOptions) {
    this.token = opts.token
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  /** 手动清缓存。刷新按钮与下拉刷新用得到 */
  clearCache(prefix?: string): void {
    this.cache.invalidate(prefix)
  }

  /** 给需要裸 fetch 的接口（日志 zip、附件上传）取令牌，不要拿去打日志 */
  get authToken(): string {
    return this.token
  }

  get cacheSize(): number {
    return this.cache.size
  }

  /**
   * 统一的请求入口。
   * GET 默认走缓存（TTL 按路径分档）；传 fresh 可强制回源，轮询与刷新按钮用它。
   * 写操作成功后按前缀清掉受影响的缓存，保证改完立刻能看见新数据。
   *
   * conditional=true 时会带上 If-None-Match，304 直接复用本地那份，
   * 用于通知这类「高频轮询但大部分时候没变化」的接口。
   */
  async request<T>(
    path: string,
    init: RequestInit = {},
    opts: { fresh?: boolean; conditional?: boolean } = {},
  ): Promise<Page<T>> {
    const method = (init.method ?? 'GET').toUpperCase()
    // 条件请求必须真的打网络（304 很便宜），所以不读缓存；但拿到新数据仍要写回去
    const readCache = method === 'GET' && !opts.fresh && !opts.conditional
    const writeCache = method === 'GET' && !opts.fresh

    if (readCache) {
      const hit = this.cache.getEntry<T>(path, ttlFor(path))
      // 命中时带上当前配额信息，避免把很久以前的剩余次数显示给用户
      if (hit) return { data: hit.value, rate: this.rate, scopes: this.scopes, link: parseLink(null) }
    }

    // 条件请求要能拿到「过期了但还留着」的那份，所以用 peek 而不是 get
    const stale = method === 'GET' && opts.conditional ? this.cache.peek<T>(path) : null

    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`
    const res = await this.fetchImpl(url, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(stale?.etag ? { 'If-None-Match': stale.etag } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    })

    const rate = this.readRate(res.headers)
    this.rate = rate
    const scopes0 = res.headers.get('x-oauth-scopes')
    if (scopes0 !== null) {
      this.scopes = scopes0
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
    const link = parseLink(res.headers.get('link'))
    const etag = res.headers.get('etag') ?? undefined

    // 304：没变化，把本地那份的时间戳刷新一下，界面照常渲染，只是知道「无新数据」
    if (res.status === 304) {
      if (stale) this.cache.set(path, stale.value, Date.now(), stale.etag)
      return { data: (stale?.value ?? null) as T, rate, scopes: this.scopes, link, notModified: true }
    }

    if (res.status === 204) {
      if (method !== 'GET') this.cache.applyInvalidation(method, path)
      return { data: null as T, rate, scopes: this.scopes, link }
    }

    const text = await res.text()
    const body: unknown = text ? safeJson(text) : null

    if (!res.ok) {
      if (res.status === 403 && rate && rate.remaining === 0) {
        throw new RateLimitError(rate.reset)
      }
      throw new GitHubError(describeError(res.status, body), res.status, body)
    }

    if (writeCache) this.cache.set(path, body as T, Date.now(), etag)
    if (method !== 'GET') this.cache.applyInvalidation(method, path)

    return { data: body as T, rate, scopes: this.scopes, link }
  }

  /**
   * 取纯文本（diff、raw 文件）。这类响应体积可能很大，而且「看一次就够了」，
   * 不进 JSON 缓存，也不做 ETag 协商。
   */
  async rawText(
    path: string,
    opts: { accept?: string; maxBytes?: number } = {},
  ): Promise<{ text: string; status: number; rate: RateLimit | null; truncated: boolean }> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`
    const res = await this.fetchImpl(url, {
      headers: {
        Accept: opts.accept ?? 'application/vnd.github.raw',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    const rate = this.readRate(res.headers)
    this.rate = rate
    if (!res.ok) {
      const text = await res.text()
      throw new GitHubError(describeError(res.status, safeJson(text)), res.status, safeJson(text))
    }
    const text = await res.text()
    const limit = opts.maxBytes ?? 2_000_000
    if (text.length > limit) {
      return { text: text.slice(0, limit), status: res.status, rate, truncated: true }
    }
    return { text, status: res.status, rate, truncated: false }
  }

  /**
   * 上传发行版附件这条路走不通，留个记录免得以后又试一遍。
   *
   * 端点本身没问题：`POST https://uploads.github.com/repos/{o}/{r}/releases/{id}/assets?name=x`
   * 用 curl 带令牌直传能拿到 201。问题在跨域 —— 这个域名（以及它前面的 Azure Blob）
   * 响应里**没有** `Access-Control-Allow-Origin`，预检也过不去，
   * 所以 WebView 里的 fetch 无论怎么发都读不到结果，原生 CapacitorHttp 也不支持
   * 二进制请求体（JS 字符串过桥后按 UTF-8 编码，会把 APK 传坏）。
   * 因此界面上不提供上传，只给「网页上传」入口。
   */

  private readRate(headers: Headers): RateLimit | null {
    const limit = headers.get('x-ratelimit-limit')
    const remaining = headers.get('x-ratelimit-remaining')
    const reset = headers.get('x-ratelimit-reset')
    if (!limit || !remaining || !reset) return null
    return { limit: Number(limit), remaining: Number(remaining), reset: Number(reset) }
  }

  /** 当前登录用户，用于确认令牌归属。 */
  async whoami() {
    return this.request<{ login: string; name: string | null; id: number; avatar_url?: string }>('/user')
  }

  /** 分页拉取当前账号可见的仓库，按最近推送排序。 */
  async listRepos(page = 1, perPage = 30, fresh = false) {
    const query = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
      sort: 'pushed',
      direction: 'desc',
      affiliation: 'owner,collaborator,organization_member',
    })
    const { data, rate, scopes } = await this.request<RawRepo[]>(`/user/repos?${query.toString()}`, {}, { fresh })
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

  async repo(owner: string, name: string, fresh = false) {
    const { data, rate, scopes } = await this.request<RawRepo>(`/repos/${owner}/${name}`, {}, { fresh })
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

  /**
   * 改仓库简介、主页与话题。
   * topics 走独立端点（PUT，整体覆盖），所以分两次请求；只传变化过的字段，
   * 避免把没动过的简介顺手清空。description 传 null 才是清空，空串会被忽略。
   */
  async updateRepo(
    owner: string,
    name: string,
    patch: { description?: string | null; homepage?: string | null; topics?: string[] },
  ) {
    const body: Record<string, unknown> = {}
    if (patch.description !== undefined) body.description = patch.description
    if (patch.homepage !== undefined) body.homepage = patch.homepage

    if (Object.keys(body).length > 0) {
      await this.request<RawRepo>(`/repos/${owner}/${name}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
    }
    if (patch.topics) {
      await this.request<{ names?: string[] }>(`/repos/${owner}/${name}/topics`, {
        method: 'PUT',
        body: JSON.stringify({ names: patch.topics }),
      })
    }
    // topics 不随 PATCH 返回，改完再取一次，避免界面与服务器不一致
    const { data, rate, scopes } = await this.request<RawRepo>(
      `/repos/${owner}/${name}`,
      {},
      { fresh: true },
    )
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

  /** 我 star 过的仓库，按 star 时间倒序。 */
  async listStarred(page = 1, perPage = 50, fresh = false) {
    const query = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
      sort: 'created',
      direction: 'desc',
    })
    const { data, rate, scopes } = await this.request<RawRepo[]>(
      `/user/starred?${query.toString()}`,
      {},
      { fresh },
    )
    return { data: (data ?? []).map(normalizeRepo), rate, scopes }
  }

  /**
   * 仓库自述。没有 README 时返回 null 而不是抛错 —— 空仓库很正常，
   * 不该让详情页弹一个红色警告。
   */
  async readme(owner: string, name: string, fresh = false): Promise<Page<ReadmeFile | null>> {
    try {
      const res = await this.request<RawReadme>(`/repos/${owner}/${name}/readme`, {}, { fresh })
      return { data: normalizeReadme(res.data), rate: res.rate, scopes: res.scopes }
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) {
        return { data: null, rate: this.rate, scopes: this.scopes }
      }
      throw err
    }
  }

  /**
   * 按路径读一个 markdown 文件。中文版 README 走这里，
   * `GET /repos/{o}/{r}/readme` 只会给默认分支上的默认文件。
   */
  async readmeAt(owner: string, name: string, path: string): Promise<ReadmeFile | null> {
    const encoded = path.split('/').map(encodeURIComponent).join('/')
    try {
      const res = await this.request<RawReadme>(`/repos/${owner}/${name}/contents/${encoded}`)
      return normalizeReadme(res.data)
    } catch (err) {
      if (err instanceof GitHubError && (err.status === 404 || err.status === 403)) return null
      throw err
    }
  }

  /**
   * 找仓库自带的中文版 README。
   * 优先用 README 顶部「English | 简体中文」链接指向的文件（作者自己的选择），
   * 没有链接就列目录按命名习惯猜（README.zh-CN.md 那一类）。
   * 找到后直接显示，比机翻准得多，也不消耗翻译额度。
   */
  async chineseReadme(owner: string, name: string, readme: ReadmeFile): Promise<ReadmeFile | null> {
    const linked = findChineseReadmeLink(readme.text, readme.path)
    if (linked) {
      const direct = await this.readmeAt(owner, name, linked)
      if (direct) return direct
    }

    const dir = readmeDir(readme.path)
    const encoded = dir.split('/').filter(Boolean).map(encodeURIComponent).join('/')
    try {
      const res = await this.request<ContentEntry[]>(
        `/repos/${owner}/${name}/contents${encoded ? `/${encoded}` : ''}`,
      )
      const path = pickChineseReadmeFile(res.data, readme.path)
      if (!path) return null
      return await this.readmeAt(owner, name, path)
    } catch {
      return null
    }
  }

  /**
   * 搜索仓库。热门页用它代替官方 trending —— GitHub 没有 trending API，
   * 这里按「最近创建 + star 排序」取新晋热门，语义写入界面文案里。
   * sort 传 best 时不带排序参数，交给 GitHub 的相关性排序。
   */
  async searchRepos(
    q: string,
    opts: {
      page?: number
      perPage?: number
      sort?: 'best' | 'stars' | 'forks' | 'updated'
      fresh?: boolean
    } = {},
  ) {
    const sort = opts.sort ?? 'stars'
    const query = new URLSearchParams({
      q,
      per_page: String(opts.perPage ?? 30),
      page: String(opts.page ?? 1),
    })
    if (sort !== 'best') {
      query.set('sort', sort)
      query.set('order', 'desc')
    }
    const { data, rate, scopes } = await this.request<{
      total_count: number
      incomplete_results: boolean
      items: RawRepo[]
    }>(`/search/repositories?${query.toString()}`, {}, { fresh: opts.fresh })
    return {
      data: (data?.items ?? []).map(normalizeRepo),
      total: data?.total_count ?? 0,
      rate,
      scopes,
    }
  }

  /** 仓库里所有工作流。Actions 未启用时返回空数组而不是报错。 */
  async listWorkflows(owner: string, name: string, fresh = false) {
    const { data, rate, scopes } = await this.request<{ total_count: number; workflows: Workflow[] }>(
      `/repos/${owner}/${name}/actions/workflows?per_page=100`,
      {},
      { fresh },
    )
    return { data: data?.workflows ?? [], rate, scopes }
  }

  /** 启用或停用工作流。停用只是禁止触发，文件本身不动。 */
  async setWorkflowEnabled(owner: string, name: string, id: number, enabled: boolean) {
    return this.request<null>(
      `/repos/${owner}/${name}/actions/workflows/${id}/${enabled ? 'enable' : 'disable'}`,
      { method: 'PUT' },
    )
  }

  /**
   * 手动触发 workflow_dispatch。GitHub 立即返回 204，真正的运行是异步的，
   * 所以调用方要提示「已进入队列」而不是「已完成」。
   */
  async dispatchWorkflow(
    owner: string,
    name: string,
    id: number,
    ref: string,
    inputs?: Record<string, string>,
  ) {
    return this.request<null>(`/repos/${owner}/${name}/actions/workflows/${id}/dispatches`, {
      method: 'POST',
      body: JSON.stringify(inputs ? { ref, inputs } : { ref }),
    })
  }

  /** 最近运行记录，可按工作流或分支过滤。 */
  async listRuns(
    owner: string,
    name: string,
    opts: { workflowId?: number; branch?: string; perPage?: number; fresh?: boolean } = {},
  ) {
    const query = new URLSearchParams({ per_page: String(opts.perPage ?? 20) })
    if (opts.branch) query.set('branch', opts.branch)
    const base =
      opts.workflowId != null
        ? `/repos/${owner}/${name}/actions/workflows/${opts.workflowId}/runs`
        : `/repos/${owner}/${name}/actions/runs`
    const { data, rate, scopes } = await this.request<{ total_count: number; workflow_runs: WorkflowRun[] }>(
      `${base}?${query.toString()}`,
      {},
      { fresh: opts.fresh },
    )
    return { data: data?.workflow_runs ?? [], rate, scopes }
  }

  async listJobs(owner: string, name: string, runId: number, fresh = false) {
    const { data, rate, scopes } = await this.request<{ total_count: number; jobs: WorkflowJob[] }>(
      `/repos/${owner}/${name}/actions/runs/${runId}/jobs?per_page=30`,
      {},
      { fresh },
    )
    return { data: data?.jobs ?? [], rate, scopes }
  }

  async cancelRun(owner: string, name: string, runId: number) {
    return this.request<null>(`/repos/${owner}/${name}/actions/runs/${runId}/cancel`, { method: 'POST' })
  }

  async rerunRun(owner: string, name: string, runId: number) {
    return this.request<null>(`/repos/${owner}/${name}/actions/runs/${runId}/rerun`, { method: 'POST' })
  }

  async listReleases(owner: string, name: string, page = 1, perPage = 20, fresh = false) {
    const query = new URLSearchParams({ per_page: String(perPage), page: String(page) })
    const { data, rate, scopes } = await this.request<Release[]>(
      `/repos/${owner}/${name}/releases?${query.toString()}`,
      {},
      { fresh },
    )
    return { data: data ?? [], rate, scopes }
  }

  /** 新建发行版。tag 不存在时 GitHub 会按 target_commitish 创建标签。 */
  async createRelease(
    owner: string,
    name: string,
    input: { tag: string; title?: string; body?: string; prerelease?: boolean; draft?: boolean; target?: string },
  ) {
    const { data, rate, scopes } = await this.request<Release>(`/repos/${owner}/${name}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: input.tag,
        name: input.title || input.tag,
        body: input.body ?? '',
        draft: input.draft ?? false,
        prerelease: input.prerelease ?? false,
        ...(input.target ? { target_commitish: input.target } : {}),
      }),
    })
    return { data, rate, scopes }
  }

  async deleteRelease(owner: string, name: string, id: number) {
    return this.request<null>(`/repos/${owner}/${name}/releases/${id}`, { method: 'DELETE' })
  }

  async listForks(owner: string, name: string, page = 1, perPage = 30, fresh = false) {
    const query = new URLSearchParams({ per_page: String(perPage), page: String(page), sort: 'newest' })
    const { data, rate, scopes } = await this.request<RawRepo[]>(
      `/repos/${owner}/${name}/forks?${query.toString()}`,
      {},
      { fresh },
    )
    return { data: (data ?? []).map((r) => normalizeRepo(r) as Fork), rate, scopes }
  }

  /** 复刻到当前账号。GitHub 返回 202，复刻是后台队列任务。 */
  async createFork(owner: string, name: string) {
    const { data, rate, scopes } = await this.request<RawRepo>(`/repos/${owner}/${name}/forks`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    return { data: data ? (normalizeRepo(data) as Fork) : null, rate, scopes }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return { message: text.slice(0, 200) }
  }
}
