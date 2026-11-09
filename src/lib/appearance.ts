/**
 * 外观偏好：强调色、底栏形态、底栏文字、背景、玻璃厚度、动效。
 *
 * 和主题一样只存 localStorage，用同步读取在首屏渲染前把 data-* 打到 <html> 上，
 * 走异步存储会先闪一帧默认外观。值在 WebView 里持久保留，卸载 App 才会清。
 *
 * 这里只负责「选择」和「写到 DOM」，具体颜色与布局全在 theme.css 里按
 * `[data-accent]` / `[data-tabbar]` 等选择器展开 —— 不要在 JS 里拼内联样式，
 * 否则首屏内联脚本和运行时两套逻辑会漂移。
 */
export const APPEARANCE_KEY = 'ghx.appearance'

export type AccentKey = 'blue' | 'violet' | 'teal' | 'green' | 'amber' | 'rose'
export type TabbarShape = 'float' | 'dock'
export type TabLabelMode = 'both' | 'icon'
export type BgMood = 'plain' | 'glow'
export type GlassLevel = 'clear' | 'normal' | 'thick'
export type MotionLevel = 'full' | 'calm'

export interface Appearance {
  accent: AccentKey
  /** 悬浮胶囊 / 贴底通栏 */
  tabbar: TabbarShape
  /** 图标 + 文字 / 只留图标 */
  tabLabel: TabLabelMode
  /** 纯色 / 顶部一层品牌色氛围光 */
  bg: BgMood
  /** 通透 / 标准 / 厚实 */
  glass: GlassLevel
  /** 标准 / 精简（关掉过渡与动画） */
  motion: MotionLevel
}

export interface AccentDef {
  key: AccentKey
  label: string
  /** 色块在深色主题下的取值，也是底部选中药丸的颜色 */
  dark: string
  /** 浅色主题下的取值，同时充当强调文字的深色 */
  light: string
}

export const ACCENTS: AccentDef[] = [
  { key: 'blue', label: '天蓝', dark: '#2f81f7', light: '#0969da' },
  { key: 'violet', label: '紫罗兰', dark: '#a371f7', light: '#8250df' },
  { key: 'teal', label: '青碧', dark: '#39c5cf', light: '#0e7c86' },
  { key: 'green', label: '松绿', dark: '#3fb950', light: '#1a7f37' },
  { key: 'amber', label: '琥珀', dark: '#d29922', light: '#9a6700' },
  { key: 'rose', label: '洋红', dark: '#f778ba', light: '#bf3989' },
]

export const DEFAULT_APPEARANCE: Appearance = {
  accent: 'blue',
  tabbar: 'float',
  tabLabel: 'both',
  bg: 'plain',
  glass: 'normal',
  motion: 'full',
}

const ACCENT_KEYS = ACCENTS.map((a) => a.key)
const TABBAR_KEYS: TabbarShape[] = ['float', 'dock']
const TAB_LABEL_KEYS: TabLabelMode[] = ['both', 'icon']
const BG_KEYS: BgMood[] = ['plain', 'glow']
const GLASS_KEYS: GlassLevel[] = ['clear', 'normal', 'thick']
const MOTION_KEYS: MotionLevel[] = ['full', 'calm']

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/**
 * 逐字段兜底，不要整体判空后丢回默认值：
 * 以后新增一个字段时，老用户存的那份 JSON 缺这个键，整体回退会把人家挑过的强调色一起抹掉。
 */
export function normalizeAppearance(raw: unknown): Appearance {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    accent: pick(src.accent, ACCENT_KEYS, DEFAULT_APPEARANCE.accent),
    tabbar: pick(src.tabbar, TABBAR_KEYS, DEFAULT_APPEARANCE.tabbar),
    tabLabel: pick(src.tabLabel, TAB_LABEL_KEYS, DEFAULT_APPEARANCE.tabLabel),
    bg: pick(src.bg, BG_KEYS, DEFAULT_APPEARANCE.bg),
    glass: pick(src.glass, GLASS_KEYS, DEFAULT_APPEARANCE.glass),
    motion: pick(src.motion, MOTION_KEYS, DEFAULT_APPEARANCE.motion),
  }
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    /* 隐私模式下访问 localStorage 本身就可能抛 */
    return null
  }
}

export function readAppearance(): Appearance {
  try {
    const raw = storage()?.getItem(APPEARANCE_KEY)
    return normalizeAppearance(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
}

export function writeAppearance(a: Appearance): void {
  try {
    storage()?.setItem(APPEARANCE_KEY, JSON.stringify(a))
  } catch {
    /* 写入失败不影响本次会话 */
  }
}

/** 序列化只保留已知字段，别把调用方顺手塞进来的东西也存进去 */
export function serializeAppearance(a: Appearance): string {
  return JSON.stringify(normalizeAppearance(a))
}

/**
 * 把选择写到 <html data-*> 上。传 root 是为了单测能拿一个假对象验证，
 * 不必为了这一行引入 jsdom。
 */
export function applyAppearance(
  a: Appearance,
  root: { dataset?: Record<string, string | undefined> } | null = globalThis.document
    ?.documentElement ?? null,
): void {
  if (!root?.dataset) return
  const next = normalizeAppearance(a)
  root.dataset.accent = next.accent
  root.dataset.tabbar = next.tabbar
  root.dataset.tablabel = next.tabLabel
  root.dataset.bg = next.bg
  root.dataset.glass = next.glass
  root.dataset.motion = next.motion
}

export function accentDef(key: AccentKey): AccentDef {
  return ACCENTS.find((a) => a.key === key) ?? ACCENTS[0]
}

/** 设置页的色块取哪一档：深色主题用亮色，浅色主题用深色，保证在白/黑底上都够清楚 */
export function accentSwatch(def: AccentDef, theme: 'light' | 'dark'): string {
  return theme === 'dark' ? def.dark : def.light
}

/**
 * 首屏内联脚本用的一句话描述：key 的取值必须和这里一致，
 * 否则 HTML 里那份白名单与 TS 里的会各自漂移。改字段名时两处一起改。
 */
export const APPEARANCE_FIELDS = {
  accent: ACCENT_KEYS,
  tabbar: TABBAR_KEYS,
  tabLabel: TAB_LABEL_KEYS,
  bg: BG_KEYS,
  glass: GLASS_KEYS,
  motion: MOTION_KEYS,
} as const
