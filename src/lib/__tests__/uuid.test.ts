import { describe, expect, it } from 'vitest'
import { uuidV4 } from '../uuid'

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** 造一个只有 getRandomValues 的 crypto，模拟 Chrome 92 以下的 WebView */
function legacyCrypto(): Crypto {
  return {
    getRandomValues<T extends ArrayBufferView | null>(buf: T): T {
      if (buf && 'length' in buf) {
        const view = buf as unknown as Uint8Array
        for (let i = 0; i < view.length; i += 1) view[i] = Math.floor(Math.random() * 256)
      }
      return buf
    },
  } as Crypto
}

describe('uuidV4', () => {
  it('优先用浏览器自带的 randomUUID', () => {
    const own = '11111111-2222-4333-8444-555555555555'
    const c = { randomUUID: () => own, getRandomValues: legacyCrypto().getRandomValues }
    expect(uuidV4(c as unknown as Crypto)).toBe(own)
  })

  it('WebView 没有 randomUUID 时自己拼，格式仍是合法 v4', () => {
    const out = uuidV4(legacyCrypto())
    expect(out).toMatch(V4)
    // 版本位与变体位必须是 4 / 8-9-a-b，上面正则已经保证，这里再直白断言一次
    expect(out[14]).toBe('4')
    expect(['8', '9', 'a', 'b']).toContain(out[19])
  })

  it('randomUUID 存在但调用抛错（部分 WebView 的 Illegal invocation）也能降级', () => {
    const c = {
      randomUUID: () => {
        throw new TypeError('Illegal invocation')
      },
      getRandomValues: legacyCrypto().getRandomValues,
    }
    expect(uuidV4(c as unknown as Crypto)).toMatch(V4)
  })

  it('连续生成不重复', () => {
    // 同一个 crypto 实例连续调用：序列必须往前走
    const c = legacyCrypto()
    const set = new Set<string>()
    for (let i = 0; i < 200; i += 1) set.add(uuidV4(c))
    expect(set.size).toBe(200)
  })

  it('连 getRandomValues 都没有也不抛', () => {
    expect(() => uuidV4({} as Crypto)).not.toThrow()
    expect(uuidV4({} as Crypto)).toMatch(V4)
  })
})
