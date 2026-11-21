import { githubUrlAt } from '../lib/mirrors'
import { copyText } from '../lib/clipboard'
import { PageHeader } from './PageHeader'
import { Icon } from './icons'

/**
 * GitHub 有、App 还没有的页面。
 *
 * 用户提的是硬性要求：「GitHub 跳转不能跳转到浏览器网址」。以前 releases、
 * wiki、discussions 这类链接只能交给系统浏览器，一点就把 App 顶掉了。
 * 现在落到这一页：路径摆出来、能复制、能退回仓库，去不去浏览器由用户自己决定。
 */
export function WebOnlyPage(p: {
  /** github.com 后面的部分，已去掉开头的斜杠 */
  path: string
  mirror: string
  onBack: () => void
  onOpenRepo: (owner: string, repo: string) => void
  onToast: (s: string) => void
}) {
  const [owner, repo] = p.path.split('/')
  const canOpenRepo = !!owner && !!repo
  const url = githubUrlAt(p.mirror, `/${p.path}`)

  return (
    <>
      <PageHeader title="App 内暂缺此页" sub={`github.com/${p.path}`} onBack={p.onBack} />

      <div className="page" style={{ marginTop: 0 }}>
        <div className="panel webonly">
          <div className="webonly-head">
            <Icon name="external" size={18} />
            <div>
              <b>这个页面还没有做进 App</b>
              <span>
                GitHub 的地址是 <code className="mono">/{p.path}</code>。为了不把你踢去浏览器，
                先停在这里 —— 需要的话可以复制地址自己打开。
              </span>
            </div>
          </div>

          <div className="webonly-path mono ellipsis" title={url}>
            {url}
          </div>

          <div className="btnrow">
            <button
              className="btn ghost"
              onClick={() => void copyText(url).then((ok) => p.onToast(ok ? '链接已复制' : '复制失败，可长按上面的地址'))}
            >
              <Icon name="copy" size={14} />
              复制链接
            </button>
            {canOpenRepo && (
              <button className="btn primary" onClick={() => p.onOpenRepo(owner, repo)}>
                <Icon name="repo" size={14} />
                去仓库看看
              </button>
            )}
          </div>

          {canOpenRepo && (
            <div className="hint" style={{ marginTop: 10 }}>
              发行版、分支标签、Issues 都在仓库主页里，进去点一下就有。
            </div>
          )}
        </div>
      </div>
    </>
  )
}
