import type { BatchPlanItem } from '../lib/repos'
import type { BatchResult } from '../lib/types'
import { Icon } from './icons'

/**
 * 批量动作的确认 / 执行 / 结果三态面板。
 *
 * 早先只服务「改可见度」，现在把动作抽象成 `BatchPlanItem`，
 * 归档、加话题都走同一套进度与逐条回执，不再各写一个弹层。
 */
export function BatchSheet(p: {
  title: string
  plan: BatchPlanItem[]
  phase: 'confirm' | 'running' | 'done'
  results: BatchResult[]
  done: number
  total: number
  current: string | null
  onCancel: () => void
  onConfirm: () => void
  onClose: () => void
}) {
  const destructive = p.plan.filter((i) => i.destructive && !i.skip)
  const blocked = p.plan.filter((i) => i.blocked)
  const skip = p.plan.filter((i) => i.skip)
  const okCount = p.results.filter((r) => r.status === 'ok').length
  const failCount = p.results.length - okCount

  if (p.phase === 'done') {
    return (
      <>
        <div className="mask" onClick={p.onClose} />
        <div className="sheet">
          <div className="grab" />
          <h3>{failCount === 0 ? '执行完成' : '部分完成'}</h3>
          <div className="sheet-sub">
            成功 {okCount} 个{failCount > 0 ? ` · 失败 ${failCount} 个` : ''} · 已写入审计日志
          </div>

          <div className="diff">
            {p.results.map((r, i) => (
              <div className="diff-row" key={`${r.repo}-${i}`}>
                <span className={`result-dot ${r.status}`} />
                <span className="nm">{r.repo}</span>
                <span className="arrow">
                  {r.status === 'ok' ? (
                    <span style={{ color: 'var(--green)' }}>{r.message ?? '已完成'}</span>
                  ) : (
                    <span style={{ color: 'var(--red)' }}>{r.message ?? '失败'}</span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className="btns">
            <button className="btn ghost" style={{ flex: 1 }} onClick={p.onClose}>
              知道了
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="mask" onClick={p.phase === 'running' ? undefined : p.onCancel} />
      <div className="sheet">
        <div className="grab" />
        <h3>{p.title}</h3>
        <div className="sheet-sub">
          {p.total} 个仓库
          {skip.length > 0 ? ` · 其中 ${skip.length} 个无需变更` : ''}
        </div>

        {destructive.length > 0 && p.title.includes('可见度') && (
          <div className="warnbox">
            <Icon name="warn" size={14} />
            <span>
              其中 {destructive.length} 个从公开转私有，会永久失去 star 与 watcher，并影响搜索排名，不可撤销。
            </span>
          </div>
        )}

        {destructive.length > 0 && !p.title.includes('可见度') && (
          <div className="warnbox" style={{ background: 'var(--amber-bg)', borderColor: 'var(--amber-line)', color: '#e8c06a' }}>
            <Icon name="warn" size={14} />
            <span>
              归档后仓库变只读：不能提交、不能开 Issue、不能发版。可以随时取消归档，但期间数据不会更新。
            </span>
          </div>
        )}

        {blocked.length > 0 && (
          <div className="warnbox" style={{ background: 'var(--amber-bg)', borderColor: 'var(--amber-line)', color: '#e8c06a' }}>
            <Icon name="warn" size={14} />
            <span>{blocked.length} 个仓库当前令牌权限不足，预计会被拒绝。</span>
          </div>
        )}

        <div className="diff">
          {p.plan.map((item) => (
            <div className="diff-row" key={item.repo.full_name}>
              <span className="nm">{item.repo.name}</span>
              <span className="arrow">
                {item.skip ? (
                  <span style={{ color: 'var(--text-dim)' }}>无需变更</span>
                ) : (
                  <span className={item.blocked ? 'to blocked' : 'to'}>{item.label}</span>
                )}
              </span>
            </div>
          ))}
        </div>

        {p.phase === 'running' ? (
          <>
            <div className="progress">
              <i style={{ width: `${p.total === 0 ? 0 : Math.round((p.done / p.total) * 100)}%` }} />
            </div>
            <div className="sheet-sub" style={{ marginTop: 8 }}>
              {p.done} / {p.total}
              {p.current ? ` · ${p.current}` : ''}
            </div>
            <div className="btns">
              <button className="btn ghost" style={{ flex: 1 }} disabled>
                执行中，请勿退出
              </button>
            </div>
          </>
        ) : (
          <div className="btns">
            <button className="btn ghost" style={{ flex: 1 }} onClick={p.onCancel}>
              取消
            </button>
            <button
              className="btn primary"
              style={{ flex: 1, background: destructive.length > 0 ? '#da3633' : '#238636' }}
              onClick={p.onConfirm}
            >
              确认执行 {p.total} 个
            </button>
          </div>
        )}
      </div>
    </>
  )
}
