import { describe, expect, it } from 'vitest'
import { DEFAULT_TABS, TAB_DEFS, fallbackTab, normalizeTabs, toggleTab, type TabKey } from '../tabs'

describe('底栏配置归一化', () => {
  it('没存过时用默认三项', () => {
    expect(normalizeTabs(null)).toEqual(DEFAULT_TABS)
    expect(DEFAULT_TABS).toEqual(['repos', 'stars', 'hot'])
  })

  it('按固定顺序排列，不看存储顺序', () => {
    expect(normalizeTabs(JSON.stringify(['hot', 'repos']))).toEqual(['repos', 'hot'])
  })

  it('去掉未知项与重复项', () => {
    expect(normalizeTabs(JSON.stringify(['repos', 'repos', 'tokens', 3]))).toEqual(['repos'])
  })

  it('坏 JSON 或空数组回落到默认', () => {
    expect(normalizeTabs('{oops')).toEqual(DEFAULT_TABS)
    expect(normalizeTabs('[]')).toEqual(DEFAULT_TABS)
  })
})

describe('勾选与取消', () => {
  it('取消一个已显示的页签', () => {
    expect(toggleTab(['repos', 'stars', 'hot'], 'hot')).toEqual(['repos', 'stars'])
  })

  it('加上流水线时按固定顺序插入', () => {
    expect(toggleTab(['repos', 'hot'], 'pipelines')).toEqual(['repos', 'hot', 'pipelines'])
  })

  it('不许把最后一个也取消，否则底栏就空了', () => {
    expect(toggleTab(['repos'], 'repos')).toEqual(['repos'])
  })

  it('选项覆盖所有底栏入口', () => {
    expect(TAB_DEFS.map((t) => t.key)).toEqual(['repos', 'stars', 'hot', 'pipelines'])
  })
})

describe('当前页签被隐藏时的兜底', () => {
  it('仍在列表里就不动', () => {
    expect(fallbackTab(['repos', 'hot'], 'hot')).toBe('hot')
  })

  it('被隐藏时退到第一个可见项', () => {
    expect(fallbackTab(['stars', 'hot'], 'repos' as TabKey)).toBe('stars')
  })

  it('只剩流水线时也不把二级页面当底栏页签', () => {
    expect(fallbackTab(['pipelines'], 'pipelines' as TabKey)).toBe('repos')
    expect(fallbackTab(['pipelines', 'hot'], 'repos' as TabKey)).toBe('hot')
  })
})
