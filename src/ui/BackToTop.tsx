import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'

/**
 * 回到顶部。
 *
 * 这个 App 的滚动容器不是 window，而是每个页面自己的 `.page`
 * （`.app` 是 flex 列，`.page` 是 `flex: 1; overflow-y: auto`），
 * 所以用捕获阶段的 scroll 监听统一接管：哪个 .page 在滚、滚了多远，
 * 都不用往十几个页面组件里各塞一个 ref。
 *
 * 只认 `.page` 这一个目标。弹层（`.sheet-body`、`.diff-list` 等）
 * 自己滚自己的内容，跟着弹按钮反而是干扰。
 */

/** 一屏约 780px，滚过一屏多才值得给按钮 —— 太早出现会盖住列表 */
const SHOW_AFTER = 620

export function BackToTop({ resetKey, raised }: { resetKey: string; raised: boolean }) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [visible, setVisible] = useState(false)
  /** 合并到一帧：scroll 事件每像素都在发，不合并就是每像素一次 setState */
  const frame = useRef(0)

  useEffect(() => {
    function onScroll(e: Event) {
      const el = e.target
      if (!(el instanceof HTMLElement) || !el.classList.contains('page')) return
      if (frame.current) return
      frame.current = window.requestAnimationFrame(() => {
        frame.current = 0
        setTarget(el)
        setVisible(el.scrollTop > SHOW_AFTER)
      })
    }
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      if (frame.current) window.cancelAnimationFrame(frame.current)
    }
  }, [])

  // 换页签 / 换路由时旧的 .page 已经不在文档里了，按钮必须跟着下去。
  // 只靠 scroll 事件不行：新页面停在顶部，根本不会发出 scroll。
  useEffect(() => {
    setVisible(false)
  }, [resetKey])

  if (!visible || !target) return null

  const el = target
  function back() {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
    // 平滑滚动期间按钮继续浮在上面很碍眼，先收起来；滚回顶部后状态自然一致
    setVisible(false)
  }

  return (
    <button
      type="button"
      className={`backtotop${raised ? ' raised' : ''}`}
      aria-label="回到顶部"
      onClick={back}
    >
      <Icon name="up" size={17} />
    </button>
  )
}
