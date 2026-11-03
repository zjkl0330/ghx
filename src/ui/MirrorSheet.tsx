import { useState } from 'react'
import {
  DEFAULT_MIRROR,
  formatSpeed,
  isOverridden,
  mirrorCandidates,
  mirrorDefFor,
  mirrorLabel,
  normalizeBase,
  pickFastest,
  setMirrorBase,
  resetMirrorBase,
  addCustomMirror,
  removeCustomMirror,
  validateMirrorBase,
  type MirrorStore,
  type MirrorStyle,
  type ProbeResult,
} from '../lib/mirrors'
import { Icon } from './icons'

export interface MirrorProbeState {
  running: boolean
  done: number
  total: number
  results: ProbeResult[]
  /** 本轮测速的整体提示，例如「全部超时」 */
  error: string | null
  /** 上次测速完成时间 */
  at: number | null
  /** 本轮是否只测了连通性（没有安装包可测） */
  light: boolean
}

interface Props {
  current: string
  auto: boolean
  probe: MirrorProbeState
  store: MirrorStore
  onProbe: () => void
  onUse: (base: string) => void
  onAuto: (on: boolean) => void
  /** 保存站点表：改地址、加站、删站都走这里，改完立刻全局生效 */
  onStore: (next: MirrorStore) => void
  /** 只切换当前站点、不关闭面板（改地址后跟随用） */
  onSwitch: (base: string) => void
  onClose: () => void
}

function ago(ts: number | null): string {
  if (!ts) return '还没测过'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚测速'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前测速`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前测速`
  return `${Math.floor(diff / 86_400_000)} 天前测速`
}

export function MirrorSheet(p: Props) {
  const [editId, setEditId] = useState<string | null>(null)
  const [editBase, setEditBase] = useState('')
  const [editStyle, setEditStyle] = useState<MirrorStyle>('path')
  const [editLabel, setEditLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newBase, setNewBase] = useState('')
  const [newStyle, setNewStyle] = useState<MirrorStyle>('path')
  const [newPage, setNewPage] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const rows = mirrorCandidates(p.current)
  const cur = normalizeBase(p.current)
  const byBase = new Map(p.probe.results.map((r) => [normalizeBase(r.base).toLowerCase(), r]))
  const best = pickFastest(p.probe.results)

  function statOf(base: string, index: number): { text: string; tone: 'ok' | 'dim' | 'bad' } {
    const hit = byBase.get(base.toLowerCase())
    if (hit) {
      return hit.status === 'ok'
        ? { text: formatSpeed(hit.kbps), tone: 'ok' }
        : { text: hit.error ?? '不可用', tone: 'bad' }
    }
    if (p.probe.running) return { text: index === p.probe.done ? '测速中' : '排队', tone: 'dim' }
    return { text: '未测速', tone: 'dim' }
  }

  function use(raw: string) {
    const base = normalizeBase(raw)
    if (!base) return
    p.onUse(base)
  }

  /** 这个 base 对应哪个内置/自定义站点（改地址、删除要按 id 走） */
  function beginEdit(base: string) {
    const def = mirrorDefFor(base)
    setEditId(def.id)
    setEditBase(def.base)
    setEditStyle(def.style)
    setEditLabel(def.label)
    setErr(null)
  }

  function saveEdit() {
    if (!editId) return
    const check = validateMirrorBase(editBase)
    if (!check.ok) {
      setErr(check.error ?? '地址不对')
      return
    }
    // 记下这个站点改之前的地址：如果当前正在用它，地址一换就得跟着切过去，
    // 否则列表顶部会多出一行「旧地址 · 自定义」，看着像多了一个站。
    const before = mirrorCandidates(p.current).find((r) => mirrorDefFor(r.base).id === editId)?.base
    const next = setMirrorBase(p.store, editId, check.base)
    const isCustom = p.store.custom.some((c) => c.id === editId)
    if (isCustom) {
      next.custom = next.custom.map((c) =>
        c.id === editId ? { ...c, base: check.base, style: editStyle, label: editLabel.trim() || c.label } : c,
      )
    }
    p.onStore(next)
    if (before && cur.toLowerCase() === before.toLowerCase() && before.toLowerCase() !== check.base.toLowerCase()) {
      p.onSwitch(check.base)
    }
    setEditId(null)
    setErr(null)
  }

  function del(id: string) {
    const victim = p.store.custom.find((c) => c.id === id)
    p.onStore(removeCustomMirror(p.store, id))
    if (victim && cur.toLowerCase() === normalizeBase(victim.base).toLowerCase()) {
      p.onUse(DEFAULT_MIRROR)
    }
    setEditId(null)
  }

  function add() {
    const check = validateMirrorBase(newBase)
    if (!check.ok) {
      setErr(check.error ?? '地址不对')
      return
    }
    const next = addCustomMirror(p.store, {
      label: newLabel,
      base: check.base,
      style: newStyle,
      page: newPage,
    })
    if (next === p.store) {
      setErr('这个地址已经在列表里了')
      return
    }
    p.onStore(next)
    setNewBase('')
    setNewLabel('')
    setNewPage(false)
    setAdding(false)
    setErr(null)
  }

  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h3>加速站</h3>
        <div className="sheet-sub">
          域名会换，所以每个站点都能改地址：改完立即全局生效，图片、安装包、发行版页一起跟着走。
          {p.probe.light ? '轻量模式只测连通性。' : ''}
        </div>

        <div className="seg" style={{ margin: '14px 0 0' }}>
          <button className={p.auto ? 'on' : ''} onClick={() => p.onAuto(true)}>
            自动选最快
          </button>
          <button className={!p.auto ? 'on' : ''} onClick={() => p.onAuto(false)}>
            手动指定
          </button>
        </div>

        {/* 测速放在列表上方：站点多了不用滚到底才能测 */}
        <button
          className="btn ghost block"
          style={{ marginTop: 10 }}
          disabled={p.probe.running}
          onClick={p.onProbe}
        >
          <Icon name="bolt" size={14} />
          {p.probe.running
            ? `测速中 ${Math.min(p.probe.done + 1, p.probe.total)}/${p.probe.total}`
            : '测试所有站点'}
        </button>

        <div className="mrow-wrap">
          {rows.map((r, i) => {
            const st = statOf(r.base, i)
            const on = cur.toLowerCase() === r.base.toLowerCase()
            const isBest = p.auto && !!best && normalizeBase(best.base).toLowerCase() === r.base.toLowerCase()
            const def = mirrorDefFor(r.base)
            const isBuiltin = def.id !== 'custom'
            const overridden = isBuiltin && isOverridden(p.store, def.id)
            const editing = editId === def.id
            return (
              <div key={r.base} className={`mrow-box${on ? ' on' : ''}`}>
                <div className="mrow-line">
                  <button className="mrow" onClick={() => use(r.base)}>
                    <span className="mrow-main">
                      <b>
                        {r.label}
                        {isBest ? <em className="mrow-best">最快</em> : null}
                        {overridden ? <em className="mrow-tag">已改地址</em> : null}
                        {!isBuiltin ? <em className="mrow-tag">自定义</em> : null}
                      </b>
                      <i>
                        {r.base.replace(/^https?:\/\//, '')}
                        {r.note ? ` · ${r.note}` : ''}
                      </i>
                    </span>
                    <span className={`mrow-stat${st.tone === 'ok' ? ' ok' : st.tone === 'bad' ? ' bad' : ''}`}>
                      {st.text}
                      {on ? <Icon name="check" size={13} /> : null}
                    </span>
                  </button>
                  <button
                    className="mrow-act"
                    aria-label="修改这个站点"
                    onClick={() => (editing ? setEditId(null) : beginEdit(r.base))}
                  >
                    <Icon name={editing ? 'close' : 'edit'} size={14} />
                  </button>
                </div>

                {editing && (
                  <div className="medit">
                    <div className="field">
                      <label htmlFor={`mb-${def.id}`}>地址</label>
                      <input
                        id={`mb-${def.id}`}
                        value={editBase}
                        onChange={(e) => setEditBase(e.target.value)}
                        placeholder={def.base}
                        autoCapitalize="off"
                        spellCheck={false}
                      />
                    </div>
                    {!isBuiltin && (
                      <div className="field">
                        <label htmlFor={`ml-${def.id}`}>名称</label>
                        <input
                          id={`ml-${def.id}`}
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          placeholder="例如 自建 Worker"
                        />
                      </div>
                    )}
                    <div className="field">
                      <label>路径风格</label>
                      <div className="seg sm">
                        <button className={editStyle === 'path' ? 'on' : ''} onClick={() => setEditStyle('path')}>
                          路径 /owner/repo
                        </button>
                        <button className={editStyle === 'url' ? 'on' : ''} onClick={() => setEditStyle('url')}>
                          整段 URL
                        </button>
                      </div>
                    </div>
                    <div className="medit-btns">
                      <button className="btn ghost" onClick={() => setEditId(null)}>
                        取消
                      </button>
                      {(!isBuiltin || overridden) && (
                        <button
                          className="btn ghost danger"
                          onClick={() => {
                            if (isBuiltin) {
                              p.onStore(resetMirrorBase(p.store, def.id))
                              setEditId(null)
                            } else {
                              del(def.id)
                            }
                          }}
                        >
                          {isBuiltin ? '恢复默认' : '删除站点'}
                        </button>
                      )}
                      <button className="btn primary" onClick={saveEdit}>
                        保存
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {p.probe.error && <div className="errline">{p.probe.error}</div>}
        {err && <div className="errline">{err}</div>}

        <div className="hint" style={{ marginTop: 10 }}>
          {p.probe.running
            ? `正在测速 ${Math.min(p.probe.done + 1, p.probe.total)}/${p.probe.total}，逐个测才不会互相抢带宽。`
            : `${ago(p.probe.at)}。测速结果缓存 6 小时，短期再打开不会重复测。改过地址的站点会重新排队等测速。`}
        </div>

        {!adding ? (
          <button className="linkrow" style={{ marginTop: 12 }} onClick={() => { setAdding(true); setErr(null) }}>
            <span className="linkrow-main">
              <b>添加自己的站点</b>
              <i>自建 Worker、其它 gh-proxy 同款服务都行</i>
            </span>
            <Icon name="plus" size={16} />
          </button>
        ) : (
          <div className="medit" style={{ marginTop: 12, borderTop: '1px solid var(--line)' }}>
            <div className="field">
              <label htmlFor="nm-base">地址</label>
              <input
                id="nm-base"
                value={newBase}
                onChange={(e) => setNewBase(e.target.value)}
                placeholder={DEFAULT_MIRROR.replace(/^https?:\/\//, '')}
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>
            <div className="field">
              <label htmlFor="nm-label">名称（可留空）</label>
              <input id="nm-label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="自建 Worker" />
            </div>
            <div className="field">
              <label>路径风格</label>
              <div className="seg sm">
                <button className={newStyle === 'path' ? 'on' : ''} onClick={() => setNewStyle('path')}>
                  路径 /owner/repo
                </button>
                <button className={newStyle === 'url' ? 'on' : ''} onClick={() => setNewStyle('url')}>
                  整段 URL
                </button>
              </div>
            </div>
            <label className="tglrow">
              <span className="tgl-main">
                <b>同时代理网页</b>
                <i>能打开 Release 等 HTML 页面</i>
              </span>
              <input
                type="checkbox"
                className="tgl"
                checked={newPage}
                onChange={(e) => setNewPage(e.target.checked)}
              />
            </label>
            <div className="medit-btns">
              <button className="btn ghost" onClick={() => setAdding(false)}>
                取消
              </button>
              <button className="btn primary" disabled={!newBase.trim()} onClick={add}>
                添加
              </button>
            </div>
          </div>
        )}

        <div className="btns">
          <button className="btn primary block" onClick={p.onClose}>
            完成
          </button>
        </div>

        <div className="hint" style={{ marginTop: 10, textAlign: 'center' }}>
          当前使用 {mirrorLabel(p.current)}；测速只请求每个站点的前 256 KB，不下载完整安装包。
        </div>
      </div>
    </div>
  )
}
