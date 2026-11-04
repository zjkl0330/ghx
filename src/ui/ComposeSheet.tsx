import { useState } from 'react'
import { Icon } from './icons'

export type ComposeMode = 'issue' | 'pull'

/**
 * 新建 Issue / PR。
 *
 * 两者字段差别只在 PR 需要 head/base 分支，所以合成一个表单，
 * 少一套重复的样式与校验。
 */
export function ComposeSheet(p: {
  mode: ComposeMode
  owner: string
  repo: string
  branches: string[]
  defaultBranch: string
  busy: boolean
  error: string | null
  onSubmit: (input: { title: string; body: string; head?: string; base?: string }) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [head, setHead] = useState(p.branches[0] ?? p.defaultBranch)
  const [base, setBase] = useState(p.defaultBranch)

  const valid = title.trim().length > 0 && (p.mode === 'issue' || (head && base && head !== base))

  return (
    <div className="mask" onClick={p.onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h3>{p.mode === 'issue' ? '新建 Issue' : '新建 Pull request'}</h3>
        <div className="sheet-sub">
          {p.owner}/{p.repo}
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>标题</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={p.mode === 'issue' ? '一句话说明问题' : '这次改了什么'}
            autoFocus
          />
        </div>

        {p.mode === 'pull' && (
          <>
            <div className="field" style={{ marginTop: 10 }}>
              <label>源分支</label>
              <select className="input mono" value={head} onChange={(e) => setHead(e.target.value)}>
                {p.branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label>目标分支</label>
              <select className="input mono" value={base} onChange={(e) => setBase(e.target.value)}>
                {p.branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            {head === base && <div className="errline">源分支和目标分支不能一样</div>}
          </>
        )}

        <div className="field" style={{ marginTop: 10 }}>
          <label>正文</label>
          <textarea
            className="textarea"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="支持 Markdown"
          />
        </div>

        {p.error && <div className="errline">{p.error}</div>}

        <div className="btns" style={{ marginTop: 14 }}>
          <button className="btn ghost" onClick={p.onCancel} disabled={p.busy}>
            取消
          </button>
          <button
            className="btn primary"
            disabled={p.busy || !valid}
            onClick={() =>
              p.onSubmit({
                title: title.trim(),
                body,
                ...(p.mode === 'pull' ? { head, base } : {}),
              })
            }
          >
            <Icon name="plus" size={14} />
            {p.busy ? '提交中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
