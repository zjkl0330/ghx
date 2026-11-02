import type { GitHubClient } from './api'
import type { BatchResult, Repo, Visibility, VisibilityPlan } from './types'

export interface RepoFilter {
  query?: string
  visibility?: 'all' | 'public' | 'private'
  includeArchived?: boolean
}

/** GitHub 返回的 owner 是对象，平铺成 login；个别端点直接给字符串。 */
export interface RawRepo extends Omit<Repo, 'owner'> {
  owner: string | { login: string }
}

/**
 * 归一化仓库对象。不做这一步，`setVisibility(r.owner, ...)` 会拼出
 * `/repos/[object Object]/x`，请求必然 404——这是真实踩过的坑。
 */
export function normalizeRepo(raw: RawRepo): Repo {
  const o = raw.owner as string | { login?: string } | undefined
  const owner = typeof o === 'string' ? o : (o?.login ?? '')
  return { ...raw, owner }
}

/** 纯函数：本地筛选，不发请求。查询同时匹配 name 与 description。 */
export function filterRepos(repos: Repo[], filter: RepoFilter = {}): Repo[] {
  const q = (filter.query ?? '').trim().toLowerCase()
  return repos.filter((r) => {
    if (!filter.includeArchived && r.archived) return false
    if (filter.visibility === 'public' && r.private) return false
    if (filter.visibility === 'private' && !r.private) return false
    if (!q) return true
    return (
      r.name.toLowerCase().includes(q) ||
      r.full_name.toLowerCase().includes(q) ||
      (r.description ?? '').toLowerCase().includes(q)
    )
  })
}

export function countBy(repos: Repo[]) {
  const total = repos.length
  const privateCount = repos.filter((r) => r.private).length
  const archived = repos.filter((r) => r.archived).length
  return { total, private: privateCount, public: total - privateCount, archived }
}

/**
 * 生成批量修改计划。把“公开转私有会掉 star”和“无 admin 权限”提前暴露，
 * 让确认层能逐条显示风险，而不是等接口返回 422 再猜原因。
 */
export function buildPlan(repos: Repo[], to: Visibility): VisibilityPlan[] {
  return repos.map((repo) => {
    const from = repo.visibility
    const destructive = from === 'public' && to === 'private'
    const admin = repo.permissions?.admin
    const blocked = admin === false
    return {
      repo,
      from,
      to,
      destructive,
      blocked,
      reason: blocked ? '无 admin 权限，组织策略通常会拒绝' : undefined,
    }
  })
}

export interface BatchOptions {
  /** 每条之间的间隔，规避 secondary rate limit */
  gapMs?: number
  signal?: AbortSignal
  onProgress?: (done: number, total: number, last: BatchResult) => void
}

/**
 * 串行执行批量修改。单条失败不影响后续，结果逐条返回。
 * 串行而非并发是刻意的：GitHub 对并发写操作有 secondary limit，
 * 并发 10 条比串行 10 条更容易被 403。
 */
export async function runBatch(
  client: GitHubClient,
  plan: VisibilityPlan[],
  opts: BatchOptions = {},
): Promise<BatchResult[]> {
  const gap = opts.gapMs ?? 350
  const results: BatchResult[] = []
  let done = 0

  for (const item of plan) {
    if (opts.signal?.aborted) break

    if (item.blocked) {
      const r: BatchResult = {
        repo: item.repo.full_name,
        status: 'failed',
        message: item.reason ?? '权限不足',
      }
      results.push(r)
      done += 1
      opts.onProgress?.(done, plan.length, r)
      continue
    }

    if (item.from === item.to) {
      const r: BatchResult = { repo: item.repo.full_name, status: 'ok', message: '已是目标状态' }
      results.push(r)
      done += 1
      opts.onProgress?.(done, plan.length, r)
      continue
    }

    try {
      await client.setVisibility(item.repo.owner, item.repo.name, item.to)
      const r: BatchResult = { repo: item.repo.full_name, status: 'ok' }
      results.push(r)
      done += 1
      opts.onProgress?.(done, plan.length, r)
    } catch (err) {
      const e = err as { message?: string; status?: number }
      const r: BatchResult = {
        repo: item.repo.full_name,
        status: 'failed',
        message: e.message ?? '未知错误',
        httpStatus: e.status,
      }
      results.push(r)
      done += 1
      opts.onProgress?.(done, plan.length, r)
    }

    if (gap > 0) await sleep(gap)
  }

  return results
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
