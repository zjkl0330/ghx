import { useState } from 'react'
import { DEFAULT_BASE_URL } from '../lib/api'
import type { ResolvedTheme, ThemePref } from '../lib/theme'
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
  themePref: ThemePref
  resolvedTheme: ResolvedTheme
  onTheme: (pref: ThemePref) => void
  secureMode: 'device' | 'passphrase'
  guarded: boolean
  onSetGuard: () => void
  onChangeGuard: () => void
  onClearGuard: () => void
  onMigrate: () => void
  onSaveBaseUrl: (url: string) => void
  onSaveMirror: (url: string) => void
  onCheckUpdate: () => void
  onLock: () => void
  onOpenAudit: () => void
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

          <div className="section-title">外观</div>
          <div className="panel">
            <div className="seg" style={{ margin: 0 }}>
              <button
                className={p.themePref === 'system' ? 'on' : ''}
                onClick={() => p.onTheme('system')}
              >
                跟随系统
              </button>
              <button
                className={p.themePref === 'light' ? 'on' : ''}
                onClick={() => p.onTheme('light')}
              >
                浅色
              </button>
              <button className={p.themePref === 'dark' ? 'on' : ''} onClick={() => p.onTheme('dark')}>
                深色
              </button>
            </div>
            <div className="hint" style={{ marginTop: 9 }}>
              当前显示{p.resolvedTheme === 'dark' ? '深色' : '浅色'}
              {p.themePref === 'system' ? '（跟随系统）' : ''}。切换立即生效，不用重启。
            </div>
          </div>

          <div className="section-title">安全</div>
          <div className="panel">
            <div className="kv-row">
              <span>解锁方式</span>
              <b>{p.secureMode === 'device' ? '免密，打开即用' : '口令（旧版保险库）'}</b>
            </div>
            <div className="kv-row">
              <span>启动验证</span>
              <b style={{ color: p.guarded ? 'var(--green)' : 'var(--text-dim)' }}>
                {p.secureMode === 'passphrase' ? '口令本身即验证' : p.guarded ? '已开启' : '关闭'}
              </b>
            </div>

            {p.secureMode === 'passphrase' ? (
              <>
                <div className="hint" style={{ marginTop: 6 }}>
                  旧版保险库的密钥由口令派生，所以每次启动都要输入。迁移后密钥改由本机保管，令牌会重新加密一遍，原文不变。
                </div>
                <button className="btn block" style={{ marginTop: 10 }} onClick={p.onMigrate}>
                  <Icon name="key" size={14} />
                  迁移为免密解锁
                </button>
              </>
            ) : p.guarded ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn ghost" style={{ flex: 1 }} onClick={p.onChangeGuard}>
                  修改口令
                </button>
                <button className="btn ghost" style={{ flex: 1 }} onClick={p.onClearGuard}>
                  关闭验证
                </button>
              </div>
            ) : (
              <button className="btn block" style={{ marginTop: 10 }} onClick={p.onSetGuard}>
                <Icon name="lock" size={14} />
                开启启动验证
              </button>
            )}

            <div className="hint" style={{ marginTop: 10 }}>
              令牌一律 AES-256-GCM 加密落盘。免密模式下设备密钥也放在本机，能防住「数据文件被单独拷走或上传」，防不住拿到已解锁手机的人；需要后者就开启启动验证。
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

          <div className="section-title">本机数据</div>
          <div className="panel">
            <button className="linkrow" onClick={p.onOpenAudit}>
              <span className="linkrow-main">
                <b>审计日志</b>
                <i>仅存本机 · {p.auditCount} 条记录</i>
              </span>
              <Icon name="chevron" size={13} className="linkrow-arrow" />
            </button>
            <button className="btn danger block" style={{ marginTop: 10 }} onClick={p.onClearAudit}>
              <Icon name="trash" size={14} />
              清空审计日志
            </button>
          </div>

          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn ghost block" onClick={p.onLock}>
              <Icon name="lock" size={14} />
              锁定保险库
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
