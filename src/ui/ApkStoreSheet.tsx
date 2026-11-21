import { useEffect, useMemo, useState } from 'react'
import {
  apkStoreUsable,
  loadApkStore,
  peekApkStore,
  type ApkApp,
  type ApkStore,
} from '../lib/apkstore'
import { compactNumber } from '../lib/format'
import type { KV } from '../lib/storage'
import { Icon } from './icons'

/**
 * 商店卡片头像。
 * 头像加载失败回退首字母 —— 国内 avatars.githubusercontent.com 经常不可达；
 * 且 <img> 等待响应期间不触发 onerror（RULES 记过的坑），挂起同样按失败算，
 * 8 秒没加载出来就换首字母。
 */
function ShopAvatar({ app }: { app: ApkApp }) {
  const [failed, setFailed] = useState(false)
  const [ok, setOk] = useState(false)
  useEffect(() => {
    if (ok || failed || !app.avatarUrl) return
    const timer = window.setTimeout(() => setFailed(true), 8000)
    return () => window.clearTimeout(timer)
  }, [ok, failed, app.avatarUrl])
  if (app.avatarUrl && !failed && ok) {
    return (
      <img
        className="shop-avatar"
        src={app.avatarUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onLoad={() => setOk(true)}
        onError={() => setFailed(true)}
      />
    )
  }
  return <div className="shop-avatar shop-letter">{app.name.charAt(0)}</div>
}

/**
 * APK 商店清单（komi-store 精选安卓应用目录）。
 *
 * 入口在热门页标题栏，内容收进全屏弹层：两列网格 + 名称/简介过滤，
 * 点应用交给调用方走现有仓库详情链路，装包复用发行版下载，零特例。
 */
export function ApkStoreSheet(p: {
  kv: KV | null
  onClose: () => void
  onOpenApp: (app: ApkApp) => void
}) {
  const [store, setStore] = useState<ApkStore | null>(peekApkStore())
  const [done, setDone] = useState(false)
  const [q, setQ] = useState('')

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

  const apps = useMemo(() => {
    if (!store || !apkStoreUsable(store)) return []
    const kw = q.trim().toLowerCase()
    if (!kw) return store.apps
    return store.apps.filter(
      (a) =>
        a.fullName.toLowerCase().includes(kw) ||
        a.name.toLowerCase().includes(kw) ||
        (a.description ?? '').toLowerCase().includes(kw),
    )
  }, [store, q])

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
              {usable ? `${store?.apps.length ?? 0} 个安卓应用` : done ? '目录暂时取不到' : '正在装填…'}
            </div>
          </div>
          <div className="spacer" />
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭">
            <Icon name="close" size={16} />
          </button>
        </div>

        {usable && (
          <div className="search" style={{ margin: '4px 0 10px' }}>
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
            <b>没有匹配的应用</b>换个关键词试试。
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
