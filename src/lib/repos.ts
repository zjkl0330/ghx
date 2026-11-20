import type { GitHubClient } from './api'
import { mergeTopics } from './topics'
import type { BatchResult, Repo, Visibility, VisibilityPlan } from './types'

/**
 * 批量动作。
 *
 * 早先只有「改可见度」，用户一次选十个仓库想归档还得一个个点。
 * 这里把可见度扩成一个封闭枚举 —— 加动作只加一个分支，不用再写一套循环。
 */
export type BatchAction =
  | { kind: 'visibility'; to: Visibility }
  | { kind: 'archive' }
  | { kind: 'unarchive' }
  | { kind: 'topics'; add: string[] }

export interface BatchPlanItem {
  repo: Repo
  action: BatchAction
  /** 界面上这一行显示的动作描述 */
  label: string
  /** 需要二次确认（公开转私有、归档会让仓库变只读） */
  destructive: boolean
  /** 权限不够，预计会被拒 */
  blocked: boolean
  reason?: string
  /** 已经是目标状态，不用发请求 */
  skip: boolean
}

function actionLabel(repo: Repo, action: BatchAction): string {
  switch (action.kind) {
    case 'visibility':
      return `${repo.visibility === 'private' ? 'Private' : 'Public'} → ${
        action.to === 'private' ? 'Private' : 'Public'
      }`
    case 'archive':
      return '归档'
    case 'unarchive':
      return '取消归档'
    case 'topics':
      return action.add.length ? `加 ${action.add.join(' ')}` : '不加话题'
  }
}

/**
 * 把选中的仓库 + 一个动作翻译成逐条计划。
 * 纯函数，不发请求，所以可以先在确认面板里把结果完整列出来。
 */
export function planBatch(repos: Repo[], action: BatchAction): BatchPlanItem[] {
  return repos.map((repo) => {
    const admin = repo.permissions?.admin
    const push = repo.permissions?.push

    if (action.kind === 'visibility') {
      const destructive = repo.visibility === 'public' && action.to === 'private'
      const blocked = admin === false
      return {
        repo,
        action,
        label: actionLabel(repo, action),
        destructive,
        blocked,
        reason: blocked ? '无 admin 权限，组织策略通常会拒绝' : undefined,
        skip: repo.visibility === action.to,
      }
    }

    if (action.kind === 'archive' || action.kind === 'unarchive') {
      const blocked = admin === false
      return {
        repo,
        action,
        label: actionLabel(repo, action),
        // 归档后仓库变只读：不能提交、不能开 issue、不能发版
        destructive: action.kind === 'archive',
        blocked,
        reason: blocked ? '无 admin 权限，归档需要管理权限' : undefined,
        skip: action.kind === 'archive' ? repo.archived : !repo.archived,
      }
    }

    const blocked = push === false
    return {
      repo,
      action,
      label: actionLabel(repo, action),
      destructive: false,
      blocked,
      reason: blocked ? '无写入权限' : undefined,
      skip: action.add.length === 0,
    }
  })
}


/**
 * 仓库列表的筛选档位。
 *
 * `archived` 单独成档，而不是做成「全部 + 含归档」的开关。归档仓库是只读的：
 * 混在在用仓库里那一列，点进去发现提交、开 issue、发版全灰，比找不到更难受。
 * 分开一档，找得到、也不挡路。
 */
export type RepoFilterVisibility = 'all' | 'public' | 'private' | 'archived'

export interface RepoFilter {
  query?: string
  visibility?: RepoFilterVisibility
  /** 兼容旧调用：为真时「全部/公开/私有」里也带上归档仓库 */
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
  // 归档档与其余档互斥：进归档档就只看归档，否则默认把归档排除在外
  const onlyArchived = filter.visibility === 'archived'
  return repos.filter((r) => {
    if (onlyArchived) {
      if (!r.archived) return false
    } else if (!filter.includeArchived && r.archived) {
      return false
    }
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

/**
 * 各档位的数量。
 *
 * 公开 / 私有 / 全部 都**不含归档**，三者必须能对上：归档仓库单独一档，
 * 混进公开里会让「公开 3 + 私有 1」和「全部 2」当场打起来。
 * `total` 是账户真实总数（含归档），用在「你有多少仓库」这类口径上。
 */
export function countBy(repos: Repo[]) {
  const total = repos.length
  const live = repos.filter((r) => !r.archived)
  const archived = total - live.length
  const privateCount = live.filter((r) => r.private).length
  return {
    total,
    private: privateCount,
    public: live.length - privateCount,
    archived,
    live: live.length,
  }
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
export function runBatch(
  client: GitHubClient,
  plan: VisibilityPlan[],
  opts: BatchOptions = {},
): Promise<BatchResult[]> {
  return runBatchActions(
    client,
    plan.map((item) => ({
      repo: item.repo,
      action: { kind: 'visibility' as const, to: item.to },
      label: '',
      destructive: item.destructive,
      blocked: item.blocked,
      reason: item.reason,
      skip: item.from === item.to,
    })),
    opts,
  )
}

/** 执行一条动作。失败往上抛，由 runBatchActions 统一记成 failed */
async function applyAction(client: GitHubClient, item: BatchPlanItem): Promise<string | undefined> {
  const { repo, action } = item
  if (action.kind === 'visibility') {
    await client.setVisibility(repo.owner, repo.name, action.to)
    return undefined
  }
  if (action.kind === 'archive') {
    await client.setArchived(repo.owner, repo.name, true)
    return undefined
  }
  if (action.kind === 'unarchive') {
    await client.setArchived(repo.owner, repo.name, false)
    return undefined
  }
  // topics 是整体替换，必须先读再合并，否则会把仓库原有话题冲掉
  const cur = await client.request<{ names?: string[] }>(
    `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/topics`,
    {},
    { fresh: true },
  )
  const next = mergeTopics(cur.data?.names ?? [], action.add)
  await client.request<{ names?: string[] }>(
    `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/topics`,
    { method: 'PUT', body: JSON.stringify({ names: next }) },
  )
  return next.length ? `共 ${next.length} 个话题` : undefined
}

export async function runBatchActions(
  client: GitHubClient,
  plan: BatchPlanItem[],
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

    if (item.skip) {
      const r: BatchResult = { repo: item.repo.full_name, status: 'ok', message: '已是目标状态' }
      results.push(r)
      done += 1
      opts.onProgress?.(done, plan.length, r)
      continue
    }

    try {
      const msg = await applyAction(client, item)
      const r: BatchResult = { repo: item.repo.full_name, status: 'ok', message: msg }
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

/** GitHub 仓库名规则：字母、数字、点、短横、下划线，不能以点开头，最长 100。 */
const REPO_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/

export function validateRepoName(name: string): string | null {
  const v = name.trim()
  if (!v) return '仓库名不能为空'
  if (v === '.' || v === '..') return '这个名字不可用'
  if (!REPO_NAME_RE.test(v)) return '只能用字母、数字、点、短横、下划线，且不能以点开头'
  return null
}
