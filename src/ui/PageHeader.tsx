import type { ReactNode } from 'react'
import { Icon } from './icons'

/**
 * 二级页面统一顶栏：返回 + 标题 + 副标题 + 右侧动作。
 * 结构照抄 PipelinesPage 的顶栏，保证视觉一致。
 */
export function PageHeader(p: {
  title: string
  sub?: ReactNode
  onBack: () => void
  right?: ReactNode
  /** 右侧文字按钮，放「新建」这类主操作 */
  action?: { label: string; icon?: string; onClick: () => void; disabled?: boolean }
}) {
  return (
    <div className="topbar">
      <button className="icon-btn" onClick={p.onBack} aria-label="返回">
        <Icon name="back" size={18} />
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="page-title ellipsis">{p.title}</div>
        {p.sub !== undefined && <div className="page-sub ellipsis">{p.sub}</div>}
      </div>
      {p.right}
      {p.action && (
        <button
          className="btn ghost tiny"
          onClick={p.action.onClick}
          disabled={p.action.disabled}
          style={{ flex: 'none' }}
        >
          {p.action.icon && <Icon name={p.action.icon} size={13} />}
          {p.action.label}
        </button>
      )}
    </div>
  )
}

/** 空态 / 错误态的统一样子 */
export function PageState(p: {
  loading?: boolean
  error?: string | null
  empty?: ReactNode
  onRetry?: () => void
  loadingText?: string
}) {
  if (p.loading) return <div className="empty">{p.loadingText ?? '正在加载…'}</div>
  if (p.error) {
    return (
      <div className="warnbox" style={{ margin: '12px 16px' }}>
        <Icon name="warn" size={14} />
        <span style={{ flex: 1 }}>{p.error}</span>
        {p.onRetry && (
          <button className="linkbtn" onClick={p.onRetry}>
            重试
          </button>
        )}
      </div>
    )
  }
  if (p.empty) return <div className="empty">{p.empty}</div>
  return null
}
