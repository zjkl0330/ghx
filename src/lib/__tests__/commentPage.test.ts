import { describe, expect, it } from 'vitest'
import type { ApiClient } from '../api'
import { listCommentPage, listLatestComments, type IssueComment } from '../issues'

/**
 * 评论分页的判定逻辑。
 *
 * 这两条函数的分支只有三处，但每一处都影响「用户打开长 Issue 看到什么」：
 * 是不是最新一页、还有没有更早的、Link 头读不到时会不会误判成只有一页。
 */

const c = (id: number): IssueComment => ({
  id,
  body: `第 ${id} 条`,
  user: { login: 'someone' },
  created_at: '2026-11-20T10:00:00Z',
  updated_at: '2026-11-20T10:00:00Z',
})

/**
 * 假客户端：按 `page=` 返回预设数据，并按需吐 Link 头。
 * `linkLast` 传 null 表示服务器没给 Link（CDN 吞头的真实情况）。
 */
function fakeClient(pages: Record<number, IssueComment[]>, linkLast: number | null) {
  const seen: number[] = []
  const client = {
    async request(path: string) {
      const page = Number(/[?&]page=(\d+)/.exec(path)?.[1] ?? '1')
      seen.push(page)
      return {
        data: pages[page] ?? [],
        rate: null,
        scopes: [],
        link:
          linkLast === null
            ? { next: null, last: null, prev: null, first: null }
            : {
                next: page < linkLast ? `https://api.github.com/x?page=${page + 1}` : null,
                last: `https://api.github.com/x?page=${linkLast}`,
                prev: page > 1 ? `https://api.github.com/x?page=${page - 1}` : null,
                first: 'https://api.github.com/x?page=1',
              },
      }
    },
  }
  return { client: client as unknown as ApiClient, seen }
}

describe('评论分页', () => {
  it('单页时 last=1，且不回退再取一次', async () => {
    const { client, seen } = fakeClient({ 1: [c(1), c(2)] }, null)
    const res = await listLatestComments(client, 'o', 'r', 1)
    expect(res.page).toBe(1)
    expect(res.last).toBe(1)
    expect(res.hasOlder).toBe(false)
    expect(seen).toEqual([1])
  })

  it('长 Issue 直接取最后一页，hasOlder 为真', async () => {
    const { client, seen } = fakeClient({ 1: [c(1)], 3: [c(201), c(202)] }, 3)
    const res = await listLatestComments(client, 'o', 'r', 1)
    expect(seen).toEqual([1, 3])
    expect(res.page).toBe(3)
    expect(res.items.map((i) => i.id)).toEqual([201, 202])
    expect(res.hasOlder).toBe(true)
  })

  it('翻到第 2 页时 hasOlder 仍为真（还能继续往前）', async () => {
    const { client } = fakeClient({ 2: [c(101)] }, 3)
    const res = await listCommentPage(client, 'o', 'r', 1, 2)
    expect(res.page).toBe(2)
    expect(res.last).toBe(3)
    expect(res.hasOlder).toBe(true)
  })

  it('第 1 页 hasOlder 为假', async () => {
    const { client } = fakeClient({ 1: [c(1)] }, 3)
    const res = await listCommentPage(client, 'o', 'r', 1, 1)
    expect(res.hasOlder).toBe(false)
  })

  it('Link 头被吞时，满页就当作还有下一页', async () => {
    // 100 条满页、没有 Link：说明很可能还有第 2 页
    const full = Array.from({ length: 100 }, (_, i) => c(i + 1))
    const { client } = fakeClient({ 1: full }, null)
    const res = await listCommentPage(client, 'o', 'r', 1, 1)
    expect(res.last).toBe(2)
  })

  it('Link 头被吞且不满页，判定为最后一页', async () => {
    const { client } = fakeClient({ 1: [c(1), c(2)] }, null)
    const res = await listCommentPage(client, 'o', 'r', 1, 1)
    expect(res.last).toBe(1)
  })
})
