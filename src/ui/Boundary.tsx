import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icon } from './icons'

/**
 * 页面级错误边界。
 *
 * 起因是一次真实的白屏：某个列表接口返回的形状不是数组（镜像站或代理把
 * 错误响应当 200 回了一张 `{}`），`[...list]` 抛 TypeError，
 * React 直接把整棵树卸掉 —— 底栏也没了，用户只能杀进程重开。
 *
 * 边界包在页面区、底栏之外：崩掉的是内容，导航要还在，这样才能退出去。
 * resetKey 变化（切页面、切页签）时自动清掉错误状态，不用用户手动点。
 */
interface Props {
  children: ReactNode
  /** 变化时清空错误。传路由键或页签名 */
  resetKey: string
  /** 出错时的返回动作；没有就只给「重试」 */
  onBack?: () => void
}

interface State {
  error: Error | null
}

export class Boundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 没有上报通道，也不该有 —— 打到控制台，方便接 adb 的时候顺手看
    console.error('[ghx] 页面渲染失败:', error, info.componentStack)
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  private retry = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="page">
        <div className="boundary">
          <div className="logo-mark">
            <Icon name="warn" size={22} />
          </div>
          <h1 className="title">这个页面出错了</h1>
          <p className="muted">
            其他页面还能用，可以先返回。如果反复出现，把这个页面怎么进来的告诉我。
          </p>
          <pre className="boundary-msg">{error.message || String(error)}</pre>
          <div className="btnrow" style={{ justifyContent: 'center', marginTop: 14 }}>
            <button className="btn ghost" onClick={this.retry}>
              <Icon name="refresh" size={14} />
              重试
            </button>
            {this.props.onBack && (
              <button className="btn primary" onClick={this.props.onBack}>
                <Icon name="back" size={14} />
                返回
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }
}
