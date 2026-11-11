import { beforeEach, describe, expect, it } from 'vitest'
import {
  HOT_FRESH,
  HOT_MAX_AGE,
  HOT_MAX_ENTRIES,
  HOT_PAGE_SIZE,
  clearHotCache,
  clearHotMemory,
  hotKey,
  isTrendingRange,
  loadHotEntry,
  loadHotPref,
  mergeHotIndex,
  parseHotEntry,
  parseHotIndex,
  parseHotPref,
  peekHot,
  putHot,
  recallHotPref,
  rememberHotPref,
  sanitizeHotRepos,
  saveHotEntry,
  saveHotPref,
} from '../hotCache'
import { memoryKV } from '../storage'
import type { Repo } from '../types'

function repo(over: Partial<Repo> = {}): Repo {
  return {
    id: 1,
    name: 'ghx',
    full_name: 'zjkl0330/ghx',
    owner: 'zjkl0330',
    private: false,
    visibility: 'public',
    archived: false,
    disabled: false,
    description: '安卓端 GitHub 客户端',
    language: 'TypeScript',
    stargazers_count: 12,
    forks_count: 0,
    pushed_at: '2026-11-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z',
    default_branch: 'main',
    ...over,
  }
}

beforeEach(() => {
  clearHotMemory()
})

describe('热门缓存的键', () => {
  it('语言为空时用 * 占位，组合互不冲突', () => {
    expect(hotKey('week', null)).toBe('week|*')
    expect(hotKey('day', 'C++')).toBe('day|C++')
    expect(hotKey('week', null)).not.toBe(hotKey('month', null))
  })

  it('只认三个时间段', () => {
    expect(isTrendingRange('day')).toBe(true)
    expect(isTrendingRange('year')).toBe(false)
    expect(isTrendingRange(null)).toBe(false)
  })
})

describe('落盘前过滤', () => {
  it('私有与停用仓库不写盘，权限位也去掉', () => {
    const list = [
      repo({ id: 1, full_name: 'o/pub', permissions: { admin: true, push: true, pull: true } }),
      repo({ id: 2, full_name: 'o/priv', private: true, visibility: 'private' }),
      repo({ id: 3, full_name: 'o/off', disabled: true }),
    ]
    const out = sanitizeHotRepos(list)
    expect(out.map((r) => r.full_name)).toEqual(['o/pub'])
    expect(out[0].permissions).toBeUndefined()
    // 入参不能被改掉，页面还在用
    expect(list[0].permissions).toBeDefined()
  })

  it('最多留一页，多出来的截掉', () => {
    const many = Array.from({ length: 40 }, (_, i) => repo({ id: i + 1, full_name: `o/r${i}` }))
    expect(sanitizeHotRepos(many).length).toBe(HOT_PAGE_SIZE)
    // 返回的是新数组
    expect(sanitizeHotRepos(many)).not.toBe(many)
  })
})

describe('快照解析', () => {
  const good = JSON.stringify({ at: 1_000_000, tokenId: 't1', repos: [repo()] })

  it('令牌对得上且没过期才采信', () => {
    expect(parseHotEntry(good, 't1', 1_000_000 + 60_000)?.repos.length).toBe(1)
  })

  it('换号后不认别人的快照', () => {
    expect(parseHotEntry(good, 't2', 1_000_000)).toBeNull()
  })

  it('过期、未来时间、坏 JSON、空值一律当没有', () => {
    expect(parseHotEntry(good, 't1', 1_000_000 + HOT_MAX_AGE + 1)).toBeNull()
    expect(parseHotEntry(good, 't1', 1_000_000 - 120_000)).toBeNull()
    expect(parseHotEntry('{oops', 't1', 1_000_000)).toBeNull()
    expect(parseHotEntry(null, 't1', 1_000_000)).toBeNull()
    expect(parseHotEntry(JSON.stringify({ at: 1, tokenId: 't1' }), 't1', 2000)).toBeNull()
  })

  it('解析时再过滤一次，旧快照里的私有仓库也不会露出来', () => {
    const dirty = JSON.stringify({
      at: 1_000_000,
      tokenId: 't1',
      repos: [repo({ id: 1 }), repo({ id: 2, full_name: 'o/p', private: true })],
    })
    expect(parseHotEntry(dirty, 't1', 1_000_000)?.repos.length).toBe(1)
  })
})

describe('索引淘汰', () => {
  it('超出上限丢最旧，新的排第一', () => {
    const items = Array.from({ length: HOT_MAX_ENTRIES }, (_, i) => ({ k: `k${i}`, at: i }))
    const { keep, drop } = mergeHotIndex(items, { k: 'new', at: 99 })
    expect(keep.length).toBe(HOT_MAX_ENTRIES)
    expect(drop.map((i) => i.k)).toEqual(['k0'])
    expect(keep[0].k).toBe('new')
  })

  it('同一个 key 再写只更新，不会占两份名额', () => {
    const items = Array.from({ length: HOT_MAX_ENTRIES }, (_, i) => ({ k: `k${i}`, at: i }))
    const { keep, drop } = mergeHotIndex(items, { k: 'k3', at: 99 })
    expect(drop).toEqual([])
    expect(keep.length).toBe(HOT_MAX_ENTRIES)
    expect(keep.filter((i) => i.k === 'k3').length).toBe(1)
    expect(keep[0].k).toBe('k3')
  })

  it('坏索引结构不会把流程搞崩', () => {
    expect(parseHotIndex('not json')).toEqual([])
    expect(parseHotIndex(JSON.stringify({ a: 1 }))).toEqual([])
    expect(parseHotIndex(null)).toEqual([])
  })
})

describe('内存层', () => {
  it('按令牌隔离，换号拿不到上一份', () => {
    putHot('t1', 'week', null, { at: Date.now(), tokenId: 't1', repos: [repo()] })
    expect(peekHot('t1', 'week', null)?.repos.length).toBe(1)
    expect(peekHot('t2', 'week', null)).toBeNull()
    expect(peekHot(null, 'week', null)).toBeNull()
  })

  it('超过上限时淘汰最早写入的那份', () => {
    for (let i = 0; i < 30; i += 1) {
      putHot('t1', 'day', `L${i}`, { at: i, tokenId: 't1', repos: [] })
    }
    expect(peekHot('t1', 'day', 'L0')).toBeNull()
    expect(peekHot('t1', 'day', 'L29')).not.toBeNull()
  })
})

describe('设备存储层', () => {
  it('存进去再读出来，过期也照样读（是否使用由调用方判断）', async () => {
    const kv = memoryKV()
    const now = 2_000_000
    await saveHotEntry(kv, 't1', 'week', 'Go', [repo({ language: 'Go' })], now)
    const got = await loadHotEntry(kv, 't1', 'week', 'Go', now + 1_000)
    expect(got?.at).toBe(now)
    expect(got?.repos[0].language).toBe('Go')
  })

  it('冷启动从设备存储恢复（内存已被清空）', async () => {
    const kv = memoryKV()
    const now = Date.now()
    await saveHotEntry(kv, 't1', 'month', null, [repo()], now)
    clearHotMemory()
    const got = await loadHotEntry(kv, 't1', 'month', null, now)
    expect(got?.repos.length).toBe(1)
    // 读到之后回填内存，第二次是同步命中
    expect(peekHot('t1', 'month', null)?.repos.length).toBe(1)
  })

  it(`超过 ${HOT_MAX_ENTRIES} 份时清掉最旧的，旧的读不出来`, async () => {
    const kv = memoryKV()
    const base = 5_000_000
    for (let i = 0; i < HOT_MAX_ENTRIES + 2; i += 1) {
      await saveHotEntry(kv, 't1', 'day', `L${i}`, [repo()], base + i)
    }
    clearHotMemory()
    const oldest = await loadHotEntry(kv, 't1', 'day', 'L0', base + 100)
    expect(oldest).toBeNull()
    clearHotMemory()
    const newest = await loadHotEntry(kv, 't1', 'day', `L${HOT_MAX_ENTRIES + 1}`, base + 100)
    expect(newest).not.toBeNull()
  })

  it('空结果也存，回来时立刻是空态而不是骨架', async () => {
    const kv = memoryKV()
    await saveHotEntry(kv, 't1', 'day', null, [], 1_000_000)
    clearHotMemory()
    const got = await loadHotEntry(kv, 't1', 'day', null, 1_000_000)
    expect(got).not.toBeNull()
    expect(got?.repos).toEqual([])
  })

  it('kv 为空（无设备存储）时不影响内存层', async () => {
    await saveHotEntry(null, 't1', 'week', null, [repo()], Date.now())
    expect(peekHot('t1', 'week', null)?.repos.length).toBe(1)
  })

  it('删除账号后连设备上的快照一起清掉', async () => {
    const kv = memoryKV()
    const now = Date.now()
    await saveHotEntry(kv, 't1', 'week', null, [repo()], now)
    await saveHotPref(kv, 't1', { range: 'month', lang: 'Go' })
    await clearHotCache(kv, 't1')
    expect(peekHot('t1', 'week', null)).toBeNull()
    expect(recallHotPref('t1')).toBeNull()
    clearHotMemory()
    expect(await loadHotEntry(kv, 't1', 'week', null, now)).toBeNull()
    expect(await loadHotPref(kv, 't1')).toBeNull()
  })
})

describe('筛选偏好', () => {
  it('记住上次的时间段与语言，切回来不用重选', () => {
    rememberHotPref('t1', { range: 'month', lang: 'Rust' })
    expect(recallHotPref('t1')).toEqual({ range: 'month', lang: 'Rust' })
    expect(recallHotPref('t2')).toBeNull()
  })

  it('非法值退回空，不让坏数据决定页面状态', () => {
    expect(parseHotPref(JSON.stringify({ range: 'year', lang: null }))).toBeNull()
    expect(parseHotPref(JSON.stringify({ range: 'day', lang: 'x'.repeat(33) }))).toBeNull()
    expect(parseHotPref('')).toBeNull()
    expect(parseHotPref('{}')).toBeNull()
    expect(parseHotPref(JSON.stringify({ range: 'day' }))).toEqual({ range: 'day', lang: null })
  })

  it('写进设备存储，冷启动读得回来', async () => {
    const kv = memoryKV()
    await saveHotPref(kv, 't1', { range: 'day', lang: null })
    clearHotMemory()
    expect(await loadHotPref(kv, 't1')).toEqual({ range: 'day', lang: null })
    // 读的时候顺手写回内存，下次同步取
    expect(recallHotPref('t1')).toEqual({ range: 'day', lang: null })
  })
})

describe('新鲜度阈值', () => {
  it('十分钟：切来切去不重复打网络，超过就静默刷新', () => {
    expect(HOT_FRESH).toBe(10 * 60_000)
    expect(HOT_FRESH).toBeLessThan(HOT_MAX_AGE)
  })
})
