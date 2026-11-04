import { useState } from 'react'
import { Icon } from './icons'

interface Props {
  login: string | null
  /** 未校验归属时用令牌名兜底，别让顶栏显示「未连接账号」 */
  accountName: string | null
  avatarUrl: string | null
  repoCount: number
  tokenCount: number
  auditCount: number
  /** 已导入的账号数，用来在账号卡片上提示「可切换」 */
  accountCount: number
  onOpenAccounts: () => void
  version: string
  latestVersion: string | null
  hasUpdate: boolean
  onBack: () => void
  onOpenTokens: () => void
  onOpenSettings: () => void
  onOpenAudit: () => void
  onOpenNotifications: () => void
  unreadCount: number
  onOpenSearch: () => void
  onOpenMe: () => void
  onCheckUpdate: () => void
  onLock: () => void
}

/**
 * 个人页。原来底栏那个「设置」的位置换成点头像进来，
 * 账号信息、令牌、设置、审计都收在这一层，底栏就能腾出位置给内容。
 */
export function ProfilePage(p: Props) {
  const [avatarFailed, setAvatarFailed] = useState(false)
  const initial = (p.login ?? '?').slice(0, 1).toUpperCase()
  const showAvatar = p.avatarUrl && !avatarFailed

  return (
    <>
      <div className="topbar">
        <button className="icon-btn" onClick={p.onBack} aria-label="返回">
          <Icon name="back" size={18} />
        </button>
        <div className="page-title">我的</div>
      </div>

      <div className="page">
        <button className="profile-head profile-head-btn" onClick={p.onOpenAccounts}>
          {showAvatar ? (
            <img
              className="avatar avatar-lg avatar-img"
              src={p.avatarUrl as string}
              alt={p.login ?? '头像'}
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <div className="avatar avatar-lg">{initial}</div>
          )}
          <div style={{ minWidth: 0, textAlign: 'left' }}>
            <div className="profile-login">
              {p.login ? `@${p.login}` : (p.accountName ?? '未连接账号')}
            </div>
            <div className="profile-sub">
              {p.login
                ? `${p.repoCount} 个仓库 · ${p.accountCount} 个账号 · 本地加密保管`
                : '导入 PAT 后即可管理仓库'}
            </div>
          </div>
          <div className="spacer" />
          <span className="acct-swap">
            {p.accountCount > 1 ? '切换' : '账号'}
            <Icon name="chevron" size={12} />
          </span>
        </button>

        <div className="profile-stats">
          <div>
            <b>{p.repoCount}</b>
            <i>仓库</i>
          </div>
          <div>
            <b>{p.tokenCount}</b>
            <i>令牌</i>
          </div>
          <div>
            <b>{p.auditCount}</b>
            <i>审计</i>
          </div>
        </div>

        <div className="profile-body">
        <div className="section-title">浏览</div>
        <div className="panel">
          <button className="linkrow" onClick={p.onOpenNotifications}>
            <span className="act-ic">
              <Icon name="bell" size={15} />
            </span>
            <span className="linkrow-main">
              <b>通知</b>
              <i>{p.unreadCount > 0 ? `${p.unreadCount} 条未读` : '收件箱'}</i>
            </span>
            {p.unreadCount > 0 && <span className="badge">{p.unreadCount}</span>}
            <Icon name="chevron" size={13} className="linkrow-arrow" />
          </button>
          <button className="linkrow" onClick={p.onOpenSearch}>
            <span className="act-ic">
              <Icon name="search" size={15} />
            </span>
            <span className="linkrow-main">
              <b>全局搜索</b>
              <i>仓库、代码、Issue、PR、用户、提交</i>
            </span>
            <Icon name="chevron" size={13} className="linkrow-arrow" />
          </button>
          <button className="linkrow" onClick={p.onOpenMe}>
            <span className="act-ic">
              <Icon name="name" size={15} />
            </span>
            <span className="linkrow-main">
              <b>我的主页</b>
              <i>资料、公开仓库、关注关系</i>
            </span>
            <Icon name="chevron" size={13} className="linkrow-arrow" />
          </button>
        </div>

        <div className="section-title">账号与数据</div>
        <div className="panel">
          <button className="linkrow" onClick={p.onOpenTokens}>
            <span className="act-ic">
              <Icon name="key" size={15} />
            </span>
            <span className="linkrow-main">
              <b>令牌保险库</b>
              <i>{p.tokenCount > 0 ? `${p.tokenCount} 个凭据 · 可切换与校验` : '还没有令牌，点这里导入'}</i>
            </span>
            <Icon name="chevron" size={13} className="linkrow-arrow" />
          </button>
          <button className="linkrow" onClick={p.onOpenSettings}>
            <span className="act-ic">
              <Icon name="gear" size={15} />
            </span>
            <span className="linkrow-main">
              <b>设置</b>
              <i>外观、翻译、加速站、安全</i>
            </span>
            <Icon name="chevron" size={13} className="linkrow-arrow" />
          </button>
          <button className="linkrow" onClick={p.onOpenAudit}>
            <span className="act-ic">
              <Icon name="clock" size={15} />
            </span>
            <span className="linkrow-main">
              <b>审计日志</b>
              <i>仅存本机 · {p.auditCount} 条记录</i>
            </span>
            <Icon name="chevron" size={13} className="linkrow-arrow" />
          </button>
        </div>

        <div className="section-title">版本</div>
        <div className="panel">
          <div className="kv-row">
            <span>当前版本</span>
            <b className="mono">v{p.version}</b>
          </div>
          <button
            className={`btn block ${p.hasUpdate ? 'primary' : 'ghost'}`}
            style={{ marginTop: 8 }}
            onClick={p.onCheckUpdate}
          >
            <Icon name={p.hasUpdate ? 'download' : 'refresh'} size={14} />
            {p.hasUpdate ? `发现新版本 v${p.latestVersion}` : '检查更新'}
          </button>
        </div>

        <button className="btn ghost block" style={{ marginTop: 20 }} onClick={p.onLock}>
          <Icon name="lock" size={14} />
          锁定保险库
        </button>

          <div className="profile-foot">
            ghx v{p.version} · 无后端、无遥测
            <br />
            令牌只在发起请求时于内存中解密，请求直连你配置的 API 地址。
          </div>
        </div>
      </div>
    </>
  )
}
