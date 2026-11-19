import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cacheFresh,
  etaSeconds,
  fastestRoute,
  formatEta,
  measureRoutes,
  modeHint,
  progressOf,
  rankRoutes,
  routeDetail,
  routeLabelOf,
  safeFileName,
  speedKey,
  targetSummary,
  type DownloadMode,
  type DownloadTarget,
  type SpeedCache,
  type SpeedEntry,
} from '../lib/download'
import { formatSpeed, pickReachable } from '../lib/mirrors'
import { formatBytes, headReachable, openExternal } from '../lib/update'
import { cancelInnerDownload, innerDownload, installApk, nativeDownloadAvailable } from '../lib/native-download'
import { Icon } from './icons'

/**
 * 统一下载面板。
 *
 * 三个入口（检查更新的安装包、任意仓库的发行版附件、仓库源码 ZIP）都开到这里：
 * 线路表、测速、选线、进度、安装是同一套，不该各写三遍。
 *
 * 测速结果按「附件 + 候选首地址」缓存在模块级 Map 里，同一个包再打开时
 * 直接沿用（6 小时），不会因为退出面板又重新拉 1 MB。
 */
const SPEED_MEM = new Map<string, SpeedCache>()

type Phase = 'idle' | 'probing' | 'downloading' | 'installing' | 'done' | 'error'

interface Props {
  target: DownloadTarget
  mode: DownloadMode
  onMode: (m: DownloadMode) => void
  onClose: () => void
  onToast: (msg: string) => void
  /** 需要鉴权的资源（CI 产物）才传；传了就会带到请求头里 */
  auth?: string | null
}

export function DownloadSheet(p: Props) {
  const native = nativeDownloadAvailable()
  const key = speedKey(p.target)
  const cached = SPEED_MEM.get(key)

  const [entries, setEntries] = useState<SpeedEntry[]>(() => (cacheFresh(cached) ? (cached as SpeedCache).entries : []))
  const [probing, setProbing] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<{ bytes: number; total: number; kbps: number; startedAt: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const cancelledRef = useRef(false)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  /**
   * 应用内只对安装包有意义：其它文件落在 App 私有目录，文件管理器看不到。
   * 例外是 CI 产物 —— 它必须带令牌才能取，交给浏览器会 401，所以只能应用内。
   */
  const mustInner = p.target.kind === 'artifact'
  const canInner = native && (p.target.installable || mustInner)
  /** 网页端根本没有原生通道，产物又只能走原生 —— 这里必须明说，不能装作能下 */
  const blocked = mustInner && !native
  const effectiveMode: DownloadMode = canInner ? (mustInner ? 'inner' : p.mode) : 'outer'
  const busy = phase === 'downloading' || phase === 'installing'

  const measure = useCallback(async () => {
    if (probing || p.target.routes.length === 0) return
    setProbing(true)
    const acc: SpeedEntry[] = []
    await measureRoutes(p.target.routes, {
      onResult: (entry) => {
        acc.push(entry)
        if (aliveRef.current) setEntries([...acc])
      },
    })
    SPEED_MEM.set(key, { at: Date.now(), entries: acc })
    if (aliveRef.current) setProbing(false)
  }, [probing, key, p.target.routes])

  // 打开即测：用户要的就是「哪条快」。已有 6 小时内的结果就直接用。
  // CI 产物不测：它只有一条线路，而且必须带令牌，HEAD 会直接 401。
  useEffect(() => {
    if (p.target.kind === 'artifact') return
    if (entries.length === 0) void measure()
    // 只在首次挂载时决定是否自动测速
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ranked = useMemo(() => rankRoutes(entries), [entries])
  const best = fastestRoute(entries)
  /** 同一站点可能出现两行（源码 ZIP：codeload 直取 vs github 302），只写站名会分不清 */
  const bestDup = best ? p.target.routes.filter((r) => r.label === best.label).length > 1 : false

  /** 实际下载顺序：手动挑的排第一，其余按测速结果（没测过就按原顺序） */
  const order = useMemo(() => {
    const all = p.target.routes
    const list = entries.length > 0 ? ranked.map((e) => e.route) : [...all]
    if (!picked) return list
    const hit = all.find((r) => r.url === picked)
    if (!hit) return list
    return [hit, ...list.filter((r) => r.url !== hit.url)]
  }, [entries, ranked, picked, p.target.routes])

  async function start() {
    if (busy || p.target.routes.length === 0) return
    setErr(null)
    cancelledRef.current = false

    // 应用外：探一条通的就交给浏览器。探活失败时 pickReachable 回退第一条，
    // 与「检查更新」旧行为一致 —— 让浏览器再试一次，比直接说「下不了」有用。
    if (effectiveMode === 'outer') {
      setPhase('probing')
      try {
        const url = await pickReachable(order.map((r) => r.url), (u) => headReachable(u))
        await openExternal(url)
        if (!aliveRef.current) return
        setPhase('done')
        p.onToast('已交给浏览器下载，可在通知栏看进度')
      } catch (e) {
        if (!aliveRef.current) return
        setPhase('error')
        setErr(`无法唤起浏览器：${(e as Error).message}`)
      }
      return
    }

    // 应用内：按顺序最多试三条线路。失败就换下一条，不必让用户手动重来。
    const tried = order.slice(0, 3)
    let lastError = ''
    for (let i = 0; i < tried.length; i += 1) {
      if (cancelledRef.current) break
      const route = tried[i]
      setPhase('downloading')
      setProgress({ bytes: 0, total: p.target.size, kbps: 0, startedAt: Date.now() })
      try {
        const res = await innerDownload({
          url: route.url,
          fileName: safeFileName(p.target.fileName),
          expectBytes: p.target.size,
          ...(route.auth && p.auth ? { headers: { Authorization: `Bearer ${p.auth}` } } : {}),
          onProgress: (d) => {
            if (!aliveRef.current) return
            setProgress((prev) => ({
              bytes: d.bytes,
              total: d.total > 0 ? d.total : p.target.size,
              kbps: d.kbps,
              startedAt: prev?.startedAt ?? Date.now(),
            }))
          },
        })
        if (!aliveRef.current) return
        setSavedPath(res.path)
        // 只有安装包才需要调安装器；产物是 zip，交给系统查看器即可
        if (!p.target.installable) {
          setPhase('done')
          p.onToast('已保存到 App 的下载目录')
          return
        }
        setPhase('installing')
        const r = await installApk(res.path)
        if (!aliveRef.current) return
        setPhase('done')
        if (r.needPermission) {
          setErr('系统需要你允许「安装未知应用」。已跳到设置页，允许后回到这里点「安装」。')
        } else {
          p.onToast('下载完成，已调起安装器')
        }
        return
      } catch (e) {
        lastError = (e as Error).message || '下载失败'
        if (cancelledRef.current) break
      }
    }

    if (!aliveRef.current) return
    if (cancelledRef.current) {
      setPhase('idle')
      setProgress(null)
      return
    }
    setPhase('error')
    setErr(tried.length > 1 ? `试了 ${tried.length} 条线路都不行：${lastError}` : lastError)
  }

  async function retryInstall() {
    if (!savedPath) return
    setErr(null)
    try {
      const r = await installApk(savedPath)
      if (r.needPermission) setErr('还没有拿到「安装未知应用」权限，请允许后再点一次。')
      else p.onToast('已调起安装器')
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function cancel() {
    cancelledRef.current = true
    await cancelInnerDownload()
    setPhase('idle')
    setProgress(null)
  }

  const pct = progress ? progressOf(progress.bytes, progress.total) : 0
  const eta = progress
    ? etaSeconds(progress.bytes, progress.total, Date.now() - progress.startedAt)
    : null

  const sizeText = p.target.size > 0 ? formatBytes(p.target.size) : '大小未知'

  return (
    <div className="mask" onClick={busy ? undefined : p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h3 className="ellipsis">{p.target.title}</h3>
        <div className="sheet-sub ellipsis">{targetSummary(p.target)}</div>

        <div className="dl-file">
          <span className="dl-file-ic">
            <Icon name={p.target.installable ? 'package' : 'download'} size={15} />
          </span>
          <span className="dl-file-main">
            <b className="mono ellipsis">{p.target.fileName}</b>
            <i>
              {sizeText}
              {p.target.kind === 'archive'
                ? ' · 源码 ZIP'
                : p.target.kind === 'apk'
                  ? ' · 安装包'
                  : p.target.kind === 'artifact'
                    ? ' · CI 产物'
                    : ' · 发行版附件'}
            </i>
          </span>
        </div>

        <div className="tgl-label" style={{ marginTop: 14 }}>
          下载方式
        </div>
        <div className="seg sm" style={{ margin: 0 }}>
          <button
            className={effectiveMode === 'inner' ? 'on' : ''}
            disabled={!canInner || busy}
            onClick={() => p.onMode('inner')}
          >
            应用内下载
          </button>
          <button className={effectiveMode === 'outer' ? 'on' : ''} disabled={busy} onClick={() => p.onMode('outer')}>
            交给浏览器
          </button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          {blocked
            ? 'CI 产物要在 App 里下载：浏览器没有令牌，也拿不到跳转后的地址。'
            : mustInner
              ? '这条只能由 App 下载：浏览器没有令牌，取不到产物'
              : modeHint(effectiveMode, native, p.target.installable)}
        </div>

        <div className="dl-head">
          <span>
            线路
            {best ? (
              <em className="dl-best">
                {bestDup ? `${routeLabelOf(best)} · ${routeDetail(best)}` : routeLabelOf(best)} 最快
              </em>
            ) : null}
          </span>
          <button className="multi-all" disabled={probing || busy} onClick={() => void measure()}>
            {probing ? '测速中…' : entries.length > 0 ? '重新测速' : '开始测速'}
          </button>
        </div>

        <div className="multi-list">
          {p.target.routes.map((r, i) => {
            const hit = entries.find((e) => e.route.url === r.url)
            const on = picked ? picked === r.url : best ? best.url === r.url : i === 0
            const speedText = hit
              ? hit.result.status === 'ok'
                ? formatSpeed(hit.result.kbps)
                : hit.result.error ?? '不可用'
              : probing
                ? '测速中'
                : '未测'
            const tone = hit ? (hit.result.status === 'ok' ? ' ok' : ' bad') : ''
            return (
              <button
                key={r.url}
                className={`multi-row${on ? ' on' : ''}`}
                disabled={busy}
                onClick={() => setPicked(r.url)}
              >
                <span className={`multi-box${on ? ' on' : ''}`} aria-hidden>
                  {on && <Icon name="check" size={11} />}
                </span>
                <span className="multi-main">
                  <b className="ellipsis">{r.label}</b>
                  <i className="ellipsis">{routeDetail(r)}</i>
                </span>
                <span className={`dl-speed${tone}`}>{speedText}</span>
              </button>
            )
          })}
        </div>

        {phase === 'downloading' && progress && (
          <div className="dl-prog">
            <div className="multi-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
            <div className="dl-prog-line">
              <span>
                {formatBytes(progress.bytes)}
                {progress.total > 0 ? ` / ${formatBytes(progress.total)}` : ''} · {pct}%
              </span>
              <span>
                {formatSpeed(progress.kbps)}
                {eta != null ? ` · ${formatEta(eta)}` : ''}
              </span>
            </div>
          </div>
        )}

        {phase === 'installing' && (
          <div className="dl-prog-line" style={{ marginTop: 10 }}>
            <span>下载完成，正在调起安装器…</span>
          </div>
        )}

        {err && <div className="errline">{err}</div>}

        <div className="btns">
          {busy ? (
            <button className="btn ghost" onClick={() => void cancel()}>
              取消下载
            </button>
          ) : (
            <button className="btn ghost" onClick={p.onClose}>
              {phase === 'done' ? '关闭' : '稍后'}
            </button>
          )}

          {phase === 'done' && savedPath && p.target.installable ? (
            <button className="btn primary" onClick={() => void retryInstall()}>
              <Icon name="package" size={14} />
              安装
            </button>
          ) : (
            <button
              className="btn primary"
              disabled={busy || blocked || p.target.routes.length === 0}
              onClick={() => void start()}
            >
              <Icon name={effectiveMode === 'inner' ? 'download' : 'external'} size={14} />
              {phase === 'downloading'
                ? `下载中 ${pct}%`
                : phase === 'probing'
                  ? '正在选择线路…'
                  : effectiveMode === 'inner'
                    ? p.target.installable
                      ? '下载并安装'
                      : '下载'
                    : '用浏览器下载'}
            </button>
          )}
        </div>

        <div className="hint" style={{ marginTop: 10, textAlign: 'center' }}>
          {p.target.kind === 'artifact'
            ? 'CI 产物要走令牌才能取，浏览器拿不到，所以只能由 App 下载；产物有保留期限，过期后需要重新跑一次工作流。'
            : effectiveMode === 'inner'
              ? '测速只拉每条线路的前 256 KB，不会把整个包下两遍。'
              : p.target.installable
                ? '交给浏览器后进度在通知栏；下载完成后点通知即可安装。'
                : '交给浏览器后进度在通知栏，完成后可直接打开，也能在下载目录里找到。'}
        </div>
      </div>
    </div>
  )
}
