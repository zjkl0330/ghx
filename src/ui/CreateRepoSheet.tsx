import { useState } from 'react'
import { validateRepoName } from '../lib/repos'
import { Icon } from './icons'

interface Props {
  owner: string | null
  busy: boolean
  error: string | null
  onCancel: () => void
  onSubmit: (input: { name: string; description: string; private: boolean; autoInit: boolean }) => void
}

export function CreateRepoSheet(p: Props) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [autoInit, setAutoInit] = useState(true)
  const [touched, setTouched] = useState(false)

  const nameError = touched ? validateRepoName(name) : null
  const canSubmit = validateRepoName(name) === null && !p.busy

  return (
    <div className="mask" onClick={p.onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h3>新建仓库</h3>
        <div className="sheet-sub">
          {p.owner ? `建在 @${p.owner} 名下` : '导入令牌并连接账号后生效'}
        </div>

        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="rn">仓库名</label>
          <input
            id="rn"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setTouched(true)
            }}
            placeholder="例如 ghx"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            style={nameError ? { borderColor: 'var(--red)' } : undefined}
          />
          {nameError ? (
            <div className="hint" style={{ color: 'var(--red)' }}>
              {nameError}
            </div>
          ) : (
            <div className="hint">
              {name.trim() ? `${p.owner ?? '你'}/${name.trim()}` : '建好后地址不可更改，只能改名'}
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor="rd">描述（可选）</label>
          <input
            id="rd"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="一句话说明这个仓库做什么"
            maxLength={350}
          />
        </div>

        <div className="field">
          <label>可见度</label>
          <div className="seg" style={{ marginTop: 0 }}>
            <button className={isPrivate ? 'on' : ''} onClick={() => setIsPrivate(true)}>
              私有
            </button>
            <button className={!isPrivate ? 'on' : ''} onClick={() => setIsPrivate(false)}>
              公开
            </button>
          </div>
          <div className="hint">
            {isPrivate ? '只有你和你授权的人能看到' : '任何人可搜索到，公开后随时可以转私有'}
          </div>
        </div>

        <button
          className="actrow"
          style={{ marginTop: 12, borderRadius: 10, border: '1px solid var(--line)' }}
          onClick={() => setAutoInit((v) => !v)}
        >
          <span className="act-ic">
            <Icon name="check" size={15} style={{ opacity: autoInit ? 1 : 0.25 }} />
          </span>
          <span className="act-txt">
            <b>初始化 README</b>
            <i>勾选后仓库立即有 main 分支，可直接 clone</i>
          </span>
        </button>

        {p.error && <div className="errline" style={{ marginTop: 10 }}>{p.error}</div>}

        <div className="btns">
          <button className="btn ghost" onClick={p.onCancel} disabled={p.busy}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={!canSubmit}
            onClick={() =>
              p.onSubmit({
                name: name.trim(),
                description: desc.trim(),
                private: isPrivate,
                autoInit,
              })
            }
          >
            {p.busy ? '创建中…' : `创建${isPrivate ? '私有' : '公开'}仓库`}
          </button>
        </div>
      </div>
    </div>
  )
}
