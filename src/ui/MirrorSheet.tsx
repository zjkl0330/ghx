import { useState } from 'react'
import {
  BUILTIN_MIRRORS,
  DEFAULT_MIRROR,
  formatSpeed,
  mirrorDefFor,
  mirrorLabel,
  normalizeBase,
  pickFastest,
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
  onProbe: () => void
  onUse: (base: string) => void
  onAuto: (on: boolean) => void
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

/** 站点列表：内置站 + 当前自定义站（不在内置表里时补一行，免得选中了却看不见） */
export function mirrorRows(current: string): { base: string; label: string; note?: string }[] {
  const cur = normalizeBase(current)
  const rows = BUILTIN_MIRRORS.map((m) => ({ base: m.base, label: m.label, note: m.note }))
  if (cur && !rows.some((r) => r.base.toLowerCase() === cur.toLowerCase())) {
    rows.unshift({ base: cur, label: cur.replace(/^https?:\/\//, ''), note: '自定义' })
  }
  return rows
}

export function MirrorSheet(p: Props) {
  const [custom, setCustom] = useState('')
  const rows = mirrorRows(p.current)
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

  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h3>下载加速</h3>
        <div className="sheet-sub">
          逐个测速，自动选最快的站点下载安装包与自述图片。{p.probe.light ? '轻量模式只测连通性。' : ''}
        </div>

        <div className="seg" style={{ margin: '14px 0 0' }}>
          <button className={p.auto ? 'on' : ''} onClick={() => p.onAuto(true)}>
            自动选最快
          </button>
          <button className={!p.auto ? 'on' : ''} onClick={() => p.onAuto(false)}>
            手动指定
          </button>
        </div>

        <div className="mrow-wrap">
          {rows.map((r, i) => {
            const st = statOf(r.base, i)
            const on = cur.toLowerCase() === r.base.toLowerCase()
            const isBest = p.auto && !!best && normalizeBase(best.base).toLowerCase() === r.base.toLowerCase()
            return (
              <button key={r.base} className={`mrow${on ? ' on' : ''}`} onClick={() => use(r.base)}>
                <span className="mrow-main">
                  <b>
                    {r.label}
                    {isBest ? <em className="mrow-best">最快</em> : null}
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
            )
          })}
        </div>

        {p.probe.error && <div className="errline">{p.probe.error}</div>}

        <div className="hint" style={{ marginTop: 10 }}>
          {p.probe.running
            ? `正在测速 ${Math.min(p.probe.done + 1, p.probe.total)}/${p.probe.total}，逐个测才不会互相抢带宽。`
            : `${ago(p.probe.at)}。测速结果缓存 6 小时，短期再打开不会重复测。`}
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="custom-mirror">自定义加速前缀</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="custom-mirror"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder={DEFAULT_MIRROR.replace(/^https?:\/\//, '')}
              autoCapitalize="off"
              spellCheck={false}
              style={{ flex: 1 }}
            />
            <button
              className="btn ghost"
              style={{ flex: 'none', width: 64 }}
              disabled={!normalizeBase(custom)}
              onClick={() => {
                use(custom)
                setCustom('')
              }}
            >
              使用
            </button>
          </div>
          <div className="hint">
            自建或其它 gh-proxy 同款服务都填这里。当前认定为
            {mirrorDefFor(custom || p.current).style === 'url' ? '「完整地址」风格（{前缀}/https://github.com/…）' : '「路径」风格（{前缀}/owner/repo/…）'}。
          </div>
        </div>

        <div className="btns">
          <button className="btn ghost" onClick={p.onClose}>
            关闭
          </button>
          <button className="btn primary" disabled={p.probe.running} onClick={p.onProbe}>
            <Icon name="bolt" size={14} />
            {p.probe.running
              ? `测速中 ${Math.min(p.probe.done + 1, p.probe.total)}/${p.probe.total}`
              : '重新测速'}
          </button>
        </div>

        <div className="hint" style={{ marginTop: 10, textAlign: 'center' }}>
          当前使用 {mirrorLabel(p.current)}；测速只请求每个站点的前 256 KB，不下载完整安装包。
        </div>
      </div>
    </div>
  )
}
