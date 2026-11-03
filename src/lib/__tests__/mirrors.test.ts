import { describe, expect, it, vi } from 'vitest'
import {
  BUILTIN_MIRRORS,
  DEFAULT_MIRROR,
  OFFICIAL_MIRROR,
  PROBE_BYTES,
  SPEED_TTL,
  formatSpeed,
  githubUrlAt,
  kbpsOf,
  mirrorDefFor,
  mirrorLabel,
  normalizeBase,
  parseSnapshot,
  pickFastest,
  probeAll,
  probeMirror,
  rankProbes,
  rawUrlAt,
  releaseDownloadUrl,
  releasePageUrl,
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
