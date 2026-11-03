import { REPO_SORTS, type RepoSort } from '../lib/sort'
import { Icon } from './icons'

interface Props {
  current: RepoSort
  onPick: (sort: RepoSort) => void
  onClose: () => void
}

export function SortSheet(p: Props) {
  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <h3>排列方式</h3>
          <div className="spacer" />
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="pick-list" style={{ maxHeight: '52vh' }}>
          {REPO_SORTS.map((s) => {
            const on = p.current === s.key
            return (
              <button
                key={s.key}
                className={`pick-row${on ? ' on' : ''}`}
                onClick={() => {
                  p.onPick(s.key)
                  p.onClose()
                }}
              >
                <span className="pick-main">
                  <span className="pick-name">{s.label}</span>
                  <span className="pick-sub">{s.hint}</span>
                </span>
                {on && <Icon name="check" size={15} />}
              </button>
            )
          })}
        </div>

        <div className="hint" style={{ marginTop: 10 }}>
          选择会记住，下次打开沿用。归档仓库默认不列出，与排序无关。
        </div>
      </div>
    </div>
  )
}
