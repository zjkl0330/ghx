import { describe, expect, it } from 'vitest'
import {
  assetKind,
  excerpt,
  mirrorDownloadUrl,
  pickAsset,
  releaseDate,
  releaseTitle,
  sortReleases,
  totalDownloads,
  validateTag,
} from '../releases'
import type { Release, ReleaseAsset } from '../types'

function asset(over: Partial<ReleaseAsset> = {}): ReleaseAsset {
  return {
    id: 1,
    name: 'app.apk',
    size: 1024,
    download_count: 3,
    browser_download_url: 'https://github.com/o/r/releases/download/v1/app.apk',
    ...over,
  }
}

function release(over: Partial<Release> = {}): Release {
  return {
    id: 1,
    tag_name: 'v1.0.0',
    name: 'v1.0.0',
    body: 'notes',
    draft: false,
    prerelease: false,
    created_at: '2026-10-01T00:00:00Z',
    published_at: '2026-10-02T00:00:00Z',
    html_url: 'https://github.com/o/r/releases/tag/v1.0.0',
    assets: [],
    ...over,
  }
}

describe('sortReleases', () => {
  it('草稿排最前，其余按发布时间倒序', () => {
    const list = sortReleases([
      release({ id: 1, tag_name: 'v1', published_at: '2026-10-01T00:00:00Z' }),
      release({ id: 2, tag_name: 'v3', published_at: '2026-10-03T00:00:00Z' }),
      release({ id: 3, tag_name: 'draft', draft: true, published_at: null, created_at: '2026-09-01T00:00:00Z' }),
      release({ id: 4, tag_name: 'v2', published_at: '2026-10-02T00:00:00Z' }),
    ])
    expect(list.map((r) => r.tag_name)).toEqual(['draft', 'v3', 'v2', 'v1'])
  })
})

describe('展示字段', () => {
  it('标题为空时退回标签', () => {
    expect(releaseTitle(release({ name: '   ', tag_name: 'v9.9.9' }))).toBe('v9.9.9')
    expect(releaseTitle(release({ name: '正式版' }))).toBe('正式版')
  })

  it('日期优先用发布时间，草稿用创建时间', () => {
    expect(releaseDate(release({ published_at: '2026-03-05T12:00:00Z' }))).toBe('2026-03-05')
    expect(releaseDate(release({ published_at: null, created_at: '2026-03-04T12:00:00Z' }))).toBe('2026-03-04')
    expect(releaseDate(release({ published_at: 'oops', created_at: 'oops' }))).toBe('—')
  })

  it('下载总数累加', () => {
    expect(totalDownloads([asset({ download_count: 2 }), asset({ id: 2, download_count: 5 })])).toBe(7)
    expect(totalDownloads([])).toBe(0)
  })

  it('正文按长度截断并保留省略号', () => {
    expect(excerpt('短说明')).toBe('短说明')
    expect(excerpt('a'.repeat(10), 4)).toBe('aaaa…')
    expect(excerpt(null)).toBe('')
  })
})

describe('资产选择', () => {
  it('识别 apk 与压缩包', () => {
    expect(assetKind('ghx-0.4.3-debug.apk')).toBe('apk')
    expect(assetKind('dist.zip')).toBe('archive')
    expect(assetKind('release.tar.gz')).toBe('archive')
    expect(assetKind('notes.txt')).toBe('other')
  })

  it('优先给 APK，其次压缩包，最后取最大的', () => {
    const zip = asset({ id: 1, name: 'dist.zip', size: 900 })
    const apk = asset({ id: 2, name: 'app.apk', size: 100 })
    expect(pickAsset([zip, apk])?.name).toBe('app.apk')
    expect(pickAsset([zip, asset({ id: 3, name: 'a.txt', size: 5000 })])?.name).toBe('dist.zip')
    expect(pickAsset([asset({ name: 'a.txt', size: 10 }), asset({ id: 4, name: 'b.txt', size: 90 })])?.name).toBe('b.txt')
    expect(pickAsset([])).toBeNull()
  })
})

describe('validateTag', () => {
  it('正常标签通过', () => {
    expect(validateTag('v0.4.4')).toBeNull()
    expect(validateTag('release-2026.11')).toBeNull()
  })

  it('空值与空格被拦住', () => {
    expect(validateTag('  ')).toContain('不能为空')
    expect(validateTag('v1 2')).toContain('空格')
  })

  it('Git 非法字符被拦住', () => {
    expect(validateTag('v1..2')).toContain('..')
    expect(validateTag('v1^2')).not.toBeNull()
    expect(validateTag('/v1')).not.toBeNull()
    expect(validateTag('v1.lock')).not.toBeNull()
    expect(validateTag('v'.repeat(121))).toContain('过长')
  })
})

describe('mirrorDownloadUrl', () => {
  it('只替换域名，路径原样保留', () => {
    expect(
      mirrorDownloadUrl(
        'https://github.com/827802685/ghx/releases/download/v0.4.3/ghx-0.4.3-debug.apk',
        'https://gh.zjkl0330.dpdns.org',
      ),
    ).toBe('https://gh.zjkl0330.dpdns.org/827802685/ghx/releases/download/v0.4.3/ghx-0.4.3-debug.apk')
  })

  it('前缀末尾斜杠会归一化', () => {
    expect(mirrorDownloadUrl('https://github.com/o/r/releases/download/v1/a.zip', 'https://m.example/')).toBe(
      'https://m.example/o/r/releases/download/v1/a.zip',
    )
  })

  it('非 github 域名不动，避免把别家链接拼坏', () => {
    const url = 'https://objects.githubusercontent.com/abc'
    expect(mirrorDownloadUrl(url, 'https://m.example')).toBe(url)
  })
})
