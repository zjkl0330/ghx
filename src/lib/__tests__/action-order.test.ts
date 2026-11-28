import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ACTION_ORDER,
  DETAIL_ACTIONS,
  moveAction,
  normalizeActionOrder,
  parseActionOrder,
  serializeActionOrder,
} from '../action-order'

describe('操作顺序解析', () => {
  it('没有存过就用默认顺序', () => {
    expect(parseActionOrder(null)).toEqual(DEFAULT_ACTION_ORDER)
    expect(parseActionOrder('')).toEqual(DEFAULT_ACTION_ORDER)
    expect(parseActionOrder('不是 JSON')).toEqual(DEFAULT_ACTION_ORDER)
  })

  it('未知 id 丢掉、重复的只留一次、缺的补在末尾', () => {
    const got = normalizeActionOrder(['zip', 'star', 'zip', '不存在的操作'])
    expect(got.slice(0, 2)).toEqual(['zip', 'star'])
    // 12 个一个不少，且没重复
    expect(got).toHaveLength(DETAIL_ACTIONS.length)
    expect(new Set(got).size).toBe(DETAIL_ACTIONS.length)
    expect(got).toContain('delete')
  })

  it('不是数组时整份退回默认，不崩', () => {
    expect(normalizeActionOrder({ a: 1 })).toEqual(DEFAULT_ACTION_ORDER)
    expect(normalizeActionOrder('zip')).toEqual(DEFAULT_ACTION_ORDER)
  })

  it('序列化再读回保持用户顺序', () => {
    const custom = normalizeActionOrder(['zip', 'star', 'delete'])
    expect(parseActionOrder(serializeActionOrder(custom))).toEqual(custom)
  })
})

describe('上下移动', () => {
  it('上移一格', () => {
    const order = normalizeActionOrder(['star', 'edit', 'archive'])
    expect(moveAction(order, 'edit', -1).slice(0, 3)).toEqual(['edit', 'star', 'archive'])
  })

  it('下移一格', () => {
    const order = normalizeActionOrder(['star', 'edit', 'archive'])
    expect(moveAction(order, 'edit', 1).slice(0, 3)).toEqual(['star', 'archive', 'edit'])
  })

  it('到顶再上移、到底再下移都原样返回', () => {
    const order = normalizeActionOrder(['star', 'edit'])
    expect(moveAction(order, 'star', -1)).toBe(order)
    expect(moveAction(order, 'delete', 1)).toBe(order)
  })

  it('id 不存在时原样返回', () => {
    const order = [...DEFAULT_ACTION_ORDER]
    expect(moveAction(order, '不存在的操作' as never, 1)).toBe(order)
  })
})
