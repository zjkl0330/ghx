/**
 * 外观偏好：跟随系统 / 浅色 / 深色。
 *
 * 偏好只存 localStorage，不经过 KV 抽象 —— 因为要用同步读取在首屏渲染前
 * 打上 data-theme，走异步存储会先闪一帧错误的配色。
 * 值在 WebView 里持久保留，卸载 App 才会清。
 */
export type ThemePref = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const KEY = 'ghx.theme'
const DARK_BG = '#0d1117'
const LIGHT_BG = '#ffffff'

export function isThemePref(v: unknown): v is ThemePref {
  return v === 'system' || v === 'light' || v === 'dark'
}

export function readThemePref(): ThemePref {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    return isThemePref(raw) ? raw : 'system'
  } catch {
    return 'system'
  }
}

export function writeThemePref(pref: ThemePref): void {
  try {
    globalThis.localStorage?.setItem(KEY, pref)
  } catch {
    /* 隐私模式下写入失败不影响本次会话 */
  }
}

export function systemTheme(): ResolvedTheme {
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'dark'
  }
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  return pref === 'system' ? systemTheme() : pref
}

/** 把配色写到 <html> 上，CSS 变量随之切换。 */
export function applyTheme(theme: ResolvedTheme): void {
  const root = globalThis.document?.documentElement
  if (!root) return
  root.dataset.theme = theme
  root.style.colorScheme = theme
  const meta = globalThis.document?.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', theme === 'dark' ? DARK_BG : LIGHT_BG)
}

/**
 * 状态栏跟随配色。原生端才生效，Web 调试直接跳过，
 * 动态导入避免把插件塞进首屏 chunk。
 */
export async function syncStatusBar(theme: ResolvedTheme): Promise<void> {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  if (!cap?.isNativePlatform?.()) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light })
    await StatusBar.setBackgroundColor({ color: theme === 'dark' ? DARK_BG : LIGHT_BG })
  } catch {
    /* 插件不可用时交给系统主题，不影响使用 */
  }
}

/** 跟随系统时，系统切换深浅色要实时生效。返回解绑函数。 */
export function watchSystemTheme(onChange: () => void): () => void {
  try {
    const mql = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mql) return () => {}
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  } catch {
    return () => {}
  }
}
