import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  APK_STORE_FRESH,
  APK_STORE_MAX_AGE,
  APK_STORE_OFFICIAL_URL,
  apkAppToRepo,
  apkPlatforms,
  apkStoreCandidates,
  apkStoreFresh,
  apkStoreUsable,
  avatarSources,
  defaultApkStoreHttp,
  fetchApkStore,
  loadApkStore,
  normalizeTs,
  parseApkFeed,
  parseApkStore,
  peekApkStore,
  resetApkStoreMemory,
  sanitizeApkApps,
  serializeApkStore,
  urlProxyBases,
} from '../apkstore'
import type { ApkStore, ApkStoreHttp } from '../apkstore'

const NOW = Date.parse('2026-11-21T08:00:00Z')

function feedItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    name: 'localsend',
    fullName: 'localsend/localsend',
    owner: { login: 'localsend', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4' },
    description: '跨设备互传',
    defaultBranch: 'main',
    stargazersCount: 60000,
    forksCount: 3400,
    language: 'Dart',
    topics: ['share', 'cross-platform'],
    pushedAt: '2026-11-20 14:36:03+00',
    latestReleaseTag: 'v1.17.0',
    hasInstallersAndroid: true,
    ...overrides,
  }
}

function feedText(items: Record<string, unknown>[], rotation = '2026-11-20'): string {
  return JSON.stringify({ category: 'feed', platform: 'android', rotation, repositories: items })
}

const memoryKv = () => {
  const map = new Map<string, string>()
  return {
    get: async (k: string) => map.get(k) ?? null,
    set: async (k: string, v: string) => void map.set(k, v),
    remove: async (k: string) => void map.delete(k),
  }
}

beforeEach(() => {
  resetApkStoreMemory()
})

describe('normalizeTs', () => {
  it('处理 komi-store 的空格分隔 + 双位时区格式', () => {
    expect(normalizeTs('2026-11-20 14:36:03+00')).toBe('2026-11-20T14:36:03.000Z')
  })

  it('兼容 +0000 与 +08:00 与 ISO', () => {
    expect(normalizeTs('2026-11-20 14:36:03+0800')).toBe('2026-11-20T06:36:03.000Z')
    expect(normalizeTs('2026-11-20T14:36:03+08:00')).toBe('2026-11-20T06:36:03.000Z')
    expect(normalizeTs('2026-11-20T14:36:03Z')).toBe('2026-11-20T14:36:03.000Z')
  })

  it('纯日期当 UTC 零点；无时区补 UTC', () => {
    expect(normalizeTs('2026-11-20')).toBe('2026-11-20T00:00:00.000Z')
    expect(normalizeTs('2026-11-20 14:36:03')).toBe('2026-11-20T14:36:03.000Z')
  })

  it('垃圾输入一律 null', () => {
    expect(normalizeTs(null)).toBeNull()
    expect(normalizeTs(undefined)).toBeNull()
    expect(normalizeTs('')).toBeNull()
    expect(normalizeTs('   ')).toBeNull()
    expect(normalizeTs('not-a-date')).toBeNull()
    expect(normalizeTs(12345)).toBeNull()
  })
})

describe('sanitizeApkApps', () => {
  it('清洗出全部展示字段', () => {
    const apps = sanitizeApkApps([feedItem()])
    expect(apps).toHaveLength(1)
    const a = apps[0]
    expect(a.fullName).toBe('localsend/localsend')
    expect(a.name).toBe('localsend')
    expect(a.owner).toBe('localsend')
    expect(a.avatarUrl).toContain('avatars.githubusercontent.com')
    expect(a.stars).toBe(60000)
    expect(a.latestTag).toBe('v1.17.0')
    expect(a.pushedAt).toBe('2026-11-20T14:36:03.000Z')
    expect(a.topics).toEqual(['share', 'cross-platform'])
    expect(a.platforms).toEqual(['android'])
  })

  it('平台归属：按 hasInstallers* 布尔解析，恒 android 在前', () => {
    expect(
      apkPlatforms({ hasInstallersAndroid: true, hasInstallersWindows: true, hasInstallersMacos: false, hasInstallersLinux: true }),
    ).toEqual(['android', 'windows', 'linux'])
    expect(apkPlatforms({ hasInstallersWindows: true })).toEqual(['windows'])
  })

  it('平台归属：installers 缺失时退到 platformReleases 键；全缺兜 android', () => {
    expect(apkPlatforms({ platformReleases: { android: { tag: 'v1' }, macos: { tag: 'v1' } } })).toEqual([
      'android',
      'macos',
    ])
    expect(apkPlatforms({})).toEqual(['android'])
    expect(apkPlatforms({ hasInstallersAndroid: false, hasInstallersMacos: false })).toEqual(['android'])
  })

  it('平台归属：落盘缓存往返后保留（认 platforms 字段，不做二次兜底）', () => {
    const store = parseApkFeed(feedText([feedItem({ hasInstallersWindows: true, hasInstallersMacos: true })]), NOW)
    const round = parseApkStore(serializeApkStore(store!))
    expect(round?.apps[0].platforms).toEqual(['android', 'windows', 'macos'])
    // 旧缓存没有 platforms 字段：按 android feed 兜底，不崩
    expect(apkPlatforms({})).toEqual(['android'])
  })

  it('fullName 缺失或不含「/」的条目直接丢弃', () => {
    const apps = sanitizeApkApps([
      feedItem({ fullName: 'nopath' }),
      feedItem({ fullName: '' }),
      feedItem({ fullName: undefined }),
      feedItem({ fullName: 'ok/path' }),
      'junk',
      null,
    ])
    expect(apps).toHaveLength(1)
    expect(apps[0].fullName).toBe('ok/path')
  })

  it('同一仓库去重保首条', () => {
    const apps = sanitizeApkApps([
      feedItem({ stargazersCount: 100 }),
      feedItem({ stargazersCount: 999 }),
      feedItem({ fullName: 'LOCALSEND/LOCALSEND' }),
    ])
    expect(apps).toHaveLength(1)
    expect(apps[0].stars).toBe(100)
  })

  it('简介/头像/语言缺失不拦条目，数字垃圾归零', () => {
    const apps = sanitizeApkApps([
      feedItem({
        description: null,
        avatarUrl: '',
        language: undefined,
        stargazersCount: 'bad',
        forksCount: -5,
        topics: 'not-array',
        owner: undefined,
      }),
    ])
    expect(apps).toHaveLength(1)
    expect(apps[0].description).toBeNull()
    expect(apps[0].avatarUrl).toBe('')
    expect(apps[0].language).toBeNull()
    expect(apps[0].stars).toBe(0)
    expect(apps[0].forks).toBe(0)
    expect(apps[0].topics).toEqual([])
    expect(apps[0].owner).toBe('localsend')
  })

  it('非数组输入返回空表', () => {
    expect(sanitizeApkApps(undefined)).toEqual([])
    expect(sanitizeApkApps('repos')).toEqual([])
  })
})

describe('parseApkFeed / parseApkStore', () => {
  it('解析完整 feed，记录 rotation', () => {
    const store = parseApkFeed(feedText([feedItem()]), NOW)
    expect(store).not.toBeNull()
    expect(store?.rotation).toBe('2026-11-20')
    expect(store?.apps).toHaveLength(1)
    expect(store?.at).toBe(NOW)
  })

  it('错误页 / 空表 / 坏 JSON 一律 null', () => {
    expect(parseApkFeed('<html>502</html>', NOW)).toBeNull()
    expect(parseApkFeed('{"repositories": []}', NOW)).toBeNull()
    expect(parseApkFeed('not json', NOW)).toBeNull()
    expect(parseApkFeed('', NOW)).toBeNull()
  })

  it('落盘结构往返一致；损坏结构不崩', () => {
    const store = parseApkFeed(feedText([feedItem()]), NOW) as ApkStore
    const back = parseApkStore(serializeApkStore(store))
    expect(back?.apps).toHaveLength(1)
    expect(back?.apps[0].fullName).toBe('localsend/localsend')
    expect(parseApkStore(null)).toBeNull()
    expect(parseApkStore('{')).toBeNull()
    expect(parseApkStore('{"at":"x","apps":1}')).toBeNull()
  })
})

describe('新鲜度', () => {
  it('6 小时内算新鲜，3 天内算可用，超 3 天不可用', () => {
    const store = parseApkFeed(feedText([feedItem()]), NOW) as ApkStore
    expect(apkStoreFresh(store, NOW + APK_STORE_FRESH - 1)).toBe(true)
    expect(apkStoreFresh(store, NOW + APK_STORE_FRESH + 1)).toBe(false)
    expect(apkStoreUsable(store, NOW + APK_STORE_MAX_AGE - 1)).toBe(true)
    expect(apkStoreUsable(store, NOW + APK_STORE_MAX_AGE + 1)).toBe(false)
    expect(apkStoreFresh(null)).toBe(false)
    // 时钟回拨按未过期处理，不出负年龄崩溃
    expect(apkStoreUsable(store, NOW - 1000)).toBe(true)
  })
})

describe('apkStoreCandidates', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('自建站队首、官方 raw 恒在、公共代理殿后，保序去重', () => {
    const urls = apkStoreCandidates(
      ['https://gh-proxy.com', 'https://ghfast.top'],
      'https://gh.example.com',
    )
    expect(urls[0]).toBe(
      'https://gh.example.com/komi-store/komi-store-backend-data/raw/main/cached-data/feed/android.json',
    )
    expect(urls[1]).toBe(APK_STORE_OFFICIAL_URL)
    expect(urls[2]).toBe(
      'https://gh-proxy.com/https://raw.githubusercontent.com/komi-store/komi-store-backend-data/main/cached-data/feed/android.json',
    )
    expect(urls[3]).toBe(
      'https://ghfast.top/https://raw.githubusercontent.com/komi-store/komi-store-backend-data/main/cached-data/feed/android.json',
    )
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('自建站与官方重复时只留一条；空自建站跳过', () => {
    const official = apkStoreCandidates([], 'https://raw.githubusercontent.com')
    expect(official).toEqual([APK_STORE_OFFICIAL_URL])
    expect(apkStoreCandidates([], '')).toEqual([APK_STORE_OFFICIAL_URL])
  })

  it('默认代理来自内置 url 风格站点且不含官方直连', () => {
    const urls = apkStoreCandidates(undefined, 'https://gh.example.com')
    expect(urls.some((u) => u.startsWith('https://github.com/'))).toBe(false)
    expect(urls.length).toBeGreaterThan(2)
    expect(urls[1]).toBe(APK_STORE_OFFICIAL_URL)
  })
})

describe('avatarSources', () => {
  it('裸头像域名：原图队首，url 风格代理逐个垫后', () => {
    const list = avatarSources('https://avatars.githubusercontent.com/u/1?v=4', [
      'https://gh-proxy.com',
      'https://ghfast.top',
    ])
    expect(list[0]).toBe('https://avatars.githubusercontent.com/u/1?v=4')
    expect(list[1]).toBe('https://gh-proxy.com/https://avatars.githubusercontent.com/u/1?v=4')
    expect(list[2]).toBe('https://ghfast.top/https://avatars.githubusercontent.com/u/1?v=4')
  })

  it('默认代理来自 urlProxyBases()，与 feed 候选同一来源', () => {
    expect(urlProxyBases().length).toBeGreaterThan(0)
    const list = avatarSources('https://avatars.githubusercontent.com/u/2?v=4')
    expect(list.length).toBe(1 + urlProxyBases().length)
    expect(list[1].startsWith(urlProxyBases()[0])).toBe(true)
  })

  it('已改写成镜像域名的头像不再二次包壳；空值返回空表', () => {
    const mirrored = avatarSources(
      'https://avatars-githubusercontent-com-gh.zjkl0330.dpdns.org/u/1?v=4',
      ['https://gh-proxy.com'],
    )
    expect(mirrored).toEqual(['https://avatars-githubusercontent-com-gh.zjkl0330.dpdns.org/u/1?v=4'])
    expect(avatarSources('')).toEqual([])
    expect(avatarSources('  ')).toEqual([])
    expect(avatarSources(undefined as unknown as string)).toEqual([])
  })

  it('代理与原图同域名时去重；候选保序无重复', () => {
    const list = avatarSources('https://avatars.githubusercontent.com/u/3?v=4', [
      'https://gh-proxy.com',
      'https://gh-proxy.com/',
    ])
    expect(new Set(list).size).toBe(list.length)
  })
})

describe('fetchApkStore', () => {
  it('第一条能出合法 JSON 的线路赢', async () => {
    const calls: string[] = []
    const http: ApkStoreHttp = async (url) => {
      calls.push(url)
      if (calls.length === 1) return '<html>bad</html>'
      return feedText([feedItem()])
    }
    const store = await fetchApkStore(['a', 'b', 'c'], http, NOW)
    expect(calls).toEqual(['a', 'b'])
    expect(store?.apps[0].fullName).toBe('localsend/localsend')
  })

  it('全部失败返回 null', async () => {
    const http: ApkStoreHttp = async () => null
    expect(await fetchApkStore(['a', 'b'], http, NOW)).toBeNull()
  })
})

describe('loadApkStore', () => {
  it('新鲜缓存直接用，不发网络请求', async () => {
    const store = parseApkFeed(feedText([feedItem()]), NOW) as ApkStore
    const kv = memoryKv()
    await kv.set('ghx.apkstore.v1', serializeApkStore(store))
    let net = 0
    const http: ApkStoreHttp = async () => {
      net += 1
      return feedText([feedItem()])
    }
    const got = await loadApkStore(kv, { http, now: NOW + 1000 })
    expect(net).toBe(0)
    expect(got?.apps[0].fullName).toBe('localsend/localsend')
    expect(peekApkStore()?.apps[0].fullName).toBe('localsend/localsend')
  })

  it('缓存过期时走网络并回写缓存', async () => {
    const stale = parseApkFeed(feedText([feedItem()]), NOW - APK_STORE_FRESH - 1000) as ApkStore
    const kv = memoryKv()
    await kv.set('ghx.apkstore.v1', serializeApkStore(stale))
    const newer = feedText([feedItem({ fullName: 'godotengine/godot' })], '2026-11-21')
    const http: ApkStoreHttp = async () => newer
    const got = await loadApkStore(kv, { http, now: NOW })
    expect(got?.apps[0].fullName).toBe('godotengine/godot')
    expect(got?.rotation).toBe('2026-11-21')
    const saved = parseApkStore(await kv.get('ghx.apkstore.v1'))
    expect(saved?.apps[0].fullName).toBe('godotengine/godot')
    expect(saved?.at).toBe(NOW)
  })

  it('fresh: true 绕过缓存强制刷新', async () => {
    const fresh = parseApkFeed(feedText([feedItem()]), NOW) as ApkStore
    const kv = memoryKv()
    await kv.set('ghx.apkstore.v1', serializeApkStore(fresh))
    let net = 0
    const http: ApkStoreHttp = async () => {
      net += 1
      return feedText([feedItem({ fullName: 'topjohnwu/Magisk' })])
    }
    const got = await loadApkStore(kv, { http, fresh: true, now: NOW })
    expect(net).toBe(1)
    expect(got?.apps[0].fullName).toBe('topjohnwu/Magisk')
  })

  it('网络全断时回退未过期的设备缓存，而不是消失', async () => {
    const stored = parseApkFeed(feedText([feedItem()]), NOW - APK_STORE_FRESH - 1000) as ApkStore
    const kv = memoryKv()
    await kv.set('ghx.apkstore.v1', serializeApkStore(stored))
    const http: ApkStoreHttp = async () => null
    const got = await loadApkStore(kv, { http, now: NOW })
    expect(got?.apps[0].fullName).toBe('localsend/localsend')
  })

  it('没有任何缓存且网络全断时返回 null', async () => {
    const http: ApkStoreHttp = async () => null
    expect(await loadApkStore(memoryKv(), { http, now: NOW })).toBeNull()
    expect(await loadApkStore(null, { http, now: NOW })).toBeNull()
  })
})

describe('apkAppToRepo', () => {
  it('映射出能直接进详情链路的 Repo', () => {
    const [app] = sanitizeApkApps([feedItem()])
    const repo = apkAppToRepo(app, NOW)
    expect(repo.id).toBeLessThan(0)
    expect(repo.full_name).toBe('localsend/localsend')
    expect(repo.owner).toBe('localsend')
    expect(repo.name).toBe('localsend')
    expect(repo.private).toBe(false)
    expect(repo.visibility).toBe('public')
    expect(repo.archived).toBe(false)
    expect(repo.disabled).toBe(false)
    expect(repo.stargazers_count).toBe(60000)
    expect(repo.pushed_at).toBe('2026-11-20T14:36:03.000Z')
    expect(repo.default_branch).toBe('main')
    expect(repo.topics).toEqual(['share', 'cross-platform'])
  })

  it('同仓映射出的 id 稳定；不同仓不撞车', () => {
    const [a, b] = sanitizeApkApps([feedItem(), feedItem({ fullName: 'o/other' })])
    expect(apkAppToRepo(a, NOW).id).toBe(apkAppToRepo(a, NOW + 1).id)
    expect(apkAppToRepo(a, NOW).id).not.toBe(apkAppToRepo(b, NOW).id)
  })

  it('pushedAt 缺失时退到当前时间，不会是非法字符串', () => {
    const [app] = sanitizeApkApps([feedItem({ pushedAt: 'garbage' })])
    const repo = apkAppToRepo(app, NOW)
    expect(Number.isNaN(Date.parse(repo.pushed_at))).toBe(false)
  })
})

describe('defaultApkStoreHttp', () => {
  it('非 200 返回 null', async () => {
    const stub = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('nope', { status: 502 }) as Response)
    await expect(defaultApkStoreHttp('https://x/y.json')).resolves.toBeNull()
    expect(stub).toHaveBeenCalledOnce()
  })

  it('fetch 抛异常收敛成 null，不往外抛', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(defaultApkStoreHttp('https://x/y.json')).resolves.toBeNull()
  })
})
