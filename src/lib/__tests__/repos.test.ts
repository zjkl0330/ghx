import { describe, expect, it, vi } from 'vitest'
import type { GitHubClient } from '../api'
import {
  buildPlan,
  countBy,
  filterRepos,
  normalizeRepo,
  planBatch,
  runBatch,
  runBatchActions,
  validateRepoName,
} from '../repos'
import type { Repo, Visibility } from '../types'

function repo(over: Partial<Repo> = {}): Repo {
  return {
    id: 1,
    name: 'demo',
    full_name: 'zjkl/demo',
    owner: 'zjkl',
    private: false,
    visibility: 'public' as Visibility,
    archived: false,
    disabled: false,
    description: '示例仓库',
    language: 'TypeScript',
    stargazers_count: 1,
    forks_count: 0,
    pushed_at: '2026-10-01T00:00:00Z',
    default_branch: 'main',
    permissions: { admin: true, push: true, pull: true },
    ...over,
  }
}

function fakeClient(impl: (owner: string, name: string, vis: Visibility) => Promise<unknown>) {
  return { setVisibility: vi.fn(impl) } as unknown as GitHubClient
}

describe('filterRepos', () => {
  const repos = [
    repo({ full_name: 'zjkl/a', name: 'a', private: false, visibility: 'public' }),
    repo({ full_name: 'zjkl/b', name: 'b', private: true, visibility: 'private' }),
    repo({ full_name: 'zjkl/c', name: 'c', private: false, visibility: 'public', archived: true }),
  ]

  it('默认排除归档仓库', () => {
    expect(filterRepos(repos).map((r) => r.name)).toEqual(['a', 'b'])
  })

  it('可按可见度筛选', () => {
    expect(filterRepos(repos, { visibility: 'private' }).map((r) => r.name)).toEqual(['b'])
    expect(filterRepos(repos, { visibility: 'public' }).map((r) => r.name)).toEqual(['a'])
  })

  it('查询匹配名称与描述', () => {
    expect(filterRepos(repos, { query: 'B' }).map((r) => r.name)).toEqual(['b'])
    // 描述匹配全部 3 条，但默认排除归档，故为 2
    expect(filterRepos(repos, { query: '示例' })).toHaveLength(2)
    expect(filterRepos(repos, { query: '示例', includeArchived: true })).toHaveLength(3)
  })

  it('countBy 统计公开与私有', () => {
    expect(countBy(repos)).toEqual({ total: 3, private: 1, public: 2, archived: 1 })
  })
})

describe('buildPlan', () => {
  it('公开转私有标记为 destructive', () => {
    const [p] = buildPlan([repo()], 'private')
    expect(p.destructive).toBe(true)
    expect(p.blocked).toBe(false)
  })

  it('私有转公开不算破坏性', () => {
    const [p] = buildPlan([repo({ private: true, visibility: 'private' })], 'public')
    expect(p.destructive).toBe(false)
  })

  it('无 admin 权限预判为 blocked 并给出原因', () => {
    const [p] = buildPlan([repo({ permissions: { admin: false, push: true, pull: true } })], 'private')
    expect(p.blocked).toBe(true)
    expect(p.reason).toContain('admin')
  })

  it('权限信息缺失时不预判 blocked', () => {
    const [p] = buildPlan([repo({ permissions: undefined })], 'private')
    expect(p.blocked).toBe(false)
  })
})

describe('runBatch', () => {
  it('全部成功时逐条返回 ok', async () => {
    const client = fakeClient(async () => ({}))
    const plan = buildPlan([repo({ full_name: 'a/x', name: 'x' }), repo({ full_name: 'a/y', name: 'y' })], 'private')
    const res = await runBatch(client, plan, { gapMs: 0 })
    expect(res.map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(client.setVisibility).toHaveBeenCalledTimes(2)
  })

  it('单条失败不影响后续，且保留 httpStatus', async () => {
    const client = fakeClient(async (_o, name) => {
      if (name === 'y') throw Object.assign(new Error('组织策略拒绝'), { status: 422 })
      return {}
    })
    const plan = buildPlan(
      [repo({ full_name: 'a/x', name: 'x' }), repo({ full_name: 'a/y', name: 'y' }), repo({ full_name: 'a/z', name: 'z' })],
      'private',
    )
    const res = await runBatch(client, plan, { gapMs: 0 })
    expect(res.map((r) => r.status)).toEqual(['ok', 'failed', 'ok'])
    expect(res[1].httpStatus).toBe(422)
  })

  it('blocked 项不发请求，直接记为失败', async () => {
    const client = fakeClient(async () => ({}))
    const plan = buildPlan([repo({ permissions: { admin: false, push: true, pull: true } })], 'private')
    const res = await runBatch(client, plan, { gapMs: 0 })
    expect(res[0].status).toBe('failed')
    expect(client.setVisibility).not.toHaveBeenCalled()
  })

  it('已是目标状态时跳过请求', async () => {
    const client = fakeClient(async () => ({}))
    const plan = buildPlan([repo({ private: true, visibility: 'private' })], 'private')
    const res = await runBatch(client, plan, { gapMs: 0 })
    expect(res[0].message).toBe('已是目标状态')
    expect(client.setVisibility).not.toHaveBeenCalled()
  })

  it('abort 后停止后续请求', async () => {
    const client = fakeClient(async () => ({}))
    const ctrl = new AbortController()
    const plan = buildPlan([repo({ name: 'x' }), repo({ name: 'y' })], 'private')
    ctrl.abort()
    const res = await runBatch(client, plan, { gapMs: 0, signal: ctrl.signal })
    expect(res).toHaveLength(0)
  })

  it('进度回调次数等于条目数', async () => {
    const client = fakeClient(async () => ({}))
    const seen: number[] = []
    const plan = buildPlan([repo({ name: 'x' }), repo({ name: 'y' })], 'private')
    await runBatch(client, plan, { gapMs: 0, onProgress: (done) => seen.push(done) })
    expect(seen).toEqual([1, 2])
  })
})

describe('normalizeRepo', () => {
  const base = {
    id: 1,
    name: 'demo',
    full_name: 'zjkl/demo',
    private: false,
    visibility: 'public' as const,
    archived: false,
    disabled: false,
    description: null,
    language: null,
    stargazers_count: 0,
    forks_count: 0,
    pushed_at: '2026-11-02T00:00:00Z',
    default_branch: 'main',
  }

  it('把 owner 对象平铺成 login，避免拼出 [object Object]', () => {
    const r = normalizeRepo({ ...base, owner: { login: 'zjkl' } })
    expect(r.owner).toBe('zjkl')
    expect(`/repos/${r.owner}/${r.name}`).toBe('/repos/zjkl/demo')
  })

  it('owner 已是字符串时原样保留', () => {
    expect(normalizeRepo({ ...base, owner: 'zjkl' }).owner).toBe('zjkl')
  })

  it('保留其余字段不变', () => {
    const r = normalizeRepo({ ...base, owner: { login: 'zjkl' } })
    expect(r.full_name).toBe('zjkl/demo')
    expect(r.default_branch).toBe('main')
  })
})

describe('validateRepoName', () => {
  it('接受常见命名', () => {
    expect(validateRepoName('ghx')).toBeNull()
    expect(validateRepoName('my.repo_2')).toBeNull()
    expect(validateRepoName('a-b_c.d')).toBeNull()
  })

  it('空名与纯空格拒绝', () => {
    expect(validateRepoName('')).not.toBeNull()
    expect(validateRepoName('   ')).not.toBeNull()
  })

  it('中文、空格、斜杠等非法字符拒绝', () => {
    expect(validateRepoName('我的仓库')).not.toBeNull()
    expect(validateRepoName('a b')).not.toBeNull()
    expect(validateRepoName('a/b')).not.toBeNull()
  })

  it('以点开头拒绝，点与点点单独拒绝', () => {
    expect(validateRepoName('.hidden')).not.toBeNull()
    expect(validateRepoName('.')).not.toBeNull()
    expect(validateRepoName('..')).not.toBeNull()
  })

  it('超过 100 字符拒绝', () => {
    expect(validateRepoName('a'.repeat(100))).toBeNull()
    expect(validateRepoName('a'.repeat(101))).not.toBeNull()
  })
})

describe('批量动作计划', () => {
  const repo = (over: Partial<Repo> = {}): Repo => ({
    id: 1,
    name: 'r',
    full_name: 'o/r',
    owner: 'o',
    private: false,
    visibility: 'public',
    archived: false,
    disabled: false,
    description: null,
    language: null,
    stargazers_count: 0,
    forks_count: 0,
    pushed_at: '',
    default_branch: 'main',
    ...over,
  })

  it('可见度：公开转私有算破坏性', () => {
    const [item] = planBatch([repo()], { kind: 'visibility', to: 'private' })
    expect(item.destructive).toBe(true)
    expect(item.skip).toBe(false)
    expect(item.label).toBe('Public → Private')
  })

  it('可见度：已经是目标状态时 skip', () => {
    const [item] = planBatch([repo({ visibility: 'private', private: true })], {
      kind: 'visibility',
      to: 'private',
    })
    expect(item.skip).toBe(true)
  })

  it('可见度：无 admin 权限标记 blocked', () => {
    const [item] = planBatch([repo({ permissions: { admin: false, push: true, pull: true } })], {
      kind: 'visibility',
      to: 'private',
    })
    expect(item.blocked).toBe(true)
    expect(item.reason).toContain('admin')
  })

  it('归档：已归档的 skip，未归档的算破坏性', () => {
    const [a] = planBatch([repo({ archived: true })], { kind: 'archive' })
    expect(a.skip).toBe(true)
    const [b] = planBatch([repo()], { kind: 'archive' })
    expect(b.skip).toBe(false)
    expect(b.destructive).toBe(true)
  })

  it('取消归档：未归档的 skip', () => {
    const [item] = planBatch([repo()], { kind: 'unarchive' })
    expect(item.skip).toBe(true)
    expect(item.destructive).toBe(false)
  })

  it('加话题：没有 push 权限时 blocked，空话题视为 skip', () => {
    const [a] = planBatch([repo({ permissions: { admin: false, push: false, pull: true } })], {
      kind: 'topics',
      add: ['x'],
    })
    expect(a.blocked).toBe(true)
    const [b] = planBatch([repo()], { kind: 'topics', add: [] })
    expect(b.skip).toBe(true)
  })

  it('一次规划多个仓库', () => {
    const list = planBatch([repo(), repo({ name: 'r2', full_name: 'o/r2' })], { kind: 'archive' })
    expect(list).toHaveLength(2)
    expect(list[1].repo.full_name).toBe('o/r2')
  })
})

describe('执行批量动作', () => {
  const repo = (over: Partial<Repo> = {}): Repo => ({
    id: 1,
    name: 'r',
    full_name: 'o/r',
    owner: 'o',
    private: false,
    visibility: 'public',
    archived: false,
    disabled: false,
    description: null,
    language: null,
    stargazers_count: 0,
    forks_count: 0,
    pushed_at: '',
    default_branch: 'main',
    ...over,
  })

  function spy() {
    const calls: { path: string; method: string; body?: string }[] = []
    const client = {
      setVisibility: async () => {
        calls.push({ path: 'visibility', method: 'PATCH' })
      },
      setArchived: async (_o: string, _r: string, archived: boolean) => {
        calls.push({ path: `archive:${archived}`, method: 'PATCH' })
      },
      request: async <T>(path: string, init?: RequestInit) => {
        calls.push({ path, method: init?.method ?? 'GET', body: init?.body as string })
        if (path.endsWith('/topics') && !init?.method) {
          return { data: { names: ['old'] } as T, rate: null, scopes: [] as string[] }
        }
        return { data: {} as T, rate: null, scopes: [] as string[] }
      },
    }
    return { client, calls }
  }

  it('归档调 setArchived(true)', async () => {
    const { client, calls } = spy()
    const res = await runBatchActions(client as never, planBatch([repo()], { kind: 'archive' }), {
      gapMs: 0,
    })
    expect(res[0].status).toBe('ok')
    expect(calls[0].path).toBe('archive:true')
  })

  it('取消归档调 setArchived(false)', async () => {
    const { client, calls } = spy()
    await runBatchActions(
      client as never,
      planBatch([repo({ archived: true })], { kind: 'unarchive' }),
      { gapMs: 0 },
    )
    expect(calls[0].path).toBe('archive:false')
  })

  it('加话题先读现有再 PUT 合并结果', async () => {
    const { client, calls } = spy()
    const res = await runBatchActions(
      client as never,
      planBatch([repo()], { kind: 'topics', add: ['new'] }),
      { gapMs: 0 },
    )
    expect(calls).toHaveLength(2)
    expect(calls[1].method).toBe('PUT')
    expect(JSON.parse(String(calls[1].body))).toEqual({ names: ['old', 'new'] })
    expect(res[0].message).toContain('2 个话题')
  })

  it('skip 的不发请求，但仍算成功', async () => {
    const { client, calls } = spy()
    const res = await runBatchActions(
      client as never,
      planBatch([repo({ archived: true })], { kind: 'archive' }),
      { gapMs: 0 },
    )
    expect(calls).toHaveLength(0)
    expect(res[0]).toEqual({ repo: 'o/r', status: 'ok', message: '已是目标状态' })
  })

  it('blocked 的直接记失败，不发请求', async () => {
    const { client, calls } = spy()
    const res = await runBatchActions(
      client as never,
      planBatch([repo({ permissions: { admin: false, push: true, pull: true } })], {
        kind: 'archive',
      }),
      { gapMs: 0 },
    )
    expect(calls).toHaveLength(0)
    expect(res[0].status).toBe('failed')
  })

  it('单条失败不影响后面', async () => {
    const calls: string[] = []
    const client = {
      setArchived: async (_o: string, r: string) => {
        calls.push(r)
        if (r === 'r') throw Object.assign(new Error('403'), { status: 403 })
      },
      request: async <T>() => ({ data: {} as T, rate: null, scopes: [] as string[] }),
    }
    const list = planBatch(
      [repo(), repo({ id: 2, name: 'r2', full_name: 'o/r2' })],
      { kind: 'archive' },
    )
    const res = await runBatchActions(client as never, list, { gapMs: 0 })
    expect(res.map((r) => r.status)).toEqual(['failed', 'ok'])
    expect(res[0].httpStatus).toBe(403)
  })
})
