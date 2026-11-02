import type { AuditEntry } from '../lib/types'
import { Icon } from './icons'

const ACTION_LABEL: Record<AuditEntry['action'], string> = {
  visibility: '修改可见度',
  'token-add': '导入令牌',
  'token-remove': '删除令牌',
  'token-check': '校验令牌',
  unlock: '解锁保险库',
  'repo-star': 'Star 仓库',
  'repo-archive': '归档仓库',
  'repo-delete': '删除仓库',
  'repo-create': '新建仓库',
}

function fmt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function AuditLog({ entries, onClear }: { entries: AuditEntry[]; onClear: () => void }) {
  return (
    <>
      <div className="topbar">
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>审计日志</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>
            仅存本机 · 最近 {entries.length} 条
          </div>
        </div>
        <div className="spacer" />
        {entries.length > 0 && (
          <button className="icon-btn" onClick={onClear} aria-label="清空">
            <Icon name="trash" size={16} />
          </button>
        )}
      </div>

      <div className="page">
        {entries.length === 0 && (
          <div className="empty">
            <b>还没有记录</b>
            每次修改可见度、导入或校验令牌都会记一条，方便事后对账。
          </div>
        )}

        {entries.map((e) => (
          <div className="audit-row" key={e.id}>
            <div className="audit-time mono">{fmt(e.at)}</div>
            <div className={`result-dot ${e.result}`} />
            <div className="audit-main">
              <div className="audit-t">{ACTION_LABEL[e.action] ?? e.action}</div>
              <div className="audit-d">
                {e.target}
                {e.detail ? ` · ${e.detail}` : ''}
              </div>
            </div>
          </div>
        ))}
        <div style={{ height: 20 }} />
      </div>
    </>
  )
}
