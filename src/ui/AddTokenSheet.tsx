import { useState } from 'react'
import { looksLikeToken } from '../lib/vault'
import { Icon } from './icons'

interface Props {
  busy: boolean
  error: string | null
  onCancel: () => void
  onSubmit: (input: {
    name: string
    secret: string
    secondary: string | null
    expiresAt: string | null
  }) => void
}

export function AddTokenSheet({ busy, error, onCancel, onSubmit }: Props) {
  const [name, setName] = useState('')
  const [secret, setSecret] = useState('')
  const [secondary, setSecondary] = useState('')
  const [expires, setExpires] = useState('')
  const valid = looksLikeToken(secret)
  const subValid = !secondary.trim() || looksLikeToken(secondary)

  return (
    <>
      <div className="mask" onClick={onCancel} />
      <div className="sheet">
        <div className="grab" />
        <h3>导入令牌</h3>
        <div className="sheet-sub">
          在 github.com/settings/tokens 生成后粘贴到这里。需要 Administration: write 才能改可见度。
        </div>

        <div className="field">
          <label htmlFor="tn">名称</label>
          <input
            id="tn"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如 主力令牌"
            autoCapitalize="off"
          />
        </div>

        <div className="field">
          <label htmlFor="ts">令牌</label>
          <input
            id="ts"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="ghp_… 或 github_pat_…"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            style={{ paddingRight: 40 }}
          />
          {secret.length > 0 && !valid && <div className="err">格式不像 GitHub 令牌，请检查是否复制完整</div>}
        </div>

        <div className="field">
          <label htmlFor="te">过期时间（可选）</label>
          <input id="te" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
          <div className="hint">GitHub 不会在接口里返回过期时间，填了才能提前提醒。</div>
        </div>

        <div className="field">
          <label htmlFor="tsub">副密钥（可选）</label>
          <input
            id="tsub"
            value={secondary}
            onChange={(e) => setSecondary(e.target.value)}
            placeholder="同一账号的另一枚令牌"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
          />
          {secondary.length > 0 && !subValid && <div className="err">副密钥格式不像 GitHub 令牌</div>}
          <div className="hint">
            同一账号可以存两把：副密钥在令牌面板里直接展示（适合只读/细粒度令牌），
            主密钥需要先输查看密码。不需要就留空。
          </div>
        </div>

        {error && <div className="err">{error}</div>}

        <div className="btns">
          <button className="btn ghost" style={{ flex: 1 }} onClick={onCancel}>
            取消
          </button>
          <button
            className="btn primary"
            style={{ flex: 1 }}
            disabled={!valid || !subValid || busy}
            onClick={() =>
              onSubmit({
                name,
                secret,
                secondary: secondary.trim() || null,
                expiresAt: expires ? new Date(expires).toISOString() : null,
              })
            }
          >
            {busy ? '导入中…' : '加密保存'}
          </button>
        </div>

        <div className="sheet-sub" style={{ marginTop: 12, display: 'flex', gap: 6 }}>
          <Icon name="lock" size={12} />
          令牌用本机密钥加密后存盘，明文只在请求时短暂存在内存。
        </div>
      </div>
    </>
  )
}
