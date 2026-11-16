import { useCallback, useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import { copyText } from '../lib/clipboard'
import {
  createGist,
  deleteGist,
  draftFromGist,
  filesPatch,
  getGist,
  gistBytes,
  gistFiles,
  gistTitle,
  hasChanges,
  isGistStarred,
  newDraftFile,
  starGist,
  updateGist,
  validateDraft,
  type DraftFile,
  type Gist,
} from '../lib/gists'
import { formatBytes, relTime } from '../lib/format'
import { openExternal } from '../lib/update'
import { PageHeader, PageState } from './PageHeader'
import { Icon } from './icons'

/**
 * 单个 Gist：看、改、删、star。
 *
 * `id` 为空表示新建 —— 直接进编辑态，省一次「先建一个空壳」的往返。
 * 编辑走 `PATCH`，只发变化的文件：没动过的不发，删掉的给 `null`，
 * 改名是一次请求里的「旧名 null + 新名 content」。
 */
export function GistPage(p: {
  client: GitHubClient | null
  /** 空字符串 = 新建 */
  id: string
  onBack: () => void
  /** 新建成功后回填 id，让路由从「新建」变成「详情」 */
  onSaved: (id: string) => void
  onDeleted: () => void
  onToast: (s: string) => void
}) {
  const isNew = !p.id
  const [gist, setGist] = useState<Gist | null>(null)
  const [loading, setLoading] = useState(!isNew)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(isNew)
  const [desc, setDesc] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [draft, setDraft] = useState<DraftFile[]>(() => (isNew ? [newDraftFile(1)] : []))
  const [busy, setBusy] = useState(false)
  const [starred, setStarred] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  const load = useCallback(async () => {
    if (isNew || !p.client) return
    setLoading(true)
    setError(null)
    try {
      const g = await getGist(p.client, p.id)
      setGist(g)
      setDesc(g.description ?? '')
      setIsPublic(g.public)
      setDraft(draftFromGist(g))
      // star 状态单独问一次；失败就当没 star，不打扰用户
      setStarred(await isGistStarred(p.client, p.id))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [p.client, p.id, isNew])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!confirmDel) return
    const t = setTimeout(() => setConfirmDel(false), 4000)
    return () => clearTimeout(t)
  }, [confirmDel])

  function patchFile(key: string, next: Partial<DraftFile>) {
    setDraft((cur) => cur.map((f) => (f.key === key ? { ...f, ...next } : f)))
  }

  async function save() {
    if (!p.client) return
    const problem = validateDraft(draft)
    if (problem) {
      p.onToast(problem.text)
      return
    }
    setBusy(true)
    try {
      if (isNew) {
        const g = await createGist(p.client, { description: desc, files: draft, public: isPublic })
        p.onToast('已创建 Gist')
        setGist(g)
        setEditing(false)
        p.onSaved(g.id)
        return
      }
      const patch = filesPatch(gist ? gistFiles(gist) : [], draft)
      const descChanged = desc !== (gist?.description ?? '')
      if (!descChanged && !hasChanges(patch)) {
        setEditing(false)
        p.onToast('没有改动')
        return
      }
      const g = await updateGist(p.client, p.id, {
        ...(descChanged ? { description: desc } : {}),
        files: patch,
      })
      setGist(g)
      setDraft(draftFromGist(g))
      setEditing(false)
      p.onToast('已保存')
    } catch (err) {
      p.onToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!p.client) return
    if (!confirmDel) {
      setConfirmDel(true)
      return
    }
    setBusy(true)
    try {
      await deleteGist(p.client, p.id)
      p.onToast('已删除')
      p.onDeleted()
    } catch (err) {
      p.onToast((err as Error).message)
    } finally {
      setBusy(false)
      setConfirmDel(false)
    }
  }

  async function toggleStar() {
    if (!p.client || isNew) return
    const next = !starred
    setStarred(next)
    try {
      await starGist(p.client, p.id, next)
      p.onToast(next ? '已加星' : '已取消星标')
    } catch (err) {
      setStarred(!next)
      p.onToast((err as Error).message)
    }
  }

  function copyAll() {
    if (!gist) return
    const files = gistFiles(gist)
    const text = files.map((f) => `===== ${f.filename} =====\n${f.content ?? ''}`).join('\n\n')
    void copyText(text).then((ok) => p.onToast(ok ? `已复制 ${files.length} 个文件` : '复制失败，长按内容手动选择'))
  }

  const files = gist ? gistFiles(gist) : []

  return (
    <>
      <PageHeader
        title={isNew ? '新建 Gist' : 'Gist'}
        sub={isNew ? '公开或私有，随时能改' : gist ? `${gist.public ? '公开' : '私有'} · ${files.length} 个文件` : ''}
        onBack={p.onBack}
        right={
          !isNew && gist && !editing ? (
            <button className="icon-btn" onClick={() => setEditing(true)} aria-label="编辑">
              <Icon name="edit" size={16} />
            </button>
          ) : undefined
        }
      />

      <div className="page" style={{ marginTop: 0 }}>
        <PageState loading={loading} error={error} onRetry={() => void load()} />

        {!loading && !error && !editing && gist && (
          <>
            <div className="gist-head">
              <b>{gistTitle(gist)}</b>
              <div className="hint">
                {gist.public ? '公开' : '私有'} · {files.length} 个文件 · {formatBytes(gistBytes(gist))} ·{' '}
                {relTime(gist.updated_at)} 更新
                {gist.comments > 0 ? ` · ${gist.comments} 条评论` : ''}
              </div>
            </div>

            <div className="gist-acts">
              <button className={`btn ghost tiny${starred ? ' on' : ''}`} onClick={() => void toggleStar()}>
                <Icon name={starred ? 'starOn' : 'star'} size={14} />
                {starred ? '已加星' : '加星'}
              </button>
              <button className="btn ghost tiny" onClick={copyAll}>
                <Icon name="copy" size={14} />
                复制全部
              </button>
              <button className="btn ghost tiny" onClick={() => void copyText(`https://gist.github.com/${gist.id}`).then((ok) => p.onToast(ok ? '已复制链接' : '复制失败'))}>
                <Icon name="link" size={14} />
                链接
              </button>
              <button
                className="btn ghost tiny"
                onClick={() => {
                  if (gist.html_url) void openExternal(gist.html_url).catch((e) => p.onToast((e as Error).message))
                  else p.onToast('没有网页地址')
                }}
              >
                <Icon name="external" size={14} />
                打开
              </button>
              <button
                className={`btn ghost tiny${confirmDel ? ' danger' : ''}`}
                disabled={busy}
                onClick={() => void remove()}
              >
                <Icon name="trash" size={14} />
                {confirmDel ? '确认删除' : '删除'}
              </button>
            </div>

            {files.map((f) => (
              <div className="panel gist-file" key={f.filename}>
                <div className="gist-file-head">
                  <span className="mono ellipsis">{f.filename}</span>
                  <span className="row-meta">
                    {f.language ?? '纯文本'}
                    {f.size ? ` · ${formatBytes(f.size)}` : ''}
                  </span>
                  <button
                    className="icon-btn"
                    aria-label="复制这个文件"
                    onClick={() =>
                      void copyText(f.content ?? '').then((ok) => p.onToast(ok ? `已复制 ${f.filename}` : '复制失败'))
                    }
                  >
                    <Icon name="copy" size={14} />
                  </button>
                </div>
                {f.truncated ? (
                  <div className="hint" style={{ padding: '0 0 10px' }}>
                    这个文件太大，接口只给了前一部分，要用完整内容请打开网页。
                  </div>
                ) : (
                  <pre className="gist-pre">{f.content && f.content.length > 0 ? f.content : '（空文件）'}</pre>
                )}
              </div>
            ))}
          </>
        )}

        {!loading && !error && editing && (
          <div className="gist-form">
            <div className="field" style={{ marginTop: 12 }}>
              <label>描述</label>
              <input
                className="input"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="这个片段是做什么的"
                autoFocus={isNew}
              />
            </div>

            <div className="field" style={{ marginTop: 10 }}>
              <label>可见性</label>
              <div className="seg" style={{ margin: '8px 0 0' }}>
                <button className={!isPublic ? 'on' : ''} onClick={() => setIsPublic(false)}>
                  私有
                </button>
                <button className={isPublic ? 'on' : ''} onClick={() => setIsPublic(true)}>
                  公开
                </button>
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                {isPublic ? '公开 Gist 会出现在你的主页和搜索里。' : '私有 Gist 只有你和拿到链接的人能看。'}
              </div>
            </div>

            {draft.map((f) => (
              <div className="panel gist-edit" key={f.key}>
                <div className="gist-edit-head">
                  <input
                    className="input mono"
                    value={f.name}
                    onChange={(e) => patchFile(f.key, { name: e.target.value })}
                    placeholder="文件名，例如 notes.md"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                  <button
                    className="icon-btn"
                    aria-label="删掉这个文件"
                    onClick={() => setDraft((cur) => cur.filter((x) => x.key !== f.key))}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
                <textarea
                  className="textarea mono gist-ta"
                  value={f.content}
                  onChange={(e) => patchFile(f.key, { content: e.target.value })}
                  placeholder="内容，支持任意文本"
                  spellCheck={false}
                  autoCapitalize="off"
                />
                <div className="hint" style={{ marginTop: 6 }}>
                  {f.content.split('\n').length} 行 · {f.content.length} 字符
                  {f.origin && f.origin !== f.name ? ` · 原名 ${f.origin}（保存时按改名处理）` : ''}
                </div>
              </div>
            ))}

            <button
              className="btn ghost block"
              style={{ marginTop: 10 }}
              onClick={() => setDraft((cur) => [...cur, newDraftFile(cur.length + 1)])}
            >
              <Icon name="plus" size={14} />
              添加文件
            </button>

            <div className="btns" style={{ marginTop: 14 }}>
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() => {
                  if (isNew) {
                    p.onBack()
                    return
                  }
                  setDesc(gist?.description ?? '')
                  setIsPublic(gist?.public ?? false)
                  setDraft(gist ? draftFromGist(gist) : [])
                  setEditing(false)
                }}
              >
                取消
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void save()}>
                {busy ? '保存中…' : isNew ? '创建' : '保存'}
              </button>
            </div>

            <div className="hint" style={{ padding: '10px 0 24px' }}>
              保存时只提交改动过的文件；删掉的文件会从 Gist 里移除。Gist 没有版本锁，两个人同时改会以后保存的为准。
            </div>
          </div>
        )}
      </div>
    </>
  )
}
