import { describe, expect, it } from 'vitest'
import { blocksToText, inline, parseMarkdown, summarize } from '../markdown'

describe('行内标记清理', () => {
  it('保留链接文字，去掉地址', () => {
    expect(inline('见 [文档](https://example.com/a) 说明')).toBe('见 文档 说明')
  })

  it('整块徽章丢弃', () => {
    expect(inline('[![build](https://img/x.svg)](https://ci/y)')).toBe('')
  })

  it('去掉行内代码与粗体标记', () => {
    expect(inline('用 `pnpm build` 构建，**不要** 提交 `dist`')).toBe('用 pnpm build 构建，不要 提交 dist')
  })

  it('裸 HTML 标签变成空格', () => {
    expect(inline('<div align="center">标题</div>')).toBe('标题')
  })

  it('折叠多余空白', () => {
    expect(inline('a    b\t\tc')).toBe('a b c')
  })
})

describe('Markdown 块解析', () => {
  it('识别标题层级', () => {
    const blocks = parseMarkdown('# 一级\n\n### 三级')
    expect(blocks).toEqual([
      { kind: 'h', level: 1, text: '一级' },
      { kind: 'h', level: 3, text: '三级' },
    ])
  })

  it('连续行合并成一个段落', () => {
    const blocks = parseMarkdown('第一行\n第二行\n\n另一段')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toEqual({ kind: 'p', text: '第一行 第二行' })
  })

  it('列表保留缩进与有序标记', () => {
    const blocks = parseMarkdown('- a\n  - b\n1. c')
    expect(blocks).toEqual([
      { kind: 'li', text: 'a', depth: 0, ordered: false },
      { kind: 'li', text: 'b', depth: 1, ordered: false },
      { kind: 'li', text: 'c', depth: 0, ordered: true },
    ])
  })

  it('代码块原样保留并带语言', () => {
    const blocks = parseMarkdown('```ts\nconst a = 1\n```')
    expect(blocks).toEqual([{ kind: 'code', text: 'const a = 1', lang: 'ts' }])
  })

  it('代码块里的 # 不会被当成标题', () => {
    const blocks = parseMarkdown('```sh\n# 注释\necho hi\n```')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('code')
  })

  it('keepCode=false 时丢弃代码块', () => {
    const blocks = parseMarkdown('文字\n\n```js\nx\n```', { keepCode: false })
    expect(blocks).toEqual([{ kind: 'p', text: '文字' }])
  })

  it('引用保留内容', () => {
    const blocks = parseMarkdown('> 注意\n> 第二行')
    expect(blocks).toEqual([{ kind: 'quote', text: '注意 第二行' }])
  })

  it('分隔线识别成 hr', () => {
    expect(parseMarkdown('---')).toEqual([{ kind: 'hr' }])
  })

  it('表格降级成一行文字', () => {
    const blocks = parseMarkdown('| 名称 | 说明 |\n|---|---|\n| a | b |')
    expect(blocks).toEqual([
      { kind: 'p', text: '名称 · 说明' },
      { kind: 'p', text: 'a · b' },
    ])
  })

  it('整行徽章不会留下空段落', () => {
    const blocks = parseMarkdown('[![a](x)](y) [![b](m)](n)\n\n正文')
    expect(blocks).toEqual([{ kind: 'p', text: '正文' }])
  })

  it('超过块数上限时截断', () => {
    const md = Array.from({ length: 50 }, (_, i) => `## 标题 ${i}`).join('\n\n')
    expect(parseMarkdown(md, { maxBlocks: 10 })).toHaveLength(10)
  })
})

describe('纯文本转换', () => {
  it('块还原成带段落间隔的文字', () => {
    const blocks = parseMarkdown('# 标题\n\n正文\n\n- 项')
    expect(blocksToText(blocks)).toBe('标题\n\n正文\n\n- 项')
  })

  it('摘要跳过代码块', () => {
    const blocks = parseMarkdown('```js\nconst a = 1\n```\n\n这是说明文字')
    expect(summarize(blocks)).toBe('这是说明文字')
  })

  it('摘要超长时截断并加省略号', () => {
    const long = 'a'.repeat(200)
    expect(summarize(parseMarkdown(long), 50)).toBe(`${'a'.repeat(50)}…`)
  })
})
