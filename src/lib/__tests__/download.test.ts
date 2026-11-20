import { describe, expect, it } from 'vitest'
import {
  apkTarget,
  archiveTarget,
  artifactTarget,
  assetTarget,
  boardOf,
  boardFresh,
  dayKeyOf,
  entriesFromBoard,
  etaSeconds,
  fastestRoute,
  formatEta,
  isApkName,
  measureRoutes,
  mirrorOfUrl,
  modeHint,
  parseDownloadMode,
  parseSpeedBoard,
  progressOf,
  rankRoutes,
  routeDetail,
  routeLabelOf,
  routesWithoutSample,
  safeFileName,
  serializeDownloadMode,
  toRoutes,
  type SpeedEntry,
} from '../download'
import {
  DEFAULT_MIRROR,
  effectiveMirrors,
  resetMirrorRegistry,
  setMirrorRegistry,
  type ProbeResponse,
} from '../mirrors'

describe('下载方式设置', () => {
  it('只认 inner，其余一律当 outer', () => {
    expect(parseDownloadMode('inner')).toBe('inner')
    expect(parseDownloadMode('outer')).toBe('outer')
    expect(parseDownloadMode(null)).toBe('outer')
    expect(parseDownloadMode('')).toBe('outer')
    // 大小写与脏值不认，避免旧配置把界面带到「应用内」却没有原生能力
    expect(parseDownloadMode('INNER')).toBe('outer')
    expect(parseDownloadMode('true')).toBe('outer')
  })

  it('序列化只写两个值', () => {
    expect(serializeDownloadMode('inner')).toBe('inner')
    expect(serializeDownloadMode('outer')).toBe('outer')
  })
})

describe('地址反查站点', () => {
  it('自建站的 path 型地址认回自建站，不会被 github.com 抢走', () => {
    const m = mirrorOfUrl(`${DEFAULT_MIRROR}/o/r/releases/download/v1/a.apk`)
    expect(m.base).toBe(DEFAULT_MIRROR)
    expect(m.style).toBe('path')
  })

  it('gh-proxy 的 url 型地址认回 gh-proxy，而不是 GitHub 官方', () => {
    const m = mirrorOfUrl('https://gh-proxy.com/https://github.com/o/r/releases/download/v1/a.apk')
    expect(m.base).toBe('https://gh-proxy.com')
    expect(m.style).toBe('url')
  })

  it('官方地址回落到官方直连（站点表里已有该条目，用它的名字）', () => {
    expect(mirrorOfUrl('https://github.com/o/r/archive/refs/heads/main.zip').label).toBe('官方直连')
  })

  it('codeload 官方单独认出来', () => {
    expect(mirrorOfUrl('https://codeload.github.com/o/r/zip/refs/heads/main').label).toBe('codeload 官方')
  })

  it('不认识的域名至少把主机名显示出来', () => {
    const m = mirrorOfUrl('https://dl.example.net/o/r/x.apk')
    expect(m.base).toBe('https://dl.example.net')
    expect(m.label).toBe('dl.example.net')
  })

  it('空串不抛异常', () => {
    expect(mirrorOfUrl('').label).toBe('未知线路')
  })
})

describe('候选去重', () => {
  it('保持顺序并按 URL 去重', () => {
    const routes = toRoutes([
      'https://a.example/x.apk',
      'https://A.example/x.apk',
      'https://b.example/x.apk',
      '',
    ])
    expect(routes.map((r) => r.url)).toEqual(['https://a.example/x.apk', 'https://b.example/x.apk'])
  })
})

describe('三类目标', () => {
  it('安装包：标题带版本，可安装，当前站点排第一', () => {
    const t = apkTarget({
      mirror: DEFAULT_MIRROR,
      owner: 'zjkl0330',
      repo: 'ghx',
      tag: 'v0.7.8',
      asset: 'ghx-0.7.8-debug.apk',
      size: 4_500_000,
      version: '0.7.8',
    })
    expect(t.kind).toBe('apk')
    expect(t.title).toBe('ghx v0.7.8 安装包')
    expect(t.installable).toBe(true)
    expect(t.subtitle).toBe('zjkl0330/ghx · v0.7.8')
    expect(t.routes[0].base).toBe(DEFAULT_MIRROR)
    // 自建站 + 四个能吃 release 的反代 + 官方兜底，最多六条
    expect(t.routes.length).toBeGreaterThanOrEqual(5)
    expect(t.routes.length).toBeLessThanOrEqual(6)
    // 官方直连永远垫底：它首包快、后段慢，不能进候选前排
    expect(t.routes[t.routes.length - 1].official).toBe(true)
    expect(t.routes.filter((r) => r.official)).toHaveLength(1)
  })

  it('发行版附件：zip 不可安装，但候选与安装包同一套', () => {
    const a = assetTarget({
      mirror: DEFAULT_MIRROR,
      owner: 'o',
      repo: 'r',
      tag: 'v1.0.0',
      asset: 'src.zip',
      size: 1024,
    })
    expect(a.kind).toBe('asset')
    expect(a.installable).toBe(false)
    expect(a.title).toBe('src.zip')
    expect(a.routes[0].base).toBe(DEFAULT_MIRROR)
  })

  it('发行版附件里的 apk 也能应用内安装', () => {
    const a = assetTarget({
      mirror: DEFAULT_MIRROR,
      owner: 'o',
      repo: 'r',
      tag: 'v1.0.0',
      asset: 'app-release.apk',
      size: 1024,
    })
    expect(a.installable).toBe(true)
  })

  it('源码 ZIP：文件名按分支拼，含 gh-proxy 的 codeload 候选', () => {
    const t = archiveTarget({ mirror: DEFAULT_MIRROR, owner: 'o', repo: 'my-repo', ref: 'feat/x' })
    expect(t.kind).toBe('archive')
    expect(t.fileName).toBe('my-repo-feat-x.zip')
    expect(t.installable).toBe(false)
    expect(t.size).toBe(0)
    expect(t.routes.some((r) => r.url.includes('gh-proxy.com/https://codeload.github.com'))).toBe(true)
  })

  it('空分支名退回 main', () => {
    const t = archiveTarget({ mirror: DEFAULT_MIRROR, owner: 'o', repo: 'r', ref: '   ' })
    expect(t.fileName).toBe('r-main.zip')
    expect(t.subtitle).toBe('o/r · main')
  })

  it('apk 后缀大小写都认', () => {
    expect(isApkName('a.APK')).toBe(true)
    expect(isApkName('a.apk')).toBe(true)
    expect(isApkName('a.apk.sha256')).toBe(false)
  })
})

/* ---------------- 测速 ---------------- */

function fakeHttp(map: Record<string, { status: number; bytes: number }>) {
  return async (url: string): Promise<ProbeResponse> => {
    const hit = map[url]
    if (!hit) return { status: 404, headers: {}, bytes: 0 }
    return { status: hit.status, headers: { 'content-length': String(hit.bytes) }, bytes: hit.bytes }
  }
}

describe('测速与选线', () => {
  const t = apkTarget({
    mirror: DEFAULT_MIRROR,
    owner: 'o',
    repo: 'r',
    tag: 'v1',
    asset: 'a.apk',
    size: 1000,
  })

  it('concurrency 为 1 时退回串行，回调按顺序给结果', async () => {
    const slow = t.routes[0].url
    const fast = t.routes[1].url
    const seen: number[] = []
    const http = fakeHttp({
      [slow]: { status: 200, bytes: 64 * 1024 },
      [fast]: { status: 206, bytes: 256 * 1024 },
    })
    let clock = 0
    const entries = await measureRoutes(t.routes.slice(0, 2), {
      http,
      concurrency: 1,
      now: () => {
        clock += 100
        return clock
      },
      onResult: (_e, i) => seen.push(i),
    })
    expect(entries).toHaveLength(2)
    expect(seen).toEqual([0, 1])
    expect(entries[0].result.status).toBe('ok')
    expect(entries[1].result.status).toBe('ok')
  })

  it('按速度排序，最快的排第一', async () => {
    const slow = t.routes[0].url
    const fast = t.routes[1].url
    const http = fakeHttp({
      [slow]: { status: 200, bytes: 20 * 1024 },
      [fast]: { status: 200, bytes: 256 * 1024 },
    })
    let clock = 0
    const entries = await measureRoutes(t.routes.slice(0, 2), {
      http,
      concurrency: 1,
      now: () => {
        clock += 200
        return clock
      },
    })
    const ranked = rankRoutes(entries)
    expect(ranked[0].route.url).toBe(fast)
    expect(fastestRoute(entries)?.url).toBe(fast)
  })

  /*
   * 官方直连的档位压制。
   *
   * 只按 kbps 排是不够的：探针只拉 256 KB，测的是建连与首包。官方直连这一段
   * 常年第一，但拉长之后吞吐会掉 —— 用户看到「官方最快」选了它，几 MB 的包
   * 下到一半变成几 KB/s。所以排序先分档（代理 0 / 官方 1），档内才比速度。
   */
  function mkEntry(url: string, kbps: number, official = false, status: 'ok' | 'fail' = 'ok'): SpeedEntry {
    return {
      route: {
        url,
        base: new URL(url).origin,
        label: official ? 'GitHub 官方' : '代理',
        style: 'url',
        official,
      },
      result: { base: '', label: '', style: 'url', status, ms: 100, bytes: 1024, kbps },
    }
  }

  it('官方测速最快也排在可用代理之后', () => {
    const entries = [
      mkEntry('https://github.com/o/r/a.apk', 900, true),
      mkEntry('https://gh-proxy.com/https://github.com/o/r/a.apk', 120),
    ]
    const ranked = rankRoutes(entries)
    expect(ranked[0].route.official).toBeFalsy()
    expect(fastestRoute(entries)?.official).toBeFalsy()
  })

  it('代理全挂时官方才轮到', () => {
    const entries = [
      mkEntry('https://gh-proxy.com/https://github.com/o/r/a.apk', 0, false, 'fail'),
      mkEntry('https://github.com/o/r/a.apk', 80, true),
    ]
    expect(fastestRoute(entries)?.official).toBe(true)
  })

  it('官方自己挂掉时不会被选中', () => {
    const entries = [
      mkEntry('https://gh-proxy.com/https://github.com/o/r/a.apk', 0, false, 'fail'),
      mkEntry('https://github.com/o/r/a.apk', 0, true, 'fail'),
    ]
    expect(fastestRoute(entries)).toBeNull()
  })

  it('失败的沉底，全失败时没有最快线路', async () => {
    const http = fakeHttp({ [t.routes[0].url]: { status: 500, bytes: 0 } })
    let clock = 0
    const entries = await measureRoutes(t.routes.slice(0, 2), {
      http,
      concurrency: 1,
      now: () => {
        clock += 100
        return clock
      },
    })
    expect(entries.every((e) => e.result.status === 'fail')).toBe(true)
    expect(fastestRoute(entries)).toBeNull()
    // 失败项保留原顺序，界面不会跳来跳去
    expect(rankRoutes(entries).map((e) => e.route.url)).toEqual(
      t.routes.slice(0, 2).map((r) => r.url),
    )
  })

  it('空线路不报错', async () => {
    expect(await measureRoutes([], { http: fakeHttp({}) })).toEqual([])
    expect(fastestRoute([])).toBeNull()
  })

  /*
   * 并发。串行时代的痛点是：一条挂了要等满超时，六条线路最坏四十多秒都在转圈。
   * 这里不测「快了多少」（那依赖真实网络），只测「确实同时在跑」且结果位置不变。
   */
  it('默认 3 条并发，结果仍按传入顺序摆放', async () => {
    const routes = t.routes.slice(0, 4)
    let running = 0
    let peak = 0
    const http = async (): Promise<ProbeResponse> => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 8))
      running -= 1
      return { status: 200, headers: { 'content-length': '1024' }, bytes: 1024 }
    }
    const entries = await measureRoutes(routes, { http })
    expect(peak).toBe(3)
    expect(entries.map((e) => e.route.url)).toEqual(routes.map((r) => r.url))
    expect(entries.every((e) => e.result.status === 'ok')).toBe(true)
  })

  it('并发度可以调到 1，退回串行', async () => {
    let running = 0
    let peak = 0
    const http = async (): Promise<ProbeResponse> => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 4))
      running -= 1
      return { status: 200, headers: {}, bytes: 1024 }
    }
    await measureRoutes(t.routes.slice(0, 3), { http, concurrency: 1 })
    expect(peak).toBe(1)
  })
})

/* ---------------- 测速看板 ---------------- */

describe('测速看板：一天只测一次', () => {
  const t = apkTarget({
    mirror: DEFAULT_MIRROR,
    owner: 'o',
    repo: 'r',
    tag: 'v1',
    asset: 'a.apk',
    size: 1000,
  })
  const baseOf = (i: number) => t.routes[i].base.toLowerCase()

  function entry(i: number, kbps: number, status: 'ok' | 'fail' = 'ok'): SpeedEntry {
    const route = t.routes[i]
    return {
      route,
      result: { base: route.base, label: route.label, style: route.style, status, ms: 120, bytes: 2048, kbps },
    }
  }

  const day = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m, 0, 0).getTime()

  it('同一天内有效，跨过零点就重测', () => {
    const b = { at: day(20, 8, 31), samples: {} }
    expect(boardFresh(b, day(20, 8, 32))).toBe(true)
    expect(boardFresh(b, day(20, 23, 59))).toBe(true)
    // 「每天一次」是自然日，不是滚动 24 小时：早上八点不该因为才过 20 小时又测一轮
    expect(boardFresh(b, day(21, 0, 1))).toBe(false)
    expect(boardFresh(null, day(20, 9))).toBe(false)
  })

  it('日期键按本地时区切', () => {
    expect(dayKeyOf(day(20, 0, 0))).toBe('2026-11-20')
    expect(dayKeyOf(day(20, 23, 59))).toBe('2026-11-20')
    expect(dayKeyOf(day(21, 0, 0))).toBe('2026-11-21')
  })

  it('时间指向未来（被改过系统时间）一律重测', () => {
    expect(boardFresh({ at: day(21, 9), samples: {} }, day(20, 9))).toBe(false)
  })

  it('坏数据当没有看板，不会让界面启动就崩', () => {
    expect(parseSpeedBoard(null)).toBeNull()
    expect(parseSpeedBoard('{')).toBeNull()
    expect(parseSpeedBoard('{"at":1}')).toBeNull()
    expect(parseSpeedBoard('{"at":1,"samples":{}}')).toEqual({ at: 1, samples: {} })
  })

  it('字段不全的样本被丢掉，其余保留且键归一成小写', () => {
    const b = parseSpeedBoard(
      JSON.stringify({
        at: 100,
        samples: {
          'https://A.com': { kbps: 12, ms: 30, status: 'ok' },
          'https://bad.com': { ms: 30 },
          'https://Fail.com': { kbps: 0, ms: 8000, status: 'fail', error: '超时' },
        },
      }),
    )
    expect(b?.samples['https://a.com']).toMatchObject({ kbps: 12, status: 'ok' })
    expect(b?.samples['https://bad.com']).toBeUndefined()
    expect(b?.samples['https://fail.com']).toMatchObject({ status: 'fail', error: '超时' })
  })

  it('按站点存：换一个包、换一个版本，测过的结果照样能用', () => {
    const b = boardOf([entry(0, 900), entry(1, 300)], day(20, 9))
    const other = assetTarget({
      mirror: DEFAULT_MIRROR,
      owner: 'x',
      repo: 'y',
      tag: 'v9',
      asset: 'b.zip',
      size: 1,
    })
    const sameBase = other.routes.find((r) => r.base.toLowerCase() === baseOf(0))!
    const got = entriesFromBoard([sameBase], b)
    expect(got).toHaveLength(1)
    expect(got[0].result.kbps).toBe(900)
    // 还原出来的是「当前这个包的地址」，不是上次测的那个
    expect(got[0].route.url).toBe(sameBase.url)
  })

  it('并进看板时保留别的站点，重测一条不会抹掉其余', () => {
    const first = boardOf([entry(0, 900), entry(1, 300)], day(20, 9))
    const second = boardOf([entry(1, 640)], day(20, 10), first)
    expect(second.at).toBe(day(20, 10))
    expect(second.samples[baseOf(0)].kbps).toBe(900)
    expect(second.samples[baseOf(1)].kbps).toBe(640)
  })

  it('只补没有样本的线路，测过的不再拉一遍', () => {
    const b = boardOf([entry(0, 900)], day(20, 9))
    const missing = routesWithoutSample(t.routes, b)
    expect(missing.map((r) => r.base.toLowerCase())).not.toContain(baseOf(0))
    expect(missing).toHaveLength(t.routes.length - 1)
    expect(routesWithoutSample(t.routes, null)).toHaveLength(t.routes.length)
  })

  it('没有样本的线路不出现在还原结果里', () => {
    const b = boardOf([entry(0, 900)], day(20, 9))
    expect(entriesFromBoard(t.routes, b)).toHaveLength(1)
    expect(entriesFromBoard(t.routes, null)).toEqual([])
  })
})

/* ---------------- 进度与文案 ---------------- */

describe('进度', () => {
  it('百分比收敛在 0–100', () => {
    expect(progressOf(0, 100)).toBe(0)
    expect(progressOf(50, 100)).toBe(50)
    expect(progressOf(200, 100)).toBe(100)
    expect(progressOf(10, 0)).toBe(0)
    expect(progressOf(Number.NaN, 100)).toBe(0)
  })

  it('剩余时间按已下载速度推算', () => {
    // 1 秒下了 1MB，总量 4MB → 还需 3 秒
    expect(etaSeconds(1024 * 1024, 4 * 1024 * 1024, 1000)).toBe(3)
    expect(etaSeconds(0, 100, 1000)).toBeNull()
    expect(etaSeconds(100, 100, 1000)).toBe(0)
    expect(etaSeconds(100, 0, 1000)).toBeNull()
  })

  it('剩余时间文案', () => {
    expect(formatEta(0)).toBe('即将完成')
    expect(formatEta(8)).toBe('约 8 秒')
    expect(formatEta(60)).toBe('约 1 分钟')
    expect(formatEta(95)).toBe('约 1 分 35 秒')
    expect(formatEta(null)).toBe('')
  })
})

describe('文件名安全化', () => {
  it('去掉路径分隔符与控制字符', () => {
    expect(safeFileName('../../etc/passwd')).toBe('etc_passwd')
    expect(safeFileName('a|b*c?.apk')).toBe('a_b_c_.apk')
    expect(safeFileName('  ghx-0.7.8.apk  ')).toBe('ghx-0.7.8.apk')
  })

  it('空名退回默认值', () => {
    expect(safeFileName('')).toBe('download.bin')
    expect(safeFileName('...')).toBe('download.bin')
  })
})

describe('设置项说明', () => {
  it('网页版不看设置，直接说要交给浏览器', () => {
    expect(modeHint('inner', false)).toContain('交给浏览器')
  })

  it('原生 + 应用内：说清会调安装器', () => {
    expect(modeHint('inner', true)).toContain('安装器')
  })

  it('原生 + 应用外：说清进度在通知栏', () => {
    expect(modeHint('outer', true)).toContain('通知栏')
  })

  it('不能装的文件即使选了应用内也走浏览器', () => {
    expect(modeHint('inner', true, false)).toContain('仍交给浏览器')
  })

  it('线路名优先用站点标签', () => {
    const routes = toRoutes([`${DEFAULT_MIRROR}/o/r/x.apk`])
    expect(routeLabelOf(routes[0])).not.toBe('')
    expect(routeLabelOf(null)).toBe('未选择线路')
  })

  it('两条同名线路要能分清：codeload 直取 vs github 302', () => {
    const direct = toRoutes(['https://gh-proxy.com/https://codeload.github.com/o/r/zip/refs/heads/main'])[0]
    const viaGithub = toRoutes(['https://gh-proxy.com/https://github.com/o/r/archive/refs/heads/main.zip'])[0]
    expect(routeDetail(direct)).toBe('codeload 直取')
    expect(routeDetail(viaGithub)).toBe('经 github 302')
    // 站点名与域名不同时直接给域名，不用补说明
    expect(routeDetail(toRoutes([`${DEFAULT_MIRROR}/o/r/x.zip`])[0])).toBe('gh.zjkl0330.dpdns.org')
  })

  it('发行版附件的 url 型站点标「整段 URL 代理」', () => {
    const r = toRoutes(['https://gh-proxy.com/https://github.com/o/r/releases/download/v1/a.apk'])[0]
    expect(routeDetail(r)).toBe('整段 URL 代理')
  })

  it('自定义站点进注册表后能按名字显示', () => {
    setMirrorRegistry(effectiveMirrors({ overrides: {}, custom: [] }))
    try {
      const m = mirrorOfUrl(`${DEFAULT_MIRROR}/o/r/x.apk`)
      expect(m.label).toBe('自建加速')
    } finally {
      resetMirrorRegistry()
    }
  })
})

describe('CI 产物', () => {
  const base = {
    owner: 'zjkl0330',
    repo: 'ghx',
    runId: 12,
    artifactId: 456,
    name: 'app-debug',
    size: 4_000_000,
  }

  it('走 API 端点，只给一条线路', () => {
    const t = artifactTarget(base)
    expect(t.kind).toBe('artifact')
    expect(t.routes).toHaveLength(1)
    expect(t.routes[0].url).toBe(
      'https://api.github.com/repos/zjkl0330/ghx/actions/artifacts/456/zip',
    )
  })

  it('标记为需要令牌，界面据此禁用测速与浏览器下载', () => {
    expect(artifactTarget(base).routes[0].auth).toBe(true)
  })

  it('文件名补 .zip，路径分隔符被清掉', () => {
    expect(artifactTarget(base).fileName).toBe('app-debug.zip')
    expect(artifactTarget({ ...base, name: '../../etc/passwd' }).fileName).not.toContain('/')
  })

  it('不能被当成可安装包', () => {
    expect(artifactTarget(base).installable).toBe(false)
  })

  it('副标题带运行号', () => {
    expect(artifactTarget(base).subtitle).toContain('#12')
  })

  it('自定义 API 基地址会去掉尾部斜杠', () => {
    const t = artifactTarget({ ...base, baseUrl: 'https://api.example.com/' })
    expect(t.routes[0].url).toBe(
      'https://api.example.com/repos/zjkl0330/ghx/actions/artifacts/456/zip',
    )
  })

  it('名字为空时给个兜底标题', () => {
    const t = artifactTarget({ ...base, name: '' })
    expect(t.title).toBe('CI 产物')
    expect(t.fileName).toBe('artifact.zip')
  })
})
