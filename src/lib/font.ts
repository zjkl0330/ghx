/**
 * 界面字体：默认（OPPO Sans，随包内置）/ 系统字体。
 *
 * 和主题、外观一样只存 localStorage，首屏内联脚本同步打上 `data-font`，
 * 走异步存储会先闪一帧系统字体再跳回来。
 *
 * 为什么内置 OPPO Sans：ColorOS 上它是系统默认字体，观感更整齐；
 * 华为、小米这些机器上没有，只能用系统字体，所以给一个开关让人自己挑。
 *
 * 授权：OPPO Sans Fonts License Agreement 允许「随软件原样打包、嵌入、再分发
 * 未修改的副本」，条件是软件内要有显著声明、且不得修改字体。所以打包的是
 * 官方原始 TTF，没有做子集化 —— 代价是 22 MB，换来的是条款上站得住。
 */
export type FontPref = 'sans' | 'system'

export const FONT_KEY = 'ghx.font'

export function isFontPref(v: unknown): v is FontPref {
  return v === 'sans' || v === 'system'
}

export function readFontPref(): FontPref {
  try {
    const raw = globalThis.localStorage?.getItem(FONT_KEY)
    return isFontPref(raw) ? raw : 'sans'
  } catch {
    return 'sans'
  }
}

export function writeFontPref(pref: FontPref): void {
  try {
    globalThis.localStorage?.setItem(FONT_KEY, pref)
  } catch {
    /* 隐私模式下写入失败不影响本次会话 */
  }
}

/** 把选择写到 <html data-font>；传 root 是为了单测不必引入 jsdom */
export function applyFont(
  pref: FontPref,
  root: { dataset?: Record<string, string | undefined> } | null = globalThis.document
    ?.documentElement ?? null,
): void {
  if (!root?.dataset) return
  root.dataset.font = isFontPref(pref) ? pref : 'sans'
}
