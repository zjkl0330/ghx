import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TTL,
  MAX_ENTRIES,
  ResponseCache,
  invalidationPrefixes,
  isFresh,
  ttlFor,
} from '../cache'

describe('ttlFor 分档', () => {
  it('搜索结果缓存最久，配额最贵', () => {
    expect(ttlFor('/search/repositories?q=stars:>10')).toBe(5 * 60_000)
  })

  it('运行相关缓存都压得很短，避免轮询拿到旧状态', () => {
    const jobs = ttlFor('/repos/a/b/actions/runs/1/jobs')
    const runs = ttlFor('/repos/a/b/actions/runs')
    expect(jobs).toBeLessThanOrEqual(30_000)
    expect(runs).toBeLessThanOrEqual(30_000)
  })

  it('发行版与复刻缓存两分钟', () => {
    expect(ttlFor('/repos/a/b/releases')).toBe(120_000)
    expect(ttlFor('/repos/a/b/forks')).toBe(120_000)
  })

  it('单仓库 star 状态与星标列表走不同档位', () => {
    expect(ttlFor('/user/starred/a/b')).toBe(30_000)
    expect(ttlFor('/user/starred')).toBe(60_000)
  })

  it('查询参数不影响分档', () => {
    expect(ttlFor('/user/repos?page=2')).toBe(ttlFor('/user/repos'))
  })

  it('未知路径给默认值', () => {
    expect(ttlFor('/zen')).toBe(DEFAULT_TTL)
  })
})

describe('isFresh', () => {
  it('刚写入是新鲜的', () => {
    expect(isFresh(1000, 1000, 100)).toBe(true)
  })

  it('刚好到 ttl 算过期', () => {
    expect(isFresh(1000, 1100, 100)).toBe(false)
  })

  it('ttl 为 0 视为不缓存', () => {
    expect(isFresh(1000, 1000, 0)).toBe(false)
  })

  it('时间回拨不算新鲜', () => {
    expect(isFresh(5000, 4000, 100)).toBe(false)
  })
})

describe('ResponseCache 读写', () => {
  it('写入后能读到', () => {
    const c = new ResponseCache()
    c.set('/user/repos', { a: 1 }, 1000)
    expect(c.get('/user/repos', 60_000, 1001)).toEqual({ a: 1 })
  })

  it('过期后返回空并清掉条目', () => {
    const c = new ResponseCache()
    c.set('/user/repos', { a: 1 }, 1000)
    expect(c.get('/user/repos', 100, 1200)).toBeNull()
    expect(c.size).toBe(0)
  })

  it('不同分页各自成键', () => {
    const c = new ResponseCache()
    c.set('/user/repos?page=1', 'p1', 1000)
    c.set('/user/repos?page=2', 'p2', 1000)
    expect(c.get('/user/repos?page=1', 60_000, 1000)).toBe('p1')
    expect(c.get('/user/repos?page=2', 60_000, 1000)).toBe('p2')
  })

  it('超过上限淘汰最旧的条目', () => {
    const c = new ResponseCache(2)
    c.set('a', 1, 1000)
    c.set('b', 2, 1000)
    c.set('c', 3, 1000)
    expect(c.size).toBe(2)
    expect(c.get('a', 60_000, 1000)).toBeNull()
    expect(c.get('c', 60_000, 1000)).toBe(3)
  })

  it('重写同一个键会移到队尾，不会被优先淘汰', () => {
    const c = new ResponseCache(2)
    c.set('a', 1)
    c.set('b', 2)
    c.set('a', 11)
    c.set('c', 3)
    expect(c.get('a', 60_000, Date.now())).toBe(11)
    expect(c.get('b', 60_000, Date.now())).toBeNull()
  })

  it('默认上限是个正数', () => {
    expect(MAX_ENTRIES).toBeGreaterThan(0)
  })
})

describe('ResponseCache 失效', () => {
  it('按前缀只清对应仓库', () => {
    const c = new ResponseCache()
    c.set('/repos/a/one/releases', 1)
    c.set('/repos/a/two/releases', 2)
    c.invalidate('/repos/a/one')
    expect(c.peek('/repos/a/one/releases')).toBeNull()
    expect(c.peek('/repos/a/two/releases')).not.toBeNull()
  })

  it('不传前缀清空全部', () => {
    const c = new ResponseCache()
    c.set('x', 1)
    c.set('y', 2)
    c.invalidate()
    expect(c.size).toBe(0)
  })
})

describe('invalidationPrefixes', () => {
  it('读请求不产生失效', () => {
    expect(invalidationPrefixes('GET', '/user/repos')).toEqual([])
  })

  it('star 会清掉星标列表、仓库列表与搜索', () => {
    const p = invalidationPrefixes('PUT', '/user/starred/a/b')
    expect(p).toContain('/user/starred')
    expect(p).toContain('/user/repos')
    expect(p).toContain('/search/')
  })

  it('取消 star 同样处理', () => {
    expect(invalidationPrefixes('DELETE', '/user/starred/a/b')).toContain('/user/starred')
  })

  it('改可见度会清仓库本体和列表', () => {
    const p = invalidationPrefixes('PATCH', '/repos/a/b')
    expect(p).toContain('/repos/a/b')
    expect(p).toContain('/user/repos')
  })

  it('工作流的写操作只清该仓库的 actions 缓存', () => {
    const p = invalidationPrefixes('POST', '/repos/a/b/actions/workflows/1/dispatches')
    expect(p).toEqual(['/repos/a/b/actions/'])
  })

  it('发行版的写操作只清该仓库的发行版缓存', () => {
    expect(invalidationPrefixes('DELETE', '/repos/a/b/releases/9')).toEqual(['/repos/a/b/releases'])
  })

  it('新建仓库会清列表与搜索', () => {
    expect(invalidationPrefixes('POST', '/user/repos')).toEqual(['/user/repos', '/search/'])
  })

  it('无法识别的写操作整库清空', () => {
    expect(invalidationPrefixes('POST', '/somewhere/else')).toBe('all')
  })
})

describe('applyInvalidation', () => {
  it('按写操作清掉受影响的键', () => {
    const c = new ResponseCache()
    c.set('/user/starred?page=1', 1)
    c.set('/user/repos?page=1', 2)
    c.set('/repos/a/b/releases', 3)
    c.applyInvalidation('PUT', '/user/starred/a/b')
    expect(c.peek('/user/starred?page=1')).toBeNull()
    expect(c.peek('/user/repos?page=1')).toBeNull()
    // 与本次写操作无关的缓存要留着
    expect(c.peek('/repos/a/b/releases')).not.toBeNull()
  })

  it('all 会把整库清掉', () => {
    const c = new ResponseCache()
    c.set('/repos/a/b/releases', 1)
    c.applyInvalidation('POST', '/unknown')
    expect(c.size).toBe(0)
  })
})

describe('协作接口的缓存失效', () => {
  it('建 Issue 会清列表、仓库本身与通知', () => {
    const p = invalidationPrefixes('POST', '/repos/a/b/issues')
    expect(p).toContain('/repos/a/b/issues')
    expect(p).toContain('/search/issues')
    expect(p).toContain('/notifications')
  })
  it('合并 PR 会清 PR 列表与提交历史', () => {
    const p = invalidationPrefixes('PUT', '/repos/a/b/pulls/3/merge')
    expect(p).toContain('/repos/a/b/pulls')
    expect(p).toContain('/repos/a/b/commits')
  })
  it('改文件会清目录与提交', () => {
    const p = invalidationPrefixes('PUT', '/repos/a/b/contents/src/x.ts')
    expect(p).toContain('/repos/a/b/contents')
    expect(p).toContain('/repos/a/b/commits')
  })
  it('建分支会清分支与标签', () => {
    const p = invalidationPrefixes('POST', '/repos/a/b/git/refs')
    expect(p).toContain('/repos/a/b/branches')
    expect(p).toContain('/repos/a/b/tags')
  })
})
