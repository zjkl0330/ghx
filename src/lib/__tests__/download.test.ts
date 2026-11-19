import { describe, expect, it } from 'vitest'
import {
  apkTarget,
  archiveTarget,
  artifactTarget,
  assetTarget,
  cacheFresh,
  etaSeconds,
  fastestRoute,
  formatEta,
  isApkName,
  measureRoutes,
  mirrorOfUrl,
  modeHint,
  parseDownloadMode,
  progressOf,
  rankRoutes,
  routeDetail,
  routeLabelOf,
  safeFileName,
  serializeDownloadMode,
  speedKey,
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
    // 自建站 + gh-proxy + ghfast + 官方，最多四条
    expect(t.routes.length).toBeGreaterThanOrEqual(3)
    expect(t.routes.length).toBeLessThanOrEqual(4)
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

  it('逐条测速，回调按顺序给结果', async () => {
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
      now: () => {
        clock += 200
        return clock
      },
    })
    const ranked = rankRoutes(entries)
    expect(ranked[0].route.url).toBe(fast)
    expect(fastestRoute(entries)?.url).toBe(fast)
  })

  it('失败的沉底，全失败时没有最快线路', async () => {
    const http = fakeHttp({ [t.routes[0].url]: { status: 500, bytes: 0 } })
    let clock = 0
    const entries = await measureRoutes(t.routes.slice(0, 2), {
      http,
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

  it('测速缓存 6 小时内有效', () => {
    const entries: SpeedEntry[] = []
    expect(cacheFresh(null)).toBe(false)
    expect(cacheFresh({ at: 1000, entries }, 1000 + 60_000)).toBe(true)
    expect(cacheFresh({ at: 1000, entries }, 1000 + 7 * 60 * 60 * 1000)).toBe(false)
    // 未来时间（改过系统时间）不算新鲜
    expect(cacheFresh({ at: 5000, entries }, 1000)).toBe(false)
  })

  it('缓存键跟着附件走：换文件就重测', () => {
    const other = assetTarget({
      mirror: DEFAULT_MIRROR,
      owner: 'o',
      repo: 'r',
      tag: 'v2',
      asset: 'b.apk',
      size: 1,
    })
    expect(speedKey(t)).not.toBe(speedKey(other))
    expect(speedKey(t)).toBe(speedKey(t))
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
