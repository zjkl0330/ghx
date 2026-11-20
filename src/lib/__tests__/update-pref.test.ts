import { afterEach, describe, expect, it } from 'vitest'
import { UPDATE_HINT_KEY, readUpdateHint, writeUpdateHint } from '../update-pref'

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

describe('更新提示开关', () => {
  it('默认开启：没存过就是 on', () => {
    withStorage()
    expect(readUpdateHint()).toBe(true)
  })

  it('关掉后读回来是 false，再打开又变 true', () => {
    const map = withStorage()
    writeUpdateHint(false)
    expect(map.get(UPDATE_HINT_KEY)).toBe('off')
    expect(readUpdateHint()).toBe(false)

    writeUpdateHint(true)
    expect(map.get(UPDATE_HINT_KEY)).toBe('on')
    expect(readUpdateHint()).toBe(true)
  })

  it('值被写坏也不当关闭处理，退回默认开启', () => {
    withStorage({ [UPDATE_HINT_KEY]: 'yes-please' })
    expect(readUpdateHint()).toBe(true)
  })

  it('存储不可用时读写都不抛错（隐私模式）', () => {
    withStorage({}, { throwGet: true })
    expect(readUpdateHint()).toBe(true)

    withStorage({}, { throwSet: true })
    expect(() => writeUpdateHint(false)).not.toThrow()
  })
})
