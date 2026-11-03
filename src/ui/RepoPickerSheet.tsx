import { useMemo, useState } from 'react'
import type { Repo } from '../lib/types'
import { Icon } from './icons'

interface Props {
  repos: Repo[]
  current: Repo | null
  onPick: (repo: Repo) => void
  onClose: () => void
}

export function RepoPickerSheet(p: Props) {
  const [query, setQuery] = useState('')

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return p.repos
    return p.repos.filter(
      (r) => r.full_name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q),
    )
  }, [p.repos, query])

  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '76vh' }}>
        <div className="grab" />
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <h3>选择仓库</h3>
          <div className="spacer" />
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="search" style={{ margin: '0 0 10px', height: 34 }}>
          <Icon name="search" size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索仓库"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
          />
        </div>

        <div className="pick-list">
          {list.length === 0 && <div className="empty" style={{ padding: '28px 12px' }}>没有匹配的仓库</div>}
          {list.map((r) => (
            <button
              key={r.id}
              className={`pick-row${p.current?.full_name === r.full_name ? ' on' : ''}`}
              onClick={() => p.onPick(r)}
            >
              <Icon name="repo" size={14} />
              <span className="pick-main">
                <span className="pick-name">{r.name}</span>
                <span className="pick-sub">
                  {r.owner} · {r.private ? '私有' : '公开'}
                </span>
              </span>
              {p.current?.full_name === r.full_name && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          只列出已加载的仓库（最多约 180 个）。要找更早的仓库，先在「仓库」页搜索定位。
        </div>
      </div>
    </div>
  )
}
