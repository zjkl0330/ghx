import { describe, expect, it, vi } from 'vitest'
import {
  archiveCandidates,
  archiveFileName,
  archivePath,
  archiveViaMirror,
  codeloadPath,
  codeloadViaProxy,
  pickArchive,
} from '../archive'
import { resetMirrorRegistry, setMirrorRegistry, repoPageUrl } from '../mirrors'

const PROXY = 'https://gh-proxy.com'
const SELF = 'https://gh.zjkl0330.dpdns.org'

describe('archiveFileName', () => {
  it('用「仓库-分支.zip」，与 GitHub 自己给的文件名一致', () => {
    expect(archiveFileName('ghx', 'main')).toBe('ghx-main.zip')
  })

  it('分支里的斜杠转成连字符', () => {
    expect(archiveFileName('ghx', 'feat/zip')).toBe('ghx-feat-zip.zip')
  })

  it('分支为空时退回 main，不产出「-」这种怪名字', () => {
    expect(archiveFileName('ghx', '')).toBe('ghx-main.zip')
  })
})

describe('archivePath', () => {
  it('走 github 的 archive 路径，不带域名', () => {
    expect(archivePath('zjkl0330', 'ghx', 'main')).toBe('zjkl0330/ghx/archive/refs/heads/main.zip')
  })

  it('分支的斜杠保留，只编码每一段', () => {
    expect(archivePath('o', 'r', 'feat/zip')).toBe('o/r/archive/refs/heads/feat/zip.zip')
  })

  it('空格与 # 这类字符要编码，否则地址会被截断', () => {
    expect(archivePath('o', 'r', 'a b#c')).toBe('o/r/archive/refs/heads/a%20b%23c.zip')
  })
})

describe('codeloadPath', () => {
  it('是 codeload 的 zip 路径，结尾没有 .zip', () => {
    expect(codeloadPath('zjkl0330', 'ghx', 'main')).toBe('zjkl0330/ghx/zip/refs/heads/main')
  })
})

describe('codeloadViaProxy', () => {
  it('url 型反代：{base}/https://codeload.github.com/…', () => {
    expect(codeloadViaProxy(PROXY, 'o', 'r', 'main')).toBe(
      'https://gh-proxy.com/https://codeload.github.com/o/r/zip/refs/heads/main',
    )
  })

  it('base 带结尾斜杠不产生双斜杠', () => {
    expect(codeloadViaProxy('https://gh-proxy.com/', 'o', 'r', 'main')).toBe(
      'https://gh-proxy.com/https://codeload.github.com/o/r/zip/refs/heads/main',
    )
  })
})

describe('archiveViaMirror', () => {
  it('自建站是路径风格，直接拼 owner/repo', () => {
    expect(archiveViaMirror(SELF, 'o', 'r', 'main')).toBe(`${SELF}/o/r/archive/refs/heads/main.zip`)
  })

  it('url 风格镜像把 github 整段带过去', () => {
    expect(archiveViaMirror(PROXY, 'o', 'r', 'main')).toBe(
      'https://gh-proxy.com/https://github.com/o/r/archive/refs/heads/main.zip',
    )
  })
})

describe('archiveCandidates', () => {
  it('url 型镜像先让它自己试 codeload，成了最快', () => {
    const list = archiveCandidates(PROXY, 'o', 'r', 'main')
    expect(list[0]).toBe('https://gh-proxy.com/https://codeload.github.com/o/r/zip/refs/heads/main')
  })

  it('自建站不代理 codeload，先交给已知能吃 codeload 的反代', () => {
    const list = archiveCandidates(SELF, 'o', 'r', 'main')
    expect(list[0]).toBe('https://gh-proxy.com/https://codeload.github.com/o/r/zip/refs/heads/main')
    expect(list).toContain(`${SELF}/o/r/archive/refs/heads/main.zip`)
    expect(list.indexOf(`${SELF}/o/r/archive/refs/heads/main.zip`)).toBeLessThan(
      list.indexOf('https://codeload.github.com/o/r/zip/refs/heads/main'),
    )
  })

  it('官方 codeload 永远沉底', () => {
    const list = archiveCandidates(SELF, 'o', 'r', 'main')
    expect(list[list.length - 1]).toBe('https://codeload.github.com/o/r/zip/refs/heads/main')
  })

  it('当前镜像就是 gh-proxy 时不重复排两条一样的', () => {
    const list = archiveCandidates(PROXY, 'o', 'r', 'main')
    expect(list.filter((u) => u === 'https://gh-proxy.com/https://codeload.github.com/o/r/zip/refs/heads/main').length).toBe(1)
    expect(new Set(list.map((u) => u.toLowerCase())).size).toBe(list.length)
  })

  it('可以换成自己的代理列表，第一个排在最前', () => {
    const list = archiveCandidates(SELF, 'o', 'r', 'main', ['https://my.proxy'])
    expect(list[0]).toBe('https://my.proxy/https://codeload.github.com/o/r/zip/refs/heads/main')
  })

  it('候选去重且最多四条 — 探活要一条条等，不能无限长', () => {
    const list = archiveCandidates(SELF, 'o', 'r', 'main', [PROXY, PROXY, 'https://ghfast.top', 'https://ghproxy.net'])
    expect(list.length).toBeLessThanOrEqual(4)
    expect(new Set(list.map((u) => u.toLowerCase())).size).toBe(list.length)
  })
})

describe('pickArchive', () => {
  it('返回第一个探活通过的地址', async () => {
    const probe = vi.fn(async (u: string) => u.includes('ghfast'))
    await expect(pickArchive(['a', 'b-ghfast', 'c'], probe)).resolves.toBe('b-ghfast')
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('第一条就通时不再继续探，省时间', async () => {
    const probe = vi.fn(async () => true)
    await expect(pickArchive(['a', 'b', 'c'], probe)).resolves.toBe('a')
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('全都不通时退回第一条，让浏览器自己再试', async () => {
    const probe = vi.fn(async () => false)
    await expect(pickArchive(['a', 'b'], probe)).resolves.toBe('a')
  })

  it('探活抛异常当作不通，不能把整个下载卡死', async () => {
    const probe = vi.fn(async (u: string) => {
      if (u === 'a') throw new Error('boom')
      return true
    })
    await expect(pickArchive(['a', 'b'], probe)).resolves.toBe('b')
  })
})

describe('repoPageUrl', () => {
  it('能翻页的镜像直接用当前站', () => {
    expect(repoPageUrl(SELF, 'o/r')).toBe(`${SELF}/o/r`)
  })

  it('下载型镜像不翻页，退回能翻页的站点', () => {
    setMirrorRegistry([{ id: 'zjkl', label: '自建', base: SELF, style: 'path', page: true }])
    const url = repoPageUrl(PROXY, 'o/r')
    resetMirrorRegistry()
    expect(url).toBe(`${SELF}/o/r`)
  })

  it('owner/repo 逐段编码，但分隔斜杠要保留', () => {
    expect(repoPageUrl(SELF, 'o/r')).toContain('/o/r')
  })
})
