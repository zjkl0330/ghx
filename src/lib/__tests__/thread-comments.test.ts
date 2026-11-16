import { describe, expect, it } from 'vitest'
import {
  isFreshComment,
  threadComments,
  threadNumber,
  type NotificationThread,
} from '../notifications'
import type { Page } from '../types'

const thread = (over: Partial<NotificationThread> = {}): NotificationThread => ({
  id: 't1',
  unread: true,
  reason: 'comment',
  updated_at: '2026-11-15T08:00:00Z',
  subject: {
    title: '崩溃了',
    type: 'Issue',
    url: 'https://api.github.com/repos/o/r/issues/12',
  },
  repository: { full_name: 'o/r', name: 'r', owner: { login: 'o' } },
  ...over,
})

const emptyLink = { next: null, last: null, prev: null, first: null }
function page<T>(data: T) {
  return { data, rate: null, scopes: [] as string[], link: emptyLink } as Page<T>
}

describe('线程编号解析', () => {
  it('issues 与 pulls 两种 URL 都能取到编号', () => {
    expect(threadNumber(thread())).toBe(12)
    expect(
      threadNumber(
        thread({
          subject: {
            title: 'x',
            type: 'PullRequest',
            url: 'https://api.github.com/repos/o/r/pulls/88',
          },
        }),
      ),
    ).toBe(88)
  })

  it('其它类型返回 null', () => {
    expect(
      threadNumber(
        thread({
          subject: { title: 'x', type: 'Release', url: 'https://api.github.com/repos/o/r/releases/9' },
        }),
      ),
    ).toBe(null)
    expect(threadNumber(thread({ subject: { title: 'x', type: 'Discussion', url: null } }))).toBe(null)
  })
})

describe('拉取线程评论', () => {
  it('按 issues 端点请求，倒序拿回后正序展示', async () => {
    const seen: string[] = []
    const client = {
      request: async <T>(path: string) => {
        seen.push(path)
        return page([
          { id: 2, user: { login: 'b' }, body: '后一条', created_at: '2026-11-15T10:00:00Z' },
          { id: 1, user: { login: 'a' }, body: '前一条', created_at: '2026-11-15T09:00:00Z' },
        ] as T)
      },
    }
    const res = await threadComments(client, thread(), { perPage: 8 })
    expect(seen[0]).toContain('/repos/o/r/issues/12/comments')
    expect(seen[0]).toContain('per_page=8')
    expect(seen[0]).toContain('direction=desc')
    expect(res.items.map((c) => c.id)).toEqual([1, 2])
    expect(res.hasMore).toBe(false)
  })

  it('PR 线程同样走 issues 端点（GitHub 里 PR 就是 issue）', async () => {
    const seen: string[] = []
    const client = {
      request: async <T>(path: string) => {
        seen.push(path)
        return page([] as T)
      },
    }
    await threadComments(
      client,
      thread({
        subject: { title: 'x', type: 'PullRequest', url: 'https://api.github.com/repos/o/r/pulls/7' },
      }),
    )
    expect(seen[0]).toContain('/repos/o/r/issues/7/comments')
  })

  it('服务端顺序不对时也按时间正序展示', async () => {
    const client = {
      request: async <T>() =>
        page([
          { id: 1, user: null, body: '先', created_at: '2026-11-15T09:00:00Z' },
          { id: 2, user: null, body: '后', created_at: '2026-11-15T11:00:00Z' },
        ] as T),
    }
    // 服务端给了正序（违反 desc 承诺），结果仍应正序且不重复反转
    const res = await threadComments(client, thread())
    expect(res.items.map((c) => c.body)).toEqual(['先', '后'])
  })

  it('满页说明可能还有更早的', async () => {
    const client = {
      request: async <T>() =>
        page(
          Array.from({ length: 8 }, (_, i) => ({
            id: i,
            user: null,
            body: '',
            created_at: '2026-11-15T09:00:00Z',
          })) as T,
        ),
    }
    expect((await threadComments(client, thread(), { perPage: 8 })).hasMore).toBe(true)
  })

  it('仓库或编号缺失时直接返回空，不发请求', async () => {
    let called = 0
    const client = {
      request: async <T>() => {
        called += 1
        return page([] as T)
      },
    }
    expect(await threadComments(client, thread({ repository: null }))).toEqual({
      items: [],
      hasMore: false,
    })
    expect(called).toBe(0)
  })

  it('没有 subject.url 时不发请求', async () => {
    let called = 0
    const client = {
      request: async <T>() => {
        called += 1
        return page([] as T)
      },
    }
    await threadComments(client, thread({ subject: { title: 'x', type: 'Issue', url: null } }))
    expect(called).toBe(0)
  })
})

describe('新评论判定', () => {
  const at = (iso: string) => ({ id: 1, user: null, body: '', created_at: iso })

  it('24 小时内算新', () => {
    const now = Date.parse('2026-11-16T12:00:00Z')
    expect(isFreshComment(at('2026-11-16T06:00:00Z'), now)).toBe(true)
    expect(isFreshComment(at('2026-11-15T11:00:00Z'), now)).toBe(false)
  })

  it('时间解析不了就当不新，不抛错', () => {
    expect(isFreshComment(at('乱码'))).toBe(false)
  })
})
