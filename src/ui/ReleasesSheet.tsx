import { useCallback, useEffect, useState } from 'react'
import { githubUrlAt } from '../lib/mirrors'
import type { GitHubClient } from '../lib/api'
import { deleteTag } from '../lib/refs'
import { deleteAsset, publishRelease, updateRelease } from '../lib/release-ext'
import {
  assetKind,
  excerpt,
  mirrorDownloadUrl,
  pickAsset,
  releaseDate,
  releaseTitle,
  sortReleases,
  totalDownloads,
  validateTag,
} from '../lib/releases'
import type { Release, ReleaseAsset, Repo } from '../lib/types'
import { formatBytes, openExternal } from '../lib/update'
import { Icon } from './icons'

interface Props {
  repo: Repo
  client: GitHubClient | null
  mirror: string
  onClose: () => void
  onToast: (msg: string) => void
  onAudit: (detail: string) => void
}

/** 附件上限给个软提醒：超过这个体积在手机上走内存缓冲容易失败 */
const BIG_ASSET = 100 * 1024 * 1024

export function ReleasesSheet(p: Props) {
  const [list, setList] = useState<Release[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [tag, setTag] = useState('')
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [pre, setPre] = useState(false)
  /** 先存草稿：草稿不会生成 tag，也不会出现在仓库首页 */
  const [draft, setDraft] = useState(false)

  /** 正在编辑的发行版 id，null 表示没有在编辑 */
  const [editId, setEditId] = useState<number | null>(null)
  const [eTag, setETag] = useState('')
  const [eName, setEName] = useState('')
  const [eBody, setEBody] = useState('')
  const [ePre, setEPre] = useState(false)

  /** 确认删除时是否顺带删掉 tag —— GitHub 默认只删发行版，tag 会留下 */
  const [dropTag, setDropTag] = useState(true)
  /** 待确认删除的附件 id */
  const [confirmAsset, setConfirmAsset] = useState<number | null>(null)

  const load = useCallback(
    async (fresh = false) => {
      if (!p.client) return
      setLoading(true)
      setError(null)
      try {
        const { data } = await p.client.listReleases(p.repo.owner, p.repo.name, 1, 20, fresh)
        setList(sortReleases(data))
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [p.client, p.repo.owner, p.repo.name],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function create() {
    if (!p.client || busy) return
    const bad = validateTag(tag)
    if (bad) {
      setError(bad)
      return
    }
    setBusy('create')
    setError(null)
    try {
      const { data } = await p.client.createRelease(p.repo.owner, p.repo.name, {
        tag: tag.trim(),
        title: title.trim(),
        body: notes,
        prerelease: pre,
        draft,
        target: p.repo.default_branch,
      })
      if (data) setList((prev) => sortReleases([data, ...prev]))
      setFormOpen(false)
      setTag('')
      setTitle('')
      setNotes('')
      setPre(false)
      setDraft(false)
      p.onAudit(`新建发行版 ${tag.trim()}`)
      p.onToast(draft ? '草稿已保存，可在列表里发布' : '发行版已创建')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function remove(r: Release) {
    if (!p.client || busy) return
    setBusy(`del-${r.id}`)
    setError(null)
    try {
      await p.client.deleteRelease(p.repo.owner, p.repo.name, r.id)
      // 草稿可能根本没有 tag，删失败不算错
      let tagGone = false
      if (dropTag) {
        try {
          await deleteTag(p.client, p.repo.owner, p.repo.name, r.tag_name)
          tagGone = true
        } catch {
          tagGone = false
        }
      }
      setList((prev) => prev.filter((x) => x.id !== r.id))
      setConfirmId(null)
      p.onAudit(`删除发行版 ${r.tag_name}${tagGone ? ' 与标签' : ''}`)
      p.onToast(tagGone ? '发行版与标签都已删除' : '发行版已删除')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  function startEdit(r: Release) {
    setEditId(r.id)
    setETag(r.tag_name)
    setEName(r.name ?? '')
    setEBody(r.body ?? '')
    setEPre(r.prerelease)
    setConfirmId(null)
    setConfirmAsset(null)
    setError(null)
  }

  /** 编辑保存：只提交改过的字段也没问题，但整体提交更好核对 */
  async function saveEdit(r: Release) {
    if (!p.client || busy) return
    const bad = validateTag(eTag)
    if (bad) {
      setError(bad)
      return
    }
    setBusy(`save-${r.id}`)
    setError(null)
    try {
      const next = await updateRelease(p.client, p.repo.owner, p.repo.name, r.id, {
        tag_name: eTag.trim(),
        name: eName.trim(),
        body: eBody,
        prerelease: ePre,
      })
      setList((prev) =>
        sortReleases(
          prev.map((x) => (x.id === r.id ? { ...x, ...next, assets: next.assets ?? x.assets } : x)),
        ),
      )
      setEditId(null)
      p.onAudit(`编辑发行版 ${eTag.trim()}`)
      p.onToast('已保存')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  /** 草稿发出去：draft 改 false 就是发布 */
  async function publish(r: Release) {
    if (!p.client || busy) return
    setBusy(`pub-${r.id}`)
    setError(null)
    try {
      const next = await publishRelease(p.client, p.repo.owner, p.repo.name, r.id)
      setList((prev) =>
        sortReleases(prev.map((x) => (x.id === r.id ? { ...x, ...next, assets: next.assets ?? x.assets } : x))),
      )
      p.onAudit(`发布草稿 ${r.tag_name}`)
      p.onToast('已发布')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function removeAsset(r: Release, a: ReleaseAsset) {
    if (!p.client || busy) return
    setBusy(`adel-${a.id}`)
    setError(null)
    try {
      await deleteAsset(p.client, p.repo.owner, p.repo.name, a.id)
      setList((prev) =>
        prev.map((x) => (x.id === r.id ? { ...x, assets: x.assets.filter((y) => y.id !== a.id) } : x)),
      )
      setConfirmAsset(null)
      p.onAudit(`删除附件 ${a.name}`)
      p.onToast('附件已删除')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3>发行版</h3>
            <div className="sheet-sub">
              {p.repo.full_name} · {list.length} 个
            </div>
          </div>
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭" style={{ marginTop: -4 }}>
            <Icon name="close" size={16} />
          </button>
        </div>

        {error && (
          <div className="errline" style={{ marginTop: 10 }}>
            {error}
          </div>
        )}

        {!formOpen && (
          <button className="btn ghost block" style={{ marginTop: 12 }} onClick={() => setFormOpen(true)}>
            <Icon name="plus" size={14} />
            新建发行版
          </button>
        )}

        {formOpen && (
          <div className="panel" style={{ marginTop: 12 }}>
            <div className="field">
              <label htmlFor="rel-tag">标签</label>
              <input
                id="rel-tag"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="v1.0.0"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="rel-title">标题（可空）</label>
              <input
                id="rel-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={tag || 'v1.0.0'}
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="rel-notes">说明（Markdown）</label>
              <textarea
                id="rel-notes"
                className="textarea"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={'本版更新\n\n- '}
                rows={4}
              />
            </div>
            <label className="checkline">
              <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />
              先存草稿（不创建 tag，也不会出现在仓库首页）
            </label>
            <label className="checkline">
              <input type="checkbox" checked={pre} onChange={(e) => setPre(e.target.checked)} />
              标记为预发行（Pre-release）
            </label>
            <div className="hint" style={{ marginTop: 6 }}>
              标签不存在时按默认分支 {p.repo.default_branch} 创建；草稿在发布时才生成 tag。
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn ghost" style={{ flex: 1 }} onClick={() => setFormOpen(false)}>
                取消
              </button>
              <button
                className="btn blue"
                style={{ flex: 1 }}
                disabled={busy === 'create' || !tag.trim()}
                onClick={() => void create()}
              >
                {busy === 'create' ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        )}

        <div className="list-head" style={{ padding: '18px 0 4px' }}>
          <b>全部发行版</b>
          <button onClick={() => void load(true)}>刷新</button>
        </div>

        {loading && list.length === 0 && <div className="hint">正在读取…</div>}
        {!loading && list.length === 0 && !error && (
          <div className="hint" style={{ padding: '10px 0' }}>
            还没有发行版。打一个 tag 或点上面的「新建发行版」。
          </div>
        )}

        <div className="rel-list">
          {list.map((r) => {
            const primary = pickAsset(r.assets)
            const open = expanded === r.id
            const editing = editId === r.id
            return (
              <div className="rel" key={r.id}>
                <button
                  className="rel-head"
                  onClick={() => setExpanded(open ? null : r.id)}
                  aria-expanded={open}
                >
                  <span className="rel-tag mono">{r.tag_name}</span>
                  <span className="rel-title ellipsis">{releaseTitle(r)}</span>
                  {r.draft && <span className="badge">草稿</span>}
                  {r.prerelease && <span className="badge archived">预发行</span>}
                  <Icon name="chevron" size={12} className={`rel-arrow${open ? ' on' : ''}`} />
                </button>

                <div className="rel-meta">
                  {releaseDate(r)} · {r.assets.length} 个附件 · 下载 {totalDownloads(r.assets)}
                </div>

                {primary && (
                  <div className="rel-asset">
                    <span className={`asset-ic ${assetKind(primary.name)}`}>
                      <Icon name={assetKind(primary.name) === 'apk' ? 'package' : 'download'} size={13} />
                    </span>
                    <span className="asset-main">
                      <span className="asset-name mono ellipsis">{primary.name}</span>
                      <span className="asset-sub">
                        {formatBytes(primary.size)} · 下载 {primary.download_count}
                      </span>
                    </span>
                    <a
                      className="btn ghost tiny"
                      href={mirrorDownloadUrl(primary.browser_download_url, p.mirror)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      下载
                    </a>
                  </div>
                )}

                {open && (
                  <div className="rel-body">
                    {editing ? (
                      <div className="rel-edit">
                        <div className="field">
                          <label htmlFor={`e-tag-${r.id}`}>标签</label>
                          <input
                            id={`e-tag-${r.id}`}
                            value={eTag}
                            onChange={(e) => setETag(e.target.value)}
                            autoCapitalize="off"
                            spellCheck={false}
                          />
                          <div className="hint">改标签等于把发行版挪到另一个 tag 上，附件的下载地址会跟着变。</div>
                        </div>
                        <div className="field" style={{ marginTop: 10 }}>
                          <label htmlFor={`e-name-${r.id}`}>标题（可空）</label>
                          <input
                            id={`e-name-${r.id}`}
                            value={eName}
                            onChange={(e) => setEName(e.target.value)}
                            placeholder={eTag}
                            autoCapitalize="off"
                            spellCheck={false}
                          />
                        </div>
                        <div className="field" style={{ marginTop: 10 }}>
                          <label htmlFor={`e-body-${r.id}`}>说明（Markdown）</label>
                          <textarea
                            id={`e-body-${r.id}`}
                            className="textarea"
                            value={eBody}
                            onChange={(e) => setEBody(e.target.value)}
                            rows={6}
                          />
                        </div>
                        <label className="checkline">
                          <input type="checkbox" checked={ePre} onChange={(e) => setEPre(e.target.checked)} />
                          标记为预发行（Pre-release）
                        </label>
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                          <button className="btn ghost" style={{ flex: 1 }} onClick={() => setEditId(null)}>
                            取消
                          </button>
                          <button
                            className="btn blue"
                            style={{ flex: 1 }}
                            disabled={busy === `save-${r.id}` || !eTag.trim()}
                            onClick={() => void saveEdit(r)}
                          >
                            {busy === `save-${r.id}` ? '保存中…' : '保存'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {r.body ? (
                          <div className="rel-notes">{excerpt(r.body, 600)}</div>
                        ) : (
                          <div className="hint">没有填写说明。</div>
                        )}

                        {r.assets.length > 0 && (
                          <div className="asset-list">
                            {r.assets.map((a) => (
                              <div className="asset-line" key={a.id}>
                                <a
                                  className="asset-link"
                                  href={mirrorDownloadUrl(a.browser_download_url, p.mirror)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <Icon name="download" size={12} />
                                  <span className="mono ellipsis">{a.name}</span>
                                  <span className="asset-size">{formatBytes(a.size)}</span>
                                </a>
                                {confirmAsset === a.id ? (
                                  <button
                                    className="asset-del on"
                                    disabled={busy === `adel-${a.id}`}
                                    onClick={() => void removeAsset(r, a)}
                                  >
                                    {busy === `adel-${a.id}` ? '删…' : '删除?'}
                                  </button>
                                ) : (
                                  <button
                                    className="asset-del"
                                    aria-label={`删除附件 ${a.name}`}
                                    onClick={() => setConfirmAsset(a.id)}
                                  >
                                    <Icon name="trash" size={11} />
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="rel-actions">
                          <button className="btn ghost tiny" onClick={() => startEdit(r)}>
                            <Icon name="edit" size={12} />
                            编辑
                          </button>
                          {r.draft && (
                            <button
                              className="btn ghost tiny"
                              disabled={busy === `pub-${r.id}`}
                              onClick={() => void publish(r)}
                            >
                              <Icon name="check" size={12} />
                              {busy === `pub-${r.id}` ? '发布中…' : '发布草稿'}
                            </button>
                          )}
                          {/* GitHub 的上传域名不支持跨域，WebView 里传不了，只能去网页传 */}
                          <button
                            className="btn ghost tiny"
                            onClick={() =>
                              void openExternal(
                                githubUrlAt(p.mirror, `${p.repo.full_name}/releases/edit/${r.tag_name}`),
                              )
                            }
                          >
                            <Icon name="plus" size={12} />
                            网页上传附件
                          </button>
                          <button
                            className="btn ghost tiny"
                            onClick={() =>
                              void openExternal(
                                githubUrlAt(p.mirror, `${p.repo.full_name}/releases/tag/${r.tag_name}`),
                              )
                            }
                          >
                            <Icon name="arrowRight" size={12} />
                            网页查看
                          </button>
                          {confirmId === r.id ? (
                            <>
                              <button className="btn ghost tiny" onClick={() => setConfirmId(null)}>
                                取消
                              </button>
                              <button
                                className="btn danger tiny"
                                disabled={busy === `del-${r.id}`}
                                onClick={() => void remove(r)}
                              >
                                {busy === `del-${r.id}` ? '删除中…' : '确认删除'}
                              </button>
                            </>
                          ) : (
                            <button className="btn ghost tiny" onClick={() => setConfirmId(r.id)}>
                              <Icon name="trash" size={12} />
                              删除发行版
                            </button>
                          )}
                        </div>

                        {confirmId === r.id && (
                          <label className="checkline">
                            <input type="checkbox" checked={dropTag} onChange={(e) => setDropTag(e.target.checked)} />
                            同时删除标签 <code className="mono">{r.tag_name}</code>
                            {r.draft && <span className="hint" style={{ marginLeft: 4 }}>（草稿通常没有标签）</span>}
                          </label>
                        )}

                        {r.assets.some((a) => a.size > BIG_ASSET) && (
                          <div className="hint" style={{ marginTop: 8 }}>
                            有附件超过 {formatBytes(BIG_ASSET)}，手机上下载可能较慢。
                          </div>
                        )}
                        <div className="hint" style={{ marginTop: 6 }}>
                          上传附件只能在网页做：GitHub 的上传域名不带跨域响应头，App 里发不出去。
                          删除、改名、改说明这里都能做。
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
