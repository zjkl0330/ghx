import { describe, expect, it, vi } from 'vitest'
import {
  buildMirrorUrl,
  checkForUpdate,
  compareVersions,
  formatBytes,
  formatDate,
  isNewer,
  isPrerelease,
  parseRelease,
  parseVersion,
  pickApk,
  pickBestRelease,
} from '../update'

describe('parseVersion', () => {
  it('解析带 v 前缀与两段版本', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('1.2')).toEqual([1, 2, 0])
    expect(parseVersion('0.10.7')).toEqual([0, 10, 7])
  })

  it('忽略预发布后缀，只比主线', () => {
    expect(parseVersion('v1.2.3-beta.1')).toEqual([1, 2, 3])
  })

  it('非法输入返回 null 而不是抛错', () => {
    expect(parseVersion('latest')).toBeNull()
    expect(parseVersion('')).toBeNull()
  })
})

describe('compareVersions / isNewer', () => {
  it('按数值而非字典序比较', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0)
  })

  it('忽略 v 前缀', () => {
    expect(compareVersions('v0.2.0', '0.2.0')).toBe(0)
  })

  it('无法解析时抛错，不静默判为无更新', () => {
    expect(() => compareVersions('abc', '1.0.0')).toThrow()
  })

  it('isNewer 对坏版本号返回 false 而非崩溃', () => {
    expect(isNewer('abc', '0.1.0')).toBe(false)
    expect(isNewer('0.2.0', '0.1.0')).toBe(true)
  })

  it('同号时正式版算作高于预发布', () => {
    // 测试通道用户不能被卡在 beta 上：1.2.0 发布后要能收到
    expect(isNewer('1.2.0', '1.2.0-beta.1')).toBe(true)
    expect(isNewer('1.2.0-beta.2', '1.2.0-beta.1')).toBe(false)
    expect(isNewer('1.2.0-beta.1', '1.2.0')).toBe(false)
  })

  it('isPrerelease 只认版本号里的后缀', () => {
    expect(isPrerelease('v1.2.3-beta.1')).toBe(true)
    expect(isPrerelease('1.2.3')).toBe(false)
    expect(isPrerelease('')).toBe(false)
  })
})

describe('buildMirrorUrl', () => {
  it('拼出加速前缀的下载路径', () => {
    expect(
      buildMirrorUrl('https://gh.zjkl0330.dpdns.org', '827802685', 'ghx', 'v0.2.0', 'ghx-0.2.0.apk'),
    ).toBe('https://gh.zjkl0330.dpdns.org/827802685/ghx/releases/download/v0.2.0/ghx-0.2.0.apk')
  })

  it('url 风格站点拼成完整 GitHub 地址', () => {
    expect(buildMirrorUrl('https://gh-proxy.com', '827802685', 'ghx', 'v0.2.0', 'x.apk')).toBe(
      'https://gh-proxy.com/https://github.com/827802685/ghx/releases/download/v0.2.0/x.apk',
    )
  })

  it('容忍前缀结尾多余斜杠，不产生 //', () => {
    expect(buildMirrorUrl('https://m.example.com///', 'a', 'b', 'v1', 'x.apk')).toBe(
      'https://m.example.com/a/b/releases/download/v1/x.apk',
    )
  })

  it('对空格等字符做编码', () => {
    expect(buildMirrorUrl('https://m', 'a', 'b', 'v1', 'my app.apk')).toContain('my%20app.apk')
  })
})

describe('pickApk', () => {
  it('优先取体积最大的 apk', () => {
    const got = pickApk([
      { name: 'a.apk', size: 100, browser_download_url: 'u1' },
      { name: 'b.apk', size: 900, browser_download_url: 'u2' },
      { name: 'source.zip', size: 5000, browser_download_url: 'u3' },
    ])
    expect(got?.name).toBe('b.apk')
  })

  it('没有 apk 时返回 null，不拿源码包顶替', () => {
    expect(pickApk([{ name: 'source.zip', size: 1, browser_download_url: 'u' }])).toBeNull()
  })
})

describe('parseRelease', () => {
  const base = {
    tag_name: 'v0.2.0',
    name: 'ghx 0.2.0',
    body: '### 新增\n- 检查更新',
    published_at: '2026-11-02T10:00:00Z',
    assets: [{ name: 'ghx-0.2.0.apk', size: 4_400_000, browser_download_url: 'https://github.com/x/y.apk' }],
  }

  it('生成加速下载地址与官方兜底地址', () => {
    const info = parseRelease(base, 'https://gh.zjkl0330.dpdns.org')
    expect(info?.version).toBe('0.2.0')
    expect(info?.downloadUrl).toBe(
      'https://gh.zjkl0330.dpdns.org/zjkl0330/ghx/releases/download/v0.2.0/ghx-0.2.0.apk',
    )
    expect(info?.fallbackUrl).toBe('https://github.com/x/y.apk')
  })

  it('带出可直接打开的 Release 页面', () => {
    const info = parseRelease(base, 'https://gh.zjkl0330.dpdns.org')
    expect(info?.releasePage).toBe('https://gh.zjkl0330.dpdns.org/zjkl0330/ghx/releases/tag/v0.2.0')
  })

  it('纯下载型镜像的 Release 页面退回自建站点，按钮不会 403', () => {
    const info = parseRelease(base, 'https://gh-proxy.com')
    expect(info?.releasePage).toBe('https://gh.zjkl0330.dpdns.org/zjkl0330/ghx/releases/tag/v0.2.0')
  })

  it('draft 版本对外不可见，直接丢弃', () => {
    expect(parseRelease({ ...base, draft: true }, 'https://m')).toBeNull()
  })

  it('tag 不可解析时返回 null', () => {
    expect(parseRelease({ ...base, tag_name: 'nightly' }, 'https://m')).toBeNull()
  })
})

describe('checkForUpdate', () => {
  function res(status: number, body: unknown, headers: Record<string, string> = {}) {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: new Headers(headers),
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response
  }

  it('远端版本更高时判定有更新', async () => {
    const fetchImpl = vi.fn(async () =>
      res(200, {
        tag_name: 'v0.3.0',
        body: 'fix',
        published_at: '2026-11-02T10:00:00Z',
        assets: [{ name: 'ghx-0.3.0.apk', size: 1, browser_download_url: 'u' }],
      }),
    )
    const { result, error } = await checkForUpdate({
      current: '0.2.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(error).toBeNull()
    expect(result?.hasUpdate).toBe(true)
    expect(result?.latest).toBe('0.3.0')
  })

  it('版本相同时不提示更新', async () => {
    const fetchImpl = vi.fn(async () => res(200, { tag_name: 'v0.2.0', assets: [] }))
    const { result } = await checkForUpdate({
      current: '0.2.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result?.hasUpdate).toBe(false)
    expect(result?.info?.downloadUrl).toBeNull()
  })

  it('404 表示还没有正式版，按「无需更新」处理而不是报错', async () => {
    const fetchImpl = vi.fn(async () => res(404, { message: 'Not Found' }))
    const { result, error } = await checkForUpdate({
      current: '0.2.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(error).toBeNull()
    expect(result?.hasUpdate).toBe(false)
    expect(result?.latest).toBeNull()
    expect(result?.current).toBe('0.2.0')
  })

  it('预发布的 release 不算更新', async () => {
    // 正常情况下 /releases/latest 不会返回预发布，这里防的是接口口径变化
    expect(parseRelease({ tag_name: 'v9.9.9', prerelease: true, assets: [] }, 'https://x')).toBeNull()
    const fetchImpl = vi.fn(async () => res(200, { tag_name: 'v9.9.9', prerelease: true, assets: [] }))
    const { result, error } = await checkForUpdate({
      current: '0.2.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(error).toBeNull()
    expect(result?.hasUpdate).toBe(false)
    expect(result?.latest).toBeNull()
  })

  it('限流时提示等待，而不是报网络错误', async () => {
    const fetchImpl = vi.fn(async () => res(403, { message: 'API rate limit exceeded' }, { 'x-ratelimit-remaining': '0' }))
    const { error } = await checkForUpdate({
      current: '0.2.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(error).toContain('限流')
  })

  it('网络异常返回结构化文案，不抛出', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const { result, error } = await checkForUpdate({
      current: '0.2.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toBeNull()
    expect(error).toContain('网络')
  })

  it('测试通道读列表接口，并把预发布算进候选', async () => {
    const fetchImpl = vi.fn(async () =>
      res(200, [
        {
          tag_name: 'v0.3.0',
          prerelease: false,
          assets: [{ name: 'ghx-0.3.0.apk', size: 10, browser_download_url: 'u' }],
        },
        {
          tag_name: 'v0.4.0-beta.1',
          prerelease: true,
          body: 'beta',
          assets: [{ name: 'ghx-0.4.0-beta.1.apk', size: 10, browser_download_url: 'u2' }],
        },
      ]),
    )
    const { result, error } = await checkForUpdate({
      current: '0.3.0',
      channel: 'beta',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(error).toBeNull()
    expect(result?.channel).toBe('beta')
    expect(result?.hasUpdate).toBe(true)
    expect(result?.latest).toBe('0.4.0')
    expect(result?.info?.prerelease).toBe(true)
    const url = (fetchImpl.mock.calls[0] as unknown[])[0] as string
    expect(url).toContain('/releases?per_page=30')
  })

  it('测试通道列表为空时按「无更新」处理，不报错', async () => {
    const fetchImpl = vi.fn(async () => res(200, []))
    const { result, error } = await checkForUpdate({
      current: '0.3.0',
      channel: 'beta',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(error).toBeNull()
    expect(result?.hasUpdate).toBe(false)
    expect(result?.channel).toBe('beta')
  })

  it('正式通道仍只认 /latest，不把 beta 当更新', async () => {
    const fetchImpl = vi.fn(async () => res(200, { tag_name: 'v9.9.9', prerelease: true, assets: [] }))
    const { result } = await checkForUpdate({
      current: '0.3.0',
      channel: 'stable',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result?.hasUpdate).toBe(false)
    expect(result?.channel).toBe('stable')
  })

  it('使用配置的 API 基址与仓库', async () => {
    const fetchImpl = vi.fn(async () => res(200, { tag_name: 'v0.2.0', assets: [] }))
    await checkForUpdate({
      current: '0.2.0',
      apiBase: 'https://mirror.example.com/api/',
      owner: 'o',
      repo: 'r',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const url = (fetchImpl.mock.calls[0] as unknown[])[0] as string
    expect(url).toBe('https://mirror.example.com/api/repos/o/r/releases/latest')
  })
})

describe('格式化', () => {
  it('字节数按 MB/KB 展示', () => {
    expect(formatBytes(0)).toBe('未知大小')
    expect(formatBytes(512 * 1024)).toBe('512 KB')
    expect(formatBytes(4_400_000)).toBe('4.2 MB')
  })

  it('日期截到天', () => {
    expect(formatDate('2026-11-02T10:00:00Z')).toMatch(/^2026-11-0[12]$/)
    expect(formatDate('')).toBe('')
  })
})

describe('pickBestRelease（测试通道）', () => {
  const apk = [{ name: 'ghx.apk', size: 10, browser_download_url: 'u' }]
  const rel = (tag: string, extra: Record<string, unknown> = {}) => ({
    tag_name: tag,
    assets: apk,
    published_at: '2026-11-20T10:00:00Z',
    ...extra,
  })

  it('按版本号取最高，不按接口返回顺序', () => {
    // 补发的低版本 hotfix 会排在列表最前面，照单全收会把用户往回拽
    const got = pickBestRelease(
      [rel('v1.1.2'), rel('v1.2.0-beta.1', { prerelease: true }), rel('v1.1.9')],
      'https://m',
    )
    expect(got?.tag).toBe('v1.2.0-beta.1')
    expect(got?.prerelease).toBe(true)
  })

  it('接口没标 prerelease 时，按 tag 后缀也认得出预发布', () => {
    expect(parseRelease(rel('v1.2.0-beta.1'), 'https://m', { allowPrerelease: true })?.prerelease).toBe(true)
  })

  it('同号时正式版优先于预发布', () => {
    const got = pickBestRelease(
      [rel('v1.2.0-beta.1', { prerelease: true }), rel('v1.2.0')],
      'https://m',
    )
    expect(got?.tag).toBe('v1.2.0')
    expect(got?.prerelease).toBe(false)
  })

  it('丢掉 draft 与无法解析的 tag', () => {
    const got = pickBestRelease([rel('v9.9.9', { draft: true }), rel('nightly'), rel('v1.0.1')], 'https://m')
    expect(got?.tag).toBe('v1.0.1')
  })

  it('全是不可用时返回 null', () => {
    expect(pickBestRelease([], 'https://m')).toBeNull()
    expect(pickBestRelease([rel('nightly')], 'https://m')).toBeNull()
  })
})
