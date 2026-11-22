import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  boardOf,
  entriesFromBoard,
  etaSeconds,
  fastestRoute,
  formatEta,
  measureRoutes,
  modeHint,
  progressOf,
  rankRoutes,
  readSpeedBoard,
  routeDetail,
  routeLabelOf,
  routesWithoutSample,
  safeFileName,
  targetSummary,
  writeSpeedBoard,
  type DownloadMode,
  type DownloadRoute,
  type DownloadTarget,
  type SpeedBoard,
  type SpeedEntry,
} from '../lib/download'
import { formatSpeed, pickReachable, selfMirrorBase } from '../lib/mirrors'
import { formatBytes, headReachable, openExternal } from '../lib/update'
import {
  cancelInnerDownload,
  discardResume,
  downloadStatus,
  innerDownload,
  installApk,
  nativeDownloadAvailable,
  takePendingDownload,
} from '../lib/native-download'
import { appendRecord, makeRecord, recordFromPending } from '../lib/dl-history'
import { Icon } from './icons'

/**
 * 统一下载面板。
 *
 * 三个入口（检查更新的安装包、任意仓库的发行版附件、仓库源码 ZIP）都开到这里：
 * 线路表、测速、选线、进度、安装是同一套，不该各写三遍。
 *
 * 测速结果存在本机（localStorage），**按自然日一天只测一次**：候选线路是同一批
 * 代理，下 A 包测过的结果对 B 包同样成立，没必要每开一个包就重测一轮。
 * 跨过零点、或者用户点「重新测速」时才真的再拉一次。
 */
function hhmm(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

type Phase = 'idle' | 'probing' | 'downloading' | 'installing' | 'done' | 'error'

interface Props {
  target: DownloadTarget
  mode: DownloadMode
  onMode: (m: DownloadMode) => void
  /**
   * 期望并发数：1 表示单线程。原生侧会先探 Range，服务器不认就自己退回单连接，
   * 所以这里传大一点最坏也只是没变快。
   */
  parts?: number
  onClose: () => void
  onToast: (msg: string) => void
  /** 需要鉴权的资源（CI 产物）才传；传了就会带到请求头里 */
  auth?: string | null
}

export function DownloadSheet(p: Props) {
  const native = nativeDownloadAvailable()

  const [board, setBoard] = useState<SpeedBoard | null>(() => readSpeedBoard())
  const [entries, setEntries] = useState<SpeedEntry[]>(() =>
    entriesFromBoard(p.target.routes, readSpeedBoard()),
  )
  const [probing, setProbing] = useState(false)
  const [probeDone, setProbeDone] = useState(0)
  const [probeTotal, setProbeTotal] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<{
    bytes: number
    total: number
    kbps: number
    startedAt: number
    parts: number
  } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  /** 上次停下时已下的字节数；>0 表示有断点可续 */
  const [resumeAt, setResumeAt] = useState(0)
  const cancelledRef = useRef(false)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  /**
   * 进来先对账。
   *
   * 熄屏、切后台、WebView 被系统回收重建之后，原来那个下载 Promise 早就没了，
   * 但原生线程还在跑。这里问一句「是不是同一个文件在下」，是就接着显示进度，
   * 不是就明说「另一个文件在下」，别让用户又点一次把按钮点成死循环。
   */
  useEffect(() => {
    if (!native) return
    let stop = false
    void (async () => {
      const s = await downloadStatus()
      if (stop) return
      if (!s.running) {
        // 没在跑：看有没有上次留下的断点，进面板就明说能接着下
        if (s.resumable && (s.resumeBytes ?? 0) > 0) setResumeAt(s.resumeBytes ?? 0)
        return
      }
      if (s.fileName && s.fileName !== safeFileName(p.target.fileName)) {
        setErr(`另一个文件正在下载：${s.fileName}`)
        return
      }
      setPhase('downloading')
      setProgress({ bytes: s.bytes, total: s.total, kbps: s.kbps, startedAt: Date.now(), parts: s.parts ?? 1 })
    })()
    return () => {
      stop = true
    }
    // 只在挂载时对一次账
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 下载中轮询原生状态。
   *
   * 进度事件在页面活着时是通的，但页面重建过一次之后监听就断了 ——
   * 轮询是那条路的兜底。两种情况同时存在也不冲突：谁先到算谁的，值都来自同一处。
   */
  useEffect(() => {
    if (phase !== 'downloading' || !native) return
    const timer = setInterval(() => {
      void (async () => {
        const s = await downloadStatus()
        if (!aliveRef.current) return
        if (s.running) {
          setProgress((prev) => ({
            bytes: s.bytes,
            total: s.total > 0 ? s.total : p.target.size,
            kbps: s.kbps,
            parts: s.parts ?? prev?.parts ?? 1,
            startedAt: prev?.startedAt ?? Date.now(),
          }))
          return
        }
        if (!s.hasResult) return
        if (s.path) {
          setSavedPath(s.path)
          setResumeAt(0)
          setPhase('done')
        } else {
          setErr(s.error ?? '下载已停止')
          if (s.resumable && (s.resumeBytes ?? 0) > 0) setResumeAt(s.resumeBytes ?? 0)
          setPhase('error')
        }
      })()
    }, 800)
    return () => clearInterval(timer)
  }, [phase, native, p.target.size])

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

  /**
   * 测速。传 only 就只测那几条（自动测速补齐缺的样本），不传则全测（用户点「重新测速」）。
   *
   * 并发 3 条，边测边点亮；测完把结果并进当天的看板，关闭面板再打开、甚至重启
   * App 都直接命中，不再拉流量。
   */
  const measure = useCallback(
    async (only?: DownloadRoute[]) => {
      const targets = only ?? p.target.routes
      if (probing || targets.length === 0) return
      setProbing(true)
      setProbeDone(0)
      setProbeTotal(targets.length)
      const acc: SpeedEntry[] = []
      await measureRoutes(targets, {
        onResult: (entry) => {
          acc.push(entry)
          if (!aliveRef.current) return
          setProbeDone(acc.length)
          setEntries((prev) => [...prev.filter((e) => e.route.url !== entry.route.url), entry])
        },
      })
      const next = boardOf(acc, Date.now(), readSpeedBoard())
      writeSpeedBoard(next)
      if (!aliveRef.current) return
      setBoard(next)
      setProbing(false)
    },
    [probing, p.target.routes],
  )

  /**
   * 打开就出结果：当天测过就直接用，一条请求都不发。
   *
   * 只有「看板过期」或「有线路还没样本」（比如用户刚加了自定义站）时才补测，
   * 而且只补缺的那几条 —— 不会因为多了一个站就把六条线路全拉一遍。
   * CI 产物不测：它只有一条线路，且必须带令牌，HEAD 会直接 401。
   */
  useEffect(() => {
    if (p.target.kind === 'artifact') return
    const today = readSpeedBoard()
    const missing = routesWithoutSample(p.target.routes, today)
    if (missing.length === 0) return
    void measure(missing)
    // 只在首次挂载时决定要不要测
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ranked = useMemo(() => rankRoutes(entries), [entries])
  const best = fastestRoute(entries)
  /** 同一站点可能出现两行（源码 ZIP：codeload 直取 vs github 302），只写站名会分不清 */
  const bestDup = best ? p.target.routes.filter((r) => r.label === best.label).length > 1 : false

  /**
   * 实际下载顺序：按测速结果排（没测过就按原顺序）。
   *
   * 测速是一条条来的，中途只有前几条有结果。这里把「已测的」放前面、
   * 「还没测的」接在后面，行数始终等于候选总数 —— 否则测速一开始列表会
   * 从六行缩成两行，看起来像线路被删了。
   */
  const order = useMemo(() => {
    const all = p.target.routes
    let base = [...all]
    if (entries.length > 0) {
      const rankedRoutes = ranked.map((e) => e.route)
      const seen = new Set(rankedRoutes.map((r) => r.url))
      base = [...rankedRoutes, ...all.filter((r) => !seen.has(r.url))]
    }
    /*
     * 自建站钉在第 2 位（它自己最快就留在第 1）。
     *
     * 测速只拉 256 KB，CF Worker 冷启动、跨境回源这些开销全算在这一小段里，
     * 排出来常常比公共代理靠后；但公共代理说挂就挂、说限速就限速，自己的站
     * 不会。所以位置固定，速度照实显示在旁边，选不选由用户看着办。
     */
    const selfBase = selfMirrorBase().toLowerCase()
    const selfAt = base.findIndex((r) => (r.base ?? '').toLowerCase() === selfBase)
    if (selfAt > 1) {
      const [self] = base.splice(selfAt, 1)
      base.splice(1, 0, self)
    }
    /*
     * 手动挑过的线路**不重排**，只做选中高亮。
     *
     * 以前把挑中的 splice 到第一行，列表当场跳动：想从下往上选的人刚点到目标行，
     * 它就窜去顶部，下一行又顶上来 —— 很难确认自己刚才点的是哪条。
     * 顺序交给测速排序（+ 自建站钉位）维持稳定，选中态只靠高亮框表达。
     */
    return base
  }, [entries, ranked, p.target.routes])

  /**
   * 认领这次下载的结果并写进本机历史。
   *
   * 优先用原生留下的「待认领」记录：它连「页面已经被销毁」的情况也覆盖了；
   * 取不到（比如网页端没有原生通道）才用调用方给的兜底值。
   * 同一个结果只会被记一次 —— 原生那边取走即清空。
   */
  async function claimRecord(fallback?: { ok: boolean; path?: string; error?: string }) {
    const pend = await takePendingDownload()
    if (pend) {
      appendRecord(
        recordFromPending({
          ...pend,
          repo: pend.repo || p.target.repo,
          tag: pend.tag || p.target.tag,
        }),
      )
      return
    }
    if (!fallback) return
    appendRecord(
      makeRecord({
        repo: p.target.repo,
        name: p.target.fileName,
        kind: p.target.kind,
        tag: p.target.tag,
        size: p.target.size,
        bytes: 0,
        status: fallback.ok ? 'done' : 'failed',
        ...(fallback.path ? { path: fallback.path } : {}),
        ...(fallback.error ? { error: fallback.error } : {}),
      }),
    )
  }

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
      setProgress({ bytes: 0, total: p.target.size, kbps: 0, startedAt: Date.now(), parts: p.parts ?? 1 })
      try {
        const res = await innerDownload({
          url: route.url,
          fileName: safeFileName(p.target.fileName),
          expectBytes: p.target.size,
          ...(route.auth && p.auth ? { headers: { Authorization: `Bearer ${p.auth}` } } : {}),
          repo: p.target.repo,
          kind: p.target.kind,
          ...(p.target.tag ? { tag: p.target.tag } : {}),
          ...(p.parts && p.parts > 1 ? { parts: p.parts } : {}),
          onProgress: (d) => {
            if (!aliveRef.current) return
            setProgress((prev) => ({
              bytes: d.bytes,
              total: d.total > 0 ? d.total : p.target.size,
              kbps: d.kbps,
              parts: d.parts ?? prev?.parts ?? 1,
              startedAt: prev?.startedAt ?? Date.now(),
            }))
          },
        })
        // 记录不依赖界面是否还活着：用户可能已经切走，包却下完了
        void claimRecord({ ok: true, path: res.path })
        if (!aliveRef.current) return
        setSavedPath(res.path)
        setResumeAt(0)
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
        // 「已取消」可能是原生侧告诉我们的：用户从通知栏按了取消，
        // 那时本组件的 cancelledRef 还是 false，不能当成失败往下试下一线路
        if (cancelledRef.current || lastError === '已取消') break
      }
    }

    if (cancelledRef.current || lastError === '已取消') {
      // 取消不留记录，但要清掉上一条线路失败时留下的待认领，免得下次启动冒出来
      void takePendingDownload()
      if (!aliveRef.current) return
      setPhase('idle')
      setProgress(null)
      return
    }
    void claimRecord({ ok: false, error: lastError })
    if (!aliveRef.current) return
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

  /** 用户明确不想接着上次那条半截文件：删掉它，从头来 */
  async function clearResume() {
    await discardResume(safeFileName(p.target.fileName))
    setResumeAt(0)
    p.onToast('已清除断点，下次从头下载')
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

        {resumeAt > 0 && !busy && (
          <div className="dl-note dl-resume">
            <span>
              上次下到 {formatBytes(resumeAt)}
              {p.target.size > 0 ? `（${progressOf(resumeAt, p.target.size)}%）` : ''}，继续会接着下
            </span>
            <button className="linkbtn" onClick={() => void clearResume()}>
              清除断点
            </button>
          </div>
        )}

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
            {probing
              ? `测速中 ${probeDone}/${probeTotal}`
              : entries.length > 0
                ? '重新测速'
                : '开始测速'}
          </button>
        </div>

        {!probing && board && entries.length > 0 && (
          <div className="dl-note">今天 {hhmm(board.at)} 测过 · 每天自动测一次</div>
        )}

        <div className="multi-list">
          {order.map((r, i) => {
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
                  <i
                    className="ellipsis"
                    title={
                      r.official
                        ? '官方直连建连快、首包快，但长时段吞吐会掉，所以排在所有代理之后'
                        : undefined
                    }
                  >
                    {routeDetail(r)}
                    {r.official ? ' · 后段慢' : ''}
                  </i>
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
                {progress.parts > 1 ? `${progress.parts} 路 · ` : ''}
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
            <>
              <button className="btn ghost" onClick={() => void cancel()}>
                取消下载
              </button>
              <button className="btn primary" onClick={p.onClose}>
                <Icon name="download" size={14} />
                后台下载
              </button>
            </>
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
                    ? resumeAt > 0
                      ? p.target.installable
                        ? '继续下载并安装'
                        : '继续下载'
                      : p.target.installable
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
              ? '点「后台下载」可以退出这一页，下载会在通知栏继续；回来还能接着看进度。测速只拉每条线路的前 256 KB。'
              : p.target.installable
                ? '交给浏览器后进度在通知栏；下载完成后点通知即可安装。'
                : '交给浏览器后进度在通知栏，完成后可直接打开，也能在下载目录里找到。'}
        </div>
      </div>
    </div>
  )
}
