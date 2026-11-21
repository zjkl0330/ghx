/**
 * 更新通道与开关。
 *
 * 三档，一次存一个值：
 *   · `stable` —— 只提示正式版（默认）；
 *   · `beta`   —— 连预发布一起提示，想先试新功能的人自己选；
 *   · `off`    —— 启动时完全不查。
 *
 * 关掉之后：
 *   · 启动时不再静默查版本（省一次请求，也就没有红点）；
 *   · 底部/列表的「有新版本」标记不再出现；
 *   · 设置页的「检查更新」仍然可用 —— 那是用户主动要的，不算打扰。
 *
 * 存储走 localStorage，和主题、字体同一套约定：读不到就当默认值，
 * 写失败也不影响使用（大不了下次启动又提示一次）。
 *
 * v1.1.0 之前只有一个布尔开关（`ghx.update.hint` = on/off）。老用户升级后
 * 要能延续「关掉了」这个选择，所以读不到新键时会回落到旧键判断一次。
 */

export type UpdateChannel = 'stable' | 'beta'
export type UpdateMode = UpdateChannel | 'off'

export const UPDATE_MODE_KEY = 'ghx.update.mode'
/** 旧版开关，只为迁移保留 */
export const UPDATE_HINT_KEY = 'ghx.update.hint'

export function readUpdateMode(): UpdateMode {
  try {
    const v = localStorage.getItem(UPDATE_MODE_KEY)
    if (v === 'stable' || v === 'beta' || v === 'off') return v
    // 旧键：只有明确写了 off 才算关，其余（包括脏值）都按默认正式版
    return localStorage.getItem(UPDATE_HINT_KEY) === 'off' ? 'off' : 'stable'
  } catch {
    return 'stable'
  }
}

export function writeUpdateMode(mode: UpdateMode): void {
  try {
    localStorage.setItem(UPDATE_MODE_KEY, mode)
    // 顺手把旧键写成一致的语义，回退到旧版本时行为不至于突变
    localStorage.setItem(UPDATE_HINT_KEY, mode === 'off' ? 'off' : 'on')
  } catch {
    /* 隐私模式下写不进去，下次启动仍按默认值，不影响主流程 */
  }
}

/** 更新提示是否开启（关掉时启动不查） */
export function updateModeEnabled(mode: UpdateMode): boolean {
  return mode !== 'off'
}
