import { describe, expect, it } from 'vitest'
import { blocksToText, expandLinkRefs, inline, parseMarkdown, parseInline, spansText, summarize } from '../markdown'

/**
 * 剥掉行内结构再比对。
 *
 * 下面这些用例断言的是「块怎么切分、纯文本是什么」，spans 由单独一组
 * 用例覆盖。混在一起写会让每条断言都长一屏，改一处要动十行。
 */
function bare(blocks: readonly unknown[]): Record<string, unknown>[] {
  return blocks.map((b) => {
    // 标题的 anchor 由「标题锚点」那组用例单独断言，其余用例只看结构
    const { spans: _s, spansFor: _f, anchor: _a, ...rest } = b as Record<string, unknown>
    return rest
  })
}

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
    expect(bare(blocks)).toEqual([
      { kind: 'h', level: 1, text: '一级' },
      { kind: 'h', level: 3, text: '三级' },
    ])
  })

  it('连续行合并成一个段落', () => {
    const blocks = parseMarkdown('第一行\n第二行\n\n另一段')
    expect(blocks).toHaveLength(2)
    expect(bare(blocks)[0]).toEqual({ kind: 'p', text: '第一行 第二行' })
  })

  it('列表保留缩进与有序标记', () => {
    const blocks = parseMarkdown('- a\n  - b\n1. c')
    expect(bare(blocks)).toEqual([
      { kind: 'li', text: 'a', depth: 0, ordered: false },
      { kind: 'li', text: 'b', depth: 1, ordered: false },
      { kind: 'li', text: 'c', depth: 0, ordered: true },
    ])
  })

  it('代码块原样保留并带语言', () => {
    const blocks = parseMarkdown('```ts\nconst a = 1\n```')
    expect(bare(blocks)).toEqual([{ kind: 'code', text: 'const a = 1', lang: 'ts' }])
  })

  it('代码块里的 # 不会被当成标题', () => {
    const blocks = parseMarkdown('```sh\n# 注释\necho hi\n```')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('code')
  })

  it('keepCode=false 时丢弃代码块', () => {
    const blocks = parseMarkdown('文字\n\n```js\nx\n```', { keepCode: false })
    expect(bare(blocks)).toEqual([{ kind: 'p', text: '文字' }])
  })

  it('引用保留内容', () => {
    const blocks = parseMarkdown('> 注意\n> 第二行')
    expect(bare(blocks)).toEqual([{ kind: 'quote', text: '注意 第二行' }])
  })

  it('分隔线识别成 hr', () => {
    expect(parseMarkdown('---')).toEqual([{ kind: 'hr' }])
  })

  it('表格解析成 table 块，带表头、对齐与行', () => {
    const blocks = parseMarkdown('| 名称 | 说明 |\n|:---|---:|\n| a | b |\n| c | d |')
    expect(bare(blocks)).toEqual([
      { kind: 'table', head: ['名称', '说明'], rows: [['a', 'b'], ['c', 'd']], align: ['l', 'r'] },
    ])
  })

  it('表格单元格保留行内标记，好让渲染层把链接变成可点的', () => {
    const blocks = parseMarkdown('| 名称 | 说明 |\n|---|---|\n| a | 见 [公式](docs/f.md) 用 `pnpm build` |')
    const t = blocks[0] as Extract<(typeof blocks)[number], { kind: 'table' }>
    expect(t.rows[0][1]).toBe('见 [公式](docs/f.md) 用 `pnpm build`')
  })

  it('表格转纯文本时才清洗标记', () => {
    const blocks = parseMarkdown('| 名称 | 说明 |\n|---|---|\n| a | 见 [公式](docs/f.md) 用 `pnpm build` |')
    expect(blocksToText(blocks)).toContain('见 公式 用 pnpm build')
    expect(summarize(blocks)).not.toContain('docs/f.md')
  })

  it('没有分隔行的竖线行降级成文字', () => {
    const blocks = parseMarkdown('| a | b |')
    expect(bare(blocks)).toEqual([{ kind: 'p', text: 'a · b' }])
  })

  it('任务列表保留勾选状态', () => {
    const blocks = parseMarkdown('- [ ] 待办\n- [x] 已完成\n- 普通项')
    expect(bare(blocks)).toEqual([
      { kind: 'li', text: '待办', depth: 0, ordered: false, checked: false },
      { kind: 'li', text: '已完成', depth: 0, ordered: false, checked: true },
      { kind: 'li', text: '普通项', depth: 0, ordered: false },
    ])
  })

  it('整行徽章不会留下空段落', () => {
    const blocks = parseMarkdown('[![a](x)](y) [![b](m)](n)\n\n正文')
    expect(bare(blocks)).toEqual([{ kind: 'p', text: '正文' }])
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

describe('图片解析', () => {
  const base = 'https://raw.githubusercontent.com/o/r/main/docs/'

  it('相对路径的图片保留下来并按 README 目录解析', () => {
    const blocks = parseMarkdown('![架构图](./img/a.png)', { imageBase: base })
    expect(bare(blocks)).toEqual([
      {
        kind: 'img',
        src: 'https://raw.githubusercontent.com/o/r/main/docs/img/a.png',
        alt: '架构图',
        badge: false,
        width: null,
        height: null,
        inline: false,
      },
    ])
  })

  it('HTML img 与 width 属性都认', () => {
    const blocks = parseMarkdown('<img src="logo.svg" width="120" alt="Logo">', { imageBase: base })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      kind: 'img',
      src: 'https://raw.githubusercontent.com/o/r/main/docs/logo.svg',
      alt: 'Logo',
      width: 120,
    })
  })

  it('居中 div 包着的单行图片不再被当装饰丢掉', () => {
    const md = '<div align="center">\n<img src="banner.png" width="800">\n</div>'
    const blocks = parseMarkdown(md, { imageBase: base })
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('img')
    // width 超过 400 视为想撑满，交回界面按屏宽缩放
    expect((blocks[0] as { width: number | null }).width).toBeNull()
  })

  it('被链接包住与 shields.io 的图算徽章', () => {
    const md = '[![build](https://ci.example/b.svg)](https://ci.example)\n\n![](https://img.shields.io/badge/a-b.svg)'
    const blocks = parseMarkdown(md)
    expect(blocks).toHaveLength(2)
    expect(blocks.every((b) => b.kind === 'img' && b.badge)).toBe(true)
  })

  it('普通截图的 SVG 不算徽章', () => {
    const blocks = parseMarkdown('![截图](shot.svg)', { imageBase: base })
    expect(blocks[0]).toMatchObject({ kind: 'img', badge: false })
  })

  it('段落里夹的图片单独成块，不会连文字一起被吞', () => {
    const blocks = parseMarkdown('看这张图 ![示意图](a.png) 就明白了', { imageBase: base })
    expect(blocks).toHaveLength(2)
    expect(blocks[0].kind).toBe('p')
    expect(blocks[1]).toMatchObject({ kind: 'img', alt: '示意图' })
  })

  it('没有基准地址时相对图片直接丢弃，不留空块', () => {
    expect(parseMarkdown('![](a.png)')).toEqual([])
  })

  it('data URI 不会被渲染成图片', () => {
    expect(parseMarkdown('![x](data:image/png;base64,AAAA)')).toEqual([])
  })

  it('图片不参与纯文本摘要', () => {
    const blocks = parseMarkdown('![图](a.png)', { imageBase: base })
    expect(summarize(blocks)).toBe('')
  })
})

describe('同行多图与高度', () => {
  const base = 'https://raw.githubusercontent.com/o/r/main/'

  it('同一行的多张图并排，不各占一行', () => {
    const md =
      '<p align="center"><a href="README.md"><img src="lang-en.png" height="40" alt="English" /></a><a href="README.zh.md"><img src="lang-zh.png" height="40" alt="中文" /></a></p>'
    const blocks = parseMarkdown(md, { imageBase: base })
    expect(blocks).toHaveLength(2)
    expect(blocks.every((b) => b.kind === 'img' && b.inline)).toBe(true)
  })

  it('height 属性决定行内高度，width 不再顶替', () => {
    const [en] = parseMarkdown('<img src="lang-en.png" height="40" width="120">', { imageBase: base })
    expect(en).toMatchObject({ height: 40, width: 120 })
  })

  it('大高度不照抄，避免一张图占满屏', () => {
    const [banner] = parseMarkdown('<img src="banner.png" height="900">', { imageBase: base })
    expect(banner).toMatchObject({ height: null })
  })

  it('单张图仍是块级，不跟正文挤在一行', () => {
    const [shot] = parseMarkdown('![截图](a.png)', { imageBase: base })
    expect(shot).toMatchObject({ inline: false })
  })
})


describe('HTML 标题', () => {
  it('独占一行的 <h1> 识别成一级标题', () => {
    const blocks = parseMarkdown('<h1 align="center">Hi, I\'m zjkl</h1>')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'h', level: 1, text: "Hi, I'm zjkl" })
  })

  it('h2 / h3 也认，层级照原样保留', () => {
    expect(parseMarkdown('<h2 id="x">小节</h2>')[0]).toMatchObject({ kind: 'h', level: 2, text: '小节' })
    expect(parseMarkdown('  <h3>深层</h3>')[0]).toMatchObject({ kind: 'h', level: 3, text: '深层' })
  })

  it('标题里夹着链接时保留文字', () => {
    const blocks = parseMarkdown('<h1><a href="https://x">点我</a></h1>')
    expect(blocks[0]).toMatchObject({ kind: 'h', level: 1, text: '点我' })
  })

  it('开闭标签不配对时不硬当标题，留给段落', () => {
    const blocks = parseMarkdown('<h1>没闭合')
    expect(blocks.every((b) => b.kind !== 'h')).toBe(true)
  })

  it('一行里除了标题还有别的内容就不当标题', () => {
    const blocks = parseMarkdown('<h1>标题</h1> 后面还有字')
    expect(blocks.every((b) => b.kind !== 'h')).toBe(true)
  })
})

describe('行内结构 parseInline', () => {
  it('链接拆成「文字 + 地址」，地址不再被丢掉', () => {
    const spans = parseInline('见 [文档](https://example.com/a) 说明')
    expect(spans).toEqual([
      { t: 'text', v: '见 ' },
      { t: 'link', v: '文档', href: 'https://example.com/a' },
      { t: 'text', v: ' 说明' },
    ])
  })

  it('链接可以带标题', () => {
    const spans = parseInline('[文档](https://x "标题")')
    expect(spans).toEqual([{ t: 'link', v: '文档', href: 'https://x' }])
  })

  it('尖括号自动链接', () => {
    const spans = parseInline('看 <https://x.com/a> 这里')
    expect(spans[1]).toEqual({ t: 'link', v: 'https://x.com/a', href: 'https://x.com/a' })
  })

  it('行内代码里的链接语法不解析', () => {
    const spans = parseInline('`[a](b)`')
    expect(spans).toEqual([{ t: 'code', v: '[a](b)' }])
  })

  it('徽章整块丢弃', () => {
    expect(parseInline('[![build](https://img/x.svg)](https://ci/y)')).toEqual([])
  })

  it('图片只留 alt', () => {
    expect(parseInline('![示意图](https://img/a.png)')).toEqual([{ t: 'text', v: '示意图' }])
  })

  it('粗体 / 斜体 / 删除线', () => {
    expect(parseInline('**粗** 和 *斜* 和 ~~删~~')).toEqual([
      { t: 'strong', v: '粗' },
      { t: 'text', v: ' 和 ' },
      { t: 'em', v: '斜' },
      { t: 'text', v: ' 和 ' },
      { t: 'del', v: '删' },
    ])
  })

  it('下划线包起来的粗体也认', () => {
    expect(parseInline('__粗__')).toEqual([{ t: 'strong', v: '粗' }])
  })

  it('单词里的下划线不当斜体', () => {
    expect(parseInline('snake_case_name')).toEqual([{ t: 'text', v: 'snake_case_name' }])
  })

  it('转义后的星号保持字面量', () => {
    expect(parseInline('2 \\* 3')).toEqual([{ t: 'text', v: '2 * 3' }])
  })

  it('裸 HTML 标签被剔除，中间文字留下', () => {
    expect(parseInline('<b>粗</b>')).toEqual([{ t: 'text', v: '粗' }])
  })

  it('纯文本原样返回', () => {
    expect(parseInline('就是一句话')).toEqual([{ t: 'text', v: '就是一句话' }])
  })

  it('空串返回空数组', () => {
    expect(parseInline('')).toEqual([])
  })

  it('spansText 与 inline 对常见写法结果一致', () => {
    for (const raw of [
      '见 [文档](https://x) 说明',
      '**粗** 和 *斜*',
      '`code` 与 [a](b)',
      '![图](u) 后面',
      '普通一行',
    ]) {
      expect(spansText(parseInline(raw))).toBe(inline(raw))
    }
  })
})

describe('块上挂行内结构', () => {
  it('段落同时带 text 与 spans', () => {
    const blocks = parseMarkdown('见 [文档](https://x)')
    expect(blocks[0]).toMatchObject({ kind: 'p', text: '见 文档' })
    expect(blocks[0]).toMatchObject({ spansFor: '见 文档' })
    expect((blocks[0] as { spans?: unknown[] }).spans).toHaveLength(2)
  })

  it('标题也带 spans，目录跳转不受影响', () => {
    const blocks = parseMarkdown('## 看 [这里](https://x)')
    expect(blocks[0]).toMatchObject({ kind: 'h', level: 2, text: '看 这里' })
    expect((blocks[0] as { spans?: unknown[] }).spans).toHaveLength(2)
  })

  it('列表项带 spans', () => {
    const blocks = parseMarkdown('- 看 [这里](https://x)')
    expect(blocks[0]).toMatchObject({ kind: 'li', text: '看 这里' })
    expect((blocks[0] as { spans?: unknown[] }).spans).toHaveLength(2)
  })

  it('引用块带 spans', () => {
    const blocks = parseMarkdown('> 见 [文档](https://x)')
    expect(blocks[0]).toMatchObject({ kind: 'quote', text: '见 文档' })
    expect((blocks[0] as { spans?: unknown[] }).spans).toHaveLength(2)
  })

  it('spansFor 记下生成时的纯文本，翻译改写 text 后能识别出来', () => {
    const blocks = parseMarkdown('见 [文档](https://x)')
    const b = blocks[0] as { text: string; spansFor?: string }
    // 模拟机翻：只换 text，不碰 spans
    const translated = { ...b, text: 'See 文档' }
    expect(translated.text).not.toBe(translated.spansFor)
  })
})

describe('参考式链接', () => {
  it('定义行被收集进 map 并从正文剔除', () => {
    const r = expandLinkRefs('# 标题\n\n[repo]: https://github.com/a/b\n正文')
    expect(r.map.get('repo')).toBe('https://github.com/a/b')
    expect(r.body).not.toContain('[repo]:')
    expect(r.body).toContain('正文')
  })

  it('[文字][ref] 展开成行内链接', () => {
    const md = '了解更多关于[发行渠道][]的信息。\n\n[发行渠道]: https://x/dist'
    const blocks = parseMarkdown(md) as { kind: string; text: string; spans?: { t: string; href?: string }[] }[]
    expect(blocks[0].text).toBe('了解更多关于发行渠道的信息。')
    const link = blocks[0].spans?.find((s) => s.t === 'link')
    expect(link?.href).toBe('https://x/dist')
  })

  it('完整引用 [文字][ref] 与折叠引用 [文字][] 都认', () => {
    const md = '看 [指南][guide] 和 [常见问题][] 吧\n\n[guide]: https://g\n[常见问题]: https://f'
    const blocks = parseMarkdown(md) as { spans?: { t: string; href?: string }[] }[]
    const hrefs = blocks.flatMap((b) => (b.spans ?? []).map((s) => (s as { href?: string }).href))
    expect(hrefs).toContain('https://g')
    expect(hrefs).toContain('https://f')
  })

  it('图片引用 ![alt][ref] 也展开（徽章表格大量使用）', () => {
    const md = '![下载][dl-badge]\n\n[dl-badge]: https://img.shields.io/x'
    const blocks = parseMarkdown(md)
    // 徽章单行 → img 块
    expect(blocks.some((b) => b.kind === 'img')).toBe(true)
  })

  it('快捷引用 [ref] 在已定义时展开，未定义时保留原文', () => {
    const md = '用 [ghx] 构建的任务清单（见任务列表段落）\n\n[ghx]: https://x/ghx'
    const blocks = parseMarkdown(md) as { text: string }[]
    expect(blocks[0].text).toContain('ghx')
    const spans = (blocks[0] as { spans?: { t: string; href?: string }[] }).spans
    expect(spans?.some((s) => s.t === 'link')).toBe(true)
    // 未定义的 [文字] 不动；`- [ ]` 任务列表不因引用展开而消失
    const md2 = '- 任务 [ ] 未完成\n\n[ghx]: https://x'
    const blocks2 = parseMarkdown(md2)
    expect(blocks2.some((b) => b.kind === 'li')).toBe(true)
    const li = blocks2.find((b) => b.kind === 'li') as { text: string }
    expect(li.text).toContain('未完成')
  })

  it('标签大小写与空白不敏感', () => {
    const md = '见 [Docs][  Docs  ] 与 [docs][]\n\n[DOCS]: https://d'
    const blocks = parseMarkdown(md) as { spans?: { t: string; href?: string }[] }[]
    const hrefs = blocks.flatMap((b) => (b.spans ?? []).map((s) => (s as { href?: string }).href))
    expect(hrefs.filter((h) => h === 'https://d')).toHaveLength(2)
  })

  it('围栏代码块里的定义行与引用原样保留', () => {
    const md = '```md\n[link]: https://inside\n正文见 [link]\n```\n\n[link]: https://real'
    const blocks = parseMarkdown(md)
    const code = blocks.find((b) => b.kind === 'code') as { text: string }
    expect(code.text).toContain('[link]: https://inside')
    expect(code.text).toContain('[link]')
    // 正文外的定义行仍然收走
    expect(blocks.every((b) => b.kind === 'code' || b.kind !== 'p' || !((b as { text?: string }).text ?? '').includes('[link]:'))).toBe(true)
  })

  it('LocalSend 那种定义行整段的 README 不再吐一屏 URL', () => {
    const defs = ['[windows store]: https://www.microsoft.com/store/apps/1', '[play store]: https://play.google.com/store/apps/2', '[latest]: https://github.com/a/b/releases/latest'].join('\n')
    const md = `下载渠道见 [windows store][] 与 [play store][]。\n\n${defs}`
    const blocks = parseMarkdown(md)
    const allText = blocks.map((b) => (b.kind === 'p' || b.kind === 'h' ? (b as { text: string }).text : '')).join('')
    expect(allText).not.toContain('[windows store]:')
    expect(allText).not.toContain('https://www.microsoft.com')
    // 链接文字保留
    expect(allText).toContain('windows store')
  })
})

describe('标题锚点', () => {
  it('HTML 标题的显式 id 原样保留 —— 发行说明的双语目录靠它跳', () => {
    const blocks = parseMarkdown('<h2 id="en-v1.3.10">Highlights</h2>')
    const h = blocks.find((b) => b.kind === 'h') as Extract<typeof blocks[number], { kind: 'h' }>
    expect(h.anchor).toBe('en-v1.3.10')
    expect(h.text).toBe('Highlights')
  })

  it('普通 Markdown 标题按 GitHub 规则生成 slug', () => {
    const blocks = parseMarkdown('## Hello World!\n\n### 更新亮点（v1.0）')
    const hs = blocks.filter((b) => b.kind === 'h') as Extract<typeof blocks[number], { kind: 'h' }>[]
    expect(hs[0].anchor).toBe('hello-world')
    expect(hs[1].anchor).toBe('更新亮点v10')
  })

  it('同名标题依次加 -1、-2，不会互相抢锚点', () => {
    const blocks = parseMarkdown('# Notes\n\n## Notes\n\n### Notes')
    const hs = blocks.filter((b) => b.kind === 'h') as Extract<typeof blocks[number], { kind: 'h' }>[]
    expect(hs.map((h) => h.anchor)).toEqual(['notes', 'notes-1', 'notes-2'])
  })

  it('没有显式 id 也没有文字时给个兜底锚点，不产出空 id', () => {
    const blocks = parseMarkdown('<h2 id=""> </h2>\n\n##  ')
    expect(blocks.filter((b) => b.kind === 'h')).toHaveLength(0)
  })
})

describe('裸 URL 链接化（parseInline）', () => {
  it('正文里的 https 地址变成可点的 link span', () => {
    const spans = parseInline('详见 https://github.com/a/b/issues/12 这条')
    const link = spans.find((s) => s.t === 'link')
    expect(link).toMatchObject({ v: 'https://github.com/a/b/issues/12', href: 'https://github.com/a/b/issues/12' })
  })

  it('中文标点不并进地址', () => {
    const spans = parseInline('地址是 https://a.b/c，后面还有字')
    expect(spans.find((s) => s.t === 'link')).toMatchObject({ v: 'https://a.b/c', href: 'https://a.b/c' })
    expect(spans.some((s) => s.t === 'text' && s.v.includes('后面'))).toBe(true)
  })

  it('句尾英文句读不算地址的一部分', () => {
    const spans = parseInline('see https://a.b/c.')
    expect(spans.find((s) => s.t === 'link')).toMatchObject({ v: 'https://a.b/c' })
  })

  it('已经是 Markdown 链接的不再重复切', () => {
    const spans = parseInline('[文档](https://a.b/c)')
    expect(spans.filter((s) => s.t === 'link')).toHaveLength(1)
    expect(spans[0]).toMatchObject({ t: 'link', v: '文档', href: 'https://a.b/c' })
  })

  it('代码片段里的地址保持原样', () => {
    const spans = parseInline('`curl https://a.b/c`')
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ t: 'code' })
  })
})
