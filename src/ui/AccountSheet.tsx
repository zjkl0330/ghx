import type { AccountView } from '../lib/accounts'
import { Icon } from './icons'

interface Props {
  accounts: AccountView[]
  /** 正在切换的账号 id，用来做「切换中…」的占位 */
  switching: string | null
  onSwitch: (id: string) => void
  onManage: () => void
  onAdd: () => void
  onClose: () => void
}

/**
 * 账号切换弹层。
 *
 * 之前只有「我的 → 令牌保险库 → 找到那条 → 切换到此令牌」四步，
 * 多账号时每次切都要翻一遍保险库。这里把账号提到一级，两下点完。
 *
 * 与保险库的区别：这里只做切换，校验、删除、改地址仍归保险库管，
 * 免得两个地方各改一半、状态对不上。
 */
export function AccountSheet(p: Props) {
  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="handle" />
        <div className="sheet-head">
          <div>
            <div className="sheet-title">切换账号</div>
            <div className="sheet-sub">
              {p.accounts.length > 0 ? `${p.accounts.length} 个账号 · 切换后立即生效` : '还没有账号'}
            </div>
          </div>
          <div className="spacer" />
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭">
            <Icon name="close" size={17} />
          </button>
        </div>

        {p.accounts.length === 0 && (
          <div className="empty">
            <b>还没有账号</b>
            导入一个 PAT 就能开始用。一个令牌对应一个 GitHub 账号，可以加多个随时切。
          </div>
        )}

        {p.accounts.length > 0 && (
          <div className="acct-list">
            {p.accounts.map((a) => (
              <button
                key={a.id}
                className={`acct-row${a.active ? ' on' : ''}`}
                disabled={a.active || p.switching !== null}
                onClick={() => p.onSwitch(a.id)}
              >
                <AcctAvatar view={a} />
                <span className="acct-main">
                  <span className="acct-line1">
                    <b>{a.label}</b>
                    {a.kind === 'fine-grained' && <span className="acct-tag">细粒度</span>}
                    {!a.verified && <span className="acct-tag warn">未校验</span>}
                  </span>
                  <span className="acct-line2 mono">
                    {a.login ? a.name : a.preview}
                  </span>
                </span>
                {p.switching === a.id ? (
                  <span className="acct-end">切换中…</span>
                ) : a.active ? (
                  <span className="acct-end on">
                    <Icon name="check" size={13} />
                    使用中
                  </span>
                ) : (
                  <Icon name="chevron" size={13} className="acct-arrow" />
                )}
              </button>
            ))}
          </div>
        )}

        <div className="acct-actions">
          <button className="btn ghost" style={{ flex: 1 }} onClick={p.onAdd}>
            <Icon name="plus" size={14} />
            添加账号
          </button>
          <button className="btn ghost" style={{ flex: 1 }} onClick={p.onManage}>
            <Icon name="key" size={14} />
            管理令牌
          </button>
        </div>

        <div className="hint" style={{ padding: '0 16px 16px' }}>
          每个账号的仓库、通知、上下文各自独立；切换会退出当前页面，不会串到另一个账号。
        </div>
      </div>
    </div>
  )
}

/** 头像加载失败一律退回首字母，国内网络下 img 挂掉很常见 */
function AcctAvatar(p: { view: AccountView }) {
  const initial = (p.view.login ?? p.view.name ?? '?').slice(0, 1).toUpperCase()
  return p.view.avatarUrl ? (
    <img
      className="avatar avatar-sm avatar-img"
      src={p.view.avatarUrl}
      alt={p.view.label}
      onError={(e) => {
        e.currentTarget.style.display = 'none'
      }}
    />
  ) : (
    <span className="avatar avatar-sm">{initial}</span>
  )
}
