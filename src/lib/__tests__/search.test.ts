import { describe, expect, it } from 'vitest'
import {
  emptySearchHint,
  hasKeyword,
  normalizeSearchSort,
  repoSearchQuery,
  SEARCH_SORTS,
} from '../search'

describe('搜索查询串', () => {
  it('只有关键词时原样保留', () => {
    expect(repoSearchQuery('docker')).toBe('docker')
  })

  it('语言加引号，C++ / C# 才不会解析失败', () => {
    expect(repoSearchQuery('cli', { language: 'C++' })).toBe('cli language:"C++"')
  })

  it('可以叠最低 star 过滤', () => {
    expect(repoSearchQuery('agent', { language: 'Python', minStars: 100 })).toBe(
      'agent language:"Python" stars:>=100',
    )
  })

  it('限定符不被包引号，topic: / user: 仍然生效', () => {
    expect(repoSearchQuery('topic:esp32 user:zjkl')).toBe('topic:esp32 user:zjkl')
  })

  it('关键词为空时只剩筛选条件，不会多出空格', () => {
    expect(repoSearchQuery('   ', { language: 'Go' })).toBe('language:"Go"')
  })

  it('什么都为空时返回空串', () => {
    expect(repoSearchQuery('')).toBe('')
  })
})

describe('排序方式', () => {
  it('三种排序都在选项里', () => {
    expect(SEARCH_SORTS.map((s) => s.key)).toEqual(['best', 'stars', 'updated'])
  })

  it('脏数据回落到最佳匹配', () => {
    expect(normalizeSearchSort(null)).toBe('best')
    expect(normalizeSearchSort('STARS')).toBe('stars')
    expect(normalizeSearchSort('random')).toBe('best')
  })
})

describe('空结果提示', () => {
  it('空白关键词不当作搜索', () => {
    expect(hasKeyword('  \n ')).toBe(false)
  })

  it('带语言筛选时提示去掉语言', () => {
    expect(emptySearchHint('esp32', 'Rust')).toContain('Rust')
  })

  it('没有语言筛选时只提示换关键词', () => {
    expect(emptySearchHint('esp32', null)).toContain('esp32')
  })
})
