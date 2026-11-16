import { useEffect, useState } from 'react'
import type { IssueTemplate } from '../lib/templates'
import { Icon } from './icons'

export type ComposeMode = 'issue' | 'pull'

export interface ComposeSubmit {
  title: string
  body: string
  head?: string
  base?: string
  /** 模板里带的标签，创建时一并提交 */
  labels?: string[]
}

/**
 * 新建 Issue / PR。
 *
 * 两者字段差别只在 PR 需要 head/base 分支，所以合成一个表单，
 * 少一套重复的样式与校验。
 *
 * 模板：仓库里有 `.github/ISSUE_TEMPLATE/*` 时先让人挑一个，挑完把正文铺进来。
 * 表单式（yml）模板在网页端是渲染成控件的，REST 只吃 Markdown，
 * 这里给的是「已拼好的骨架」，界面会注明，避免让人以为漏了控件。
 */
export function ComposeSheet(p: {
  mode: ComposeMode
  owner: string
  repo: string
  branches: string[]
  defaultBranch: string
  busy: boolean
  error: string | null
  templates: IssueTemplate[]
  templatesLoading: boolean
  prTemplate: { path: string; body: string } | null
  onSubmit: (input: ComposeSubmit) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [head, setHead] = useState(p.branches[0] ?? p.defaultBranch)
  const [base, setBase] = useState(p.defaultBranch)
  const [tplPath, setTplPath] = useState<string | null>(null)
  /** 模板写进标题的那部分，用户没改过才允许被下一个模板覆盖 */
  const [autoTitle, setAutoTitle] = useState('')

  const active = p.templates.find((t) => t.path === tplPath) ?? null

  // PR 模板是异步读的，读到了再填；用户已经开始写就不覆盖
  useEffect(() => {
    if (p.mode !== 'pull' || !p.prTemplate) return
    setBody((cur) => (cur.trim() ? cur : p.prTemplate!.body))
  }, [p.mode, p.prTemplate])

  const valid = title.trim().length > 0 && (p.mode === 'issue' || (head && base && head !== base))

  function pick(t: IssueTemplate | null) {
    setTplPath(t?.path ?? null)
    if (!t) {
      setBody('')
      if (title === autoTitle) setTitle('')
      setAutoTitle('')
      return
    }
    setBody(t.body)
    if (t.title && (!title.trim() || title === autoTitle)) {
      setTitle(t.title)
      setAutoTitle(t.title)
    }
  }

  return (
    <div className="mask" onClick={p.onCancel}>
      <div className="sheet" style={{ maxHeight: "92vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h3>{p.mode === 'issue' ? '新建 Issue' : '新建 Pull request'}</h3>
        <div className="sheet-sub">
          {p.owner}/{p.repo}
        </div>

        {p.mode === 'issue' && (
          <div className="sheet-sec" style={{ marginTop: 12 }}>
            <div className="sheet-sec-label">模板</div>
            {p.templatesLoading ? (
              <div className="hint" style={{ marginTop: 6 }}>正在读仓库模板…</div>
            ) : p.templates.length === 0 ? (
              <div className="hint" style={{ marginTop: 6 }}>这个仓库没有 Issue 模板，直接写就行</div>
            ) : (
              <>
                <div className="chips" style={{ margin: '8px 0 0' }}>
                  <button className={`chip${tplPath === null ? ' on' : ''}`} onClick={() => pick(null)}>
                    空白
                  </button>
                  {p.templates.map((t) => (
                    <button
                      key={t.path}
                      className={`chip${tplPath === t.path ? ' on' : ''}`}
                      onClick={() => pick(t)}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
                {active && (
                  <div className="hint" style={{ marginTop: 6 }}>
                    {active.about || '已套用模板'}
                    {active.labels.length > 0 ? ` · 会带上标签 ${active.labels.join('、')}` : ''}
                    {active.fromForm ? ' · 表单模板已拼成 Markdown，字段标题可以改' : ''}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {p.mode === 'pull' && p.prTemplate && (
          <div className="hint" style={{ marginTop: 10 }}>
            已套用 <span className="mono">{p.prTemplate.path}</span>
          </div>
        )}

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
                ...(p.mode === 'issue' && active && active.labels.length > 0 ? { labels: active.labels } : {}),
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
