import { describe, expect, it } from 'vitest'
import { memoryKV } from '../storage'
import {
  SNAPSHOT_MAX_AGE,
  clearSnapshot,
  loadSnapshot,
  saveSnapshot,
  snapshotAge,
  snapshotKey,
} from '../snapshot'

describe('冷启动快照', () => {
  it('存进去能原样读出来', async () => {
    const kv = memoryKV()
    await saveSnapshot(kv, 'repos', 't1', [{ name: 'a' }], 1000)
    const got = await loadSnapshot<{ name: string }[]>(kv, 'repos', 't1', 2000)
    expect(got?.data).toEqual([{ name: 'a' }])
    expect(got?.at).toBe(1000)
  })

  it('没有快照返回 null', async () => {
    const kv = memoryKV()
    expect(await loadSnapshot(kv, 'repos', 't1')).toBeNull()
  })

  it('换了令牌读不到别人的快照', async () => {
    const kv = memoryKV()
    await saveSnapshot(kv, 'repos', 't1', [1], 1000)
    expect(await loadSnapshot(kv, 'repos', 't2', 2000)).toBeNull()
  })

  it('同一个令牌不同种类互不干扰', async () => {
    const kv = memoryKV()
    await saveSnapshot(kv, 'repos', 't1', ['r'], 1000)
    await saveSnapshot(kv, 'stars', 't1', ['s'], 1000)
    expect((await loadSnapshot<string[]>(kv, 'repos', 't1', 2000))?.data).toEqual(['r'])
    expect((await loadSnapshot<string[]>(kv, 'stars', 't1', 2000))?.data).toEqual(['s'])
  })

  it('超过保留时长就丢弃', async () => {
    const kv = memoryKV()
    await saveSnapshot(kv, 'repos', 't1', [1], 1000)
    expect(await loadSnapshot(kv, 'repos', 't1', 1000 + SNAPSHOT_MAX_AGE + 1)).toBeNull()
  })

  it('边界上刚好到期仍可用', async () => {
    const kv = memoryKV()
    await saveSnapshot(kv, 'repos', 't1', [1], 1000)
    expect(await loadSnapshot(kv, 'repos', 't1', 1000 + SNAPSHOT_MAX_AGE)).not.toBeNull()
  })

  it('内容损坏不会抛错', async () => {
    const kv = memoryKV({ [snapshotKey('repos', 't1')]: '{不是 json' })
    expect(await loadSnapshot(kv, 'repos', 't1')).toBeNull()
  })

  it('写入时间在未来说明时钟被改过，不采信', async () => {
    const kv = memoryKV()
    await saveSnapshot(kv, 'repos', 't1', [1], 1000)
    // 当前时间比写入还早两分钟
    expect(await loadSnapshot(kv, 'repos', 't1', 1000 - 120_000)).toBeNull()
  })

  it('清除后读不到', async () => {
    const kv = memoryKV()
    await saveSnapshot(kv, 'repos', 't1', [1], 1000)
    await clearSnapshot(kv, 'repos', 't1')
    expect(await loadSnapshot(kv, 'repos', 't1', 2000)).toBeNull()
  })

  it('存储抛错时静默返回 false', async () => {
    const kv = memoryKV()
    const broken = { ...kv, set: async () => { throw new Error('quota') } }
    expect(await saveSnapshot(broken, 'repos', 't1', [1])).toBe(false)
  })

  it('年龄文案按区间变化', () => {
    const now = 10_000_000_000
    expect(snapshotAge(now - 30_000, now)).toBe('刚刚')
    expect(snapshotAge(now - 5 * 60_000, now)).toBe('5 分钟前')
    expect(snapshotAge(now - 3 * 3600_000, now)).toBe('3 小时前')
    expect(snapshotAge(now - 2 * 86400_000, now)).toBe('2 天前')
  })
})
