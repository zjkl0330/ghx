import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import {
  CODE_PREFS_KEY,
  CODE_SIZES,
  DEFAULT_CODE_PREFS,
  blobUrl,
  fileStats,
  findHits,
  groupHitsByLine,
  parseCodePrefs,
  serializeCodePrefs,
  splitHighlight,
  stepCodeSize,
  stepHit,
  type CodePrefs,
} from '../lib/code-view'
import { copyText } from '../lib/clipboard'
import { baseName, formatBytes, pathSegments } from '../lib/format'
import { mirrorImage } from '../lib/images'
import { openExternal } from '../lib/update'
import { PageHeader, PageState } from './PageHeader'
import { Icon } from './icons'

/** 读阅读偏好。隐私模式下 localStorage 会抛错，不能让它把整个页面搞崩 */
function readPrefs(): CodePrefs {
  try {
    return parseCodePrefs(localStorage.getItem(CODE_PREFS_KEY))
  } catch {
    return { ...DEFAULT_CODE_PREFS }
  }
}

function savePrefs(p: CodePrefs): void {
  try {
    localStorage.setItem(CODE_PREFS_KEY, serializeCodePrefs(p))
  } catch {
    /* 无痕模式写不进去，本次会话仍然生效 */
  }
}

/**
 * 图片文件预览。
 *
 * 和 README 里的图一个道理：加速前缀经常不通，只报「加载失败」等于让人放弃。
 * 先试加速地址，失败自动退回 raw.githubusercontent.com 原图，两次都不行才提示。
 * 独立组件是为了让 fallback 状态跟着文件切换自动重置（key 换掉就重建）。
 */
function FileImage(p: { raw: string; fast: string | null; alt: string; onFail: () => void }) {
  const [fallback, setFallback] = useState(!p.fast)
  return (
    <img
      src={fallback || !p.fast ? p.raw : p.fast}
      alt={p.alt}
      onError={() => {
        if (!fallback && p.fast) {
          setFallback(true)
          return
        }
        p.onFail()
      }}
    />
  )
}

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
  /** 从搜索结果跳进来时带的关键词：文件加载完自动打开查找栏并定位第一处 */
  initialFind?: string
}) {
  const [kind, setKind] = useState<'dir' | 'file' | 'binary' | 'image' | 'unknown'>('unknown')
  const [items, setItems] = useState<ContentItem[]>([])
  const [file, setFile] = useState<{ item: ContentItem; text: string; truncated: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** 阅读偏好：字号与折行，落 localStorage，换文件不重置 */
  const [prefs, setPrefs] = useState<CodePrefs>(readPrefs)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hitIdx, setHitIdx] = useState(0)
  const hitLineRef = useRef<HTMLDivElement | null>(null)

  const lines = useMemo(() => (file ? withLineNumbers(file.text) : []), [file])
  const hits = useMemo(() => (findOpen ? findHits(lines.map((l) => l.text), query) : []), [findOpen, lines, query])
  const hitMap = useMemo(() => groupHitsByLine(hits), [hits])
  const curIndex = hits.length === 0 ? -1 : Math.min(Math.max(hitIdx, 0), hits.length - 1)
  const curHit = curIndex >= 0 ? hits[curIndex] : undefined

  // 换关键词后从第一处看起，别停在上一次的第 17 处
  useEffect(() => {
    setHitIdx(0)
  }, [query])

  // 搜索跳进来：文件到位后再开查找栏。放在 file 加载之后，
  // 否则 findHits 拿到的还是空行数组，计数会显示 0/0
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !p.initialFind || !file) return
    seeded.current = true
    setQuery(p.initialFind)
    setFindOpen(true)
  }, [p.initialFind, file])

  // 当前命中滚到视野中间：手机上 2000 行文件里靠手动滑根本找不到
  useEffect(() => {
    if (!findOpen || !curHit) return
    hitLineRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [findOpen, curHit?.line, curHit?.start])

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
              <button
                className="icon-btn"
                onClick={() => {
                  setFindOpen((on) => !on)
                  if (findOpen) setQuery('')
                }}
                aria-label="文件内查找"
                style={findOpen ? { color: 'var(--blue)' } : undefined}
              >
                <Icon name="search" size={16} />
              </button>
              <button className="icon-btn" onClick={() => setSheetOpen(true)} aria-label="更多操作">
                <Icon name="dots" size={16} />
              </button>
              <button className="btn ghost tiny" onClick={() => p.onEdit(file.item.path, file.item.sha)}>
                <Icon name="edit" size={13} />
                编辑
              </button>
            </div>

            {findOpen && (
              <div className="findbar">
                <Icon name="search" size={13} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="在这个文件里找"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                />
                <span className={`find-count${query && hits.length === 0 ? ' none' : ''}`}>
                  {query ? (hits.length === 0 ? '无匹配' : `${curIndex + 1}/${hits.length}`) : ''}
                </span>
                <button
                  className="icon-btn"
                  disabled={hits.length === 0}
                  onClick={() => setHitIdx(stepHit(curIndex, hits.length, -1))}
                  aria-label="上一处"
                >
                  <Icon name="chevron" size={15} style={{ transform: 'rotate(180deg)' }} />
                </button>
                <button
                  className="icon-btn"
                  disabled={hits.length === 0}
                  onClick={() => setHitIdx(stepHit(curIndex, hits.length, 1))}
                  aria-label="下一处"
                >
                  <Icon name="chevron" size={15} />
                </button>
                <button
                  className="icon-btn"
                  onClick={() => {
                    setFindOpen(false)
                    setQuery('')
                  }}
                  aria-label="关闭查找"
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
            )}

            {file.truncated && (
              <div className="warnbox slim">文件太大，只显示了前一部分</div>
            )}
            <div
              className={`codeview${prefs.wrap ? ' wrap' : ''}`}
              style={{ fontSize: `${prefs.size}px` }}
            >
              {lines.map((l, i) => {
                const onLine = hitMap.get(i)
                const isCur = curHit?.line === i
                return (
                  <div
                    className={`code-line${onLine ? ' has-hit' : ''}${isCur ? ' cur-hit' : ''}`}
                    key={l.no}
                    ref={isCur ? hitLineRef : undefined}
                  >
                    <span className="code-no">{l.no}</span>
                    <span className="code-text">
                      {onLine
                        ? splitHighlight(l.text, onLine).map((seg, k) =>
                            seg.hit ? (
                              <mark key={k} className="hit">
                                {seg.text}
                              </mark>
                            ) : (
                              <span key={k}>{seg.text}</span>
                            ),
                          )
                        : l.text || '\u00a0'}
                    </span>
                  </div>
                )
              })}
            </div>

          </>
        )}

        {!loading && !error && kind === 'image' && file && (
          <>
            <div className="filebar">
              <span className="mono ellipsis">
                {file.item.path} · {formatBytes(file.item.size)}
              </span>
              <button className="icon-btn" onClick={() => setSheetOpen(true)} aria-label="更多操作">
                <Icon name="dots" size={16} />
              </button>
            </div>
            <div className="imgview">
              <FileImage
                key={file.item.path}
                raw={file.item.download_url ?? ''}
                fast={mirrorImage(file.item.download_url ?? '', p.mirror)}
                alt={file.item.name}
                onFail={() => p.onToast('图片加载失败：加速站与原图都没通')}
              />
              <div className="hint" style={{ textAlign: 'center', marginTop: 10 }}>
                {file.item.path} · {formatBytes(file.item.size)}
              </div>
            </div>
          </>
        )}

        {!loading && !error && kind === 'binary' && file && (
          <>
            <div className="filebar">
              <span className="mono ellipsis">
                {file.item.path} · {formatBytes(file.item.size)}
              </span>
              <button className="icon-btn" onClick={() => setSheetOpen(true)} aria-label="更多操作">
                <Icon name="dots" size={16} />
              </button>
            </div>
            <div className="empty">
              <b>二进制文件</b>
              这类文件（{formatBytes(file.item.size)}）没法在手机上按文本打开，用右上「⋯」里的「下载原文件」交给系统应用打开。
            </div>
          </>
        )}

        {/* 操作面板对文本、图片、二进制共用：链接、下载、历史都不依赖文件能否按文本读 */}
        {sheetOpen && file && !loading && !error && (
          <div className="mask" onClick={() => setSheetOpen(false)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()}>
              <div className="handle" />
              <div className="sheet-head">
                <div style={{ minWidth: 0 }}>
                  <div className="sheet-title ellipsis">{file.item.name}</div>
                  <div className="sheet-sub mono ellipsis">
                    {kind === 'file' ? `${fileStats(file.text).lines} 行 · ` : ''}
                    {formatBytes(file.item.size)} · {languageOf(file.item.path)}
                  </div>
                </div>
                <div className="spacer" />
                <button className="icon-btn" onClick={() => setSheetOpen(false)} aria-label="关闭">
                  <Icon name="close" size={17} />
                </button>
              </div>

              {kind === 'file' && (
                <button
                  className="linkrow"
                  onClick={() => {
                    void copyText(file.text).then((ok) =>
                      p.onToast(
                        ok
                          ? `已复制 ${fileStats(file.text).lines} 行${file.truncated ? '（仅已加载部分）' : ''}`
                          : '复制失败，长按代码手动选择',
                      ),
                    )
                    setSheetOpen(false)
                  }}
                >
                  <Icon name="copy" size={16} />
                  <span className="linkrow-main">
                    <b>复制文件内容</b>
                    <i>整份文本进剪贴板{file.truncated ? '（当前只加载了前一部分）' : ''}</i>
                  </span>
                </button>
              )}

              <button
                className="linkrow"
                onClick={() => {
                  const url = blobUrl(p.owner, p.repo, p.ref, file.item.path, file.item.html_url)
                  void copyText(url).then((ok) => p.onToast(ok ? '已复制链接' : '复制失败'))
                  setSheetOpen(false)
                }}
              >
                <Icon name="link" size={16} />
                <span className="linkrow-main">
                  <b>复制文件链接</b>
                  <i>{blobUrl(p.owner, p.repo, p.ref, file.item.path, file.item.html_url)}</i>
                </span>
              </button>

              <button
                className="linkrow"
                onClick={() => {
                  void copyText(`${p.owner}/${p.repo}/${file.item.path}`).then((ok) =>
                    p.onToast(ok ? '已复制路径' : '复制失败'),
                  )
                  setSheetOpen(false)
                }}
              >
                <Icon name="repo" size={16} />
                <span className="linkrow-main">
                  <b>复制仓库内路径</b>
                  <i>{file.item.path}</i>
                </span>
              </button>

              <button
                className="linkrow"
                onClick={() => {
                  setSheetOpen(false)
                  // 硬要求：GitHub 地址不再踢去浏览器。要网页版就复制出去自己粘
                  const url = blobUrl(p.owner, p.repo, p.ref, file.item.path, file.item.html_url)
                  void copyText(url).then((ok) => p.onToast(ok ? '文件地址已复制' : '复制失败'))
                }}
              >
                <Icon name="copy" size={16} />
                <span className="linkrow-main">
                  <b>复制文件地址</b>
                  <i>需要网页版时自己粘贴打开</i>
                </span>
              </button>

              <button
                className="linkrow"
                onClick={() => {
                  const raw = file.item.download_url
                  const target = raw ? (mirrorImage(raw, p.mirror) ?? raw) : null
                  setSheetOpen(false)
                  if (!target) {
                    p.onToast('这个文件没有直链，用「在浏览器打开」再保存')
                    return
                  }
                  void openExternal(target)
                }}
              >
                <Icon name="download" size={16} />
                <span className="linkrow-main">
                  <b>下载原文件</b>
                  <i>交给系统浏览器下载，图片与二进制走这里</i>
                </span>
              </button>

              <button
                className="linkrow"
                onClick={() => {
                  setSheetOpen(false)
                  p.onHistory(file.item.path)
                }}
              >
                <Icon name="clock" size={16} />
                <span className="linkrow-main">
                  <b>这个文件的提交历史</b>
                  <i>只列出动过这个路径的提交</i>
                </span>
              </button>

              {kind === 'file' && (
                <div className="sheet-sec">
                  <div className="sizerow">
                    <span className="sheet-sec-label" style={{ flex: 1 }}>
                      字号
                    </span>
                    <button
                      className="sizebtn"
                      disabled={prefs.size === CODE_SIZES[0]}
                      onClick={() => {
                        const next = { ...prefs, size: stepCodeSize(prefs.size, -1) }
                        setPrefs(next)
                        savePrefs(next)
                      }}
                      aria-label="缩小字号"
                    >
                      A−
                    </button>
                    <span className="sizeval mono">{prefs.size}</span>
                    <button
                      className="sizebtn"
                      disabled={prefs.size === CODE_SIZES[CODE_SIZES.length - 1]}
                      onClick={() => {
                        const next = { ...prefs, size: stepCodeSize(prefs.size, 1) }
                        setPrefs(next)
                        savePrefs(next)
                      }}
                      aria-label="放大字号"
                    >
                      A+
                    </button>
                  </div>
                  <label className="tglrow">
                    <span className="tgl-main">
                      <b>长行折行</b>
                      <i>关掉就横向滚动，和 GitHub 网页一致</i>
                    </span>
                    <input
                      type="checkbox"
                      className="tgl"
                      checked={prefs.wrap}
                      onChange={(e) => {
                        const next = { ...prefs, wrap: e.target.checked }
                        setPrefs(next)
                        savePrefs(next)
                      }}
                    />
                  </label>
                </div>
              )}

              {kind === 'file' && (
                <div className="btnrow" style={{ paddingBottom: 22 }}>
                  <button
                    className="btn primary"
                    onClick={() => {
                      setSheetOpen(false)
                      p.onEdit(file.item.path, file.item.sha)
                    }}
                  >
                    <Icon name="edit" size={14} />
                    编辑这个文件
                  </button>
                </div>
              )}
            </div>
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
