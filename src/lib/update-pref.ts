/**
 * 「更新提示」开关。
 *
 * 只有正式版才会提示更新（预览版一律标 prerelease，不打扰用户），
 * 但有人连正式版的提示都不想看 —— 那就得能关。
 *
 * 关掉之后：
 *   · 启动时不再静默查 /releases/latest（省一次请求，也就没有红点）；
 *   · 底部/列表的「有新版本」标记不再出现；
 *   · 设置页的「检查更新」仍然可用 —— 那是用户主动要的，不算打扰。
 *
 * 默认开启。存储走 localStorage，和主题、字体同一套约定：读不到就当默认值，
 * 写失败也不影响使用（大不了下次启动又提示一次）。
 */

export const UPDATE_HINT_KEY = 'ghx.update.hint'

export function readUpdateHint(): boolean {
  try {
    return localStorage.getItem(UPDATE_HINT_KEY) !== 'off'
  } catch {
    return true
  }
}

export function writeUpdateHint(on: boolean): void {
  try {
    localStorage.setItem(UPDATE_HINT_KEY, on ? 'on' : 'off')
  } catch {
    /* 隐私模式下写不进去，下次启动仍按默认开启，不影响主流程 */
  }
}
