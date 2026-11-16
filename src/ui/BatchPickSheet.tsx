import { useState } from 'react'
import type { BatchAction } from '../lib/repos'
import { parseTopics } from '../lib/topics'
import { Icon } from './icons'

/**
 * 批量动作选择。
 *
 * 顶栏那条操作栏空间只够放两个最常用的（转私有 / 转公开），
 * 其余动作收在这里，顺带把「加话题」的输入也做进来。
 */
export function BatchPickSheet(p: {
  count: number
  /** 选中仓库里有几个已归档，用来给「归档」标一句「其中 N 个已是归档」 */
  archivedCount: number
  onClose: () => void
  onPick: (action: BatchAction) => void
}) {
  const [topics, setTopics] = useState('')
  const parsed = parseTopics(topics)

  return (
    <>
      <div className="mask" onClick={p.onClose} />
      <div className="sheet" style={{ maxHeight: '88vh' }}>
        <div className="grab" />
        <h3>批量操作</h3>
        <div className="sheet-sub">已选 {p.count} 个仓库</div>

        <div className="picklist">
          <button className="pickrow" onClick={() => p.onPick({ kind: 'archive' })}>
            <Icon name="archive" size={16} />
            <span>
              归档
              {p.archivedCount > 0 && <em> · 其中 {p.archivedCount} 个已归档</em>}
            </span>
            <Icon name="chevron" size={13} />
          </button>
          <button className="pickrow" onClick={() => p.onPick({ kind: 'unarchive' })}>
            <Icon name="refresh" size={16} />
            <span>取消归档</span>
            <Icon name="chevron" size={13} />
          </button>
        </div>

        <div className="section-title" style={{ marginTop: 14 }}>
          加话题
        </div>
        <div className="hint" style={{ margin: '0 0 8px' }}>
          会先读一次仓库现有话题再合并（接口是整体替换，直接写会把原来的冲掉）。
          GitHub 只接受小写字母、数字与短横，中文词会被自动丢掉。
        </div>
        <div className="field" style={{ marginTop: 0 }}>
          <input
            value={topics}
            onChange={(e) => setTopics(e.target.value)}
            placeholder="例如 react, 工具, tauri"
            autoCapitalize="off"
            spellCheck={false}
          />
        </div>
        {parsed.length > 0 && (
          <div className="chipwrap" style={{ marginTop: 8 }}>
            {parsed.map((t) => (
              <span className="chip static" key={t}>
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="btns" style={{ marginTop: 14 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={p.onClose}>
            取消
          </button>
          <button
            className="btn primary"
            style={{ flex: 1 }}
            disabled={parsed.length === 0}
            onClick={() => p.onPick({ kind: 'topics', add: parsed })}
          >
            加到 {p.count} 个仓库
          </button>
        </div>
      </div>
    </>
  )
}
