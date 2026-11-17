import type { AccountState, MultiAccount, MultiKind, MultiResult, MultiTask } from '../lib/multi'
import { runLabel } from '../lib/multi'
import { Icon } from './icons'

/**
 * 多账号动作面板。
 *
 * 详情页的 Star、复刻页的复刻，在有两个以上账号时都走这里：
 * 勾几个就同时对几个账号动手，跑完逐行给回执。
 * 只读展示，真正干活的是 App 里那条串行管道。
 *
 * 已经有状态的账号（已 star / 已有复刻）直接标成「不用动」且不可勾 ——
 * 允许勾上却又不执行，会让人以为点了没用。
 */

interface Props {
  kind: MultiKind
  title: string
  subtitle: string
  accounts: MultiAccount[]
  tasks: MultiTask[]
  states: Record<string, AccountState>
  selected: Set<string>
  loading: boolean
  running: boolean
  results: MultiResult[] | null
  onToggle: (id: string) => void
  onToggleAll: () => void
  onRun: () => void
  onClose: () => void
}

function stateText(kind: MultiKind, st: AccountState): { text: string; tone: '' | ' on' | ' off' } {
  if (kind === 'fork') {
    if (st.forked === true) return { text: '已有复刻', tone: ' on' }
    if (st.forked === false) return { text: '还没复刻', tone: ' off' }
    return { text: '状态未知', tone: '' }
  }
  if (st.starred === true) return { text: '已 star', tone: ' on' }
  if (st.starred === false) return { text: '未 star', tone: ' off' }
  return { text: '状态未知', tone: '' }
}

/** 这一行点下去会发生什么；右侧标签已经写了当前状态，这里不重复 */
function intentText(kind: MultiKind): string {
  if (kind === 'star') return '将 star 这个仓库'
  if (kind === 'unstar') return '将取消 star'
  return '将复刻到这个账号'
}

export function MultiAccountSheet(p: Props) {
  const resultOf = (id: string): MultiResult | undefined => p.results?.find((r) => r.id === id)
  const doneCount = p.results?.filter((r) => !r.skipped).length ?? 0
  const runnable = p.selected.size
  const open = p.tasks.filter((t) => !t.skip)
  const allOn = open.length > 0 && open.every((t) => p.selected.has(t.id))

  return (
    <>
      <div className="mask" onClick={p.onClose} />
      <div className="sheet multi-sheet" style={{ maxHeight: '88vh' }}>
        <div className="grab" />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3>{p.title}</h3>
            <div className="sheet-sub">{p.subtitle}</div>
          </div>
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭" style={{ marginTop: -4 }}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="multi-head">
          <span className="multi-count">
            {p.loading ? '正在查各账号状态…' : `${runnable} 个账号待执行`}
          </span>
          <button className="multi-all" onClick={p.onToggleAll} disabled={p.running || p.loading}>
            {allOn ? '全不选' : '全选'}
          </button>
        </div>

        <div className="multi-list">
          {p.accounts.map((a) => {
            const task = p.tasks.find((t) => t.id === a.id)
            const locked = !!task?.skip
            const st = stateText(p.kind, p.states[a.id] ?? {})
            const res = resultOf(a.id)
            const on = !locked && p.selected.has(a.id)
            return (
              <button
                key={a.id}
                className={`multi-row${on ? ' on' : ''}${locked ? ' locked' : ''}`}
                disabled={p.running || locked}
                onClick={() => p.onToggle(a.id)}
              >
                <span className={`multi-box${on ? ' on' : ''}${locked ? ' locked' : ''}`} aria-hidden>
                  {on && <Icon name="check" size={11} />}
                  {locked && <Icon name="minus" size={11} />}
                </span>
                <span className="multi-avatar">
                  {a.avatarUrl ? (
                    <img src={a.avatarUrl} alt="" loading="lazy" />
                  ) : (
                    (a.login ?? a.label).slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="multi-main">
                  <b className="ellipsis">{a.label}</b>
                  <i>
                    {res
                      ? res.ok
                        ? res.skipped
                          ? res.skipped
                          : '已完成'
                        : res.error
                      : locked
                        ? `${task?.skip}，不用动`
                        : intentText(p.kind)}
                  </i>
                </span>
                {res ? (
                  <span className={`multi-res${res.ok ? (res.skipped ? ' skip' : ' ok') : ' bad'}`}>
                    <Icon name={res.ok ? (res.skipped ? 'minus' : 'check') : 'close'} size={13} />
                  </span>
                ) : locked ? (
                  <span className="multi-tag on">{st.text}</span>
                ) : (
                  <span className={`multi-tag${st.tone}`}>{st.text}</span>
                )}
              </button>
            )
          })}
        </div>

        {p.running && (
          <div className="multi-bar">
            <span style={{ width: `${Math.round((doneCount / Math.max(1, p.selected.size)) * 100)}%` }} />
          </div>
        )}

        <button
          className="btn primary block"
          style={{ marginTop: 14 }}
          disabled={p.running || p.loading || runnable === 0}
          onClick={p.onRun}
        >
          {p.running ? `正在处理 ${doneCount}/${runnable}…` : runLabel(p.kind, runnable)}
        </button>

        <div className="hint" style={{ marginTop: 8, textAlign: 'center' }}>
          每个账号用各自的令牌单独请求，串行执行，失败不影响其它账号。
        </div>
      </div>
    </>
  )
}
