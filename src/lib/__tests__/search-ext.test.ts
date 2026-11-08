import { describe, expect, it } from 'vitest'
import { normalizeUserTerm, searchUsers } from '../search-ext'
import type { ApiClient } from '../api'

function fakeClient() {
  const calls: string[] = []
  const client = {
    request: async (path: string) => {
      calls.push(path)
      return { data: { total_count: 0, incomplete_results: false, items: [] } }
    },
  }
  return { client: client as unknown as ApiClient, calls }
}

describe('normalizeUserTerm', () => {
  it('去掉前导 @ —— 用户习惯直接写 @login', () => {
    expect(normalizeUserTerm('@zjkl0330')).toBe('zjkl0330')
  })

  it('连续多个 @ 也一起清掉', () => {
    expect(normalizeUserTerm('@@torvalds')).toBe('torvalds')
  })

  it('前后空格一起去掉', () => {
    expect(normalizeUserTerm('  torvalds  ')).toBe('torvalds')
  })

  it('中间带空格的姓名不动，GitHub 支持按名字搜', () => {
    expect(normalizeUserTerm('Linus Torvalds')).toBe('Linus Torvalds')
  })

  it('只有 @ 时得到空串，交给界面拦', () => {
    expect(normalizeUserTerm('@')).toBe('')
    expect(normalizeUserTerm('  @  ')).toBe('')
  })
})

describe('searchUsers', () => {
  it('请求里用清洗后的关键词', async () => {
    const { client, calls } = fakeClient()
    await searchUsers(client, '@zjkl0330')
    expect(calls[0]).toContain('/search/users?')
    expect(calls[0]).toContain('q=zjkl0330')
    expect(calls[0]).not.toContain('%40')
  })

  it('分页参数照传', async () => {
    const { client, calls } = fakeClient()
    await searchUsers(client, 'octocat', { page: 2 })
    expect(calls[0]).toContain('page=2')
  })
})
