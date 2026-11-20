import { describe, expect, it, vi } from 'vitest'
import {
  BADGE_TTL,
  badgeFresh,
  badgeKey,
  badgesOfAssets,
  badgesOfReleases,
  kindOfAsset,
  loadBadges,
  parseBadge,
  readCachedBadges,
  runBadgeQueue,
  serializeBadge,
} from '../rel-badge'
import { memoryKV } from '../storage'
import type { Release } from '../types'

function rel(assets: string[], extra: Partial<Release> = {}): Release {
  return {
    id: 1,
    tag_name: 'v1',
    name: null,
    body: null,
    draft: false,
    prerelease: false,
    created_at: '',
    published_at: '',
    html_url: '',
    assets: assets.map((name, i) => ({
      id: i,
      name,
      size: 1,
      download_count: 0,
      browser_download_url: '',
    })),
    ...extra,
  }
}

describe('kindOfAsset', () => {
  it('认得 apk 与 exe，大小写都行', () => {
    expect(kindOfAsset('ghx-0.8.2-debug.apk')).toBe('apk')
    expect(kindOfAsset('GHX.APK')).toBe('apk')
    expect(kindOfAsset('setup.exe')).toBe('exe')
    expect(kindOfAsset('Setup.EXE')).toBe('exe')
  })

  it('其它后缀与空值一律不算', () => {
    expect(kindOfAsset('ghx.apk.sha256')).toBe(null)
    expect(kindOfAsset('app.dmg')).toBe(null)
    expect(kindOfAsset('source.zip')).toBe(null)
    expect(kindOfAsset('')).toBe(null)
    expect(kindOfAsset('   ')).toBe(null)
  })

  it('前后空格不影响判断', () => {
    expect(kindOfAsset('  app.apk  ')).toBe('apk')
  })
})

describe('badgesOfAssets', () => {
  it('两种都有时顺序固定为 apk → exe', () => {
    expect(badgesOfAssets(['a.exe', 'a.apk'])).toEqual(['apk', 'exe'])
  })

  it('同名多份只出一个标记', () => {
    expect(badgesOfAssets(['a.apk', 'b.apk', 'c.apk'])).toEqual(['apk'])
  })

  it('没有安装包时返回空数组', () => {
    expect(badgesOfAssets(['source.tar.gz', 'notes.txt'])).toEqual([])
  })
})

describe('badgesOfReleases', () => {
  it('草稿不计入：草稿里的包别人根本下不到', () => {
    expect(badgesOfReleases([rel(['x.apk'], { draft: true })])).toEqual([])
  })

  it('预发布计入：用户判断的是「有没有能装的包」', () => {
    expect(badgesOfReleases([rel(['x.apk'], { prerelease: true })])).toEqual(['apk'])
  })

  it('多个 release 合起来看', () => {
    expect(badgesOfReleases([rel(['x.apk']), rel(['y.exe'])])).toEqual(['apk', 'exe'])
  })

  it('assets 缺失不炸', () => {
    expect(badgesOfReleases([{ draft: false, assets: undefined } as unknown as Release])).toEqual([])
    expect(badgesOfReleases([])).toEqual([])
  })
})

describe('缓存读写', () => {
  it('坏 JSON / 缺 at / 脏 kinds 都退化成 null 或过滤', () => {
    expect(parseBadge('{')).toBe(null)
    expect(parseBadge(null)).toBe(null)
    expect(parseBadge(JSON.stringify({ kinds: ['apk'] }))).toBe(null)
    expect(parseBadge(JSON.stringify({ at: 1, kinds: ['apk', 'weird', 7] }))).toEqual({
      at: 1,
      kinds: ['apk'],
    })
  })

  it('存进去读出来一致', () => {
    const raw = serializeBadge({ at: 123, kinds: ['exe', 'apk'] })
    expect(parseBadge(raw)).toEqual({ at: 123, kinds: ['apk', 'exe'] })
  })

  it('Fresh 的边界：差 1 毫秒算新鲜，正好到期算过期', () => {
    expect(badgeFresh({ at: 1000, kinds: [] }, 1000 + BADGE_TTL - 1)).toBe(true)
    expect(badgeFresh({ at: 1000, kinds: [] }, 1000 + BADGE_TTL)).toBe(false)
    expect(badgeFresh(null)).toBe(false)
    // 时间倒流（设备改时间）也当过期，否则会永久卡住一份旧结果
    expect(badgeFresh({ at: 5000, kinds: [] }, 1000)).toBe(false)
  })

  it('键里带令牌 id，大小写不同视为同一个仓库', () => {
    expect(badgeKey('t1', 'A/B')).toBe(badgeKey('t1', 'a/b'))
    expect(badgeKey('t1', 'a/b')).not.toBe(badgeKey('t2', 'a/b'))
    expect(badgeKey('', 'a/b')).toContain('anon')
  })
})

describe('loadBadges', () => {
  it('缓存新鲜时不再发请求', async () => {
    const kv = memoryKV({ [badgeKey('t1', 'a/b')]: serializeBadge({ at: 1000, kinds: ['apk'] }) })
    const fetchReleases = vi.fn()
    const kinds = await loadBadges({
      kv,
      tokenId: 't1',
      fullName: 'a/b',
      fetchReleases,
      now: () => 1000 + 60_000,
    })
    expect(kinds).toEqual(['apk'])
    expect(fetchReleases).not.toHaveBeenCalled()
  })

  it('缓存过期后重新请求并覆盖', async () => {
    const kv = memoryKV({ [badgeKey('t1', 'a/b')]: serializeBadge({ at: 1000, kinds: ['apk'] }) })
    const fetchReleases = vi.fn(async () => [rel(['x.exe'])])
    const kinds = await loadBadges({
      kv,
      tokenId: 't1',
      fullName: 'a/b',
      fetchReleases,
      now: () => 1000 + BADGE_TTL + 1,
    })
    expect(kinds).toEqual(['exe'])
    expect(fetchReleases).toHaveBeenCalledTimes(1)
    expect(parseBadge(await kv.get(badgeKey('t1', 'a/b')))?.kinds).toEqual(['exe'])
  })

  it('空结果也写缓存：没安装包的仓库不该每次都被重查', async () => {
    const kv = memoryKV()
    await loadBadges({
      kv,
      tokenId: 't1',
      fullName: 'a/b',
      fetchReleases: async () => [rel(['src.zip'])],
      now: () => 2000,
    })
    expect(parseBadge(await kv.get(badgeKey('t1', 'a/b')))).toEqual({ at: 2000, kinds: [] })
  })

  it('没有本地存储时照样返回，不崩', async () => {
    const kinds = await loadBadges({
      kv: null,
      tokenId: 't1',
      fullName: 'a/b',
      fetchReleases: async () => [rel(['x.apk'])],
    })
    expect(kinds).toEqual(['apk'])
  })
})

describe('readCachedBadges', () => {
  it('只回未过期且非空的那几条', async () => {
    const kv = memoryKV({
      [badgeKey('t1', 'a/one')]: serializeBadge({ at: 1000, kinds: ['apk'] }),
      [badgeKey('t1', 'a/two')]: serializeBadge({ at: 1000, kinds: [] }),
      [badgeKey('t1', 'a/old')]: serializeBadge({ at: 1, kinds: ['exe'] }),
    })
    const got = await readCachedBadges(kv, 't1', ['a/one', 'a/two', 'a/old', 'a/missing'], 1000 + BADGE_TTL - 1)
    expect(Object.keys(got)).toEqual(['a/one'])
    expect(got['a/one']).toEqual(['apk'])
  })
})

describe('runBadgeQueue', () => {
  it('每个仓库只处理一次，结果逐个回传', async () => {
    const seen: [string, string[] | null][] = []
    await runBadgeQueue({
      names: ['a/1', 'a/2', 'a/3'],
      probe: async (n) => (n.endsWith('2') ? ['exe'] : ['apk']),
      onEach: (n, k) => seen.push([n, k]),
    })
    expect(seen).toHaveLength(3)
    expect(seen.map(([n]) => n).sort()).toEqual(['a/1', 'a/2', 'a/3'])
    expect(seen.find(([n]) => n === 'a/2')?.[1]).toEqual(['exe'])
  })

  it('并发不超过设定值', async () => {
    let running = 0
    let peak = 0
    await runBadgeQueue({
      names: Array.from({ length: 12 }, (_, i) => `a/${i}`),
      concurrency: 3,
      probe: async () => {
        running += 1
        peak = Math.max(peak, running)
        await new Promise((r) => setTimeout(r, 5))
        running -= 1
        return []
      },
      onEach: () => undefined,
    })
    expect(peak).toBeLessThanOrEqual(3)
  })

  it('单个仓库抛错只让它自己空着，不影响后面的', async () => {
    const seen: string[] = []
    await runBadgeQueue({
      names: ['a/1', 'a/2', 'a/3'],
      concurrency: 1,
      probe: async (n) => {
        if (n === 'a/2') throw new Error('403')
        return ['apk']
      },
      onEach: (n) => seen.push(n),
    })
    expect(seen).toEqual(['a/1', 'a/2', 'a/3'])
  })

  it('isAlive 变假后立刻停手', async () => {
    let alive = true
    const seen: string[] = []
    await runBadgeQueue({
      names: ['a/1', 'a/2', 'a/3', 'a/4'],
      concurrency: 1,
      probe: async () => {
        alive = false
        return []
      },
      onEach: (n) => seen.push(n),
      isAlive: () => alive,
    })
    expect(seen.length).toBeLessThanOrEqual(1)
  })
})
