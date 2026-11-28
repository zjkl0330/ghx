import { useState } from 'react'
import { REVEAL_MIN } from '../lib/reveal'
import { Icon } from './icons'

export type RevealMode = 'set' | 'clear'

interface Props {
  mode: RevealMode
  hasPass: boolean
  busy: boolean
  error: string | null
  onCancel: () => void
  onSubmit: (next: string) => void
}

/**
 * 查看密码的设置 / 清除。
 *
 * 只有一件事要注意：它是闸门不是加密，文案必须把这点说透，
 * 否则用户会以为「设了密码令牌就更安全了」，然后放心把手机借出去。
 */
export function RevealSheet({ mode, hasPass, busy, error, onCancel, onSubmit }: Props) {
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const tooShort = next.length > 0 && next.length < REVEAL_MIN
  const mismatch = confirm.length > 0 && confirm !== next
  const canSubmit = mode === 'clear' ? !busy : !busy && next.length >= REVEAL_MIN && confirm === next

  return (
    <>
      <div className="mask" onClick={onCancel} />
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h3>{mode === 'clear' ? '清除查看密码' : hasPass ? '修改查看密码' : '设置查看密码'}</h3>
        <div className="sheet-sub">
          {mode === 'clear'
            ? '清除后，主密钥又变成「点一下就能看」。令牌不会丢，只是这道闸门撤销。'
            : '副密钥按设定不需要密码；主密钥要输这个密码才展示。它挡的是拿到已解锁手机的人，不会重新加密令牌。'}
        </div>

        {mode === 'set' && (
          <>
            <div className="field">
              <label htmlFor="rv1">新密码（至少 {REVEAL_MIN} 位）</label>
              <input
                id="rv1"
                type="password"
                value={next}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(e) => setNext(e.target.value)}
                placeholder="只有你知道的一串字符"
              />
              {tooShort && <div className="err">密码至少 {REVEAL_MIN} 位</div>}
            </div>
            <div className="field">
              <label htmlFor="rv2">再输一次</label>
              <input
                id="rv2"
                type="password"
                value={confirm}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="确认密码"
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
            onClick={() => onSubmit(next)}
          >
            {busy ? '处理中…' : mode === 'clear' ? '确认清除' : '保存'}
          </button>
        </div>

        <div className="sheet-sub" style={{ marginTop: 12, display: 'flex', gap: 6 }}>
          <Icon name="lock" size={12} />
          密码只在本机存盐与哈希（PBKDF2-SHA256），无法找回；忘了就清掉重设。
        </div>
      </div>
    </>
  )
}
