/**
 * 首屏遮罩的撤除。
 *
 * 遮罩本身写死在 index.html 里 —— 它要盖住的正是「打包产物还没下载完」的那段时间，
 * 所以不能等 React 来创建。这里只负责在保险库初始化完之后让它淡出。
 *
 * 用 transitionend + 超时双保险：精简动效下 transition 只剩 0.01ms，
 * 事件有可能来不及触发，超时兜底保证节点最终会被移走，不会留一层挡住点击。
 */
const FADE_MS = 420

export function dismissBoot(): void {
  const el = globalThis.document?.getElementById('boot')
  if (!el || el.dataset?.leaving === '1') return
  el.dataset.leaving = '1'

  let removed = false
  const remove = () => {
    if (removed) return
    removed = true
    el.remove()
  }
  el.addEventListener('transitionend', remove, { once: true })
  globalThis.setTimeout?.(remove, FADE_MS)
}
