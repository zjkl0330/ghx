import { useEffect, useState } from 'react'
import { formatSpeed, mirrorLabel, pickReachable, releaseCandidates, releasePageUrl } from '../lib/mirrors'
import {
  formatBytes,
  formatDate,
  headReachable,
  openExternal,
  UPDATE_OWNER,
  UPDATE_REPO,
  type UpdateCheckResult,
} from '../lib/update'
import { Icon } from './icons'

export type UpdatePhase = 'checking' | 'latest' | 'found' | 'error'

interface Props {
  phase: UpdatePhase
  result: UpdateCheckResult | null
  error: string | null
  current: string
  mirror: string
  /** 当前镜像的实测速度（KB/s），没测过为 null */
  mirrorSpeed: number | null
  onOpenMirrors: () => void
  onRecheck: () => void
  onClose: () => void
}

/** 更新说明里最常见的 markdown 噪音（标题井号、粗体星号）做轻量清理，只求可读。 */
function cleanNotes(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '· ')
    .replace(/\r/g, '')
    .trim()
}

export function UpdateSheet(p: Props) {
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [pageBusy, setPageBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setOpening(false)
    setOpenError(null)
    setPageBusy(false)
    setExpanded(false)
  }, [p.phase, p.result?.latest])

  const info = p.result?.info ?? null
  const notes = info ? cleanNotes(info.notes) : ''
  const showToggle = notes.length > 260 && !expanded

  // 下载地址与页面地址都按「当前镜像」现算：测速换站后不必重新检查更新
  const downloadUrls =
    info?.asset != null
      ? releaseCandidates(p.mirror, UPDATE_OWNER, UPDATE_REPO, info.tag, info.asset.name)
      : []
  const pageUrl = releasePageUrl(p.mirror, UPDATE_OWNER, UPDATE_REPO, info?.tag)
  const mirrorName = mirrorLabel(p.mirror)

  async function download() {
    if (downloadUrls.length === 0) return
    setOpening(true)
    setOpenError(null)
    try {
      // 先 HEAD 探活再唤起浏览器：自建站这类「页面能开、资产偶发 522」的站点会让
      // 浏览器停在错误页，用户只看到「打不开」。探到能下的那条再交出去；
      // 探活本身不可靠时（Web 端 CORS）pickReachable 会回退第一条，行为同旧版。
      const url = await pickReachable(downloadUrls, (u) => headReachable(u))
      await openExternal(url)
      setOpening(false)
    } catch (err) {
      setOpening(false)
      setOpenError(`无法唤起浏览器：${(err as Error).message}`)
    }
  }

  async function openPage() {
    setPageBusy(true)
    try {
      await openExternal(pageUrl)
    } catch (err) {
      setOpenError(`无法唤起浏览器：${(err as Error).message}`)
    } finally {
      setPageBusy(false)
    }
  }

  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />

        {p.phase === 'checking' && (
          <>
            <h3>检查更新</h3>
            <div className="sheet-sub">正在查询最新版本…</div>
            <div style={{ padding: '26px 0 30px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 12 }}>
              <span className="spin" />
            </div>
          </>
        )}

        {p.phase === 'latest' && (
          <>
            <h3>已是最新版本</h3>
            <div className="sheet-sub">
              当前 v{p.current}
              {info?.publishedAt ? ` · 最新发布 ${formatDate(info.publishedAt)}` : ''}
            </div>
            <div style={{ padding: '20px 0 8px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '14px 14px',
                  background: 'var(--green-bg)',
                  border: '1px solid var(--green-line)',
                  borderRadius: 10,
                }}
              >
                <span style={{ color: 'var(--green)', display: 'flex' }}>
                  <Icon name="check" size={16} />
                </span>
                <span style={{ fontSize: 12.5, color: '#a8d5b5', lineHeight: 1.5 }}>
                  没有可用的更新，当前版本已是最新。
                </span>
              </div>
            </div>
            <button className="btn ghost block" style={{ marginTop: 4 }} disabled={pageBusy} onClick={() => void openPage()}>
              <Icon name="external" size={14} />
              打开发行版页面
            </button>
            <div className="btns">
              <button className="btn ghost" onClick={p.onRecheck}>
                重新检查
              </button>
              <button className="btn primary" onClick={p.onClose}>
                好
              </button>
            </div>
          </>
        )}

        {p.phase === 'found' && info && (
          <>
            <h3>发现新版本 v{info.version}</h3>
            <div className="sheet-sub">
              v{p.current} → v{info.version}
              {info.asset ? ` · ${formatBytes(info.asset.size)}` : ''}
              {info.publishedAt ? ` · ${formatDate(info.publishedAt)}` : ''}
            </div>

            {info.asset ? (
              <>
                <div className={`notes${showToggle ? ' clipped' : ''}`}>{notes || '该版本没有填写更新说明。'}</div>
                {showToggle && (
                  <button className="btn ghost block" style={{ height: 30, fontSize: 11.5, marginTop: 8 }} onClick={() => setExpanded(true)}>
                    展开全部说明
                  </button>
                )}
                <button className="mirrorline asbtn" onClick={p.onOpenMirrors}>
                  <Icon name="globe" size={13} />
                  <span>
                    通过 {mirrorName}
                    {p.mirrorSpeed != null ? ` · ${formatSpeed(p.mirrorSpeed)}` : ''} 加速下载
                  </span>
                  <b>更换</b>
                </button>
                {openError && <div className="errline">{openError}</div>}
                <div className="btns">
                  <button className="btn ghost" onClick={p.onClose}>
                    稍后
                  </button>
                  <button className="btn primary" disabled={opening} onClick={() => void download()}>
                    <Icon name="download" size={14} />
                    {opening ? '正在选择线路…' : '下载并安装'}
                  </button>
                </div>
                <button className="btn ghost block" style={{ marginTop: 8 }} disabled={pageBusy} onClick={() => void openPage()}>
                  <Icon name="external" size={14} />
                  打开发行版页面
                </button>
                <div className="hint" style={{ marginTop: 10, textAlign: 'center' }}>
                  下载完成后点通知即可安装；覆盖安装不会丢失本地令牌与审计日志。
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    margin: '14px 0',
                    padding: '12px 14px',
                    background: 'var(--amber-bg)',
                    border: '1px solid var(--amber-line)',
                    borderRadius: 10,
                    fontSize: 12,
                    color: '#e3c07a',
                    lineHeight: 1.55,
                  }}
                >
                  该版本没有附带 APK 安装包，可能是发布流水线还没跑完。稍后重新检查即可。
                </div>
                <button className="btn ghost block" disabled={pageBusy} onClick={() => void openPage()}>
                  <Icon name="external" size={14} />
                  打开发行版页面
                </button>
                <div className="btns">
                  <button className="btn ghost" onClick={p.onClose}>
                    关闭
                  </button>
                  <button className="btn ghost" onClick={p.onRecheck}>
                    重新检查
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {p.phase === 'error' && (
          <>
            <h3>检查失败</h3>
            <div className="sheet-sub">当前 v{p.current}</div>
            <div
              style={{
                margin: '14px 0',
                padding: '12px 14px',
                background: 'var(--red-bg)',
                border: '1px solid var(--red-line)',
                borderRadius: 10,
                fontSize: 12,
                color: '#f0a9a6',
                lineHeight: 1.55,
              }}
            >
              {p.error ?? '未知错误'}
            </div>
            <button className="btn ghost block" disabled={pageBusy} onClick={() => void openPage()}>
              <Icon name="external" size={14} />
              打开发行版页面（手动下载）
            </button>
            {openError && <div className="errline">{openError}</div>}
            <div className="btns">
              <button className="btn ghost" onClick={p.onClose}>
                关闭
              </button>
              <button className="btn primary" onClick={p.onRecheck}>
                重试
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
