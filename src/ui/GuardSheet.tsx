import { useState } from 'react'
import { Icon } from './icons'

export type GuardMode = 'set' | 'change' | 'clear' | 'migrate'

interface Props {
  mode: GuardMode
  busy: boolean
  error: string | null
  onCancel: () => void
  onSubmit: (input: { current: string; next: string }) => void
}

const TITLE: Record<GuardMode, string> = {
  set: '开启启动验证',
  change: '修改启动口令',
  clear: '关闭启动验证',
  migrate: '迁移为免密解锁',
}

export function GuardSheet({ mode, busy, error, onCancel, onSubmit }: Props) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')

  const needsCurrent = mode !== 'set'
  const needsNext = mode === 'set' || mode === 'change'
  const tooShort = needsNext && next.length > 0 && next.length < 8
  const mismatch = needsNext && confirm.length > 0 && confirm !== next

  const canSubmit =
    !busy &&
    (!needsCurrent || current.length > 0) &&
    (!needsNext || (next.length >= 8 && confirm === next))

  return (
    <>
      <div className="mask" onClick={onCancel} />
      <div className="sheet">
        <div className="grab" />
        <h3>{TITLE[mode]}</h3>
        <div className="sheet-sub">
          {mode === 'set' &&
            '开启后每次启动都要输入这个口令。它只用来包裹设备密钥，不会上传，也无法找回 —— 忘了就只能重新导入令牌。'}
          {mode === 'change' && '先验证当前口令，再设置新的。令牌本身不会被重新加密，只是换了把钥匙。'}
          {mode === 'clear' && '输入当前口令确认。关闭后打开 App 就直接进入，不再询问。'}
          {mode === 'migrate' &&
            '旧库的密钥由口令派生，所以每次启动都要输。输入一次当前口令，令牌会用本机设备密钥重新加密，以后不再询问。'}
        </div>

        {needsCurrent && (
          <div className="field">
            <label htmlFor="gc">当前口令</label>
            <input
              id="gc"
              type="password"
              value={current}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="当前启动口令"
            />
          </div>
        )}

        {needsNext && (
          <>
            <div className="field">
              <label htmlFor="gn">新口令（至少 8 位）</label>
              <input
                id="gn"
                type="password"
                value={next}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(e) => setNext(e.target.value)}
                placeholder="新启动口令"
              />
              {tooShort && <div className="err">口令至少 8 位</div>}
            </div>
            <div className="field">
              <label htmlFor="gn2">再输一次</label>
              <input
                id="gn2"
                type="password"
                value={confirm}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="确认新口令"
              />
              {mismatch && <div className="err">两次输入不一致</div>}
            </div>
          </>
        )}

        {error && <div className="err">{error}</div>}

        <div className="btns">
          <button className="btn ghost" style={{ flex: 1 }} onClick={onCancel}>
            取消
          </button>
          <button
            className={`btn ${mode === 'clear' ? 'danger' : 'primary'}`}
            style={{ flex: 1 }}
            disabled={!canSubmit}
            onClick={() => onSubmit({ current, next })}
          >
            {busy ? '处理中…' : mode === 'clear' ? '关闭验证' : mode === 'migrate' ? '开始迁移' : '保存'}
          </button>
        </div>

        <div className="sheet-sub" style={{ marginTop: 12, display: 'flex', gap: 6 }}>
          <Icon name="lock" size={12} />
          令牌始终是 AES-256-GCM 密文存储，开启验证只是把钥匙也锁起来。
        </div>
      </div>
    </>
  )
}
