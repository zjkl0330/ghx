import { daysUntil, riskyScopes } from '../lib/tokens'
import type { TokenRecord } from '../lib/types'
import { Icon } from './icons'

function statusPill(rec: TokenRecord) {
  const d = daysUntil(rec.expiresAt)
  if (rec.lastStatus === 'invalid') return { cls: 'bad', text: '失效' }
  if (rec.lastStatus === 'expired' || (d !== null && d < 0)) return { cls: 'bad', text: '已过期' }
  if (d !== null && d <= 7) return { cls: 'warn', text: `${d} 天过期` }
  if (rec.lastStatus === 'unknown') return { cls: 'warn', text: '未校验' }
  return { cls: 'ok', text: '有效' }
}

interface Props {
  records: TokenRecord[]
  activeId: string | null
  checking: string | null
  onActivate: (id: string) => void
  onAdd: () => void
  onRemove: (id: string) => void
  onCheck: (id: string) => void
  quota: Record<string, { remaining: number; limit: number }>
}

export function TokenVault(p: Props) {
  return (
    <>
      <div className="topbar">
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>令牌保险库</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>
            {p.records.length} 个凭据 · AES-256-GCM 本地加密
          </div>
        </div>
        <div className="spacer" />
        <button className="icon-btn" onClick={p.onAdd} aria-label="添加令牌" style={{ color: 'var(--blue)' }}>
          <Icon name="plus" size={19} />
        </button>
      </div>

      <div className="page">
        {p.records.length === 0 && (
          <div className="empty">
            <b>还没有令牌</b>
            点右上角 + 导入一个 PAT。GitHub 不提供创建令牌的接口，需要先在网页
            settings/tokens 生成，再粘贴进来。
          </div>
        )}

        {p.records.map((rec) => {
          const pill = statusPill(rec)
          const hot = riskyScopes(rec.scopes)
          const q = p.quota[rec.id]
          const pct = q ? Math.max(4, Math.round((q.remaining / Math.max(q.limit, 1)) * 100)) : 0

          return (
            <div key={rec.id} className={`tk${p.activeId === rec.id ? ' off' : ''}`}>
              <div className="tk-top">
                <div className="tk-ic">
                  <Icon name="key" size={14} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="tk-name">{rec.name}</div>
                  <div className="tk-fp mono">{rec.preview}</div>
                </div>
                <div className={`pill ${pill.cls}`}>{pill.text}</div>
              </div>

              {rec.scopes.length > 0 && (
                <div className="scopes">
                  {rec.scopes.map((s) => (
                    <span key={s} className={`sc${hot.includes(s) ? ' hot' : ''}`}>
                      {s}
                    </span>
                  ))}
                </div>
              )}

              {q && (
                <>
                  <div className="meter">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <div className="tk-foot">
                    <span>
                      配额 {q.remaining} / {q.limit}
                    </span>
                    <span>{rec.expiresAt ? `${rec.expiresAt.slice(0, 10)} 到期` : '无固定期限'}</span>
                  </div>
                </>
              )}

              {!q && (
                <div className="tk-foot">
                  <span>{rec.login ? `@${rec.login}` : '未校验归属'}</span>
                  <span>{rec.expiresAt ? `${rec.expiresAt.slice(0, 10)} 到期` : '无固定期限'}</span>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  className={`btn ${p.activeId === rec.id ? 'blue' : 'ghost'}`}
                  style={{ flex: 1, height: 32, fontSize: 11.5 }}
                  onClick={() => p.onActivate(rec.id)}
                >
                  {p.activeId === rec.id ? '当前使用中' : '切换到此令牌'}
                </button>
                <button
                  className="btn ghost"
                  style={{ height: 32, fontSize: 11.5 }}
                  disabled={p.checking === rec.id}
                  onClick={() => p.onCheck(rec.id)}
                >
                  {p.checking === rec.id ? '校验中' : '校验'}
                </button>
                <button
                  className="btn danger"
                  style={{ height: 32, padding: '0 10px' }}
                  onClick={() => p.onRemove(rec.id)}
                  aria-label="删除"
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          )
        })}

        <div style={{ height: 20 }} />
      </div>
    </>
  )
}
