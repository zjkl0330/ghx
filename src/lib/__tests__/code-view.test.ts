import { describe, expect, it } from 'vitest'
import {
  CODE_PREFS_KEY,
  DEFAULT_CODE_PREFS,
  blobUrl,
  fileStats,
  findHits,
  groupHitsByLine,
  parseCodePrefs,
  serializeCodePrefs,
  splitHighlight,
  stepCodeSize,
  stepHit,
} from '../code-view'

describe('阅读偏好', () => {
  it('没有落盘值时用默认', () => {
    expect(parseCodePrefs(null)).toEqual(DEFAULT_CODE_PREFS)
    expect(parseCodePrefs(undefined)).toEqual(DEFAULT_CODE_PREFS)
  })

  it('坏 JSON 不抛错，退回默认', () => {
    expect(parseCodePrefs('{oops')).toEqual(DEFAULT_CODE_PREFS)
    expect(parseCodePrefs('null')).toEqual(DEFAULT_CODE_PREFS)
  })

  it('非法字号被挡掉，合法值保留', () => {
    expect(parseCodePrefs('{"size":99,"wrap":true}')).toEqual({ size: 13, wrap: true })
    expect(parseCodePrefs('{"size":15,"wrap":true}')).toEqual({ size: 15, wrap: true })
  })

  it('wrap 只认 true，字符串 "true" 不算', () => {
    expect(parseCodePrefs('{"size":12,"wrap":"true"}').wrap).toBe(false)
  })

  it('序列化后能原样读回', () => {
    const p = { size: 15 as const, wrap: true }
    expect(parseCodePrefs(serializeCodePrefs(p))).toEqual(p)
  })

  it('字号进退到边界就停住', () => {
    expect(stepCodeSize(12, 1)).toBe(13)
    expect(stepCodeSize(13, 1)).toBe(15)
    expect(stepCodeSize(15, 1)).toBe(15)
    expect(stepCodeSize(15, -1)).toBe(13)
    expect(stepCodeSize(12, -1)).toBe(12)
  })

  it('键名固定，换名字会让老用户的偏好丢失', () => {
    expect(CODE_PREFS_KEY).toBe('ghx.codeview')
  })
})

describe('文件内查找', () => {
  const lines = ['const a = 1', 'function hello() {', '  return "hello world"', '}']

  it('逐行给出命中位置', () => {
    const hits = findHits(lines, 'hello')
    expect(hits).toEqual([
      { line: 1, start: 9, len: 5 },
      { line: 2, start: 10, len: 5 },
    ])
  })

  it('大小写不敏感', () => {
    expect(findHits(lines, 'RETURN')).toEqual([{ line: 2, start: 2, len: 6 }])
  })

  it('空 query 与纯空白不匹配任何东西', () => {
    expect(findHits(lines, '')).toEqual([])
    expect(findHits(lines, '   ')).toEqual([])
  })

  it('首尾空白会被裁掉，不让误输空格毁掉查询', () => {
    expect(findHits(lines, '  hello  ')).toEqual(findHits(lines, 'hello'))
  })

  it('同一行多次命中都返回', () => {
    const hits = findHits(['ab ab ab'], 'ab')
    expect(hits.map((h) => h.start)).toEqual([0, 3, 6])
  })

  it('允许重叠命中', () => {
    expect(findHits(['aaa'], 'aa').map((h) => h.start)).toEqual([0, 1])
  })

  it('超过上限就截断，不留半截结果', () => {
    const many = Array.from({ length: 40 }, () => 'x')
    expect(findHits(many, 'x', 10)).toHaveLength(10)
  })

  it('找不到时返回空数组而不是 undefined', () => {
    expect(findHits(lines, 'zzz')).toEqual([])
  })

  it('按行分桶供渲染用', () => {
    const map = groupHitsByLine(findHits(['ab ab', 'ab'], 'ab'))
    expect(map.get(0)?.length).toBe(2)
    expect(map.get(1)?.length).toBe(1)
    expect(map.size).toBe(2)
  })
})

describe('命中高亮切分', () => {
  it('无命中时整行原样返回', () => {
    expect(splitHighlight('abc', [])).toEqual([{ text: 'abc', hit: false }])
  })

  it('行内单处命中切成三段', () => {
    expect(splitHighlight('hello world', [{ line: 0, start: 6, len: 5 }])).toEqual([
      { text: 'hello ', hit: false },
      { text: 'world', hit: true },
    ])
  })

  it('行首命中不留空段', () => {
    expect(splitHighlight('abc', [{ line: 0, start: 0, len: 2 }])).toEqual([
      { text: 'ab', hit: true },
      { text: 'c', hit: false },
    ])
  })

  it('多处命中按列顺序切开', () => {
    expect(splitHighlight('a-b-c', [
      { line: 0, start: 0, len: 1 },
      { line: 0, start: 2, len: 1 },
    ])).toEqual([
      { text: 'a', hit: true },
      { text: '-', hit: false },
      { text: 'b', hit: true },
      { text: '-c', hit: false },
    ])
  })

  it('重叠的命中只保留先到的那条，不产生错位', () => {
    expect(splitHighlight('aaa', [
      { line: 0, start: 0, len: 2 },
      { line: 0, start: 1, len: 2 },
    ])).toEqual([
      { text: 'aa', hit: true },
      { text: 'a', hit: false },
    ])
  })

  it('命中贴到行尾时不追加空段', () => {
    expect(splitHighlight('ab', [{ line: 0, start: 0, len: 2 }])).toEqual([{ text: 'ab', hit: true }])
  })
})

describe('上一处 / 下一处', () => {
  it('在范围内循环', () => {
    expect(stepHit(0, 3, 1)).toBe(1)
    expect(stepHit(2, 3, 1)).toBe(0)
    expect(stepHit(0, 3, -1)).toBe(2)
  })

  it('还没定位时（index -1）从第一处开始往前 / 从最后一处往回', () => {
    expect(stepHit(-1, 3, 1)).toBe(0)
    expect(stepHit(-1, 3, -1)).toBe(2)
  })

  it('没有命中时稳定返回 0，不产生 NaN', () => {
    expect(stepHit(0, 0, 1)).toBe(0)
    expect(stepHit(-1, 0, -1)).toBe(0)
  })
})

describe('链接与统计', () => {
  it('有 html_url 就直接用', () => {
    expect(blobUrl('a', 'b', 'main', 'x.ts', 'https://github.com/a/b/blob/main/x.ts')).toBe(
      'https://github.com/a/b/blob/main/x.ts',
    )
  })

  it('没有 ref 时用 HEAD，不猜 main（master 仓库会 404）', () => {
    expect(blobUrl('a', 'b', undefined, 'x.ts')).toBe('https://github.com/a/b/blob/HEAD/x.ts')
  })

  it('中文与空格路径要编码', () => {
    expect(blobUrl('a', 'b', 'main', '文档/说明 文件.md')).toBe(
      'https://github.com/a/b/blob/main/%E6%96%87%E6%A1%A3/%E8%AF%B4%E6%98%8E%20%E6%96%87%E4%BB%B6.md',
    )
  })

  it('行数与字符数按实际文本算', () => {
    expect(fileStats('a\nb\nc')).toEqual({ lines: 3, chars: 5 })
    expect(fileStats('')).toEqual({ lines: 0, chars: 0 })
  })
})
