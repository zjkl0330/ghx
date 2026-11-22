import { describe, expect, it, vi } from 'vitest'
import {
  BUILTIN_MIRRORS,
  DEFAULT_MIRROR,
  EMPTY_STORE,
  KNOWN_RELEASE_PROXIES,
  OFFICIAL_MIRROR,
  PROBE_BYTES,
  SPEED_TTL,
  formatSpeed,
  githubUrlAt,
  kbpsOf,
  mirrorCandidates,
  mirrorDefFor,
  addCustomMirror,
  effectiveMirrors,
  fallbackPageBase,
  isOverridden,
  mirrorLabel,
  mirrorKnown,
  migrateLegacyMirrorStore,
  normalizeBase,
  parseMirrorStore,
  removeCustomMirror,
  resetMirrorBase,
  resetMirrorRegistry,
  serializeMirrorStore,
  selfMirrorBase,
  setMirrorBase,
  setMirrorRegistry,
  validateMirrorBase,
  parseSnapshot,
  pickFastest,
  probeAll,
  probeMirror,
  rankProbes,
  rawUrlAt,
  releaseCandidates,
  releaseDownloadUrl,
  releasePageUrl,
  pickReachable,
  snapshotFresh,
  snapshotOf,
  type ProbeResult,
} from '../mirrors'

function ok(base: string, kbps: number, ms = 1000): ProbeResult {
  return { base, label: base, style: 'path', status: 'ok', ms, bytes: Math.round(kbps * 1024), kbps }
}

function bad(base: string, error = '超时'): ProbeResult {
  return { base, label: base, style: 'path', status: 'fail', ms: 8000, bytes: 0, kbps: 0, error }
}

describe('加速站前缀归一化', () => {
  it('去掉结尾斜杠与空白', () => {
    expect(normalizeBase('  https://gh-proxy.com/  ')).toBe('https://gh-proxy.com')
    expect(normalizeBase('https://a.com///')).toBe('https://a.com')
  })

  it('缺协议时补 https，避免 WebView 当成相对路径', () => {
    expect(normalizeBase('ghfast.top')).toBe('https://ghfast.top')
  })

  it('空串仍然返回空串，交给调用方兜底', () => {
    expect(normalizeBase('   ')).toBe('')
    expect(normalizeBase(null as unknown as string)).toBe('')
  })
})

describe('站点风格识别', () => {
  it('注册过的站能查表命中，官方恒定 official', () => {
    setMirrorRegistry(
      effectiveMirrors(addCustomMirror(EMPTY_STORE, { base: 'https://gh-proxy.com', style: 'url' })),
    )
    try {
      expect(mirrorDefFor('https://gh-proxy.com/').style).toBe('url')
      expect(mirrorDefFor('https://github.com').id).toBe('official')
    } finally {
      resetMirrorRegistry()
    }
  })

  it('大小写不敏感', () => {
    setMirrorRegistry(
      effectiveMirrors(addCustomMirror(EMPTY_STORE, { base: 'https://gh-proxy.com', style: 'url' })),
    )
    try {
      expect(mirrorDefFor('HTTPS://GH-PROXY.COM').style).toBe('url')
    } finally {
      resetMirrorRegistry()
    }
  })

  it('自定义地址按 path 风格处理', () => {
    const def = mirrorDefFor('https://my.proxy.example/')
    expect(def.id).toBe('custom')
    expect(def.style).toBe('path')
    expect(def.base).toBe('https://my.proxy.example')
  })

  it('内置站点表只有官方直连，一个加速站都不预置', () => {
    const ids = BUILTIN_MIRRORS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['official'])
    expect(BUILTIN_MIRRORS).toContainEqual(OFFICIAL_MIRROR)
  })

  /*
   * 这条是防回归的红线：任何人往内置表里塞回一个加速站（哪怕是"临时"），
   * 下一个装包的人就会替那台服务器跑流量。除了 github.com 本身，别的域名
   * 一律不允许出现在内置表里。
   */
  it('内置表里没有 github.com 之外的域名', () => {
    for (const m of BUILTIN_MIRRORS) {
      expect(new URL(m.base).hostname).toBe('github.com')
    }
    expect(KNOWN_RELEASE_PROXIES).toEqual([])
  })

  it('默认候选只剩官方直连', () => {
    const rows = mirrorCandidates(DEFAULT_MIRROR)
    expect(rows.map((r) => r.base)).toEqual(['https://github.com'])
  })

  it('当前站是自定义时补在最前面，避免选中了却看不见', () => {
    const rows = mirrorCandidates('https://my.example/')
    expect(rows[0]).toMatchObject({ base: 'https://my.example', note: '自定义' })
    expect(rows.length).toBe(BUILTIN_MIRRORS.length + 1)
  })

  it('自定义站与内置站重复时不重复插入', () => {
    const rows = mirrorCandidates('https://github.com/')
    expect(rows.filter((r) => r.base === 'https://github.com')).toHaveLength(1)
  })

  it('镜像名优先用可读标签', () => {
    expect(mirrorLabel('https://github.com')).toBe('官方直连')
    expect(mirrorLabel('https://x.example')).toBe('x.example')
  })
})

/**
 * 模拟「用户自己填过站」的环境：一个 url 型反代、一个能翻页的自建站。
 *
 * 包里不再带任何加速站，所以风格识别只能靠注册表 —— 这里就是在还原
 * 用户填完之后 App 的真实状态。
 */
function withStations(fn: () => void) {
  const store = addCustomMirror(
    addCustomMirror(EMPTY_STORE, { base: 'https://gh-proxy.com', style: 'url' }),
    { base: 'https://gh.example.com', style: 'path', page: true },
  )
  setMirrorRegistry(effectiveMirrors(store))
  try {
    fn()
  } finally {
    resetMirrorRegistry()
  }
}

/** 注册若干「用户自己填的站」，跑完自动清空注册表 */
function withRegistry(bases: Array<{ base: string; style?: 'path' | 'url' }>, fn: () => void) {
  let store = EMPTY_STORE
  for (const b of bases) {
    store = addCustomMirror(store, { base: b.base, style: b.style ?? 'path' })
  }
  setMirrorRegistry(effectiveMirrors(store))
  try {
    fn()
  } finally {
    resetMirrorRegistry()
  }
}

describe('地址拼接', () => {
  it('path 风格直接把路径接在前缀后', () => {
    withStations(() => {
      expect(githubUrlAt('https://gh.example.com/', '/827802685/ghx')).toBe(
        'https://gh.example.com/827802685/ghx',
      )
    })
  })

  it('url 风格需要拼完整的 github.com 地址', () => {
    withStations(() => {
      expect(githubUrlAt('https://gh-proxy.com', 'https://github.com/827802685/ghx')).toBe(
        'https://gh-proxy.com/https://github.com/827802685/ghx',
      )
    })
  })

  it('前缀为空时退回官方地址，不生成坏链接', () => {
    expect(githubUrlAt('', '827802685/ghx')).toBe('https://github.com/827802685/ghx')
  })

  it('raw 地址按风格换域', () => {
    withStations(() => {
      expect(rawUrlAt('https://gh.example.com', 'o', 'r', 'main', 'docs/a.png')).toBe(
        'https://gh.example.com/o/r/raw/main/docs/a.png',
      )
      expect(rawUrlAt('https://gh-proxy.com', 'o', 'r', 'dev', 'a.png')).toBe(
        'https://gh-proxy.com/https://raw.githubusercontent.com/o/r/dev/a.png',
      )
    })
  })

  it('raw 缺分支时用 main 兜底', () => {
    withStations(() => {
      expect(rawUrlAt('https://gh.example.com', 'o', 'r', '', 'a.png')).toBe(
        'https://gh.example.com/o/r/raw/main/a.png',
      )
    })
  })

  it('Release 下载地址按风格区分', () => {
    withStations(() => {
      expect(releaseDownloadUrl('https://gh.example.com', '827802685', 'ghx', 'v0.5.0', 'a.apk')).toBe(
        'https://gh.example.com/827802685/ghx/releases/download/v0.5.0/a.apk',
      )
      expect(releaseDownloadUrl('https://gh-proxy.com', '827802685', 'ghx', 'v0.5.0', 'a.apk')).toBe(
        'https://gh-proxy.com/https://github.com/827802685/ghx/releases/download/v0.5.0/a.apk',
      )
    })
  })

  it('文件名里的空格与 # 会被编码，不会被代理截断', () => {
    withStations(() => {
      expect(releaseDownloadUrl('https://gh.example.com', 'o', 'r', 'v1.0.0', 'gh x#1.apk')).toBe(
        'https://gh.example.com/o/r/releases/download/v1.0.0/gh%20x%231.apk',
      )
    })
  })

  it('Release 页面：能翻页的镜像用自己的站', () => {
    withStations(() => {
      expect(releasePageUrl('https://gh.example.com', 'o', 'r', 'v1.0.0')).toBe(
        'https://gh.example.com/o/r/releases/tag/v1.0.0',
      )
    })
  })

  it('Release 页面：纯下载型镜像退回能翻页的站点，保证按钮点得开', () => {
    withStations(() => {
      expect(releasePageUrl('https://gh-proxy.com', 'o', 'r', 'v1.0.0')).toBe(
        'https://gh.example.com/o/r/releases/tag/v1.0.0',
      )
    })
  })

  it('Release 页面：没填能翻页的站时退回官方', () => {
    expect(releasePageUrl('https://gh-proxy.com', 'o', 'r', 'v1.0.0')).toBe(
      `${DEFAULT_MIRROR}/o/r/releases/tag/v1.0.0`,
    )
  })

  it('Release 页面：不给 tag 时指向发行版列表', () => {
    withStations(() => {
      expect(releasePageUrl('https://gh.example.com', 'o', 'r')).toBe(
        'https://gh.example.com/o/r/releases',
      )
    })
  })
})

describe('速度换算', () => {
  it('256KB 用 1 秒 = 256 KB/s', () => {
    expect(kbpsOf(PROBE_BYTES, 1000)).toBe(256)
  })

  it('非法输入返回 0，不产生 NaN 排名', () => {
    expect(kbpsOf(0, 100)).toBe(0)
    expect(kbpsOf(100, 0)).toBe(0)
  })

  it('大速度显示 MB/s，四位数的 KB/s 也换算掉', () => {
    expect(formatSpeed(2048)).toBe('2.0 MB/s')
    expect(formatSpeed(1000)).toBe('1.0 MB/s')
    expect(formatSpeed(300)).toBe('300 KB/s')
    expect(formatSpeed(0)).toBe('—')
  })
})

describe('单站测速', () => {
  const url = 'https://gh.example.com/o/r/releases/download/v1/a.apk'

  it('200 且拿到足够字节算成功', async () => {
    const r = await probeMirror('https://gh.example.com', url, {
      http: async () => ({ status: 206, headers: {}, bytes: 256 * 1024 }),
      now: (() => {
        let t = 0
        return () => (t += 500)
      })(),
    })
    expect(r.status).toBe('ok')
    expect(r.kbps).toBe(512)
    expect(r.style).toBe('path')
  })

  it('非 2xx 判失败并带上状态码', async () => {
    const r = await probeMirror('https://gh-proxy.com', url, {
      http: async () => ({ status: 403, headers: {}, bytes: 77 }),
    })
    expect(r.status).toBe('fail')
    expect(r.error).toContain('403')
  })

  it('返回内容过小视为错误页，不给名次', async () => {
    const r = await probeMirror('https://ghfast.top', url, {
      http: async () => ({ status: 200, headers: {}, bytes: 12 }),
    })
    expect(r.status).toBe('fail')
    expect(r.error).toContain('异常')
  })

  it('超时归为失败，不往外抛', async () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    const r = await probeMirror('https://ghfast.top', url, {
      http: async () => {
        throw abort
      },
    })
    expect(r.status).toBe('fail')
    expect(r.error).toBe('超时')
  })

  it('跨域被拦给出可读提示', async () => {
    const r = await probeMirror('https://ghfast.top', url, {
      http: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    expect(r.error).toContain('跨域')
  })

  it('空地址直接判失败，不发请求', async () => {
    const http = vi.fn()
    const r = await probeMirror('   ', url, { http })
    expect(r.status).toBe('fail')
    expect(http).not.toHaveBeenCalled()
  })
})

describe('批量测速与排序', () => {
  it('顺序探测并按回调逐个汇报', async () => {
    const calls: string[] = []
    const seen: number[] = []
    const bases = ['https://a.example', 'https://b.example']
    const out = await probeAll(
      bases,
      (b) => `${b}/x`,
      {
        http: async (u) => {
          calls.push(u)
          return { status: 206, headers: {}, bytes: 1024 * 256 }
        },
        onResult: (_r, i) => seen.push(i),
      },
    )
    expect(calls).toEqual(['https://a.example/x', 'https://b.example/x'])
    expect(seen).toEqual([0, 1])
    expect(out).toHaveLength(2)
  })

  it('快的排前面，失败的沉底', () => {
    const ranked = rankProbes([bad('x'), ok('slow', 100), ok('fast', 900), bad('y')])
    expect(ranked.map((r) => r.base)).toEqual(['fast', 'slow', 'x', 'y'])
  })

  it('同速时按延迟决胜', () => {
    const ranked = rankProbes([ok('a', 500, 900), ok('b', 500, 300)])
    expect(ranked[0].base).toBe('b')
  })

  it('全失败时没有最优站', () => {
    expect(pickFastest([bad('a'), bad('b')])).toBeNull()
    expect(pickFastest([])).toBeNull()
  })

  it('有成功站时取最快的', () => {
    expect(pickFastest([bad('a'), ok('b', 300), ok('c', 800)])?.base).toBe('c')
  })
})

describe('测速结果快照', () => {
  it('取最优并记录时间', () => {
    const snap = snapshotOf([bad('a'), ok('b', 300), ok('c', 800)], 1000)
    expect(snap.best).toBe('c')
    expect(snap.at).toBe(1000)
    expect(snap.results.map((r) => r.base)).toEqual(['a', 'b', 'c'])
  })

  it('TTL 内算新鲜，过期或时间回拨算失效', () => {
    const snap = snapshotOf([ok('a', 100)], 1000)
    expect(snapshotFresh(snap, 1000 + SPEED_TTL - 1)).toBe(true)
    expect(snapshotFresh(snap, 1000 + SPEED_TTL)).toBe(false)
    expect(snapshotFresh(snap, 0)).toBe(false)
    expect(snapshotFresh(null)).toBe(false)
  })

  it('损坏的 JSON 当没有缓存', () => {
    expect(parseSnapshot('not json')).toBeNull()
    expect(parseSnapshot(null)).toBeNull()
    expect(parseSnapshot('{"at":1}')).toBeNull()
    expect(parseSnapshot('{"at":1,"results":[]}')).toBeNull()
  })

  it('容错读取，丢掉脏条目', () => {
    const raw = JSON.stringify({
      at: 5,
      best: 'https://a.example',
      results: [{ base: 'https://a.example', kbps: 12, ms: 800 }, { base: 3 }],
    })
    const snap = parseSnapshot(raw)
    expect(snap?.results).toEqual([{ base: 'https://a.example', kbps: 12, ms: 800 }])
  })

  it('写入再读回保持一致', () => {
    const snap = snapshotOf([ok('https://a.example', 400)], 42)
    expect(parseSnapshot(JSON.stringify(snap))).toEqual(snap)
  })
})

describe('站点表（改地址 / 自定义）', () => {
  it('默认表就是内置表，没有多余站点', () => {
    const list = effectiveMirrors(EMPTY_STORE)
    expect(list.map((m) => m.base)).toEqual(BUILTIN_MIRRORS.map((m) => m.base))
  })

  it('自定义站改地址只换 base，id 与风格保持不变', () => {
    const one = addCustomMirror(EMPTY_STORE, { label: '自建', base: 'gh.example.com', style: 'path', page: true })
    const id = one.custom[0].id
    const store = setMirrorBase(one, id, 'gh2.example.com')
    const hit = effectiveMirrors(store).find((m) => m.id === id)
    expect(hit?.base).toBe('https://gh2.example.com')
    expect(hit?.style).toBe('path')
    expect(hit?.page).toBe(true)
  })

  it('内置站改地址走 overrides，id 与风格不变', () => {
    const store = setMirrorBase(EMPTY_STORE, 'official', 'gh2.example.com')
    expect(store.overrides.official).toBe('https://gh2.example.com')
    expect(isOverridden(store, 'official')).toBe(true)
    expect(effectiveMirrors(store).find((m) => m.id === 'official')?.style).toBe('path')
  })

  it('改地址后 githubUrlAt 立刻走新域名', () => {
    const one = addCustomMirror(EMPTY_STORE, { base: 'gh.example.com', style: 'path' })
    const store = setMirrorBase(one, one.custom[0].id, 'https://gh2.example.com')
    setMirrorRegistry(effectiveMirrors(store))
    try {
      expect(githubUrlAt('https://gh2.example.com', 'o/r')).toBe('https://gh2.example.com/o/r')
    } finally {
      resetMirrorRegistry()
    }
  })

  it('改回原地址等价于恢复默认', () => {
    const store = setMirrorBase(EMPTY_STORE, 'official', DEFAULT_MIRROR)
    expect(store.overrides.official).toBeUndefined()
  })

  it('恢复默认会删掉 override', () => {
    const store = setMirrorBase(EMPTY_STORE, 'official', 'gh2.example.com')
    expect(resetMirrorBase(store, 'official').overrides.official).toBeUndefined()
  })

  it('添加自定义站点后能参与候选与查表', () => {
    const store = addCustomMirror(EMPTY_STORE, { label: '我的', base: 'my.example.com', style: 'url' })
    expect(store.custom).toHaveLength(1)
    const list = effectiveMirrors(store)
    expect(list.some((m) => m.base === 'https://my.example.com' && m.style === 'url')).toBe(true)
    setMirrorRegistry(list)
    try {
      expect(mirrorCandidates('https://my.example.com').some((r) => r.label === '我的')).toBe(true)
      expect(mirrorDefFor('https://my.example.com').style).toBe('url')
    } finally {
      resetMirrorRegistry()
    }
  })

  it('重复地址不重复添加', () => {
    const a = addCustomMirror(EMPTY_STORE, { base: DEFAULT_MIRROR, style: 'path' })
    expect(a).toBe(EMPTY_STORE)
  })

  it('删除自定义站点只影响它自己', () => {
    const one = addCustomMirror(EMPTY_STORE, { base: 'a.example', style: 'path' })
    const two = addCustomMirror(one, { base: 'b.example', style: 'path' })
    const back = removeCustomMirror(two, two.custom[0].id)
    expect(back.custom.map((c) => c.base)).toEqual(['https://b.example'])
  })

  it('解析容错：脏 JSON / 脏字段都不抛错', () => {
    expect(parseMirrorStore('{oops')).toEqual({ overrides: {}, custom: [] })
    expect(parseMirrorStore(null)).toEqual({ overrides: {}, custom: [] })
    const s = parseMirrorStore(
      JSON.stringify({
        overrides: { zjkl: 'gh3.example', bad: '' },
        custom: [{ base: 'x.example' }, { base: 'x.example' }, { base: '' }, { base: 'y.example', style: 'url' }],
      }),
    )
    expect(s.overrides).toEqual({ zjkl: 'https://gh3.example' })
    expect(s.custom.map((c) => c.base)).toEqual(['https://x.example', 'https://y.example'])
    expect(s.custom[1].style).toBe('url')
  })

  it('序列化再解析保持等价', () => {
    const store = addCustomMirror(setMirrorBase(EMPTY_STORE, 'ghproxy', 'p.example'), {
      label: '自建',
      base: 'w.example',
      style: 'path',
      page: true,
    })
    expect(parseMirrorStore(serializeMirrorStore(store))).toEqual(store)
  })

  it('地址校验：补协议、拒绝空与非法', () => {
    expect(validateMirrorBase('gh.example.com').base).toBe('https://gh.example.com')
    expect(validateMirrorBase('').ok).toBe(false)
    expect(validateMirrorBase('not a url').ok).toBe(false)
    expect(validateMirrorBase('https://x.example/?a=1').ok).toBe(false)
    expect(validateMirrorBase('ftp://x.example').ok).toBe(false)
  })

  it('能翻网页的兜底站点用用户自己填的那个', () => {
    const store = addCustomMirror(EMPTY_STORE, { base: 'https://gh9.example', style: 'path', page: true })
    setMirrorRegistry(effectiveMirrors(store))
    try {
      expect(fallbackPageBase()).toBe('https://gh9.example')
    } finally {
      resetMirrorRegistry()
    }
  })

  it('没有能翻页的站时兜底为空，交给官方地址接管', () => {
    setMirrorRegistry(effectiveMirrors(EMPTY_STORE))
    try {
      expect(fallbackPageBase()).toBe('')
      expect(releasePageUrl('https://gh-proxy.com', 'o', 'r', 'v1')).toBe(
        'https://github.com/o/r/releases/tag/v1',
      )
    } finally {
      resetMirrorRegistry()
    }
  })
})

describe('改地址后全局生效', () => {
  it('安装包下载与自述图片都改用新域名', () => {
    const one = addCustomMirror(EMPTY_STORE, { base: 'https://gh-old.example.com', style: 'path' })
    const store = setMirrorBase(one, one.custom[0].id, 'https://gh-new.example.com')
    setMirrorRegistry(effectiveMirrors(store))
    try {
      const base = 'https://gh-new.example.com'
      expect(releaseDownloadUrl(base, 'o', 'r', 'v1.0.0', 'a.apk')).toBe(
        'https://gh-new.example.com/o/r/releases/download/v1.0.0/a.apk',
      )
      expect(rawUrlAt(base, 'o', 'r', 'main', 'docs/a.png')).toBe(
        'https://gh-new.example.com/o/r/raw/main/docs/a.png',
      )
      // 完整地址风格的站点拼法不同，改地址不能把风格改掉
      const urlStore = addCustomMirror(EMPTY_STORE, { base: 'https://p2.example.com', style: 'url' })
      setMirrorRegistry(effectiveMirrors(urlStore))
      expect(releaseDownloadUrl('https://p2.example.com', 'o', 'r', 'v1', 'a.apk')).toBe(
        'https://p2.example.com/https://github.com/o/r/releases/download/v1/a.apk',
      )
    } finally {
      resetMirrorRegistry()
    }
  })

  it('只改一台不影响其它站点', () => {
    const one = addCustomMirror(EMPTY_STORE, { base: 'https://a.example', style: 'path' })
    const two = addCustomMirror(one, { base: 'https://b.example', style: 'url' })
    const store = setMirrorBase(two, two.custom[0].id, 'https://a2.example')
    const list = effectiveMirrors(store)
    expect(list.find((m) => m.base === 'https://a2.example')).toBeTruthy()
    expect(list.find((m) => m.base === 'https://b.example')?.style).toBe('url')
  })
})

describe('安装包下载线路', () => {
  const OFFICIAL_URL = 'https://github.com/o/r/releases/download/v1/a.apk'

  it('没填站时只剩官方直连一条', () => {
    const list = releaseCandidates(DEFAULT_MIRROR, 'o', 'r', 'v1', 'a.apk')
    expect(list).toEqual([OFFICIAL_URL])
  })

  it('用户填了站：选中站第一，官方垫底', () => {
    withRegistry([{ base: 'https://gh.example.com' }], () => {
      const list = releaseCandidates('https://gh.example.com', 'o', 'r', 'v1', 'a.apk')
      expect(list[0]).toBe('https://gh.example.com/o/r/releases/download/v1/a.apk')
      expect(list[list.length - 1]).toBe(OFFICIAL_URL)
      expect(list).toHaveLength(2)
    })
  })

  it('显式传入的线路排在官方前面，官方仍然垫底', () => {
    const proxies = ['https://gh-proxy.com', 'https://ghfast.top', 'https://ghproxy.net']
    withRegistry(
      proxies.map((base) => ({ base, style: 'url' as const })),
      () => {
        const list = releaseCandidates(DEFAULT_MIRROR, 'o', 'r', 'v1', 'a.apk', proxies)
        expect(list).toContain('https://gh-proxy.com/https://github.com/o/r/releases/download/v1/a.apk')
        expect(list[list.length - 1]).toBe(OFFICIAL_URL)
        expect(list.indexOf(OFFICIAL_URL)).toBeGreaterThanOrEqual(3)
      },
    )
  })

  it('从旧版本继承来、风格未知的地址：两种拼法都给，让探活挑', () => {
    const list = releaseCandidates('https://legacy.example', 'o', 'r', 'v1', 'a.apk')
    expect(list[0]).toBe('https://legacy.example/o/r/releases/download/v1/a.apk')
    expect(list[1]).toBe('https://legacy.example/https://github.com/o/r/releases/download/v1/a.apk')
    expect(list[list.length - 1]).toBe(OFFICIAL_URL)
  })

  it('登记过的站不会多出一条 url 拼法', () => {
    const store = addCustomMirror(EMPTY_STORE, { base: 'https://gh.example.com', style: 'path' })
    setMirrorRegistry(effectiveMirrors(store))
    try {
      expect(mirrorKnown('https://gh.example.com')).toBe(true)
      const list = releaseCandidates('https://gh.example.com', 'o', 'r', 'v1', 'a.apk')
      expect(list).toHaveLength(2)
    } finally {
      resetMirrorRegistry()
    }
  })

  it('当前镜像就是官方时只出现一次，仍在末尾', () => {
    const list = releaseCandidates('https://github.com', 'o', 'r', 'v1', 'a.apk')
    expect(list.filter((u) => u === OFFICIAL_URL).length).toBe(1)
    expect(list[list.length - 1]).toBe(OFFICIAL_URL)
  })

  it('当前镜像本身就是代理时不重复出现', () => {
    withRegistry([{ base: 'https://gh-proxy.com', style: 'url' }], () => {
      const list = releaseCandidates('https://gh-proxy.com', 'o', 'r', 'v1', 'a.apk')
      expect(list.filter((u) => u.startsWith('https://gh-proxy.com/')).length).toBe(1)
    })
  })

  /*
   * 回归：开了「自动选最快」后，当前镜像会被换掉，用户自己的站就不再是
   * selected，于是从候选表里整个消失 —— 用户看到的就是「我的加速站不见了」。
   * 它必须固定占一位，位置紧跟在选中站之后。
   */
  it('自动切到别的线路后，用户自建站仍固定占第二位', () => {
    withRegistry(
      [
        { base: 'https://gh-proxy.com', style: 'url' },
        { base: 'https://self.example', style: 'path' },
      ],
      () => {
        const list = releaseCandidates('https://gh-proxy.com', 'o', 'r', 'v1', 'a.apk', [], 'https://self.example')
        expect(list[0]).toBe('https://gh-proxy.com/https://github.com/o/r/releases/download/v1/a.apk')
        expect(list[1]).toBe('https://self.example/o/r/releases/download/v1/a.apk')
        expect(list[list.length - 1]).toBe(OFFICIAL_URL)
      },
    )
  })

  it('当前镜像就是官方时，用户的自建站也照样在表里', () => {
    withRegistry([{ base: 'https://self.example' }], () => {
      const list = releaseCandidates('https://github.com', 'o', 'r', 'v1', 'a.apk', [], 'https://self.example')
      expect(list[0]).toBe('https://self.example/o/r/releases/download/v1/a.apk')
      expect(list[list.length - 1]).toBe(OFFICIAL_URL)
    })
  })

  it('设置页把自建站改成新地址后，下载候选跟着走', () => {
    withRegistry(
      [
        { base: 'https://gh-proxy.com', style: 'url' },
        { base: 'https://new.example.com', style: 'path' },
      ],
      () => {
        const list = releaseCandidates('https://gh-proxy.com', 'o', 'r', 'v1', 'a.apk', [], 'https://new.example.com')
        expect(list[1]).toBe('https://new.example.com/o/r/releases/download/v1/a.apk')
        // 旧地址不再出现，候选只剩「选中的站 + 改过地址的自建站 + 官方」
        expect(list).toHaveLength(3)
        expect(list.filter((u) => u.includes('old-self'))).toHaveLength(0)
      },
    )
  })

  it('同一个站在表里只出现一次，不会因为「选中 + 固定位」排两条', () => {
    withRegistry([{ base: 'https://self.example' }], () => {
      const list = releaseCandidates('https://self.example', 'o', 'r', 'v1', 'a.apk', [], 'https://self.example')
      expect(list.filter((u) => u.startsWith('https://self.example/')).length).toBe(1)
      expect(new Set(list.map((u) => u.toLowerCase())).size).toBe(list.length)
    })
  })

  it('资产名里的空格与 # 会被编码，不会把路径截断', () => {
    const list = releaseCandidates('https://gh.example.com', 'o', 'r', 'v1.0.0', 'gh x#1.apk')
    expect(list[0]).toContain('gh%20x%231.apk')
  })

  it('pickReachable 取第一条通的；全不通时退回第一条交给浏览器', async () => {
    const urls = ['a', 'b', 'c']
    expect(await pickReachable(urls, async (u) => u === 'b')).toBe('b')
    expect(await pickReachable(urls, async () => false)).toBe('a')
    expect(
      await pickReachable(urls, async () => {
        throw new Error('boom')
      }),
    ).toBe('a')
  })
})

/*
 * 升级兼容：包里不再带加速站，但老用户机器上存过的地址一条都不能丢。
 * 这段是「已经安装的不影响」的机器可验证版本。
 */
describe('v1.1.3 迁移：老配置一条不丢', () => {
  it('改过地址的旧内置站转成自定义站，风格沿用', () => {
    const old = { overrides: { zjkl: 'https://my-self.example' }, custom: [] }
    const mig = migrateLegacyMirrorStore(old, 'https://my-self.example')
    expect(mig.changed).toBe(true)
    expect(mig.store.overrides).toEqual({})
    expect(mig.store.custom).toHaveLength(1)
    expect(mig.store.custom[0]).toMatchObject({
      id: 'self',
      base: 'https://my-self.example',
      style: 'path',
      page: true,
    })
    expect(mig.selected).toBe('https://my-self.example')
  })

  it('url 型旧站的风格不会被改成 path', () => {
    const old = { overrides: { ghproxy: 'https://p.example' }, custom: [] }
    const mig = migrateLegacyMirrorStore(old, 'https://p.example')
    expect(mig.store.custom[0]).toMatchObject({ base: 'https://p.example', style: 'url' })
  })

  it('迁移后自建站还能被 selfMirrorBase 认出来（候选固定位不丢）', () => {
    const mig = migrateLegacyMirrorStore(
      { overrides: { zjkl: 'https://my-self.example' }, custom: [] },
      'https://my-self.example',
    )
    setMirrorRegistry(effectiveMirrors(mig.store))
    try {
      expect(selfMirrorBase()).toBe('https://my-self.example')
    } finally {
      resetMirrorRegistry()
    }
  })

  it('用户自己加的站原样保留', () => {
    const old = { overrides: {}, custom: [{ id: 'u1', label: '我的', base: 'https://keep.example', style: 'url' as const }] }
    const mig = migrateLegacyMirrorStore(old, 'https://keep.example')
    expect(mig.store.custom).toEqual(old.custom)
    expect(mig.changed).toBe(false)
    expect(mig.selected).toBe('https://keep.example')
  })

  it('新装（什么都没有）落到官方直连，不算改动', () => {
    const mig = migrateLegacyMirrorStore(EMPTY_STORE, null)
    expect(mig.changed).toBe(false)
    expect(mig.selected).toBe('https://github.com')
    expect(mig.store.custom).toEqual([])
  })

  it('迁移是幂等的：跑第二遍不再改动', () => {
    const once = migrateLegacyMirrorStore({ overrides: { zjkl: 'https://my-self.example' }, custom: [] }, 'https://my-self.example')
    const twice = migrateLegacyMirrorStore(once.store, once.selected)
    expect(twice.changed).toBe(false)
    expect(twice.store.custom).toHaveLength(1)
  })
})
