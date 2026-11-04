import { describe, expect, it, vi } from 'vitest'
import { GitHubClient, GitHubError, RateLimitError, describeError } from '../api'

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn(async () =>
    new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    }),
  ) as unknown as typeof fetch
}

describe('describeError', () => {
  it('401 提示重新导入', () => {
    expect(describeError(401, {})).toContain('令牌无效')
  })
  it('403 区分限流与权限', () => {
    expect(describeError(403, { message: 'API rate limit exceeded' })).toContain('限流')
    expect(describeError(403, { message: 'Resource not accessible' })).toContain('权限不足')
  })
  it('422 指向组织策略', () => {
    expect(describeError(422, { message: 'Validation Failed' })).toContain('组织策略')
  })
  it('5xx 归为服务异常', () => {
    expect(describeError(502, {})).toContain('服务异常')
  })
})

describe('GitHubClient', () => {
  it('解析限流头与 scopes', async () => {
    const client = new GitHubClient({
      token: 't',
      fetchImpl: mockFetch(
        200,
        { login: 'zjkl' },
        { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '1800000000', 'x-oauth-scopes': 'repo, workflow' },
      ),
    })
    const res = await client.whoami()
    expect(res.data.login).toBe('zjkl')
    expect(res.rate).toEqual({ limit: 5000, remaining: 4999, reset: 1800000000 })
    expect(client.scopes).toEqual(['repo', 'workflow'])
  })

  it('403 且配额耗尽时抛 RateLimitError', async () => {
    const client = new GitHubClient({
      token: 't',
      fetchImpl: mockFetch(
        403,
        { message: 'API rate limit exceeded' },
        { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' },
      ),
    })
    await expect(client.whoami()).rejects.toBeInstanceOf(RateLimitError)
  })

  it('401 抛 GitHubError 且带状态码', async () => {
    const client = new GitHubClient({ token: 'bad', fetchImpl: mockFetch(401, { message: 'Bad credentials' }) })
    await expect(client.whoami()).rejects.toMatchObject({ status: 401 })
    await expect(client.whoami()).rejects.toBeInstanceOf(GitHubError)
  })

  it('204 返回 null 而不是解析失败', async () => {
    const client = new GitHubClient({ token: 't', fetchImpl: mockFetch(204, null) })
    const res = await client.request<null>('/repos/a/b', { method: 'DELETE' })
    expect(res.data).toBeNull()
  })

  it('非 JSON 响应不会抛解析异常，而是归类为错误消息', async () => {
    const client = new GitHubClient({
      token: 't',
      fetchImpl: vi.fn(async () => new Response('<html>gateway</html>', { status: 502 })) as unknown as typeof fetch,
    })
    await expect(client.whoami()).rejects.toMatchObject({ status: 502 })
  })

  it('baseUrl 去掉尾部斜杠并拼接路径', async () => {
    const fn = mockFetch(200, { login: 'x' })
    const client = new GitHubClient({ token: 't', baseUrl: 'https://gh.example.com/api/', fetchImpl: fn })
    await client.whoami()
    const url = (fn as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]
    expect(url).toBe('https://gh.example.com/api/user')
  })

  it('设置可见度使用 PATCH 且带 visibility 字段', async () => {
    const fn = mockFetch(200, { full_name: 'a/b', visibility: 'private' })
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    await client.setVisibility('a', 'b', 'private')
    const call = (fn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]
    expect(call[1].method).toBe('PATCH')
    expect(JSON.parse(call[1].body as string)).toEqual({ visibility: 'private' })
  })

  it('星标列表把 owner 对象归一化成字符串', async () => {
    const fn = mockFetch(200, [
      { id: 1, name: 'ghx', full_name: 'zjkl/ghx', owner: { login: 'zjkl' }, private: false },
    ])
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    const { data } = await client.listStarred()
    expect(data[0].owner).toBe('zjkl')
    const url = (fn as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]
    expect(url).toContain('/user/starred?')
    expect(url).toContain('sort=created')
  })

  it('触发工作流走 dispatches，只带 ref', async () => {
    const fn = mockFetch(204, null)
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    await client.dispatchWorkflow('a', 'b', 7, 'main')
    const call = (fn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]
    expect(call[0]).toContain('/repos/a/b/actions/workflows/7/dispatches')
    expect(call[1].method).toBe('POST')
    expect(JSON.parse(call[1].body as string)).toEqual({ ref: 'main' })
  })

  it('启停工作流用 PUT 到 enable/disable', async () => {
    const fn = mockFetch(204, null)
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    await client.setWorkflowEnabled('a', 'b', 7, false)
    const call = (fn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]
    expect(call[0]).toContain('/actions/workflows/7/disable')
    expect(call[1].method).toBe('PUT')
  })

  it('运行列表可限定工作流并带上每页条数', async () => {
    const fn = mockFetch(200, { total_count: 0, workflow_runs: [] })
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    await client.listRuns('a', 'b', { workflowId: 7, perPage: 5 })
    const url = (fn as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]
    expect(url).toContain('/actions/workflows/7/runs?')
    expect(url).toContain('per_page=5')
  })

  it('新建发行版把标签与预发行标记写进请求体', async () => {
    const fn = mockFetch(201, { id: 1, tag_name: 'v1.0.0' })
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    await client.createRelease('a', 'b', { tag: 'v1.0.0', title: '首个版本', prerelease: true, target: 'main' })
    const call = (fn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]
    const body = JSON.parse(call[1].body as string)
    expect(body).toMatchObject({
      tag_name: 'v1.0.0',
      name: '首个版本',
      prerelease: true,
      target_commitish: 'main',
      draft: false,
    })
  })

  it('复刻走 POST /forks', async () => {
    const fn = mockFetch(202, { id: 2, name: 'ghx', owner: { login: 'me' } })
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    const { data } = await client.createFork('a', 'b')
    const call = (fn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]
    expect(call[0]).toBe('https://api.github.com/repos/a/b/forks')
    expect(call[1].method).toBe('POST')
    expect(data?.owner).toBe('me')
  })
})

describe('工作流错误翻译', () => {
  it('422 缺 workflow_dispatch 时给明确提示', () => {
    expect(describeError(422, { message: "Workflow does not have 'workflow_dispatch' trigger" })).toContain(
      'workflow_dispatch',
    )
  })

  it('409 指向停用或状态冲突', () => {
    expect(describeError(409, { message: 'Conflict' })).toContain('冲突')
  })
})

describe('请求缓存', () => {
  const repo = {
    id: 1,
    name: 'a',
    full_name: 'o/a',
    owner: { login: 'o' },
    private: false,
    visibility: 'public',
    archived: false,
    disabled: false,
    stargazers_count: 1,
    forks_count: 0,
    pushed_at: '2026-11-01T00:00:00Z',
    default_branch: 'main',
  }

  function counted(body: unknown = repo) {
    return mockFetch(200, body) as unknown as { mock: { calls: unknown[] } } & typeof fetch
  }

  it('相同 GET 第二次不再发请求', async () => {
    const fn = counted()
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    await client.repo('o', 'a')
    const second = await client.repo('o', 'a')
    expect(fn.mock.calls.length).toBe(1)
    // 命中缓存也要拿到正确数据
    expect(second.data.full_name).toBe('o/a')
  })

  it('fresh 为 true 时强制回源', async () => {
    const fn = counted()
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    await client.repo('o', 'a')
    await client.repo('o', 'a', true)
    expect(fn.mock.calls.length).toBe(2)
  })

  it('不同路径各自缓存', async () => {
    const fn = counted()
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    await client.repo('o', 'a')
    await client.repo('o', 'b')
    expect(fn.mock.calls.length).toBe(2)
  })

  it('写操作后同一路径会重新请求', async () => {
    const fn = counted()
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    await client.repo('o', 'a')
    await client.setVisibility('o', 'a', 'private')
    await client.repo('o', 'a')
    // GET + PATCH + GET
    expect(fn.mock.calls.length).toBe(3)
  })

  it('清缓存后重新请求', async () => {
    const fn = counted()
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    await client.repo('o', 'a')
    client.clearCache()
    await client.repo('o', 'a')
    expect(fn.mock.calls.length).toBe(2)
    expect(client.cacheSize).toBe(1)
  })

  it('失败响应不进缓存', async () => {
    const fn = mockFetch(404, { message: 'Not Found' })
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    await expect(client.repo('o', 'a')).rejects.toBeInstanceOf(GitHubError)
    await expect(client.repo('o', 'a')).rejects.toBeInstanceOf(GitHubError)
    expect((fn as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(2)
  })

  it('star 之后星标列表会失效', async () => {
    const fn = counted([])
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    await client.listStarred()
    await client.listStarred()
    expect(fn.mock.calls.length).toBe(1)
    await client.setStarred('o', 'a', true)
    await client.listStarred()
    expect(fn.mock.calls.length).toBe(3)
  })

  it('搜索按最佳匹配时不带 sort 参数，交给 GitHub 相关性排序', async () => {
    const fn = counted({ total_count: 1, incomplete_results: false, items: [repo] })
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    await client.searchRepos('docker', { sort: 'best' })
    const url = String((fn.mock.calls[0] as unknown[])[0])
    expect(url).toContain('/search/repositories')
    expect(url).toContain('q=docker')
    expect(url).not.toContain('sort=')
  })

  it('搜索指定排序时带上 sort 与 order', async () => {
    const fn = counted({ total_count: 1, incomplete_results: false, items: [repo] })
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    await client.searchRepos('docker', { sort: 'updated' })
    const url = String((fn.mock.calls[0] as unknown[])[0])
    expect(url).toContain('sort=updated')
    expect(url).toContain('order=desc')
  })

  it('搜索接口走自己的路径键', async () => {
    const fn = counted({ total_count: 1, incomplete_results: false, items: [repo] })
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    const res = await client.searchRepos('created:>=2026-11-01')
    expect(res.data[0].owner).toBe('o')
    expect(res.total).toBe(1)
  })
})

describe('README', () => {
  const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64')

  it('解码 base64 内容，中文不乱码', async () => {
    const fn = mockFetch(200, {
      name: 'README.md',
      path: 'README.md',
      size: 10,
      encoding: 'base64',
      content: `${b64('# 标题\n\n中文说明')}\n`,
    })
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    const res = await client.readme('o', 'a')
    expect(res.data?.text).toContain('中文说明')
    expect(res.data?.name).toBe('README.md')
  })

  it('没有 README 时返回 null 而不是抛错', async () => {
    const fn = mockFetch(404, { message: 'Not Found' })
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    await expect(client.readme('o', 'a')).resolves.toEqual(
      expect.objectContaining({ data: null }),
    )
  })

  it('其他错误照常抛出', async () => {
    const fn = mockFetch(500, { message: 'boom' })
    const client = new GitHubClient({ token: 't', fetchImpl: fn })
    await expect(client.readme('o', 'a')).rejects.toBeInstanceOf(GitHubError)
  })
})

describe('Link 头与条件请求', () => {
  it('把 Link 头解析进 Page，next 能被调用方读到', async () => {
    const f = vi.fn(async () =>
      new Response(JSON.stringify([{ id: 1 }]), {
        status: 200,
        headers: { 'content-type': 'application/json', link: '<https://api.github.com/x?page=2>; rel="next"' },
      }),
    ) as unknown as typeof fetch
    const client = new GitHubClient({ token: 't', fetchImpl: f })
    const page = await client.request<{ id: number }[]>('/repos/a/b/issues')
    expect(page.link?.next).toContain('page=2')
  })

  it('304 复用本地缓存并标记 notModified', async () => {
    let call = 0
    const f = vi.fn(async () => {
      call += 1
      if (call === 1) {
        return new Response(JSON.stringify([{ id: 1 }]), {
          status: 200,
          headers: { 'content-type': 'application/json', etag: 'W/"abc"' },
        })
      }
      return new Response(null, { status: 304 })
    }) as unknown as typeof fetch
    const client = new GitHubClient({ token: 't', fetchImpl: f })
    const first = await client.request<{ id: number }[]>('/notifications')
    expect(first.data).toEqual([{ id: 1 }])

    const second = await client.request<{ id: number }[]>('/notifications', {}, { conditional: true })
    expect(second.notModified).toBe(true)
    expect(second.data).toEqual([{ id: 1 }])
  })

  it('304 之前没缓存过时 data 为 null，不抛错', async () => {
    const client = new GitHubClient({ token: 't', fetchImpl: mockFetch(304, null) })
    const page = await client.request<null>('/notifications', {}, { conditional: true })
    expect(page.notModified).toBe(true)
    expect(page.data).toBe(null)
  })
})
