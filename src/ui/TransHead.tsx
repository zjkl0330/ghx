import type { ReactNode } from 'react'

/**
 * 「译 / 原文」切换条。
 *
 * 发行说明、Issue 正文、PR 描述、通知评论都用这一条：
 * 左侧是标题与「译」标，右侧是状态与切换，避免每处各写一套。
 * 只有真的翻出东西才给切换按钮 —— 没翻成时按钮点下去也不会变，
 * 那种按钮只会让人以为坏了。
 */
export function TransHead(p: {
  label?: ReactNode
  view: 'zh' | 'src'
  onToggle: () => void
  /** 已经有译文可看 */
  ready: boolean
  busy: boolean
  /** 设置里开了这个范围 */
  enabled: boolean
  onTranslate: () => void
  error?: string | null
}) {
  const translated = p.view === 'zh' && p.ready
  return (
    <>
      <div className="trans-head">
        <span className="trans-head-label">
          {p.label}
          {translated ? <span className="tr-mark">译</span> : null}
        </span>
        <span className="trans-head-acts">
          {p.busy ? <span className="trans-head-state">翻译中…</span> : null}
          {p.ready ? (
            <button type="button" className="linkbtn" onClick={p.onToggle}>
              {p.view === 'zh' ? '看原文' : '看译文'}
            </button>
          ) : null}
          {!p.busy && p.enabled && !p.ready ? (
            <button type="button" className="linkbtn" onClick={p.onTranslate}>
              翻译
            </button>
          ) : null}
        </span>
      </div>
      {p.error ? <div className="hint trans-head-err">{p.error}</div> : null}
    </>
  )
}
