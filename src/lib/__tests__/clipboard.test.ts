import { describe, expect, it, vi } from 'vitest'
import { copyWithDeps } from '../clipboard'

describe('剪贴板三通道 copyWithDeps', () => {
  it('原生通道成功就停，不再碰 web 与 exec', async () => {
    const web = vi.fn(async () => {})
    const exec = vi.fn(() => true)
    const r = await copyWithDeps('x', {
      native: async () => {},
      clipboardApi: { writeText: web },
      execCopy: exec,
    })
    expect(r).toMatchObject({ ok: true, via: 'native' })
    expect(web).not.toHaveBeenCalled()
    expect(exec).not.toHaveBeenCalled()
  })

  it('原生报错后落到 navigator.clipboard', async () => {
    const r = await copyWithDeps('x', {
      native: async () => {
        throw new Error('native down')
      },
      clipboardApi: { writeText: async () => {} },
      execCopy: () => true,
    })
    expect(r).toMatchObject({ ok: true, via: 'clipboard' })
  })

  it('华为 WebView 场景：clipboardApi 为 null 时走 execCommand', async () => {
    // 老内核里 navigator.clipboard 整个不存在，以前直接 .writeText 就抛英文红字。
    // 原生插件也被裁掉（真机上它正常，这里故意让它失败）时才轮到最后一条。
    const exec = vi.fn(() => true)
    const r = await copyWithDeps('https://github.com/a/b', {
      native: async () => {
        throw new Error('plugin missing')
      },
      clipboardApi: null,
      execCopy: exec,
    })
    expect(r).toMatchObject({ ok: true, via: 'exec' })
    expect(exec).toHaveBeenCalledWith('https://github.com/a/b')
  })

  it('clipboardApi 存在但没有 writeText，视为不可用', async () => {
    const r = await copyWithDeps('x', { clipboardApi: {}, execCopy: () => true })
    expect(r).toMatchObject({ ok: true, via: 'exec' })
  })

  it('三条全挂：ok=false，error 里三段原因都在', async () => {
    const r = await copyWithDeps('x', {
      native: async () => {
        throw new Error('boom')
      },
      clipboardApi: {
        writeText: async () => {
          throw new Error('NotAllowedError')
        },
      },
      execCopy: () => false,
    })
    expect(r.ok).toBe(false)
    expect(r.via).toBeUndefined()
    expect(r.error).toContain('boom')
    expect(r.error).toContain('NotAllowedError')
    expect(r.error).toContain('exec')
  })

  it('抛出的不是 Error 实例也能记下来', async () => {
    const r = await copyWithDeps('x', {
      native: async () => {
        // 某些 WebView 的 rejection 是字符串
        throw 'denied'
      },
      clipboardApi: null,
      execCopy: () => false,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('denied')
  })

  it('web 端没有 native 时从第二条开始，不报缺通道', async () => {
    const r = await copyWithDeps('x', { clipboardApi: { writeText: async () => {} } })
    expect(r).toMatchObject({ ok: true, via: 'clipboard' })
  })

  it('空串照样走完通道并返回结果', async () => {
    const r = await copyWithDeps('', { native: async () => {} })
    expect(r).toMatchObject({ ok: true, via: 'native' })
  })
})
