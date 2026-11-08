import { useState } from 'react'
import { DEFAULT_BASE_URL } from '../lib/api'
import { formatSpeed, mirrorLabel } from '../lib/mirrors'
import type { ResolvedTheme, ThemePref } from '../lib/theme'
import { TAB_DEFS, type TabKey } from '../lib/tabs'
import {
  TARGET_LANGS,
  TRANSLATE_CHANNELS,
  type TargetLang,
  type TranslateChannel,
  type TranslateScope,
} from '../lib/translate'
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
  /** 是否跑在原生壳里。全屏开关只在原生端有意义 */
  native: boolean
  /** 沉浸式全屏：藏掉状态栏 */
  fullscreen: boolean
  onFullscreen: (on: boolean) => void
  /** 哪些内容需要机翻 */
  scope: TranslateScope
  onScope: (next: TranslateScope) => void
  /** 译文语言 */
  target: TargetLang
  onTarget: (t: TargetLang) => void
  translateChannel: TranslateChannel
  onTranslateChannel: (ch: TranslateChannel) => void
  /** 微软翻译密钥，空串表示没配 */
  azureKey: string
  onAzureKey: (key: string) => void
  /** 底栏显示哪几个页签 */
  tabs: TabKey[]
  onToggleTab: (key: TabKey) => void
  secureMode: 'device' | 'passphrase'
  guarded: boolean
  onSetGuard: () => void
  onChangeGuard: () => void
  onClearGuard: () => void
  onMigrate: () => void
  onSaveBaseUrl: (url: string) => void
  mirrorAuto: boolean
  mirrorSpeed: number | null
  mirrorCheckedAt: number | null
  /** 用户自己加的站点数 */
  mirrorCustom: number
  /** 改过地址的内置站点数 */
  mirrorChanged: number
  onOpenMirrors: () => void
  onOpenTokens: () => void
  onBack: () => void
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

/** 开关行：整行可点，右侧一个滑动开关 */
function SwitchRow(p: {
  label: string
  hint: string
  on: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <label className="tglrow">
      <span className="tgl-main">
        <b>{p.label}</b>
        <i>{p.hint}</i>
      </span>
      <input
        type="checkbox"
        className="tgl"
        checked={p.on}
        onChange={(e) => p.onChange(e.target.checked)}
      />
    </label>
  )
}

export function SettingsPage(p: Props) {
  const [url, setUrl] = useState(p.baseUrl)
  const [key, setKey] = useState(p.azureKey)
  const [showKey, setShowKey] = useState(false)
  const changed = url.trim() !== p.baseUrl
  const keyChanged = key.trim() !== p.azureKey.trim()
  const azureRelevant = p.translateChannel === 'auto' || p.translateChannel === 'azure'

  return (
    <>
      <div className="topbar">
        <button className="icon-btn" onClick={p.onBack} aria-label="返回">
          <Icon name="back" size={18} />
        </button>
        <div style={{ minWidth: 0 }}>
          <div className="page-title">设置</div>
          <div className="page-sub ellipsis">{p.login ? `已连接 @${p.login}` : '未连接账号'}</div>
        </div>
      </div>

      <div className="page">
        <div style={{ padding: '4px 16px 0' }}>
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

            {p.native && (
              <SwitchRow
                label="沉浸式全屏"
                hint="连状态栏一起藏掉，内容顶到屏幕最上沿；从屏幕边缘上滑可临时唤出系统栏"
                on={p.fullscreen}
                onChange={p.onFullscreen}
              />
            )}

            <div className="section-title" style={{ marginTop: 18 }}>
              底栏显示
            </div>
            <div className="chips" style={{ padding: '0 0 2px' }}>
              {TAB_DEFS.map((t) => (
                <button
                  key={t.key}
                  className={`chip${p.tabs.includes(t.key) ? ' on' : ''}`}
                  onClick={() => p.onToggleTab(t.key)}
                >
                  {p.tabs.includes(t.key) ? '✓ ' : ''}
                  {t.label}
                </button>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              只影响底栏入口，功能都在。至少保留一个；流水线也随时能从仓库详情里进。
            </div>
          </div>

          <div className="section-title">翻译</div>
          <div className="panel">
            <div className="tgl-label">译成</div>
            <div className="chips" style={{ padding: '2px 0 0' }}>
              {TARGET_LANGS.map((t) => (
                <button
                  key={t.key}
                  className={`chip${p.target === t.key ? ' on' : ''}`}
                  onClick={() => p.onTarget(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="tgl-label" style={{ marginTop: 14 }}>
              翻译哪些内容
            </div>
            <SwitchRow
              label="项目自述"
              hint="打开 README 时自动翻，边翻边显示"
              on={p.scope.readme}
              onChange={(v) => p.onScope({ ...p.scope, readme: v })}
            />
            <SwitchRow
              label="仓库简介"
              hint="列表与详情里的描述翻成中文，缓存后不再请求"
              on={p.scope.desc}
              onChange={(v) => p.onScope({ ...p.scope, desc: v })}
            />

            <div className="tgl-label" style={{ marginTop: 14 }}>
              翻译通道
            </div>
            <div className="seg" style={{ margin: 0, flexWrap: 'wrap' }}>
              {TRANSLATE_CHANNELS.map((c) => (
                <button
                  key={c.key}
                  className={p.translateChannel === c.key ? 'on' : ''}
                  onClick={() => p.onTranslateChannel(c.key)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 9 }}>
              {TRANSLATE_CHANNELS.find((c) => c.key === p.translateChannel)?.hint ?? ''}
            </div>
            {p.translateChannel === 'edge' && (
              <div className="hint" style={{ marginTop: 4 }}>
                Edge 是微软浏览器自带的翻译接口，免密钥也不用注册，实测国内可直连。它不是公开 API，微软随时可能关掉；
                真关了就切回「自动」（会自动降级到别的通道），或填一个微软密钥。
              </div>
            )}

            {azureRelevant && (
              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="azure">微软翻译密钥</label>
                <div className="keyrow">
                  <input
                    id="azure"
                    type={showKey ? 'text' : 'password'}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="Azure 翻译资源的密钥，可留空"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <button
                    className="icon-btn"
                    onClick={() => setShowKey((v) => !v)}
                    aria-label={showKey ? '隐藏密钥' : '显示密钥'}
                  >
                    <Icon name={showKey ? 'eyeOff' : 'eye'} size={16} />
                  </button>
                </div>
                <div className="hint">
                  在 Azure 门户创建「翻译」资源后可拿到密钥，免费 F0 档每月 200 万字符。填了之后
                  它是 Edge 之后的第二选择：Edge 被关掉或不通时自动接上，也可在上面手动选「微软」只用它。
                </div>
                <button
                  className="btn ghost block"
                  style={{ marginTop: 8 }}
                  disabled={!keyChanged}
                  onClick={() => p.onAzureKey(key.trim())}
                >
                  保存密钥
                </button>
              </div>
            )}
          </div>

          <div className="section-title">账号与网络</div>
          <div className="panel">
            <button className="linkrow" onClick={p.onOpenTokens}>
              <span className="linkrow-main">
                <b>令牌保险库</b>
                <i>{p.tokenCount > 0 ? `${p.tokenCount} 个凭据 · 点此切换或校验` : '还没有令牌'}</i>
              </span>
              <Icon name="chevron" size={13} className="linkrow-arrow" />
            </button>

            <div className="field" style={{ marginTop: 12 }}>
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
              <label>下载加速</label>
              <button className="linkrow" onClick={p.onOpenMirrors}>
                <span className="linkrow-main">
                  <b>{mirrorLabel(p.mirror)}</b>
                  <i>
                    {p.mirrorAuto ? '自动选最快' : '手动指定'}
                    {p.mirrorSpeed != null ? ` · ${formatSpeed(p.mirrorSpeed)}` : ''}
                    {p.mirrorCheckedAt ? ` · ${ago(p.mirrorCheckedAt).replace('检查', '测速')}` : ''}
                    {p.mirrorCustom > 0 ? ` · ${p.mirrorCustom} 个自定义站点` : ''}
                    {p.mirrorChanged > 0 ? ` · ${p.mirrorChanged} 个已改地址` : ''}
                  </i>
                </span>
                <Icon name="chevron" size={13} className="linkrow-arrow" />
              </button>
              <div className="hint">
                APK 与自述图片都从加速站下载，因为 github.com 直连通常不通。站点域名换了不用重装 App：进页面点每个站点右边的铅笔直接改地址，改完立即全局生效（图片、安装包、发行版页一起跟着走）。也能添加自己的站点并测速。
              </div>
            </div>
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

          <div style={{ marginTop: 20 }}>
            <button className="btn ghost block" onClick={p.onLock}>
              <Icon name="lock" size={14} />
              锁定保险库
            </button>
          </div>

          <div className="profile-foot" style={{ marginTop: 26 }}>
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
