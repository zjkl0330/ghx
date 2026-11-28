import { describe, expect, it } from 'vitest'
import { clearRevealPass, checkRevealPass, hasRevealPass, REVEAL_KEY, setRevealPass } from '../reveal'
import { memoryKV } from '../storage'

describe('主密钥查看密码', () => {
  it('设置后能校验通过，错误密码不通过', async () => {
    const kv = memoryKV()
    await setRevealPass(kv, 'view-1234')
    expect(await hasRevealPass(kv)).toBe(true)
    expect(await checkRevealPass(kv, 'view-1234')).toBe(true)
    expect(await checkRevealPass(kv, 'view-12345')).toBe(false)
    expect(await checkRevealPass(kv, '')).toBe(false)
  })

  it('落盘的是盐与哈希，不含明文密码', async () => {
    const kv = memoryKV()
    await setRevealPass(kv, 'plain-text-pass')
    const raw = (await kv.get(REVEAL_KEY)) as string
    expect(raw).not.toContain('plain-text-pass')
    const o = JSON.parse(raw)
    expect(o.v).toBe(1)
    expect(o.hash.length).toBeGreaterThan(20)
  })

  it('短于 6 位直接拒绝', async () => {
    const kv = memoryKV()
    await expect(setRevealPass(kv, '12345')).rejects.toThrow('至少')
    expect(await hasRevealPass(kv)).toBe(false)
  })

  it('清除之后回到未设置状态', async () => {
    const kv = memoryKV()
    await setRevealPass(kv, 'view-1234')
    await clearRevealPass(kv)
    expect(await hasRevealPass(kv)).toBe(false)
    expect(await checkRevealPass(kv, 'view-1234')).toBe(false)
  })

  it('存储坏掉时按未设置处理，不抛异常', async () => {
    const kv = memoryKV({ [REVEAL_KEY]: '{broken' })
    expect(await hasRevealPass(kv)).toBe(false)
    expect(await checkRevealPass(kv, 'whatever')).toBe(false)
  })
})
