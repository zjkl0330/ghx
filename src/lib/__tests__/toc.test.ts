import { describe, expect, it } from 'vitest'
import { activeHeading, anchorIndexOf, buildToc, slugOf, tocAnchor, tocIndent } from '../toc'
import type { Block } from '../markdown'

const h = (level: number, text: string): Block => ({ kind: 'h', level, text })
const p = (text: string): Block => ({ kind: 'p', text })

describe('自述目录抽取', () => {
  it('只收标题块，段落与代码不进来', () => {
    const blocks: Block[] = [
      h(1, '项目名'),
      p('一句话介绍'),
      h(2, '安装'),
      { kind: 'code', text: 'pnpm i', lang: 'sh' },
      h(2, '用法'),
      h(2, '许可'),
    ]
    const toc = buildToc(blocks)
    expect(toc.map((t) => t.text)).toEqual(['项目名', '安装', '用法', '许可'])
    // index 指向原始块下标，跳转靠它
    expect(toc.map((t) => t.index)).toEqual([0, 2, 4, 5])
  })

  it('标题太少就不给目录', () => {
    expect(buildToc([h(1, 'A'), h(2, 'B')])).toEqual([])
    expect(buildToc([h(1, 'A'), h(2, 'B'), h(2, 'C')])).toHaveLength(3)
  })

  it('从 ## 起跳时按最小级别归一化，不会整排缩进一格', () => {
    const toc = buildToc([h(2, 'A'), h(2, 'B'), h(3, 'C'), h(2, 'D')])
    expect(toc.map((t) => t.depth)).toEqual([0, 0, 1, 0])
  })

  it('4 级以上默认丢掉，但可以放宽', () => {
    const blocks: Block[] = [h(1, 'A'), h(2, 'B'), h(2, 'C'), h(4, '细节')]
    expect(buildToc(blocks).map((t) => t.text)).toEqual(['A', 'B', 'C'])
    expect(buildToc(blocks, { maxLevel: 4, minItems: 1 }).map((t) => t.text)).toEqual([
      'A',
      'B',
      'C',
      '细节',
    ])
  })

  it('空标题与纯空白标题不进目录', () => {
    const toc = buildToc([h(1, 'A'), h(2, '   '), h(2, ''), h(2, 'B'), h(2, 'C')])
    expect(toc.map((t) => t.text)).toEqual(['A', 'B', 'C'])
  })

  it('条目过多时截断，防止畸形文档撑爆目录', () => {
    const blocks: Block[] = Array.from({ length: 60 }, (_, i) => h(2, `第 ${i} 节`))
    const toc = buildToc(blocks)
    expect(toc).toHaveLength(40)
    expect(toc[39].text).toBe('第 39 节')
  })

  it('全部是空标题时返回空数组而不是崩', () => {
    expect(buildToc([p('只有文字'), h(2, '')])).toEqual([])
    expect(buildToc([])).toEqual([])
  })
})

describe('目录锚点与缩进', () => {
  it('锚点用块下标，同名标题也不会撞', () => {
    const blocks: Block[] = [h(2, '修复'), p('x'), h(2, '修复'), p('y'), h(2, '修复')]
    const toc = buildToc(blocks)
    const ids = toc.map((t) => tocAnchor(t.index))
    expect(new Set(ids).size).toBe(3)
  })

  it('缩进最多两级，再深就不缩了', () => {
    expect(tocIndent(0)).toBe(0)
    expect(tocIndent(1)).toBe(8)
    expect(tocIndent(2)).toBe(16)
    expect(tocIndent(5)).toBe(16)
    expect(tocIndent(-1)).toBe(0)
  })
})

describe('滚动时高亮哪一节', () => {
  const offsets = [0, 320, 900, 1500]

  it('顶部时高亮第一项', () => {
    expect(activeHeading(offsets, 0)).toBe(0)
    expect(activeHeading(offsets, 100)).toBe(0)
  })

  it('越过某个标题就高亮它', () => {
    expect(activeHeading(offsets, 320)).toBe(1)
    // 留白 24px：标题还差 25px 到顶时仍算上一节，差 24px 就切过去
    expect(activeHeading(offsets, 875)).toBe(1)
    expect(activeHeading(offsets, 876)).toBe(2)
    expect(activeHeading(offsets, 901)).toBe(2)
    expect(activeHeading(offsets, 99999)).toBe(3)
  })

  it('留白可调，负值也能算', () => {
    expect(activeHeading(offsets, 310, 0)).toBe(0)
    expect(activeHeading(offsets, 310, 24)).toBe(1)
    expect(activeHeading([], 100)).toBe(-1)
  })
})

describe('标题 slug', () => {
  it('小写并把空白换成连字符', () => {
    expect(slugOf('Getting Started')).toBe('getting-started')
  })

  it('去掉标点', () => {
    expect(slugOf('Q&A: 怎么用？')).toBe('qa-怎么用')
  })

  it('中文原样保留', () => {
    expect(slugOf('安装说明')).toBe('安装说明')
  })
})

describe('锚点反查块下标', () => {
  const blocks: Block[] = [h(1, '安装说明'), p('正文'), h(2, 'Getting Started'), h(2, '修复')]

  it('按标题文字找到对应块', () => {
    expect(anchorIndexOf(blocks, '安装说明')).toBe(0)
    expect(anchorIndexOf(blocks, '#getting-started')).toBe(2)
  })

  it('带 # 前缀也认', () => {
    expect(anchorIndexOf(blocks, '#修复')).toBe(3)
  })

  it('百分号编码的锚点能解回来', () => {
    expect(anchorIndexOf(blocks, '%E4%BF%AE%E5%A4%8D')).toBe(3)
  })

  it('找不到返回 null', () => {
    expect(anchorIndexOf(blocks, '不存在的节')).toBeNull()
    expect(anchorIndexOf(blocks, '')).toBeNull()
    expect(anchorIndexOf(blocks, '#')).toBeNull()
  })

  it('同名标题按出现顺序编号，与 GitHub 一致', () => {
    const dup: Block[] = [h(2, '修复'), h(2, '修复'), h(2, '修复')]
    expect(anchorIndexOf(dup, '修复')).toBe(0)
    expect(anchorIndexOf(dup, '修复-1')).toBe(1)
    expect(anchorIndexOf(dup, '修复-2')).toBe(2)
  })

  it('忽略大小写', () => {
    expect(anchorIndexOf(blocks, 'GETTING-STARTED')).toBe(2)
  })
})
