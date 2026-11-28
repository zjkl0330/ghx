import { useState } from 'react'
import {
  MAX_FOLDER_NAME,
  MAX_FOLDERS,
  assignFolder,
  createFolder,
  deleteFolder,
  folderById,
  renameFolder,
  type FolderCounts,
  type StarFolderStore,
} from '../lib/star-folders'
import { Icon } from './icons'

/**
 * 星标文件夹面板。
 *
 * 一个弹层里装三个视图：归类 / 管理 / 编辑，靠内部状态切换 ——
 * 不叠第二层弹层，返回键一次就能收掉（叠层会让「退一层」变成退两次）。
 */

type View =
  | { kind: 'assign' }
  | { kind: 'manage' }
  /** 新建（id 为 null）或重命名；from 记住是从哪进来的，保存后回哪 */
  | { kind: 'edit'; id: string | null; from: 'assign' | 'manage' }

interface Props {
  store: StarFolderStore
  initial: 'assign' | 'manage'
  /** assign 模式下的仓库全名 */
  fullName?: string
  counts: FolderCounts
  onChange: (next: StarFolderStore) => void
  onClose: () => void
  onToast: (msg: string) => void
}

export function StarFolderSheet(p: Props) {
  const [view, setView] = useState<View>({ kind: p.initial })
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const store = p.store
  const current = p.fullName ? store.assign[p.fullName.toLowerCase()] ?? null : null

  function pick(folderId: string | null) {
    if (!p.fullName) return
    p.onChange(assignFolder(store, p.fullName, folderId))
    const f = folderId ? folderById(store, folderId) : null
    p.onToast(f ? `已放进「${f.name}」` : '已移到未分类')
    p.onClose()
  }

  function startEdit(id: string | null, from: 'assign' | 'manage') {
    const f = id ? folderById(store, id) : null
    setName(f?.name ?? '')
    setErr(null)
    setConfirmDelete(false)
    setView({ kind: 'edit', id, from })
  }

  function save() {
    if (view.kind !== 'edit') return
    const op = view.id ? renameFolder(store, view.id, name) : createFolder(store, name)
    if (!op.ok) {
      setErr(
        op.reason === 'empty'
          ? '名字不能为空'
          : op.reason === 'dupe'
            ? '已经有同名文件夹了'
            : op.reason === 'full'
              ? `最多 ${MAX_FOLDERS} 个文件夹`
              : '这个文件夹已经不在了',
      )
      return
    }
    p.onChange(op.store)
    if (view.id) {
      p.onToast('已重命名')
      setView({ kind: 'manage' })
      return
    }
    // 从「归类」里新建的，建完直接归进去，省得再点一次
    if (view.from === 'assign' && p.fullName && op.id) {
      p.onChange(assignFolder(op.store, p.fullName, op.id))
      p.onToast('已新建并归类')
      p.onClose()
      return
    }
    p.onToast('文件夹已创建')
    setView({ kind: 'manage' })
  }

  function remove(id: string) {
    const f = folderById(store, id)
    const op = deleteFolder(store, id)
    if (!op.ok) return
    p.onChange(op.store)
    p.onToast(f ? `已删除「${f.name}」，仓库回到未分类` : '文件夹已删除')
    setView({ kind: 'manage' })
  }

  const title =
    view.kind === 'assign'
      ? '归类到文件夹'
      : view.kind === 'manage'
        ? '文件夹'
        : view.id
          ? '重命名文件夹'
          : '新建文件夹'

  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 className="ellipsis">{title}</h3>
            <div className="sheet-sub ellipsis">
              {view.kind === 'assign'
                ? p.fullName ?? '这个仓库'
                : `${store.folders.length} 个文件夹 · 只在本机保存`}
            </div>
          </div>
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭" style={{ marginTop: -4 }}>
            <Icon name="close" size={16} />
          </button>
        </div>

        {view.kind === 'assign' && (
          <>
            <div className="multi-list" style={{ marginTop: 12 }}>
              <button className="multi-row" onClick={() => pick(null)}>
                <span className={`multi-box${current === null ? ' on' : ''}`} aria-hidden>
                  {current === null && <Icon name="check" size={11} />}
                </span>
                <span className="multi-main">
                  <b>未分类</b>
                  <i>不放进任何文件夹</i>
                </span>
              </button>
              {store.folders.map((f) => (
                <button key={f.id} className="multi-row" onClick={() => pick(f.id)}>
                  <span className={`multi-box${current === f.id ? ' on' : ''}`} aria-hidden>
                    {current === f.id && <Icon name="check" size={11} />}
                  </span>
                  <span className="multi-main">
                    <b className="ellipsis">{f.name}</b>
                    <i>{p.counts.byId[f.id] ?? 0} 个仓库</i>
                  </span>
                </button>
              ))}
            </div>
            <div className="acts-foot">
              <button className="linkbtn" onClick={() => startEdit(null, 'assign')}>
                ＋ 新建文件夹
              </button>
              <button className="linkbtn" onClick={() => setView({ kind: 'manage' })}>
                管理
              </button>
            </div>
          </>
        )}

        {view.kind === 'manage' && (
          <>
            {store.folders.length === 0 ? (
              <div className="empty">
                <b>还没有文件夹</b>
                把星标仓库按用途分组，比如「常用」「待读」「自己写的」。
              </div>
            ) : (
              <div className="multi-list" style={{ marginTop: 12 }}>
                {store.folders.map((f) => (
                  <button key={f.id} className="multi-row" onClick={() => startEdit(f.id, 'manage')}>
                    <span className="act-ic" style={{ marginRight: 2 }}>
                      <Icon name="folder" size={15} />
                    </span>
                    <span className="multi-main">
                      <b className="ellipsis">{f.name}</b>
                      <i>{p.counts.byId[f.id] ?? 0} 个仓库</i>
                    </span>
                    <Icon name="chevron" size={13} />
                  </button>
                ))}
              </div>
            )}
            <div className="btns">
              <button className="btn ghost" onClick={p.onClose}>
                关闭
              </button>
              <button className="btn primary" onClick={() => startEdit(null, 'manage')}>
                <Icon name="folder" size={14} />
                新建文件夹
              </button>
            </div>
          </>
        )}

        {view.kind === 'edit' && (
          <>
            <div className="field">
              <label htmlFor="folder-name">文件夹名</label>
              <input
                id="folder-name"
                value={name}
                autoFocus
                maxLength={MAX_FOLDER_NAME}
                onChange={(e) => {
                  setName(e.target.value)
                  setErr(null)
                }}
                placeholder="例如 常用、待读、自己写的"
                autoCapitalize="off"
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') save()
                }}
              />
              <div className="hint">最多 {MAX_FOLDER_NAME} 个字，只能在本机使用。</div>
            </div>
            {err && <div className="errline">{err}</div>}
            {view.id && (
              <div style={{ marginTop: 12 }}>
                {confirmDelete ? (
                  <div className="dangerbox">
                    <div style={{ fontSize: 11, color: '#c98d8a', lineHeight: 1.55 }}>
                      删除后，里面的仓库会回到「未分类」，star 本身不受影响。
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
                      <button className="btn ghost" style={{ flex: 1 }} onClick={() => setConfirmDelete(false)}>
                        取消
                      </button>
                      <button className="btn danger" style={{ flex: 1 }} onClick={() => remove(view.id as string)}>
                        确认删除
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="linkbtn" style={{ color: 'var(--red)' }} onClick={() => setConfirmDelete(true)}>
                    删除这个文件夹
                  </button>
                )}
              </div>
            )}
            <div className="btns">
              <button
                className="btn ghost"
                onClick={() => setView({ kind: view.from === 'assign' ? 'assign' : 'manage' })}
              >
                取消
              </button>
              <button className="btn primary" disabled={!name.trim()} onClick={save}>
                {view.id ? '保存' : '创建'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
