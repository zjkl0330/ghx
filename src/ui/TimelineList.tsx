import { useState } from 'react'
import { relTime } from '../lib/format'
import { tailLimit, type TimelineItem } from '../lib/timeline'

/**
 * 「动态」区块：标签变更、指派、关闭、引用这类事件。
 *
 * Issue 与 PR 共用。默认只显示最近 8 条 —— 手机上翻三十行历史会把评论
 * 区顶到看不见的地方；剩下的折成一行按钮，想看再展开。
 */
export function TimelineList({ items }: { items: TimelineItem[] }) {
  const [all, setAll] = useState(false)
  if (items.length === 0) return null
  const view = tailLimit(items, all ? items.length : 8)

  return (
    <div className="tl">
      <div className="tl-title">
        动态 · {items.length}
        {view.hidden > 0 && <span className="muted">（只显示最近 {view.shown.length} 条）</span>}
      </div>
      {view.shown.map((e) => (
        <div className="tl-row" key={e.key}>
          <span
            className={`tl-dot ${e.tone}`}
            style={e.color ? { background: `#${e.color}`, borderColor: `#${e.color}` } : undefined}
          />
          <span className="tl-text">
            <b>{e.actor}</b> {e.text}
          </span>
          <span className="tl-time">{relTime(e.at)}</span>
        </div>
      ))}
      {view.hidden > 0 && (
        <button type="button" className="tl-more" onClick={() => setAll(true)}>
          还有 {view.hidden} 条 · 展开
        </button>
      )}
    </div>
  )
}
