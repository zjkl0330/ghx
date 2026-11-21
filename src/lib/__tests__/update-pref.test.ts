import { afterEach, describe, expect, it } from 'vitest'
import {
  UPDATE_HINT_KEY,
  UPDATE_MODE_KEY,
  readUpdateMode,
  updateModeEnabled,
  writeUpdateMode,
} from '../update-pref'

/** node 环境没有 localStorage，按需塞一个假的再拆掉 */
function withStorage(
  seed: Record<string, string> = {},
  opts: { throwGet?: boolean; throwSet?: boolean } = {},
): Map<string, string> {
  const map = new Map(Object.entries(seed))
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => {
        if (opts.throwGet) throw new Error('denied')
        return map.get(k) ?? null
      },
      setItem: (k: string, v: string) => {
        if (opts.throwSet) throw new Error('denied')
        map.set(k, v)
      },
      removeItem: (k: string) => void map.delete(k),
    },
  })
  return map
}

afterEach(() => {
  // @ts-expect-error 测试里临时挂的，用完删掉
  delete globalThis.localStorage
})

describe('更新通道', () => {
  it('默认正式版：没存过就是 stable', () => {
    withStorage()
    expect(readUpdateMode()).toBe('stable')
    expect(updateModeEnabled('stable')).toBe(true)
  })

  it('三档都能存能读，关掉与测试版互不影响', () => {
    const map = withStorage()
    writeUpdateMode('beta')
    expect(map.get(UPDATE_MODE_KEY)).toBe('beta')
    expect(readUpdateMode()).toBe('beta')

    writeUpdateMode('off')
    expect(readUpdateMode()).toBe('off')
    expect(updateModeEnabled('off')).toBe(false)

    writeUpdateMode('stable')
    expect(readUpdateMode()).toBe('stable')
  })

  it('写新键时同步旧键，回退到旧版本不会语义突变', () => {
    const map = withStorage()
    writeUpdateMode('beta')
    expect(map.get(UPDATE_HINT_KEY)).toBe('on')
    writeUpdateMode('off')
    expect(map.get(UPDATE_HINT_KEY)).toBe('off')
  })

  it('老用户只存过旧开关时按它迁移', () => {
    withStorage({ [UPDATE_HINT_KEY]: 'off' })
    expect(readUpdateMode()).toBe('off')

    withStorage({ [UPDATE_HINT_KEY]: 'on' })
    expect(readUpdateMode()).toBe('stable')
  })

  it('新键写坏时退回旧键，再退回默认值', () => {
    withStorage({ [UPDATE_MODE_KEY]: 'sometimes' })
    expect(readUpdateMode()).toBe('stable')

    withStorage({ [UPDATE_MODE_KEY]: 'sometimes', [UPDATE_HINT_KEY]: 'off' })
    expect(readUpdateMode()).toBe('off')
  })

  it('存储不可用时读写都不抛错（隐私模式）', () => {
    withStorage({}, { throwGet: true })
    expect(readUpdateMode()).toBe('stable')

    withStorage({}, { throwSet: true })
    expect(() => writeUpdateMode('beta')).not.toThrow()
  })
})
