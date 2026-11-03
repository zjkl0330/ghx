import { Icon } from './icons'

interface Props {
  busy: boolean
  onResume: () => void
}

/**
 * 手动锁定后的挡屏。免密模式下密钥仍在本机，所以这里只是遮住界面，
 * 点一下即可回来 —— 主要用在「把手机递给别人」这类场景。
 */
export function LockedScreen({ busy, onResume }: Props) {
  return (
    <div className="app">
      <div className="center-screen">
        <div className="logo-mark">
          <Icon name="lock" size={22} />
        </div>
        <h1 className="title">已锁定</h1>
        <p className="muted">
          保险库已从内存清除。当前是免密模式，点下面即可继续；想真正挡住别人，去设置里开启「启动验证」。
        </p>
        <button
          className="btn blue block"
          style={{ marginTop: 18 }}
          disabled={busy}
          onClick={onResume}
        >
          {busy ? '处理中…' : '继续使用'}
        </button>
      </div>
    </div>
  )
}
