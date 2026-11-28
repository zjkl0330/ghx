import { useEffect, useState } from 'react'
import type { TokenRecord } from '../lib/types'
import { copyText } from '../lib/clipboard'
import { looksLikeToken } from '../lib/vault'
import { REVEAL_MIN } from '../lib/reveal'
import { Icon } from './icons'

interface Props {
  record: TokenRecord
  /** 保险库开了启动验证：主密钥用启动口令解锁，不用再记一个查看密码 */
  guarded: boolean
  hasRevealPass: boolean
  onClose: () => void
  onToast: (msg: string) => void
  onCheckVaultPass: (pass: string) => Promise<boolean>
  onCheckRevealPass: (pass: string) => Promise<boolean>
  onSetRevealPass: (pass: string) => Promise<void>
  /** 取主密钥明文 */
  onLoadPrimary: () => Promise<string>
  /** 取副密钥明文；没配过返回 null */
  onLoadSecondary: () => Promise<string | null>
  /** 设置 / 替换 / 清除副密钥 */
  onSaveSecondary: (secret: string | null) => Promise<void>
}

/** 主密钥展示后多久自动重新遮住。够看清、够复制，也让「放下手机」不至于一直裸着 */
const AUTO_HIDE_MS = 120_000

/**
 * 一个账号的两把钥匙。
 *
 * 设计上刻意不对称：
 * - **副密钥**打开面板就能看到。它是给「同一账号的第二枚权限更窄的令牌」用的，
 *   比如只读令牌、只给某几个仓库的细粒度令牌，平时需要随手复制。
 * - **主密钥**必须过一道门。开了启动验证就输启动口令；免密的库没有口令可验，
 *   那就用单独设的「查看密码」。两者都没有时先让用户设一个 —— 不给「直接看」的缺口。
 *
 * 门只是界面闸门，不是第二层加密：密文仍由保险库密钥保护，这里决定的是
 * 「现在这个人有没有资格把它解出来」。
 */
export function SecretSheet(p: Props) {
  const [sub, setSub] = useState<string | null>(null)
  const [subReady, setSubReady] = useState(false)
  const [subEdit, setSubEdit] = useState(false)
  const [subInput, setSubInput] = useState('')
  const [subConfirmDel, setSubConfirmDel] = useState(false)

  /** idle=主密钥遮着；pass=输密码；setup=第一次设查看密码；open=已展示 */
  const [gate, setGate] = useState<'idle' | 'pass' | 'setup' | 'open'>('idle')
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [primary, setPrimary] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void p
      .onLoadSecondary()
      .then((v) => {
        if (!alive) return
        setSub(v)
        setSubReady(true)
      })
      .catch(() => {
        if (alive) setSubReady(true)
      })
    return () => {
      alive = false
    }
    // 只在打开面板时读一次；保存后由 saveSub 自己刷新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 展示两分钟后自动遮回去
  useEffect(() => {
    if (!primary) return
    const t = window.setTimeout(() => {
      setPrimary(null)
      setGate('idle')
      setPass('')
      setConfirm('')
    }, AUTO_HIDE_MS)
    return () => window.clearTimeout(t)
  }, [primary])

  const passLabel = p.guarded ? '保险库口令' : '查看密码'

  async function unlock() {
    if (busy) return
    setErr(null)
    if (gate === 'setup') {
      if (pass.length < REVEAL_MIN) {
        setErr(`查看密码至少 ${REVEAL_MIN} 位`)
        return
      }
      if (confirm !== pass) {
        setErr('两次输入不一致')
        return
      }
    }
    setBusy(true)
    try {
      if (gate === 'setup') {
        await p.onSetRevealPass(pass)
      } else {
        const ok = p.guarded ? await p.onCheckVaultPass(pass) : await p.onCheckRevealPass(pass)
        if (!ok) {
          setErr(`${passLabel}不正确`)
          return
        }
      }
      const secret = await p.onLoadPrimary()
      setPrimary(secret)
      setGate('open')
      setPass('')
      setConfirm('')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function hide() {
    setPrimary(null)
    setGate('idle')
    setPass('')
    setConfirm('')
    setErr(null)
  }

  async function copy(text: string, what: string) {
    const ok = await copyText(text)
    p.onToast(ok ? `${what}已复制` : '复制失败，长按文本手动选择')
  }

  async function saveSub(next: string | null) {
    if (busy) return
    if (next && !looksLikeToken(next)) {
      setErr('副密钥格式不对，检查是否复制完整')
      return
    }
    setErr(null)
    setBusy(true)
    try {
      await p.onSaveSecondary(next)
      const fresh = await p.onLoadSecondary()
      setSub(fresh)
      setSubEdit(false)
      setSubInput('')
      setSubConfirmDel(false)
      p.onToast(next ? '副密钥已保存' : '副密钥已删除')
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="mask" onClick={p.onClose} />
      <div className="sheet sec-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="bk-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3>{p.record.login ? `@${p.record.login}` : p.record.name}</h3>
            <div className="sheet-sub">
              主密钥 {p.record.preview}
              {p.record.hasSecondary && p.record.secondaryPreview
                ? ` · 副密钥 ${p.record.secondaryPreview}`
                : ' · 没配副密钥'}
            </div>
          </div>
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭">
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* ── 副密钥：直接展示 ── */}
        <div className="sec-block">
          <div className="sec-head">
            <span className="sec-tag ok">副密钥</span>
            <span className="sec-note">可直接查看</span>
          </div>

          {!subReady && <div className="sec-value mono dim">读取中…</div>}

          {subReady && sub && !subEdit && (
            <>
              <div className="sec-value mono">{sub}</div>
              <div className="sec-acts">
                <button className="btn ghost" style={{ flex: 1 }} onClick={() => void copy(sub, '副密钥')}>
                  <Icon name="copy" size={13} />
                  复制
                </button>
                <button
                  className="btn ghost"
                  style={{ flex: 1 }}
                  onClick={() => {
                    setSubEdit(true)
                    setSubInput(sub)
                    setErr(null)
                  }}
                >
                  更换
                </button>
                <button
                  className={`btn ${subConfirmDel ? 'danger' : 'ghost'}`}
                  onClick={() => {
                    if (subConfirmDel) {
                      void saveSub(null)
                      return
                    }
                    setSubConfirmDel(true)
                  }}
                >
                  {subConfirmDel ? '确认删除' : <Icon name="trash" size={13} />}
                </button>
              </div>
            </>
          )}

          {subReady && !sub && !subEdit && (
            <>
              <div className="sec-value dim">还没配副密钥。适合放只读或细粒度令牌，平时随手复制。</div>
              <button className="btn ghost block" style={{ marginTop: 8 }} onClick={() => setSubEdit(true)}>
                <Icon name="plus" size={13} />
                添加副密钥
              </button>
            </>
          )}

          {subEdit && (
            <>
              <div className="field" style={{ marginTop: 8 }}>
                <label htmlFor="secsub">{sub ? '替换为' : '副密钥'}</label>
                <input
                  id="secsub"
                  value={subInput}
                  autoCapitalize="off"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setSubInput(e.target.value)}
                  placeholder="ghp_… 或 github_pat_…"
                />
              </div>
              <div className="sec-acts">
                <button
                  className="btn ghost"
                  style={{ flex: 1 }}
                  onClick={() => {
                    setSubEdit(false)
                    setSubInput('')
                    setErr(null)
                  }}
                >
                  取消
                </button>
                <button
                  className="btn primary"
                  style={{ flex: 1 }}
                  disabled={busy || !subInput.trim()}
                  onClick={() => void saveSub(subInput.trim())}
                >
                  {busy ? '保存中…' : '保存'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── 主密钥：过闸门 ── */}
        <div className="sec-block">
          <div className="sec-head">
            <span className="sec-tag">主密钥</span>
            <span className="sec-note">
              {p.guarded ? '需保险库口令' : p.hasRevealPass ? '需查看密码' : '首次需设置查看密码'}
            </span>
          </div>

          {gate === 'open' && primary && (
            <>
              <div className="sec-value mono">{primary}</div>
              <div className="sec-acts">
                <button className="btn ghost" style={{ flex: 1 }} onClick={() => void copy(primary, '主密钥')}>
                  <Icon name="copy" size={13} />
                  复制
                </button>
                <button className="btn ghost" style={{ flex: 1 }} onClick={hide}>
                  收起
                </button>
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                两分钟后自动遮住。别截图，别发到聊天里。
              </div>
            </>
          )}

          {gate === 'idle' && (
            <>
              <div className="sec-value dim">已加密保存。点下面按钮输密码后展示。</div>
              <button
                className="btn ghost block"
                style={{ marginTop: 8 }}
                onClick={() => {
                  setErr(null)
                  setGate(!p.guarded && !p.hasRevealPass ? 'setup' : 'pass')
                }}
              >
                <Icon name="lock" size={13} />
                输入{!p.guarded && !p.hasRevealPass ? '并设置查看密码' : `${passLabel}查看`}
              </button>
            </>
          )}

          {(gate === 'pass' || gate === 'setup') && (
            <>
              {gate === 'setup' && (
                <div className="hint" style={{ marginTop: 6 }}>
                  这是本机的一道闸门，只用来挡住「拿到已解锁手机的人」。密码不会上传，
                  忘了可以在设置里清掉重设，令牌不受影响。
                </div>
              )}
              <div className="field" style={{ marginTop: 8 }}>
                <label htmlFor="secpass">
                  {gate === 'setup' ? `查看密码（至少 ${REVEAL_MIN} 位）` : passLabel}
                </label>
                <input
                  id="secpass"
                  type="password"
                  value={pass}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={(e) => setPass(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && gate === 'pass') void unlock()
                  }}
                  placeholder={gate === 'setup' ? '设一个只有你知道的密码' : `输入${passLabel}`}
                />
              </div>
              {gate === 'setup' && (
                <div className="field">
                  <label htmlFor="secpass2">再输一次</label>
                  <input
                    id="secpass2"
                    type="password"
                    value={confirm}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="确认密码"
                  />
                </div>
              )}
              <div className="sec-acts">
                <button className="btn ghost" style={{ flex: 1 }} onClick={hide}>
                  取消
                </button>
                <button
                  className="btn primary"
                  style={{ flex: 1 }}
                  disabled={busy || !pass}
                  onClick={() => void unlock()}
                >
                  {busy ? '核对中…' : gate === 'setup' ? '设置并查看' : '解锁查看'}
                </button>
              </div>
            </>
          )}
        </div>

        {err && <div className="err">{err}</div>}

        <div className="bk-foot">
          <Icon name="key" size={11} />
          <span>
            两把密钥都按 AES-256-GCM 加密落盘，主密钥额外过一道查看闸门；副密钥按设定不设防。
          </span>
        </div>
      </div>
    </>
  )
}
