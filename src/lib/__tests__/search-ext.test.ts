import { describe, expect, it } from 'vitest'
import { normalizeUserTerm, searchUsers,
  highlightTerm,
} from '../search-ext'
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

describe('从查询串里挑高亮词', () => {
  it('普通关键词原样返回', () => {
    expect(highlightTerm('useEffect')).toBe('useEffect')
  })

  it('去掉限定符只留关键词', () => {
    expect(highlightTerm('useEffect lang:ts repo:o/r')).toBe('useEffect')
    expect(highlightTerm('repo:o/r path:src kind:fix bug')).toBe('bug')
  })

  it('带引号的限定符整体去掉', () => {
    expect(highlightTerm('auth language:"type script"')).toBe('auth')
  })

  it('只有限定符时返回空串', () => {
    expect(highlightTerm('repo:o/r lang:go')).toBe('')
  })

  it('去掉包住关键词的引号', () => {
    expect(highlightTerm('"hello"')).toBe('hello')
  })

  it('多个词只取第一个（文件页的查找栏一次只查一个词）', () => {
    expect(highlightTerm('foo bar baz')).toBe('foo')
  })
})
