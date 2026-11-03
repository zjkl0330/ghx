import { useCallback, useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
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
import type { Release, Repo } from '../lib/types'
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

  const load = useCallback(async () => {
    if (!p.client) return
    setLoading(true)
    setError(null)
    try {
      const { data } = await p.client.listReleases(p.repo.owner, p.repo.name, 1, 20)
      setList(sortReleases(data))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [p.client, p.repo.owner, p.repo.name])

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
        target: p.repo.default_branch,
      })
      if (data) setList((prev) => sortReleases([data, ...prev]))
      setFormOpen(false)
      setTag('')
      setTitle('')
      setNotes('')
      setPre(false)
      p.onAudit(`新建发行版 ${tag.trim()}`)
      p.onToast('发行版已创建')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function remove(id: number) {
    if (!p.client || busy) return
    setBusy(`del-${id}`)
    setError(null)
    try {
      await p.client.deleteRelease(p.repo.owner, p.repo.name, id)
      setList((prev) => prev.filter((r) => r.id !== id))
      setConfirmId(null)
      p.onAudit('删除发行版')
      p.onToast('发行版已删除')
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
              <input type="checkbox" checked={pre} onChange={(e) => setPre(e.target.checked)} />
              标记为预发行（Pre-release）
            </label>
            <div className="hint" style={{ marginTop: 6 }}>
              标签不存在时按默认分支 {p.repo.default_branch} 创建；发行版创建后不能改标签，只能删掉重建。
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
          <button onClick={() => void load()}>刷新</button>
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
                  <div className="rel-asset" onClick={(e) => e.stopPropagation()}>
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
                    {r.body ? <div className="rel-notes">{excerpt(r.body, 600)}</div> : <div className="hint">没有填写说明。</div>}
                    {r.assets.filter((a) => a.id !== primary?.id).length > 0 && (
                      <div className="asset-list">
                        {r.assets
                          .filter((a) => a.id !== primary?.id)
                          .map((a) => (
                            <a
                              key={a.id}
                              className="asset-line"
                              href={mirrorDownloadUrl(a.browser_download_url, p.mirror)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Icon name="download" size={12} />
                              <span className="mono ellipsis">{a.name}</span>
                              <span className="asset-size">{formatBytes(a.size)}</span>
                            </a>
                          ))}
                      </div>
                    )}
                    <div className="rel-actions">
                      <button
                        className="btn ghost tiny"
                        onClick={() => void openExternal(`${p.mirror.replace(/\/+$/, '')}/${p.repo.full_name}/releases/tag/${r.tag_name}`)}
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
                            onClick={() => void remove(r.id)}
                          >
                            {busy === `del-${r.id}` ? '删除中…' : '确认删除'}
                          </button>
                        </>
                      ) : (
                        <button className="btn ghost tiny" onClick={() => setConfirmId(r.id)}>
                          <Icon name="trash" size={12} />
                          删除
                        </button>
                      )}
                    </div>
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
