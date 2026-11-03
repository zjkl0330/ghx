import { describe, expect, it } from 'vitest'
import { mirrorImage, normalizeGithubImage, rawBase, resolveImageSrc } from '../images'

const RAW = 'https://raw.githubusercontent.com'

describe('图片基准地址', () => {
  it('根目录 README 的基准就是仓库根', () => {
    expect(rawBase('o', 'r', 'main', 'README.md')).toBe(`${RAW}/o/r/main/`)
  })

  it('子目录 README 的图相对它自己所在目录', () => {
    expect(rawBase('o', 'r', 'dev', 'docs/README.md')).toBe(`${RAW}/o/r/dev/docs/`)
  })

  it('分支为空时按 main 兜底', () => {
    expect(rawBase('o', 'r', '', 'README.md')).toBe(`${RAW}/o/r/main/`)
  })
})

describe('图片地址归一化', () => {
  const base = `${RAW}/o/r/main/docs/`

  it('相对路径按基准拼绝对地址', () => {
    expect(resolveImageSrc('./img/a.png', base)).toBe(`${RAW}/o/r/main/docs/img/a.png`)
    expect(resolveImageSrc('img/a.png', base)).toBe(`${RAW}/o/r/main/docs/img/a.png`)
  })

  it('../ 能退到仓库上层目录', () => {
    expect(resolveImageSrc('../assets/a.png', base)).toBe(`${RAW}/o/r/main/assets/a.png`)
  })

  it('github.com 的 blob / raw 链接换成 raw 域名', () => {
    expect(normalizeGithubImage('https://github.com/o/r/blob/main/a/b.png')).toBe(
      `${RAW}/o/r/main/a/b.png`,
    )
    expect(resolveImageSrc('https://github.com/o/r/raw/main/a.png?raw=true', base)).toBe(
      `${RAW}/o/r/main/a.png`,
    )
  })

  it('协议相对地址补 https', () => {
    expect(resolveImageSrc('//cdn.example.com/a.png', base)).toBe('https://cdn.example.com/a.png')
  })

  it('内联数据、脚本与空地址一律不渲染', () => {
    expect(resolveImageSrc('data:image/png;base64,AAAA', base)).toBeNull()
    expect(resolveImageSrc('javascript:alert(1)', base)).toBeNull()
    expect(resolveImageSrc('', base)).toBeNull()
    expect(resolveImageSrc('   ', base)).toBeNull()
  })

  it('没有基准时相对路径不猜，直接丢弃', () => {
    expect(resolveImageSrc('a.png', '')).toBeNull()
  })
})

describe('镜像降级地址', () => {
  it('raw 地址换到加速前缀', () => {
    expect(mirrorImage(`${RAW}/o/r/main/docs/a.png`, 'https://gh.example.com/')).toBe(
      'https://gh.example.com/o/r/raw/main/docs/a.png',
    )
  })

  it('第三方图床不掺和镜像', () => {
    expect(mirrorImage('https://img.shields.io/badge/a-b.svg', 'https://gh.example.com')).toBeNull()
  })

  it('地址段不够时返回空，不拼出坏链接', () => {
    expect(mirrorImage(`${RAW}/o/r/main`, 'https://gh.example.com')).toBeNull()
    expect(mirrorImage(`${RAW}/o/r/main/a.png`, '')).toBeNull()
  })
})
