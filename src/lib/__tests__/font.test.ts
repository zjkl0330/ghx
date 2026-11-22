import { afterEach, describe, expect, it } from 'vitest'
import { applyFont, isFontPref, readFontPref, writeFontPref } from '../font'

/** node 环境没有 localStorage，按需塞一个假的再拆掉 */
function withStorage(seed: Record<string, string> = {}): void {
  const map = new Map(Object.entries(seed))
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  })
}

afterEach(() => {
  // @ts-expect-error 测试里临时挂的，用完删掉
  delete globalThis.localStorage
})

describe('字体偏好', () => {
  it('只认两档取值', () => {
    expect(isFontPref('sans')).toBe(true)
    expect(isFontPref('system')).toBe(true)
    expect(isFontPref('OPPOSans')).toBe(false)
    expect(isFontPref(null)).toBe(false)
    expect(isFontPref(undefined)).toBe(false)
  })

  it('没存过时默认用内置 OPPO Sans', () => {
    withStorage()
    expect(readFontPref()).toBe('sans')
  })

  it('存了 system 就读回 system', () => {
    withStorage({ 'ghx.font': 'system' })
    expect(readFontPref()).toBe('system')
  })

  it('存了乱值也不算数，回默认', () => {
    withStorage({ 'ghx.font': 'comic-sans' })
    expect(readFontPref()).toBe('sans')
  })

  it('写入后能原样读回', () => {
    withStorage()
    writeFontPref('system')
    expect(readFontPref()).toBe('system')
    writeFontPref('sans')
    expect(readFontPref()).toBe('sans')
  })

  it('没有 localStorage 时读默认、写不抛错', () => {
    // afterEach 之后没有 storage，这里直接在裸环境下调
    expect(readFontPref()).toBe('sans')
    expect(() => writeFontPref('system')).not.toThrow()
  })
})

describe('应用到 DOM', () => {
  it('把选择写到 data-font 上', () => {
    const root: { dataset: Record<string, string> } = { dataset: {} }
    applyFont('system', root)
    expect(root.dataset.font).toBe('system')
    applyFont('sans', root)
    expect(root.dataset.font).toBe('sans')
  })

  it('非法值兜底成 sans', () => {
    const root: { dataset: Record<string, string> } = { dataset: {} }
    // @ts-expect-error 故意传错，验证兜底
    applyFont('serif', root)
    expect(root.dataset.font).toBe('sans')
  })

  it('拿不到根节点时不抛错', () => {
    expect(() => applyFont('system', null)).not.toThrow()
  })

  it('兼容模式下强制系统字体，不加载内置字体', () => {
    const root: { dataset: Record<string, string> } = { dataset: { safe: '1' } }
    applyFont('sans', root)
    expect(root.dataset.font).toBe('system')
  })
})
