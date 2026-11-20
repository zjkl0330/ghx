import { formatBytes } from '../lib/update'
import { STATUS_LABEL, KIND_LABEL, historyTime, type DlRecord } from '../lib/dl-history'
import { nativeDownloadAvailable } from '../lib/native-download'
import { Icon } from './icons'

/**
 * 下载记录面板。
 *
 * 记的是「下过什么、成没成、什么时候、从哪个仓库来的」——
 * 所以每一行都能点回仓库，这是它和「文件管理器」最大的区别。
 *
 * 文件是否还在由原生侧查（用户可能清过 App 存储）。不在了就不给安装按钮，
 * 免得点下去弹一句「安装包不存在」。
 */
export function DlHistorySheet(p: {
  records: DlRecord[]
  exists: Record<string, boolean>
  onClose: () => void
  onOpenRepo: (repo: string) => void
  onInstall: (rec: DlRecord) => void
  onClear: () => void
}) {
  const total = p.records.length
  // 网页端没有安装器，给了按钮只会点了报错
  const native = nativeDownloadAvailable()

  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="sheet-head">
          <div>
            <h3 style={{ margin: 0 }}>下载记录</h3>
            <div className="sheet-sub">仅存本机 · {total > 0 ? `最近 ${total} 条` : '还没有记录'}</div>
          </div>
          <div className="spacer" />
          {total > 0 && (
            <button className="icon-btn" onClick={p.onClear} aria-label="清空记录">
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>

        {total === 0 ? (
          <div className="empty" style={{ marginTop: 10 }}>
            <b>还没有下载过东西</b>
            在仓库的发行版、源码 ZIP 或「检查更新」里下载一次，这里就会留一条。
          </div>
        ) : (
          <div className="multi-list" style={{ marginTop: 12 }}>
            {p.records.map((r) => {
              const alive = r.path ? p.exists[r.path] !== false : false
              const canInstall = native && r.kind === 'apk' && r.status === 'done' && alive && !!r.path
              const tone = r.status === 'done' ? 'ok' : r.status === 'failed' ? 'failed' : 'idle'
              const size = r.bytes > 0 ? r.bytes : r.size
              return (
                <div
                  key={r.id}
                  className="audit-row dlh-row"
                  role={r.repo ? 'button' : undefined}
                  tabIndex={r.repo ? 0 : undefined}
                  onClick={() => (r.repo ? p.onOpenRepo(r.repo) : undefined)}
                >
                  <div className={`result-dot ${tone}`} />
                  <div className="audit-main">
                    <div className="audit-t dlh-name mono ellipsis">{r.name}</div>
                    <div className="audit-d">
                      {r.repo || '来源未知'}
                      {r.tag ? ` · ${r.tag}` : ''} · {KIND_LABEL[r.kind]}
                      {size > 0 ? ` · ${formatBytes(size)}` : ''}
                      {r.status !== 'done' ? ` · ${STATUS_LABEL[r.status]}` : ''}
                    </div>
                    <div className="audit-d">
                      {historyTime(r.at)}
                      {r.status === 'failed' && r.error ? ` · ${r.error}` : ''}
                      {r.status === 'done' && r.path && !alive ? ' · 文件已被清理' : ''}
                    </div>
                  </div>
                  {canInstall ? (
                    <button
                      className="dlh-act"
                      onClick={(e) => {
                        e.stopPropagation()
                        p.onInstall(r)
                      }}
                    >
                      安装
                    </button>
                  ) : r.repo ? (
                    <Icon name="chevron" size={13} className="linkrow-arrow" />
                  ) : null}
                </div>
              )
            })}
          </div>
        )}

        <div className="hint" style={{ marginTop: 12 }}>
          记录只存文件名、大小与仓库，不存下载地址与令牌。点任意一条可以跳回它的仓库。
        </div>

        <div className="btns">
          <button className="btn ghost" onClick={p.onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
