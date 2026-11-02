import { useState } from 'react'
import { Icon } from './icons'

interface Props {
  mode: 'create' | 'unlock'
  busy: boolean
  error: string | null
  onSubmit: (passphrase: string) => void
}

export function UnlockScreen({ mode, busy, error, onSubmit }: Props) {
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)

  const tooShort = pass.length > 0 && pass.length < 8
  const mismatch = mode === 'create' && confirm.length > 0 && confirm !== pass
  const canSubmit = pass.length >= 8 && !mismatch && !busy

  return (
    <div className="app">
      <div className="center-screen">
        <div className="logo-mark">
          <Icon name="key" size={22} />
        </div>
        <h1 className="title">{mode === 'create' ? '创建令牌保险库' : '解锁保险库'}</h1>
        <p className="muted">
          {mode === 'create'
            ? '设置一个本地口令。令牌用 AES-256-GCM 加密，密钥由该口令经 PBKDF2 派生，不会离开这台设备，也无法在忘记后找回。'
            : '输入口令解锁。口令只用于本机解密，不会发送到任何服务器。'}
        </p>

        <div className="field">
          <label htmlFor="pass">口令（至少 8 位）</label>
          <div style={{ position: 'relative' }}>
            <input
              id="pass"
              type={show ? 'text' : 'password'}
              value={pass}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => setPass(e.target.value)}
              placeholder="用于加密本地令牌"
            />
            <button
              type="button"
              className="icon-btn"
              style={{ position: 'absolute', right: 2, top: 3 }}
              onClick={() => setShow((v) => !v)}
              aria-label="切换显示"
            >
              <Icon name={show ? 'eyeOff' : 'eye'} size={16} />
            </button>
          </div>
          {tooShort && <div className="err">口令至少 8 位</div>}
        </div>

        {mode === 'create' && (
          <div className="field">
            <label htmlFor="pass2">再输一次</label>
            <input
              id="pass2"
              type={show ? 'text' : 'password'}
              value={confirm}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="确认口令"
            />
            {mismatch && <div className="err">两次输入不一致</div>}
          </div>
        )}

        {error && <div className="err">{error}</div>}

        <button
          className="btn blue block"
          style={{ marginTop: 18 }}
          disabled={!canSubmit}
          onClick={() => onSubmit(pass)}
        >
          {busy ? '处理中…' : mode === 'create' ? '创建并进入' : '解锁'}
        </button>

        <p className="muted" style={{ marginTop: 16, fontSize: 10.5 }}>
          口令丢失等于令牌丢失，没有找回途径。建议与你的密码管理器里的主口令一致。
        </p>
      </div>
    </div>
  )
}
