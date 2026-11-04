import { useCallback, useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import {
  deleteArtifact,
  fetchRunLogs,
  listArtifacts,
  type Artifact,
  type LogFile,
} from '../lib/actions-ext'
import { formatBytes } from '../lib/format'
import { openExternal } from '../lib/update'
import { Icon } from './icons'

/**
 * 运行日志。
 *
 * 日志接口给的是 zip，解压后是若干 `.txt`，按作业顺序命名。
 * 这里做成「左边选作业、右边看内容」，手机上比一堆折叠面板好用。
 */
export function LogSheet(p: {
  client: GitHubClient | null
  owner: string
  repo: string
  runId: number
  runTitle: string
  onClose: () => void
}) {
  const [files, setFiles] = useState<LogFile[]>([])
  const [active, setActive] = useState(0)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** 待确认删除的产物 id */
  const [confirmArt, setConfirmArt] = useState<number | null>(null)
  const [busyArt, setBusyArt] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!p.client) return
    setLoading(true)
    setError(null)
    try {
      const [logs, arts] = await Promise.all([
        fetchRunLogs(p.client, p.owner, p.repo, p.runId),
        listArtifacts(p.client, p.owner, p.repo, p.runId).catch(() => []),
      ])
      setFiles(logs)
      setArtifacts(arts)
      setActive(0)
    } catch (err) {
      setError(
        `${(err as Error).message}。日志是 302 跳到预签名地址的 zip，浏览器里会被跨域拦住；真机走原生请求，不受这个限制。`,
      )
    } finally {
      setLoading(false)
    }
  }, [p.client, p.owner, p.repo, p.runId])

  useEffect(() => {
    void load()
  }, [load])

  const current = files[active]

  /** 删产物：过期后 GitHub 会自己清理，但提前删能省存储配额 */
  async function dropArtifact(a: Artifact) {
    if (!p.client || busyArt != null) return
    setBusyArt(a.id)
    try {
      await deleteArtifact(p.client, p.owner, p.repo, a.id)
      setArtifacts((prev) => prev.filter((x) => x.id !== a.id))
      setConfirmArt(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusyArt(null)
    }
  }

  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet sheet-tall" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 className="ellipsis">运行日志</h3>
            <div className="sheet-sub ellipsis">{p.runTitle}</div>
          </div>
          <button className="icon-btn" onClick={() => void load()} aria-label="重新加载">
            <Icon name="refresh" size={16} />
          </button>
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭">
            <Icon name="close" size={16} />
          </button>
        </div>

        {loading && <div className="empty">正在下载并解压日志…</div>}

        {error && (
          <div className="warnbox" style={{ marginTop: 10 }}>
            <Icon name="warn" size={14} />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && files.length === 0 && (
          <div className="empty">
            <b>这次运行没有日志</b>
            可能还没开始跑，或者日志已过期（GitHub 只保留 90 天）。
          </div>
        )}

        {files.length > 0 && (
          <>
            <div className="chips" style={{ padding: '10px 0 0' }}>
              {files.map((f, i) => (
                <button key={f.name} className={`chip${i === active ? ' on' : ''}`} onClick={() => setActive(i)}>
                  {f.name.replace(/\.txt$/, '')}
                </button>
              ))}
            </div>
            <pre className="logview">{current?.text ?? ''}</pre>
          </>
        )}

        {artifacts.length > 0 && (
          <>
            <div className="section-title">产物 · {artifacts.length}</div>
            {artifacts.map((a) => (
              <div className="art-row" key={a.id}>
                <button
                  className="linkrow"
                  disabled={a.expired}
                  onClick={() =>
                    void openExternal(
                      `https://github.com/${p.owner}/${p.repo}/actions/runs/${p.runId}/artifacts/${a.id}`,
                    )
                  }
                >
                  <span className="linkrow-main">
                    <b>{a.name}</b>
                    <i>
                      {formatBytes(a.size_in_bytes)}
                      {a.expired ? ' · 已过期' : ''}
                    </i>
                  </span>
                  <Icon name="download" size={15} />
                </button>
                {confirmArt === a.id ? (
                  <button
                    className="asset-del on"
                    disabled={busyArt === a.id}
                    onClick={() => void dropArtifact(a)}
                  >
                    {busyArt === a.id ? '删…' : '删除?'}
                  </button>
                ) : (
                  <button className="asset-del" aria-label={`删除产物 ${a.name}`} onClick={() => setConfirmArt(a.id)}>
                    <Icon name="trash" size={11} />
                  </button>
                )}
              </div>
            ))}
            <div className="hint" style={{ marginTop: 6 }}>
              产物需要登录才能下载，会在浏览器里打开。过期后 GitHub 会自动清理，也可以现在就删掉省配额。
            </div>
          </>
        )}
      </div>
    </div>
  )
}
