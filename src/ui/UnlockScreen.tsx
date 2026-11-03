import { useState } from 'react'
import { Icon } from './icons'

interface Props {
  busy: boolean
  error: string | null
  /** 老版本口令保险库可一次性迁移为免密，迁移后不再要求口令 */
  canMigrate: boolean
  onSubmit: (passphrase: string) => void
  onMigrate: (passphrase: string) => void
}

export function UnlockScreen({ busy, error, canMigrate, onSubmit, onMigrate }: Props) {
  const [pass, setPass] = useState('')
  const [show, setShow] = useState(false)

  const canSubmit = pass.length > 0 && !busy

  return (
    <div className="app">
      <div className="center-screen">
        <div className="logo-mark">
          <Icon name="lock" size={22} />
        </div>
        <h1 className="title">需要口令解锁</h1>
        <p className="muted">
          {canMigrate
            ? '这是旧版本创建的保险库，密钥由口令派生。输一次口令把它迁移成免密模式，以后打开就不用再输了。'
            : '你开启了启动验证。输入口令解开设备密钥，数据本身仍存在本机。'}
        </p>

        <div className="field">
          <label htmlFor="pass">启动口令</label>
          <div style={{ position: 'relative' }}>
            <input
              id="pass"
              type={show ? 'text' : 'password'}
              value={pass}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSubmit) onSubmit(pass)
              }}
              placeholder="输入口令"
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
        </div>

        {error && <div className="err">{error}</div>}

        <button
          className="btn blue block"
          style={{ marginTop: 18 }}
          disabled={!canSubmit}
          onClick={() => onSubmit(pass)}
        >
          {busy ? '处理中…' : '解锁'}
        </button>

        {canMigrate && (
          <button
            className="btn ghost block"
            style={{ marginTop: 10 }}
            disabled={!canSubmit}
            onClick={() => onMigrate(pass)}
          >
            用这次口令迁移成免密
          </button>
        )}

        <p className="muted" style={{ marginTop: 16, fontSize: 10.5 }}>
          口令只在本机参与解密，不会发送到任何服务器，也不会被保存。
        </p>
      </div>
    </div>
  )
}
