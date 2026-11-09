import { afterEach, describe, expect, it, vi } from 'vitest'
import { dismissBoot } from '../boot'

interface FakeBoot {
  dataset: Record<string, string>
  removed: boolean
  addEventListener: (name: string, fn: () => void) => void
  remove: () => void
  fire: (name: string) => void
}

function fakeBoot(): FakeBoot {
  const listeners: Record<string, () => void> = {}
  const el: FakeBoot = {
    dataset: {},
    removed: false,
    addEventListener: (name, fn) => {
      listeners[name] = fn
    },
    remove: () => {
      el.removed = true
    },
    fire: (name) => listeners[name]?.(),
  }
  return el
}

function withDocument(el: FakeBoot | null) {
  vi.stubGlobal('document', { getElementById: () => el })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('dismissBoot', () => {
  it('没有遮罩时静默返回', () => {
    withDocument(null)
    expect(() => dismissBoot()).not.toThrow()
  })

  it('先打 leaving 标记再等过渡结束', () => {
    const el = fakeBoot()
    withDocument(el)
    dismissBoot()
    expect(el.dataset.leaving).toBe('1')
    expect(el.removed).toBe(false)
    el.fire('transitionend')
    expect(el.removed).toBe(true)
  })

  it('重复调用不会叠加监听或提前移除', () => {
    const el = fakeBoot()
    withDocument(el)
    dismissBoot()
    dismissBoot()
    expect(el.dataset.leaving).toBe('1')
    expect(el.removed).toBe(false)
    el.fire('transitionend')
    expect(el.removed).toBe(true)
  })

  it('过渡事件没来也会被超时兜底移走', () => {
    vi.useFakeTimers()
    const el = fakeBoot()
    withDocument(el)
    dismissBoot()
    expect(el.removed).toBe(false)
    vi.advanceTimersByTime(500)
    expect(el.removed).toBe(true)
  })
})
