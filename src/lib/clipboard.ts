/**
 * 写剪贴板。三条通道依次尝试，任一条成功就停：
 *
 *   1. Capacitor 原生插件 —— Android 里直接走系统 ClipboardManager，
 *      不受 WebView 安全上下文、用户手势、焦点状态影响。华为 EMUI 的
 *      WebView 常把 `navigator.clipboard` 整个裁掉，只有这条路稳。
 *   2. `navigator.clipboard.writeText` —— 桌面浏览器与较新的 WebView。
 *   3. `document.execCommand('copy')` —— 老内核兜底。
 *
 * 三条全挂才返回 false，调用方据此提示「长按手动选择」。
 *
 * 取值前必须先判断类型：内核里 `navigator.clipboard` 是 undefined 时，
 * 直接 `.writeText` 会抛 `Cannot read properties of undefined`，
 * 那串英文以前会原样砸到界面上。
 */
import { Capacitor } from '@capacitor/core'
import { Clipboard } from '@capacitor/clipboard'

export type CopyChannel = 'native' | 'clipboard' | 'exec'

export interface CopyDeps {
  /** 原生写剪贴板；web 端不传 */
  native?: (text: string) => Promise<void>
  /** `navigator.clipboard`，可能为 null（老内核） */
  clipboardApi?: { writeText?: (text: string) => Promise<void> } | null
  /** execCommand 兜底，返回是否成功 */
  execCopy?: (text: string) => boolean
}

export interface CopyResult {
  ok: boolean
  via?: CopyChannel
  /** 全挂时三条通道各自的失败原因，只用于排查，不直接展示 */
  error?: string
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** 纯逻辑，注入依赖以便单测；真实环境见 copyTextResult */
export async function copyWithDeps(text: string, deps: CopyDeps): Promise<CopyResult> {
  const failures: string[] = []

  if (deps.native) {
    try {
      await deps.native(text)
      return { ok: true, via: 'native' }
    } catch (err) {
      failures.push(`native: ${reason(err)}`)
    }
  }

  const api = deps.clipboardApi
  if (api && typeof api.writeText === 'function') {
    try {
      await api.writeText(text)
      return { ok: true, via: 'clipboard' }
    } catch (err) {
      failures.push(`clipboard: ${reason(err)}`)
    }
  } else {
    failures.push('clipboard: 接口不存在')
  }

  if (deps.execCopy) {
    try {
      if (deps.execCopy(text)) return { ok: true, via: 'exec' }
      failures.push('exec: 返回 false')
    } catch (err) {
      failures.push(`exec: ${reason(err)}`)
    }
  } else {
    failures.push('exec: 接口不存在')
  }

  return { ok: false, error: failures.join(' / ') }
}

/**
 * 老内核兜底：塞一个不可见的 textarea、选中、execCommand。
 * `focus()` 不能省 —— 华为 WebView 上不 focus 时选区是空的，复制出来是空串。
 */
export function execCopy(text: string): boolean {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.setAttribute('aria-hidden', 'true')
  ta.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;outline:0;opacity:0;'
  document.body.appendChild(ta)
  try {
    ta.focus({ preventScroll: true })
    ta.select()
    ta.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(ta)
  }
}

/** 取 navigator.clipboard，某些内核在非安全上下文下访问这个 getter 会直接抛 */
function readClipboardApi(): CopyDeps['clipboardApi'] {
  try {
    if (typeof navigator === 'undefined') return null
    return navigator.clipboard ?? null
  } catch {
    return null
  }
}

/** 写剪贴板，附带用了哪条通道，方便排查「为什么它能复制我不能」 */
export async function copyTextResult(text: string): Promise<CopyResult> {
  return copyWithDeps(text, {
    native: Capacitor.isNativePlatform() ? (t) => Clipboard.write({ string: t }) : undefined,
    clipboardApi: readClipboardApi(),
    execCopy: typeof document === 'undefined' ? undefined : execCopy,
  })
}

/** 写剪贴板；三条通道都失败才返回 false */
export async function copyText(text: string): Promise<boolean> {
  return (await copyTextResult(text)).ok
}
