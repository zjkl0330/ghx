import { describe, expect, it } from 'vitest'
import { canManageVisibility, classifyExpiry, daysUntil, riskyScopes } from '../tokens'

const DAY = 86_400_000
const NOW = Date.parse('2026-11-02T00:00:00Z')

describe('daysUntil', () => {
  it('无过期时间返回 null', () => {
    expect(daysUntil(null, NOW)).toBeNull()
  })
  it('向上取整剩余天数', () => {
    expect(daysUntil(new Date(NOW + 4.2 * DAY).toISOString(), NOW)).toBe(5)
  })
  it('非法日期返回 null', () => {
    expect(daysUntil('not-a-date', NOW)).toBeNull()
  })
})

describe('classifyExpiry', () => {
  it('无期限视为 ok', () => {
    expect(classifyExpiry(null, NOW)).toBe('ok')
  })
  it('已过期', () => {
    expect(classifyExpiry(new Date(NOW - DAY).toISOString(), NOW)).toBe('expired')
  })
  it('7 天内为 expiring', () => {
    expect(classifyExpiry(new Date(NOW + 3 * DAY).toISOString(), NOW)).toBe('expiring')
  })
  it('恰好 7 天仍是 expiring', () => {
    expect(classifyExpiry(new Date(NOW + 7 * DAY).toISOString(), NOW)).toBe('expiring')
  })
  it('8 天以上为 ok', () => {
    expect(classifyExpiry(new Date(NOW + 20 * DAY).toISOString(), NOW)).toBe('ok')
  })
})

describe('riskyScopes', () => {
  it('挑出破坏性 scope', () => {
    expect(riskyScopes(['repo', 'admin:org', 'delete_repo', 'workflow'])).toEqual(['admin:org', 'delete_repo'])
  })
  it('普通 scope 不误报', () => {
    expect(riskyScopes(['repo', 'read:user'])).toEqual([])
  })
})

describe('canManageVisibility', () => {
  it('classic 无 repo scope 时判定不可用', () => {
    expect(canManageVisibility(['read:user'], 'classic')).toBe(false)
  })
  it('classic 带 repo 可用', () => {
    expect(canManageVisibility(['repo'], 'classic')).toBe(true)
  })
  it('fine-grained 交给接口判定', () => {
    expect(canManageVisibility([], 'fine-grained')).toBe(true)
  })
})
