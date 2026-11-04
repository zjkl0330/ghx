import { useCallback, useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import {
  deleteFile,
  getFile,
  getMeta,
  listDir,
  languageOf,
  putFile,
  isBinaryPath,
  isImagePath,
  summarizeDir,
  withLineNumbers,
  writeErrorHint,
  type ContentItem,
} from '../lib/code'
import { baseName, formatBytes, pathSegments } from '../lib/format'
import { mirrorImage } from '../lib/images'
import { PageHeader, PageState } from './PageHeader'
import { Icon } from './icons'

/**
 * 代码浏览：一个组件同时处理「目录」和「文件」。
 *
 * 目录与文件的接口形状不同（数组 vs 对象），所以先问一次元信息再决定怎么渲染。
 * 进入子目录由上层压一条新路由，返回键自然退回上一级。
 */
export function CodePage(p: {
  client: GitHubClient | null
  owner: string
  repo: string
  path: string
  ref?: string
  mirror: string
  onBack: () => void
  onOpenDir: (path: string) => void
  onOpenFile: (path: string) => void
  onEdit: (path: string, sha: string) => void
  onPickRef: () => void
  /** 看这个文件的提交历史；目录根上不给入口 */
  onHistory: (path: string) => void
  onToast: (s: string) => void
}) {
  const [kind, setKind] = useState<'dir' | 'file' | 'binary' | 'image' | 'unknown'>('unknown')
  const [items, setItems] = useState<ContentItem[]>([])
  const [file, setFile] = useState<{ item: ContentItem; text: string; truncated: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (!p.client) {
        setLoading(false)
        return
      }
      if (!silent) setLoading(true)
      setError(null)
      try {
        const meta = await getMeta(p.client, p.owner, p.repo, p.path, p.ref)
        // 目录返回的是数组、文件返回对象 —— 这是 API 的形状差异，不是错误
        if (Array.isArray(meta)) {
          setItems(meta)
          setKind('dir')
          setFile(null)
        } else if (meta.type === 'dir') {
          const list = await listDir(p.client, p.owner, p.repo, p.path, p.ref)
          setItems(list)
          setKind('dir')
          setFile(null)
        } else if (isImagePath(meta.path)) {
          setFile({ item: meta, text: '', truncated: false })
          setKind('image')
        } else if (isBinaryPath(meta.path)) {
          setFile({ item: meta, text: '', truncated: false })
          setKind('binary')
        } else {
          const f = await getFile(p.client, p.owner, p.repo, p.path, p.ref)
          setFile(f)
          setKind('file')
        }
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [p.client, p.owner, p.repo, p.path, p.ref],
  )

  useEffect(() => {
    void load()
  }, [load])

  const segs = pathSegments(p.path)
  const title = p.path ? baseName(p.path) : `${p.owner}/${p.repo}`

  return (
    <>
      <PageHeader
        title={title}
        sub={
          <span className="mono">
            {p.ref ?? '默认分支'}
            {kind === 'dir' ? ` · ${summarizeDir(items)}` : ''}
          </span>
        }
        onBack={p.onBack}
        right={
          <>
            {p.path !== '' && (
              <button className="icon-btn" onClick={() => p.onHistory(p.path)} aria-label="提交历史">
                <Icon name="clock" size={17} />
              </button>
            )}
            <button className="icon-btn" onClick={p.onPickRef} aria-label="切换分支">
              <Icon name="branch" size={17} />
            </button>
            <button className="icon-btn" onClick={() => void load(true)} aria-label="刷新">
              <Icon name="refresh" size={17} />
            </button>
          </>
        }
      />

      <div className="page" style={{ marginTop: 0 }}>
        {segs.length > 0 && (
          <div className="crumbs">
            <button className="crumb" onClick={() => p.onOpenDir('')}>
              {p.repo}
            </button>
            {segs.map((s, i) => (
              <span key={i} className="crumb-wrap">
                <span className="crumb-sep">/</span>
                <button
                  className="crumb"
                  onClick={() => p.onOpenDir(segs.slice(0, i + 1).join('/'))}
                  disabled={i === segs.length - 1 && kind === 'file'}
                >
                  {s}
                </button>
              </span>
            ))}
          </div>
        )}

        <PageState loading={loading} error={error} onRetry={() => void load()} />

        {!loading && !error && kind === 'dir' && (
          <>
            {items.length === 0 && <div className="empty">这个目录是空的</div>}
            <div className="rows">
              {items.map((it) => (
                <div
                  key={it.path}
                  role="button"
                  tabIndex={0}
                  className="row file-row"
                  onClick={() => (it.type === 'dir' ? p.onOpenDir(it.path) : p.onOpenFile(it.path))}
                >
                  <span className="file-ic">
                    <Icon name={it.type === 'dir' ? 'folder' : it.type === 'submodule' ? 'package' : 'file'} size={16} />
                  </span>
                  <span className="row-main">
                    <span className="row-l1">
                      <span className="row-name ellipsis">{it.name}</span>
                    </span>
                    <span className="row-meta">
                      {it.type === 'dir'
                        ? '目录'
                        : it.type === 'submodule'
                          ? '子模块'
                          : it.type === 'symlink'
                            ? '软链接'
                            : `${formatBytes(it.size ?? 0)} · ${languageOf(it.path)}`}
                    </span>
                  </span>
                  {it.type !== 'dir' && (
                    <button
                      className="icon-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        p.onEdit(it.path, it.sha)
                      }}
                      aria-label={`编辑 ${it.name}`}
                    >
                      <Icon name="edit" size={15} />
                    </button>
                  )}
                  <Icon name="chevron" size={13} className="linkrow-arrow" />
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && !error && kind === 'file' && file && (
          <>
            <div className="filebar">
              <span className="mono ellipsis">
                {file.item.path} · {languageOf(file.item.path)} · {formatBytes(file.item.size)}
              </span>
              <button className="btn ghost tiny" onClick={() => p.onEdit(file.item.path, file.item.sha)}>
                <Icon name="edit" size={13} />
                编辑
              </button>
            </div>
            {file.truncated && (
              <div className="warnbox slim">文件太大，只显示了前一部分</div>
            )}
            <div className="codeview">
              {withLineNumbers(file.text).map((l) => (
                <div className="code-line" key={l.no}>
                  <span className="code-no">{l.no}</span>
                  <span className="code-text">{l.text || '\u00a0'}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && !error && kind === 'image' && file && (
          <div className="imgview">
            <img
              src={mirrorImage(file.item.download_url ?? '', p.mirror) ?? file.item.download_url ?? ''}
              alt={file.item.name}
              onError={(e) => {
                ;(e.target as HTMLImageElement).style.display = 'none'
                p.onToast('图片加载失败，可能是加速站没通')
              }}
            />
            <div className="hint" style={{ textAlign: 'center', marginTop: 10 }}>
              {file.item.path} · {formatBytes(file.item.size)}
            </div>
          </div>
        )}

        {!loading && !error && kind === 'binary' && file && (
          <div className="empty">
            <b>二进制文件</b>
            这类文件（{formatBytes(file.item.size)}）没法在手机上按文本打开，需要下载后用别的应用看。
          </div>
        )}
      </div>
    </>
  )
}

/** 单文件编辑器：新建与修改共用一个界面 */
export function FileEditor(p: {
  client: GitHubClient | null
  owner: string
  repo: string
  path: string
  ref?: string
  sha?: string
  onBack: () => void
  onSaved: (message: string) => void
  onToast: (s: string) => void
}) {
  const isNew = !p.path
  const [path, setPath] = useState(p.path)
  const [content, setContent] = useState('')
  const [message, setMessage] = useState(isNew ? '创建文件' : `更新 ${baseName(p.path)}`)
  const [loading, setLoading] = useState(!isNew)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    if (isNew || !p.client) {
      setLoading(false)
      return
    }
    void (async () => {
      try {
        const f = await getFile(p.client!, p.owner, p.repo, p.path, p.ref)
        if (!alive) return
        setContent(f.text)
      } catch (err) {
        if (alive) setError((err as Error).message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [p.client, p.owner, p.repo, p.path, p.ref, isNew])

  async function save() {
    if (!p.client || busy) return
    if (!path.trim()) {
      setError('路径不能为空')
      return
    }
    if (!message.trim()) {
      setError('提交信息不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await putFile(p.client, p.owner, p.repo, {
        path: path.trim(),
        content,
        message: message.trim(),
        ...(p.sha ? { sha: p.sha } : {}),
        ...(p.ref ? { branch: p.ref } : {}),
      })
      p.onSaved(message.trim())
    } catch (err) {
      const status = (err as { status?: number }).status ?? 0
      setError(writeErrorHint(path, status) ?? (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!p.client || !p.sha || busy) return
    setBusy(true)
    setError(null)
    try {
      await deleteFile(p.client, p.owner, p.repo, {
        path: p.path,
        message: message.trim() || `删除 ${baseName(p.path)}`,
        sha: p.sha,
        ...(p.ref ? { branch: p.ref } : {}),
      })
      p.onSaved('已删除文件')
    } catch (err) {
      const status = (err as { status?: number }).status ?? 0
      setError(writeErrorHint(p.path, status) ?? (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title={isNew ? '新建文件' : `编辑 ${baseName(p.path)}`}
        sub={<span className="mono">{p.owner}/{p.repo}{p.ref ? ` · ${p.ref}` : ''}</span>}
        onBack={p.onBack}
      />

      <div className="page" style={{ marginTop: 0 }}>
        <PageState loading={loading} error={error} />

        {!loading && (
          <>
            <div className="field" style={{ margin: '12px 16px 0' }}>
              <label>文件路径</label>
              <input
                className="input mono"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="src/index.ts"
                disabled={!isNew}
              />
            </div>

            <div className="field" style={{ margin: '12px 16px 0' }}>
              <label>内容</label>
              <textarea
                className="textarea mono"
                rows={14}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
              />
            </div>

            <div className="field" style={{ margin: '12px 16px 0' }}>
              <label>提交信息</label>
              <input className="input" value={message} onChange={(e) => setMessage(e.target.value)} />
            </div>

            <div className="btnrow" style={{ paddingBottom: 24 }}>
              <button className="btn primary" disabled={busy} onClick={() => void save()}>
                <Icon name="check" size={14} />
                {busy ? '提交中…' : '提交'}
              </button>
              {!isNew && p.sha && (
                <button className="btn ghost danger" disabled={busy} onClick={() => void remove()}>
                  <Icon name="trash" size={14} />
                  删除
                </button>
              )}
            </div>

            <div className="hint" style={{ padding: '0 16px 24px' }}>
              提交会直接写到 {p.ref ?? '默认分支'}。写 `.github/workflows/` 下的文件需要令牌带 workflow 权限，
              缺权限时 GitHub 返回的是 404 而不是 403。
            </div>
          </>
        )}
      </div>
    </>
  )
}
