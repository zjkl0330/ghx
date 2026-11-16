import type { IssueFilter } from '../lib/issue-filter'
import { SINCE_CHOICES, sinceLabel } from '../lib/issue-filter'
import { milestoneProgress, type Milestone } from '../lib/milestones'
import { Icon } from './icons'

/**
 * 高级筛选弹层。Issue 列表与 PR 列表共用。
 *
 * 为什么不做成「点一下就改 query」的 chips：筛选维度有五个，叠加起来的状态
 * 用一排 chips 表达不清（尤其「指派给我」「无人指派」是互斥的两个值）。
 * 放进一个弹层，改完点「完成」，列表只重拉一次。
 *
 * PR 侧要说明一句：PR 列表接口不支持这些服务端参数，筛选是在拿到的这一页里
 * 客户端过滤，所以「筛选后没几条」可能只是这一页没有，不是全仓库都没有。
 */
export function IssueFilterSheet(p: {
  filter: IssueFilter
  milestones: Milestone[]
  milestonesLoading: boolean
  /** 当前账号，用于「我」这个快捷值；没有就隐藏 */
  me: string | null
  /** 列表是 PR 时换一套说明 */
  pulls?: boolean
  onChange: (f: IssueFilter) => void
  onClose: () => void
}) {
  const set = (patch: Partial<IssueFilter>) => p.onChange({ ...p.filter, ...patch })

  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet" style={{ maxHeight: '92vh' }} onClick={(e) => e.stopPropagation()}>
        <div className="handle" />
        <div className="sheet-head">
          <div>
            <div className="sheet-title">筛选</div>
            <div className="sheet-sub">
              {p.pulls
                ? 'PR 列表只能在这一页里筛 —— 接口不支持这些参数'
                : '条件会带到 GitHub 的服务端查询，不只这一页'}
            </div>
          </div>
          <div className="spacer" />
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭">
            <Icon name="close" size={17} />
          </button>
        </div>

        <div className="sheet-body">
          <div className="sheet-sec">
            <div className="sheet-sec-label">作者</div>
            <div className="flt-line">
              <input
                className="flt-input"
                value={p.filter.author}
                onChange={(e) => set({ author: e.target.value })}
                placeholder="登录名，留空表示不限"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              {p.me && (
                <button
                  className={`chip${p.filter.author === p.me ? ' on' : ''}`}
                  onClick={() => set({ author: p.filter.author === p.me ? '' : p.me as string })}
                >
                  我
                </button>
              )}
            </div>
          </div>

          <div className="sheet-sec">
            <div className="sheet-sec-label">指派给</div>
            <div className="flt-line">
              <input
                className="flt-input"
                value={p.filter.assignee}
                onChange={(e) => set({ assignee: e.target.value })}
                placeholder="登录名，留空表示不限"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="chips" style={{ margin: '8px 0 0' }}>
              <button
                className={`chip${p.filter.assignee === '' ? ' on' : ''}`}
                onClick={() => set({ assignee: '' })}
              >
                不限
              </button>
              {p.me && (
                <button
                  className={`chip${p.filter.assignee === p.me ? ' on' : ''}`}
                  onClick={() => set({ assignee: p.filter.assignee === p.me ? '' : p.me as string })}
                >
                  我
                </button>
              )}
              <button
                className={`chip${p.filter.assignee === 'none' ? ' on' : ''}`}
                onClick={() => set({ assignee: p.filter.assignee === 'none' ? '' : 'none' })}
              >
                无人指派
              </button>
              <button
                className={`chip${p.filter.assignee === '*' ? ' on' : ''}`}
                onClick={() => set({ assignee: p.filter.assignee === '*' ? '' : '*' })}
              >
                已指派
              </button>
            </div>
          </div>

          <div className="sheet-sec">
            <div className="sheet-sec-label">
              里程碑
              {p.milestonesLoading && <span className="sheet-sec-note">读取中…</span>}
            </div>
            {p.milestones.length === 0 && !p.milestonesLoading ? (
              <div className="hint">这个仓库还没有里程碑，去网页端建一个</div>
            ) : (
              <div className="chips" style={{ margin: '8px 0 0' }}>
                <button
                  className={`chip${p.filter.milestone === '' ? ' on' : ''}`}
                  onClick={() => set({ milestone: '' })}
                >
                  不限
                </button>
                <button
                  className={`chip${p.filter.milestone === 'none' ? ' on' : ''}`}
                  onClick={() => set({ milestone: p.filter.milestone === 'none' ? '' : 'none' })}
                >
                  无里程碑
                </button>
                {p.milestones.map((m) => (
                  <button
                    key={m.number}
                    className={`chip${p.filter.milestone === String(m.number) ? ' on' : ''}`}
                    onClick={() =>
                      set({
                        milestone: p.filter.milestone === String(m.number) ? '' : String(m.number),
                      })
                    }
                    title={`已完成 ${milestoneProgress(m)}%`}
                  >
                    {m.title}
                    <span className="chip-n">{milestoneProgress(m)}%</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="sheet-sec">
            <div className="sheet-sec-label">时间</div>
            <div className="chips" style={{ margin: '8px 0 0' }}>
              {SINCE_CHOICES.map((d) => (
                <button
                  key={d}
                  className={`chip${p.filter.sinceDays === d ? ' on' : ''}`}
                  onClick={() => set({ sinceDays: d })}
                >
                  {sinceLabel(d)}
                </button>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              按「最后一次更新」算，不是创建时间。
            </div>
          </div>
        </div>

        <div className="acct-actions">
          <button
            className="btn ghost"
            style={{ flex: 1 }}
            onClick={() =>
              p.onChange({ author: '', assignee: '', milestone: '', label: '', sinceDays: 0 })
            }
          >
            清除全部
          </button>
          <button className="btn primary" style={{ flex: 1 }} onClick={p.onClose}>
            完成
          </button>
        </div>
        <div style={{ height: 12 }} />
      </div>
    </div>
  )
}
