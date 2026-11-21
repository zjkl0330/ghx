import { useEffect, useMemo, useState } from 'react'
import {
  APK_PLATFORM_LABEL,
  apkStoreUsable,
  avatarSources,
  loadApkStore,
  peekApkStore,
  type ApkApp,
  type ApkPlatform,
  type ApkStore,
} from '../lib/apkstore'
import { compactNumber } from '../lib/format'
import type { KV } from '../lib/storage'
import { Icon } from './icons'

/**
 * 商店卡片头像。逐条线路尝试：原图 → 公共代理改写 → 首字母兜底。
 *
 * avatars.githubusercontent.com 国内整站不通，feed 从官方 raw 拿来时头像是
 * 裸域名，等 8 秒再画首字母等于「每张图都慢一拍还照样失败」——
 * 所以把 avatarSources() 给出的候选逐个换，每条 6 秒超时，
 * 全部阵亡才退首字母。加载成功就停表。
 */
function ShopAvatar({ app }: { app: ApkApp }) {
  const sources = useMemo(() => avatarSources(app.avatarUrl), [app.avatarUrl])
  const [idx, setIdx] = useState(0)
  const [ok, setOk] = useState(false)
  useEffect(() => {
    setIdx(0)
    setOk(false)
  }, [app.avatarUrl])
  useEffect(() => {
    if (ok || idx >= sources.length) return
    // <img> 等响应期间不触发 onerror（RULES 记过的坑），挂起按失败算
    const timer = window.setTimeout(() => setIdx((i) => i + 1), 6000)
    return () => window.clearTimeout(timer)
  }, [ok, idx, sources.length])
  const src = idx < sources.length ? sources[idx] : undefined
  if (src) {
    return (
      <img
        className="shop-avatar"
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onLoad={() => setOk(true)}
        onError={() => setIdx((i) => i + 1)}
      />
    )
  }
  return <div className="shop-avatar shop-letter">{app.name.charAt(0)}</div>
}

const PLATFORM_TABS: (ApkPlatform | 'all')[] = ['all', 'android', 'windows', 'macos', 'linux']

/**
 * APK 商店清单（komi-store 精选安卓应用目录）。
 *
 * 入口在热门页标题栏，内容收进全屏弹层：平台归属筛选 tabs + 名称/简介过滤
 * + 两列网格（卡片带平台小标与版本 tag）。点应用交给调用方走现有仓库详情
 * 链路，装包复用发行版下载，零特例。
 */
export function ApkStoreSheet(p: {
  kv: KV | null
  onClose: () => void
  onOpenApp: (app: ApkApp) => void
}) {
  const [store, setStore] = useState<ApkStore | null>(peekApkStore())
  const [done, setDone] = useState(false)
  const [q, setQ] = useState('')
  const [plat, setPlat] = useState<ApkPlatform | 'all'>('all')

  useEffect(() => {
    let alive = true
    void loadApkStore(p.kv).then((s) => {
      if (!alive) return
      setStore(s)
      setDone(true)
    })
    return () => {
      alive = false
    }
  }, [p.kv])

  const counts = useMemo(() => {
    const m = new Map<ApkPlatform, number>()
    for (const a of store?.apps ?? []) for (const pf of a.platforms) m.set(pf, (m.get(pf) ?? 0) + 1)
    return m
  }, [store])

  const apps = useMemo(() => {
    if (!store || !apkStoreUsable(store)) return []
    const kw = q.trim().toLowerCase()
    return (store.apps ?? [])
      .filter((a) => plat === 'all' || a.platforms.includes(plat))
      .filter(
        (a) =>
          !kw ||
          a.fullName.toLowerCase().includes(kw) ||
          a.name.toLowerCase().includes(kw) ||
          (a.description ?? '').toLowerCase().includes(kw),
      )
  }, [store, q, plat])

  const usable = !!store && apkStoreUsable(store)

  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="sheet-head">
          <div>
            <h3 style={{ margin: 0 }}>APK 商店</h3>
            <div className="sheet-sub">
              {store?.rotation ? `komi-store 精选 ${store.rotation} · ` : 'komi-store 精选 · '}
              {usable ? `${store?.apps.length ?? 0} 个应用` : done ? '目录暂时取不到' : '正在装填…'}
            </div>
          </div>
          <div className="spacer" />
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭">
            <Icon name="close" size={16} />
          </button>
        </div>

        {usable && (
          <div className="shop-tabs" role="tablist">
            {PLATFORM_TABS.map((t) => {
              const n = t === 'all' ? (store?.apps.length ?? 0) : (counts.get(t) ?? 0)
              return (
                <button
                  key={t}
                  role="tab"
                  aria-selected={plat === t}
                  className={`shop-tab${plat === t ? ' on' : ''}`}
                  onClick={() => setPlat(t)}
                >
                  {t === 'all' ? '全部' : APK_PLATFORM_LABEL[t]}
                  <span className="shop-tab-n">{n}</span>
                </button>
              )
            })}
          </div>
        )}

        {usable && (
          <div className="search" style={{ margin: '0 0 10px' }}>
            <Icon name="search" size={14} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="按名称或简介过滤"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
            />
            {q && (
              <button onClick={() => setQ('')} aria-label="清空" style={{ color: 'inherit' }}>
                <Icon name="close" size={13} />
              </button>
            )}
          </div>
        )}

        {!done && (
          <div className="shop-grid" aria-hidden>
            {Array.from({ length: 6 }, (_, i) => (
              <div className="shop-card shop-skel" key={i}>
                <span className="skel shop-avatar" />
                <span className="skel skel-bar" style={{ width: '70%' }} />
                <span className="skel skel-bar sm" style={{ width: '88%' }} />
              </div>
            ))}
          </div>
        )}

        {done && !usable && (
          <div className="empty" style={{ marginTop: 10 }}>
            <b>目录暂时取不到</b>
            它缓存在 komi-store 的公开仓库里，网络恢复后再试。热门榜单不受影响。
          </div>
        )}

        {done && usable && apps.length === 0 && (
          <div className="empty" style={{ marginTop: 10 }}>
            <b>没有匹配的应用</b>换个平台或关键词试试。
          </div>
        )}

        {usable && apps.length > 0 && (
          <div className="shop-grid">
            {apps.map((a) => (
              <button
                key={a.fullName}
                className="shop-card"
                onClick={() => p.onOpenApp(a)}
                aria-label={`打开 ${a.fullName}`}
              >
                <span className="shop-top">
                  <ShopAvatar app={a} />
                  <span className="shop-main">
                    <span className="shop-name">{a.name}</span>
                    <span className="shop-meta">
                      ★ {compactNumber(a.stars)}
                      {a.language ? ` · ${a.language}` : ''}
                    </span>
                  </span>
                </span>
                <span className="shop-plats">
                  {a.platforms.map((pf) => (
                    <span className="shop-plat" key={pf}>
                      {APK_PLATFORM_LABEL[pf]}
                    </span>
                  ))}
                </span>
                {a.latestTag && <span className="shop-tag">{a.latestTag}</span>}
                {a.description && <span className="shop-desc">{a.description}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
