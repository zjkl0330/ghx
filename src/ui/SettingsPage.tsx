import { useState } from 'react'
import { DEFAULT_BASE_URL } from '../lib/api'
import { DEFAULT_MIRROR } from '../lib/update'
import { Icon } from './icons'

interface Props {
  baseUrl: string
  login: string | null
  tokenCount: number
  repoCount: number
  auditCount: number
  version: string
  mirror: string
  updateCheckedAt: number | null
  latestVersion: string | null
  hasUpdate: boolean
  onSaveBaseUrl: (url: string) => void
  onSaveMirror: (url: string) => void
  onCheckUpdate: () => void
  onLock: () => void
  onClearAudit: () => void
}

function ago(ts: number | null): string {
  if (!ts) return '尚未检查'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚检查'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前检查`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前检查`
  return `${Math.floor(diff / 86_400_000)} 天前检查`
}

export function SettingsPage(p: Props) {
  const [url, setUrl] = useState(p.baseUrl)
  const [mirror, setMirror] = useState(p.mirror)
  const changed = url.trim() !== p.baseUrl
  const mirrorChanged = mirror.trim().replace(/\/+$/, '') !== p.mirror

  return (
    <>
      <div className="topbar">
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.3px' }}>设置</div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 3 }}>
            {p.login ? `已连接 @${p.login}` : '未连接账号'}
          </div>
        </div>
      </div>

      <div className="page">
        <div style={{ padding: '4px 16px 0' }}>
          <div className="field">
            <label htmlFor="base">API 地址</label>
            <input
              id="base"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={DEFAULT_BASE_URL}
              autoCapitalize="off"
              spellCheck={false}
            />
            <div className="hint">
              默认 {DEFAULT_BASE_URL}。github.com 网页打不开时该域名通常仍可用；如遇污染可改为可信镜像地址，只影响请求域名，令牌仍只发给你填的地址。
            </div>
          </div>
          <button
            className="btn ghost block"
            style={{ marginTop: 10 }}
            disabled={!changed}
            onClick={() => p.onSaveBaseUrl(url.trim() || DEFAULT_BASE_URL)}
          >
            保存并重连
          </button>

          <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
            <div className="tk" style={{ flex: 1, margin: 0, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{p.repoCount}</div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>仓库</div>
            </div>
            <div className="tk" style={{ flex: 1, margin: 0, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{p.tokenCount}</div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>令牌</div>
            </div>
            <div className="tk" style={{ flex: 1, margin: 0, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{p.auditCount}</div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>审计</div>
            </div>
          </div>

          <div className="section-title">版本与更新</div>
          <div className="panel">
            <div className="kv-row">
              <span>当前版本</span>
              <b className="mono">v{p.version}</b>
            </div>
            <div className="kv-row">
              <span>状态</span>
              <b style={{ color: p.hasUpdate ? 'var(--green)' : 'var(--text-dim)' }}>
                {p.hasUpdate ? `可更新至 v${p.latestVersion}` : ago(p.updateCheckedAt)}
              </b>
            </div>
            <button
              className={`btn block ${p.hasUpdate ? 'primary' : 'ghost'}`}
              style={{ marginTop: 10 }}
              onClick={p.onCheckUpdate}
            >
              <Icon name={p.hasUpdate ? 'download' : 'refresh'} size={14} />
              {p.hasUpdate ? `发现新版本 v${p.latestVersion}` : '检查更新'}
            </button>
            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="mirror">下载加速前缀</label>
              <input
                id="mirror"
                value={mirror}
                onChange={(e) => setMirror(e.target.value)}
                placeholder={DEFAULT_MIRROR}
                autoCapitalize="off"
                spellCheck={false}
              />
              <div className="hint">
                APK 从 {DEFAULT_MIRROR.replace(/^https?:\/\//, '')} 下载，因为 github.com 直连通常不通。查询版本走 API，与下载走不同通道。
              </div>
            </div>
            <button
              className="btn ghost block"
              style={{ marginTop: 8 }}
              disabled={!mirrorChanged}
              onClick={() => p.onSaveMirror(mirror.trim().replace(/\/+$/, '') || DEFAULT_MIRROR)}
            >
              保存加速前缀
            </button>
          </div>

          <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn ghost block" onClick={p.onLock}>
              <Icon name="lock" size={14} />
              锁定保险库
            </button>
            <button className="btn danger block" onClick={p.onClearAudit}>
              <Icon name="trash" size={14} />
              清空审计日志
            </button>
          </div>

          <div
            style={{
              marginTop: 28,
              fontSize: 10.5,
              color: 'var(--text-dim)',
              lineHeight: 1.8,
              paddingBottom: 24,
            }}
          >
            ghx v{p.version} · 无后端、无遥测
            <br />
            令牌只在发起请求时于内存中解密，请求直连你配置的 API 地址。
            <br />
            受 GitHub 限制，令牌必须先在网页端生成后粘贴导入，App 内无法代你创建。
          </div>
        </div>
      </div>
    </>
  )
}
