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
})
