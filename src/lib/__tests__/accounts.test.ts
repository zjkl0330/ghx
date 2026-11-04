import { describe, expect, it } from 'vitest'
import type { TokenRecord } from '../types'
import {
  accountLabel,
  accountsSummary,
  activeAccount,
  buildAccounts,
  needsAccountReset,
  nextAccount,
  switchMessage,
} from '../accounts'

function rec(patch: Partial<TokenRecord> & { id: string }): TokenRecord {
  return {
    name: '主账号',
    kind: 'classic',
    preview: 'ghp_••••••••abcd',
    createdAt: '2026-01-01T00:00:00Z',
    expiresAt: null,
    scopes: ['repo'],
    login: null,
    lastCheckedAt: null,
    lastStatus: 'ok',
    baseUrl: 'https://api.github.com',
    ...patch,
  }
}

describe('账号标题', () => {
  it('校验过就用 @login，比令牌名更容易认', () => {
    expect(accountLabel({ login: 'zjkl0330', name: '主账号' })).toBe('@zjkl0330')
  })

  it('没校验过退回令牌名', () => {
    expect(accountLabel({ login: null, name: '小号' })).toBe('小号')
  })

  it('两者都空时不留白', () => {
    expect(accountLabel({ login: null, name: '   ' })).toBe('未命名令牌')
    expect(accountLabel({ login: '  ', name: '备胎' })).toBe('备胎')
  })
})

describe('账号列表', () => {
  const a = rec({ id: 'a', login: 'alpha', name: '甲' })
  const b = rec({ id: 'b', login: 'beta', name: '乙' })
  const c = rec({ id: 'c', name: '丙' })

  it('当前账号置顶，其余保持导入顺序', () => {
    const list = buildAccounts([a, b, c], 'b')
    expect(list.map((v) => v.id)).toEqual(['b', 'a', 'c'])
  })

  it('只有一个 active，且落在选中那条上', () => {
    const list = buildAccounts([a, b, c], 'c')
    expect(list.filter((v) => v.active).map((v) => v.id)).toEqual(['c'])
  })

  it('没选中时不乱动顺序', () => {
    expect(buildAccounts([a, b, c], null).map((v) => v.id)).toEqual(['a', 'b', 'c'])
  })

  it('选中 id 不存在（令牌刚被删）时原样返回，不崩', () => {
    expect(buildAccounts([a, b], 'gone').map((v) => v.id)).toEqual(['a', 'b'])
  })

  it('未校验归属的账号标记为 verified=false', () => {
    expect(buildAccounts([a, c], 'a').find((v) => v.id === 'c')?.verified).toBe(false)
  })

  it('activeAccount 取到当前账号，空列表给 null', () => {
    expect(activeAccount([a, b], 'b')?.login).toBe('beta')
    expect(activeAccount([], 'b')).toBeNull()
  })
})

describe('轮换到下一个账号', () => {
  const a = rec({ id: 'a' })
  const b = rec({ id: 'b' })
  const c = rec({ id: 'c' })

  it('按导入顺序往后走', () => {
    expect(nextAccount([a, b, c], 'a')?.id).toBe('b')
  })

  it('最后一个回绕到第一个', () => {
    expect(nextAccount([a, b, c], 'c')?.id).toBe('a')
  })

  it('只有一个账号时没有可切的', () => {
    expect(nextAccount([a], 'a')).toBeNull()
    expect(nextAccount([], null)).toBeNull()
  })

  it('当前 id 不在列表里（刚删掉）时给第一个', () => {
    expect(nextAccount([a, b], 'gone')?.id).toBe('a')
  })
})

describe('切换提示与重置判定', () => {
  it('已校验的账号提示 @login', () => {
    const v = buildAccounts([rec({ id: 'a', login: 'zjkl0330' })], 'a')[0]
    expect(switchMessage(v)).toBe('已切到 @zjkl0330')
  })

  it('未校验的账号提示令牌名并说明没校验', () => {
    const v = buildAccounts([rec({ id: 'a', name: '小号', login: null })], 'a')[0]
    expect(switchMessage(v)).toBe('已切到「小号」，尚未校验归属')
  })

  it('没有账号时也不报错', () => {
    expect(switchMessage(null)).toBe('已切换账号')
  })

  it('只有换到不同 id 才需要重置界面', () => {
    expect(needsAccountReset('a', 'b')).toBe(true)
    expect(needsAccountReset('a', 'a')).toBe(false)
    expect(needsAccountReset(null, 'a')).toBe(true)
  })
})

describe('账号摘要', () => {
  it('空列表有专门文案', () => {
    expect(accountsSummary([], null)).toBe('还没有账号')
  })

  it('单账号只报是谁', () => {
    expect(accountsSummary([rec({ id: 'a', login: 'me' })], 'a')).toBe('当前 @me')
  })

  it('多账号报总数与当前', () => {
    const list = [rec({ id: 'a', login: 'me' }), rec({ id: 'b', login: 'alt' })]
    expect(accountsSummary(list, 'b')).toBe('2 个账号 · 当前 @alt')
  })
})
