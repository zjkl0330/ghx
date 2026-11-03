import { describe, expect, it } from 'vitest'
import { isThemePref, resolveTheme } from '../theme'

describe('外观偏好', () => {
  it('手动指定时不依赖系统', () => {
    expect(resolveTheme('light')).toBe('light')
    expect(resolveTheme('dark')).toBe('dark')
  })

  it('只接受三档取值', () => {
    expect(isThemePref('system')).toBe(true)
    expect(isThemePref('light')).toBe(true)
    expect(isThemePref('dark')).toBe(true)
    expect(isThemePref('auto')).toBe(false)
    expect(isThemePref(null)).toBe(false)
  })

  it('没有 document 时应用配色不抛错', async () => {
    const { applyTheme } = await import('../theme')
    expect(() => applyTheme('light')).not.toThrow()
  })
})
