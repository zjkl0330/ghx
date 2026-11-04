import { describe, expect, it, vi } from 'vitest'
import {
  buildMirrorUrl,
  checkForUpdate,
  compareVersions,
  formatBytes,
  formatDate,
  isNewer,
  parseRelease,
  parseVersion,
  pickApk,
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

  it('404 表示还没发过版本，给出可读文案', async () => {
    const fetchImpl = vi.fn(async () => res(404, { message: 'Not Found' }))
    const { result, error } = await checkForUpdate({
      current: '0.2.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(result).toBeNull()
    expect(error).toContain('尚未发布')
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
