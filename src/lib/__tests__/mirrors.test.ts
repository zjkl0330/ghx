import { describe, expect, it, vi } from 'vitest'
import {
  BUILTIN_MIRRORS,
  DEFAULT_MIRROR,
  EMPTY_STORE,
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
  normalizeBase,
  parseMirrorStore,
  removeCustomMirror,
  resetMirrorBase,
  resetMirrorRegistry,
  serializeMirrorStore,
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
  it('已知站点查表命中', () => {
    expect(mirrorDefFor('https://gh-proxy.com/').style).toBe('url')
    expect(mirrorDefFor('https://gh.zjkl0330.dpdns.org').id).toBe('zjkl')
    expect(mirrorDefFor('https://github.com').id).toBe('official')
  })

  it('大小写不敏感', () => {
    expect(mirrorDefFor('HTTPS://GH-PROXY.COM').id).toBe('ghproxy')
  })

  it('自定义地址按 path 风格处理', () => {
    const def = mirrorDefFor('https://my.proxy.example/')
    expect(def.id).toBe('custom')
    expect(def.style).toBe('path')
    expect(def.base).toBe('https://my.proxy.example')
  })

  it('内置站点表包含自建、公开代理与官方直连，且不重复', () => {
    const ids = BUILTIN_MIRRORS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(BUILTIN_MIRRORS.some((m) => m.base === DEFAULT_MIRROR)).toBe(true)
    expect(BUILTIN_MIRRORS).toContainEqual(OFFICIAL_MIRROR)
  })

  it('候选列表含内置站与官方直连', () => {
    const rows = mirrorCandidates('https://gh.zjkl0330.dpdns.org')
    expect(rows.length).toBe(BUILTIN_MIRRORS.length)
    expect(rows.at(-1)?.base).toBe('https://github.com')
  })

  it('当前站是自定义时补在最前面，避免选中了却看不见', () => {
    const rows = mirrorCandidates('https://my.example/')
    expect(rows[0]).toMatchObject({ base: 'https://my.example', note: '自定义' })
    expect(rows.length).toBe(BUILTIN_MIRRORS.length + 1)
  })

  it('自定义站与内置站重复时不重复插入', () => {
    const rows = mirrorCandidates('https://ghfast.top/')
    expect(rows.filter((r) => r.base === 'https://ghfast.top')).toHaveLength(1)
  })

  it('镜像名优先用可读标签', () => {
    expect(mirrorLabel('https://ghfast.top')).toBe('ghfast.top')
    expect(mirrorLabel('https://x.example')).toBe('x.example')
  })
})

describe('地址拼接', () => {
  it('path 风格直接把路径接在前缀后', () => {
    expect(githubUrlAt('https://gh.zjkl0330.dpdns.org/', '/827802685/ghx')).toBe(
      'https://gh.zjkl0330.dpdns.org/827802685/ghx',
    )
  })

  it('url 风格需要拼完整的 github.com 地址', () => {
    expect(githubUrlAt('https://gh-proxy.com', 'https://github.com/827802685/ghx')).toBe(
      'https://gh-proxy.com/https://github.com/827802685/ghx',
    )
  })

  it('前缀为空时退回官方地址，不生成坏链接', () => {
    expect(githubUrlAt('', '827802685/ghx')).toBe('https://github.com/827802685/ghx')
  })

  it('raw 地址按风格换域', () => {
    expect(rawUrlAt('https://gh.zjkl0330.dpdns.org', 'o', 'r', 'main', 'docs/a.png')).toBe(
      'https://gh.zjkl0330.dpdns.org/o/r/raw/main/docs/a.png',
    )
    expect(rawUrlAt('https://gh-proxy.com', 'o', 'r', 'dev', 'a.png')).toBe(
      'https://gh-proxy.com/https://raw.githubusercontent.com/o/r/dev/a.png',
    )
  })

  it('raw 缺分支时用 main 兜底', () => {
    expect(rawUrlAt('https://gh.zjkl0330.dpdns.org', 'o', 'r', '', 'a.png')).toBe(
      'https://gh.zjkl0330.dpdns.org/o/r/raw/main/a.png',
    )
  })

  it('Release 下载地址按风格区分', () => {
    expect(releaseDownloadUrl('https://gh.zjkl0330.dpdns.org', '827802685', 'ghx', 'v0.5.0', 'a.apk')).toBe(
      'https://gh.zjkl0330.dpdns.org/827802685/ghx/releases/download/v0.5.0/a.apk',
    )
    expect(releaseDownloadUrl('https://gh-proxy.com', '827802685', 'ghx', 'v0.5.0', 'a.apk')).toBe(
      'https://gh-proxy.com/https://github.com/827802685/ghx/releases/download/v0.5.0/a.apk',
    )
  })

  it('文件名里的空格与 # 会被编码，不会被代理截断', () => {
    expect(releaseDownloadUrl('https://gh.zjkl0330.dpdns.org', 'o', 'r', 'v1.0.0', 'gh x#1.apk')).toBe(
      'https://gh.zjkl0330.dpdns.org/o/r/releases/download/v1.0.0/gh%20x%231.apk',
    )
  })

  it('Release 页面：能翻页的镜像用自己的站', () => {
    expect(releasePageUrl('https://gh.zjkl0330.dpdns.org', 'o', 'r', 'v1.0.0')).toBe(
      'https://gh.zjkl0330.dpdns.org/o/r/releases/tag/v1.0.0',
    )
  })

  it('Release 页面：纯下载型镜像退回自建站点，保证按钮点得开', () => {
    expect(releasePageUrl('https://gh-proxy.com', 'o', 'r', 'v1.0.0')).toBe(
      `${DEFAULT_MIRROR}/o/r/releases/tag/v1.0.0`,
    )
  })

  it('Release 页面：不给 tag 时指向发行版列表', () => {
    expect(releasePageUrl('https://gh.zjkl0330.dpdns.org', 'o', 'r')).toBe(
      'https://gh.zjkl0330.dpdns.org/o/r/releases',
    )
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
  const url = 'https://gh.zjkl0330.dpdns.org/o/r/releases/download/v1/a.apk'

  it('200 且拿到足够字节算成功', async () => {
    const r = await probeMirror('https://gh.zjkl0330.dpdns.org', url, {
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

  it('改地址只换 base，id 与风格保持不变', () => {
    const store = setMirrorBase(EMPTY_STORE, 'zjkl', 'gh2.example.com')
    const list = effectiveMirrors(store)
    const hit = list.find((m) => m.id === 'zjkl')
    expect(hit?.base).toBe('https://gh2.example.com')
    expect(hit?.style).toBe('path')
    expect(hit?.page).toBe(true)
    expect(isOverridden(store, 'zjkl')).toBe(true)
  })

  it('改地址后 githubUrlAt 立刻走新域名', () => {
    const store = setMirrorBase(EMPTY_STORE, 'zjkl', 'https://gh2.example.com')
    setMirrorRegistry(effectiveMirrors(store))
    try {
      expect(githubUrlAt('https://gh2.example.com', 'o/r')).toBe('https://gh2.example.com/o/r')
    } finally {
      resetMirrorRegistry()
    }
  })

  it('改回原地址等价于恢复默认', () => {
    const store = setMirrorBase(EMPTY_STORE, 'zjkl', DEFAULT_MIRROR)
    expect(store.overrides.zjkl).toBeUndefined()
  })

  it('恢复默认会删掉 override', () => {
    const store = setMirrorBase(EMPTY_STORE, 'zjkl', 'gh2.example.com')
    expect(resetMirrorBase(store, 'zjkl').overrides.zjkl).toBeUndefined()
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

  it('能翻网页的兜底站点跟着 override 走', () => {
    const store = setMirrorBase(EMPTY_STORE, 'zjkl', 'https://gh9.example')
    setMirrorRegistry(effectiveMirrors(store))
    try {
      expect(fallbackPageBase()).toBe('https://gh9.example')
    } finally {
      resetMirrorRegistry()
    }
  })
})

describe('改地址后全局生效', () => {
  it('安装包下载与自述图片都改用新域名', () => {
    const store = setMirrorBase(EMPTY_STORE, 'zjkl', 'https://gh-new.example.com')
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
      const store2 = setMirrorBase(EMPTY_STORE, 'ghproxy', 'https://p2.example.com')
      setMirrorRegistry(effectiveMirrors(store2))
      expect(releaseDownloadUrl('https://p2.example.com', 'o', 'r', 'v1', 'a.apk')).toBe(
        'https://p2.example.com/https://github.com/o/r/releases/download/v1/a.apk',
      )
    } finally {
      resetMirrorRegistry()
    }
  })

  it('只改一台不影响其它站点', () => {
    const store = setMirrorBase(EMPTY_STORE, 'zjkl', 'https://gh-new.example.com')
    const list = effectiveMirrors(store)
    expect(list.find((m) => m.id === 'ghproxy')?.base).toBe('https://gh-proxy.com')
    expect(list.find((m) => m.id === 'ghfast')?.base).toBe('https://ghfast.top')
  })
})

describe('安装包下载线路', () => {
  it('当前镜像排第一，公共反代与官方直连依次兜底', () => {
    const list = releaseCandidates(DEFAULT_MIRROR, 'o', 'r', 'v1', 'a.apk')
    expect(list[0]).toBe('https://gh.zjkl0330.dpdns.org/o/r/releases/download/v1/a.apk')
    expect(list).toContain('https://gh-proxy.com/https://github.com/o/r/releases/download/v1/a.apk')
    expect(list[list.length - 1]).toBe('https://github.com/o/r/releases/download/v1/a.apk')
    expect(list.length).toBeLessThanOrEqual(4)
  })

  it('当前镜像本身就是公共反代时不重复出现', () => {
    const list = releaseCandidates('https://gh-proxy.com', 'o', 'r', 'v1', 'a.apk')
    expect(list.filter((u) => u.startsWith('https://gh-proxy.com/')).length).toBe(1)
  })

  it('资产名里的空格与 # 会被编码，不会把路径截断', () => {
    const list = releaseCandidates(DEFAULT_MIRROR, 'o', 'r', 'v1.0.0', 'gh x#1.apk')
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
