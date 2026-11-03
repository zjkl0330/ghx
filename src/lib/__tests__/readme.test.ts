import { describe, expect, it, vi } from 'vitest'
import { GitHubClient } from '../api'
import {
  findChineseReadmeLink,
  joinRepoPath,
  looksChinese,
  pickChineseReadmeFile,
  readmeDir,
  type ReadmeFile,
} from '../readme'

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

function file(path: string, text: string) {
  const name = path.split('/').pop() ?? path
  return { name, path, size: text.length, content: b64(text), encoding: 'base64' }
}

describe('中文版 README 的识别', () => {
  it('认出顶部「English | 简体中文」里的链接', () => {
    const md = '![logo](./docs/logo.png)  English | [简体中文](./README_zh_CN.md)'
    expect(findChineseReadmeLink(md, 'README.md')).toBe('README_zh_CN.md')
  })

  it('README 在子目录时，相对链接跟着落到子目录', () => {
    expect(findChineseReadmeLink('[中文](README.zh-CN.md)', 'docs/README.md')).toBe(
      'docs/README.zh-CN.md',
    )
  })

  it('外链、锚点与非 markdown 不算', () => {
    expect(findChineseReadmeLink('[中文](https://example.com/zh.md)', 'README.md')).toBeNull()
    expect(findChineseReadmeLink('[中文](#中文说明)', 'README.md')).toBeNull()
    expect(findChineseReadmeLink('[中文](README_zh.txt)', 'README.md')).toBeNull()
  })

  it('HTML 写法的语言切换也认', () => {
    expect(findChineseReadmeLink('<a href="./README_zh.md">简体中文</a>', 'README.md')).toBe(
      'README_zh.md',
    )
  })

  it('没有语言链接时返回空，交给目录列表兜底', () => {
    expect(findChineseReadmeLink('# Hello\n\nSome English text.', 'README.md')).toBeNull()
  })

  it('目录里按命名习惯挑中文版', () => {
    const entries = [
      { name: 'README.md', path: 'README.md', type: 'file' },
      { name: 'README_zh_CN.md', path: 'README_zh_CN.md', type: 'file' },
      { name: 'CONTRIBUTING.md', path: 'CONTRIBUTING.md', type: 'file' },
    ]
    expect(pickChineseReadmeFile(entries, 'README.md')).toBe('README_zh_CN.md')
  })

  it('没有规范命名时按 zh / cn 兜一层', () => {
    const entries = [{ name: 'readme-chinese.md', path: 'readme-chinese.md', type: 'file' }]
    expect(pickChineseReadmeFile(entries, 'README.md')).toBe('readme-chinese.md')
  })

  it('目录里没有中文版就返回空', () => {
    const entries = [
      { name: 'README.md', path: 'README.md', type: 'file' },
      { name: 'LICENSE', path: 'LICENSE', type: 'file' },
    ]
    expect(pickChineseReadmeFile(entries, 'README.md')).toBeNull()
  })

  it('只取目录里的文件，不把子目录当文件', () => {
    const entries = [{ name: 'README_zh', path: 'README_zh', type: 'dir' }]
    expect(pickChineseReadmeFile(entries, 'README.md')).toBeNull()
  })
})

describe('路径工具', () => {
  it('目录末尾带斜杠，根目录为空串', () => {
    expect(readmeDir('README.md')).toBe('')
    expect(readmeDir('docs/README.md')).toBe('docs/')
  })

  it('相对路径按目录归一化，能退回上层', () => {
    expect(joinRepoPath('docs/', './README_zh.md')).toBe('docs/README_zh.md')
    expect(joinRepoPath('docs/', '../README_zh.md')).toBe('README_zh.md')
  })
})

describe('中文正文判断', () => {
  it('成段中文算中文', () => {
    expect(looksChinese('这是一个基于 Cloudflare 的无服务器博客平台，支持文章、图片与评论。')).toBe(true)
  })

  it('纯英文不算', () => {
    expect(looksChinese('A serverless blog platform built on Cloudflare Workers.')).toBe(false)
  })

  it('英文 README 里只夹一句中文不算', () => {
    expect(looksChinese('English | 简体中文\n\nA fast, self-hosted blog engine for everyone.')).toBe(
      false,
    )
  })

  it('空内容不算', () => {
    expect(looksChinese('')).toBe(false)
  })
})

describe('chineseReadme 拉取', () => {
  it('README 里有语言链接时直接取链接指向的文件', async () => {
    const calls: string[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/contents/README_zh_CN.md')) {
        return new Response(JSON.stringify(file('README_zh_CN.md', '# 标题\n\n这是中文说明，讲清楚项目用途与安装方式。')), { status: 200 })
      }
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
    }) as unknown as typeof fetch

    const client = new GitHubClient({ token: 't', fetchImpl: fetcher })
    const base: ReadmeFile = {
      name: 'README.md',
      path: 'README.md',
      text: 'English | [简体中文](./README_zh_CN.md)\n\n# Title\n\nEnglish only.',
      html: null,
      size: 10,
    }
    const zh = await client.chineseReadme('o', 'r', base)
    expect(zh?.path).toBe('README_zh_CN.md')
    expect(zh?.text).toContain('中文说明')
    // 有链接就不再列目录，省一次请求
    expect(calls).toHaveLength(1)
  })

  it('没有链接时列目录按命名挑', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/contents')) {
        return new Response(
          JSON.stringify([
            { name: 'README.md', path: 'README.md', type: 'file' },
            { name: 'README.zh-CN.md', path: 'README.zh-CN.md', type: 'file' },
          ]),
          { status: 200 },
        )
      }
      if (url.includes('README.zh-CN.md')) {
        return new Response(JSON.stringify(file('README.zh-CN.md', '# 中文\n\n这是中文版的完整说明内容。')), {
          status: 200,
        })
      }
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
    }) as unknown as typeof fetch

    const client = new GitHubClient({ token: 't', fetchImpl: fetcher })
    const base: ReadmeFile = {
      name: 'README.md',
      path: 'README.md',
      text: '# Readme\n\nOnly English here.',
      html: null,
      size: 10,
    }
    const zh = await client.chineseReadme('o', 'r', base)
    expect(zh?.path).toBe('README.zh-CN.md')
  })

  it('目录里也没中文版时返回空，不抛错', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/contents')) {
        return new Response(JSON.stringify([{ name: 'README.md', path: 'README.md', type: 'file' }]), {
          status: 200,
        })
      }
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 })
    }) as unknown as typeof fetch

    const client = new GitHubClient({ token: 't', fetchImpl: fetcher })
    const base: ReadmeFile = {
      name: 'README.md',
      path: 'README.md',
      text: 'English only.',
      html: null,
      size: 10,
    }
    await expect(client.chineseReadme('o', 'r', base)).resolves.toBeNull()
  })
})

describe('图片式语言切换与标签很重的中文 README', () => {
  it('用图片当语言按钮时看 alt', () => {
    const md =
      '<p align="center"><a href="README.ja.md"><img src="lang-ja.png" alt="日本語" height="40" /></a><a href="README.zh.md"><img src="lang-zh.png" alt="中文" height="40" /></a></p>'
    expect(findChineseReadmeLink(md, 'README.md')).toBe('README.zh.md')
  })

  it('markdown 图片链接形式的语言切换也能认', () => {
    expect(findChineseReadmeLink('[![中文](lang-zh.svg)](README.zh.md)', 'README.md')).toBe(
      'README.zh.md',
    )
  })

  it('开头一大段居中 HTML 与徽章，正文仍是中文', () => {
    const md = [
      '<p align="center">',
      '  <picture><source srcset="docs/banner-dark.png" /><img src="docs/banner.png" width="800" alt="M3E" /></picture>',
      '</p>',
      '<p align="center">',
      '  <a href="https://x"><img alt="GitHub stars" src="https://img.shields.io/github/stars/a/b?style=for-the-badge" /></a>',
      '</p>',
      '',
      '## 这是什么',
      '',
      '这是一个在浏览器里画界面草图的工具，画完就能生成给 AI 用的提示词，',
      '不需要注册账号，也不需要安装任何东西，全部在本地运行。',
    ].join('\n')
    expect(looksChinese(md)).toBe(true)
  })
})
