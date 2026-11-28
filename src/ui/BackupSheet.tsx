import { useState } from 'react'
import {
  BACKUP_PASS_MIN,
  backupFileName,
  looksLikeBackupName,
  parseBackup,
  type BackupSummary,
  type RestoreMode,
} from '../lib/backup'
import { pickTextFile, saveTargetLabel, saveTextFile } from '../lib/savefile'
import { Icon } from './icons'

interface Props {
  version: string
  login: string | null
  accountName: string | null
  accountCount: number
  native: boolean
  onClose: () => void
  onToast: (msg: string) => void
  /** 组装备份文本（读设置、解密钥、按密码封起来都在 App 里做） */
  onExport: (o: { withSecrets: boolean; passphrase: string }) => Promise<{ fileName: string; text: string }>
  /** 写回本机并返回一句结果；成功后 App 自己负责重载 */
  onRestore: (o: { text: string; passphrase: string; mode: RestoreMode }) => Promise<string>
}

type Tab = 'export' | 'restore'

function prettyTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '时间未知'
  const d = new Date(t)
  const p = (n: number) => (n < 10 ? `0${n}` : String(n))
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function sizeText(text: string): string {
  const bytes = new TextEncoder().encode(text).length
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/**
 * 备份与恢复。
 *
 * 两块内容放在同一个面板里：上面导出、下面恢复。用户的心智是「备份这件事」，
 * 拆成两个入口反而要多找一次。
 *
 * 导出：
 * - 文件名固定带账号与时间，存进云盘后也认得出是哪台手机哪一天；
 * - 不勾密钥就是一份纯配置 + 账号清单（不含敏感串）；
 * - 勾了密钥必须给导出密码，整块 AES-256-GCM 加密，文件里看不到明文。
 *
 * 恢复：
 * - 选文件 → 先解析并展示「谁的、什么时候的、几个账号、带不带密钥」；
 * - 带密钥才要密码，密码错在提交时才报，不在选文件阶段打扰；
 * - 合并 / 覆盖两种口径写清楚，默认合并不动本机已有偏好。
 */
export function BackupSheet(p: Props) {
  const [tab, setTab] = useState<Tab>('export')

  const [withSecrets, setWithSecrets] = useState(true)
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState<'export' | 'restore' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ name: string; size: string } | null>(null)

  /** 恢复：已选中的文件 */
  const [picked, setPicked] = useState<{
    name: string
    text: string
    summary: BackupSummary
    needsPass: boolean
  } | null>(null)
  const [restorePass, setRestorePass] = useState('')
  const [mode, setMode] = useState<RestoreMode>('merge')
  const [restored, setRestored] = useState<string | null>(null)

  const passTooShort = withSecrets && pass.length > 0 && pass.length < BACKUP_PASS_MIN
  const filePreview = backupFileName({ login: p.login, name: p.accountName })

  async function doExport() {
    if (busy) return
    if (withSecrets && pass.length < BACKUP_PASS_MIN) {
      setError(`连同密钥导出需要先设一个至少 ${BACKUP_PASS_MIN} 位的导出密码`)
      return
    }
    setError(null)
    setBusy('export')
    try {
      const { fileName, text } = await p.onExport({ withSecrets, passphrase: withSecrets ? pass : '' })
      const r = await saveTextFile({ fileName, text })
      if (!r.ok) {
        if (r.cancelled) {
          p.onToast('已取消保存')
        } else {
          setError(r.error || '保存失败')
        }
        return
      }
      setSaved({ name: fileName, size: sizeText(text) })
      p.onToast(r.via === 'native' ? '备份已写入所选位置' : '备份已开始下载')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function chooseFile() {
    if (busy) return
    setError(null)
    try {
      const file = await pickTextFile('application/json')
      if (!file) return
      if (!looksLikeBackupName(file.name)) {
        setError(`「${file.name}」不像备份文件，请选 .json`)
        return
      }
      const parsed = parseBackup(file.text)
      if (!parsed.ok) {
        setError(parsed.error)
        setPicked(null)
        return
      }
      setPicked({
        name: file.name,
        text: file.text,
        summary: parsed.summary,
        needsPass: parsed.summary.secrets > 0,
      })
      setRestorePass('')
      setRestored(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function doRestore() {
    if (busy || !picked) return
    if (picked.needsPass && !restorePass) {
      setError('这份备份带着密钥，需要输入导出时设的密码')
      return
    }
    setError(null)
    setBusy('restore')
    try {
      const msg = await p.onRestore({
        text: picked.text,
        passphrase: picked.needsPass ? restorePass : '',
        mode,
      })
      // 不清 picked：摘要与「已写回」要留在屏幕上，紧接着页面就会重载
      setRestored(msg)
      p.onToast(msg)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="mask" onClick={p.onClose} />
      <div className="sheet bk-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="bk-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3>备份与恢复</h3>
            <div className="sheet-sub">设置、账号、置顶仓库；密钥可选择性带走</div>
          </div>
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="seg" style={{ margin: '12px 0 0' }}>
          <button className={tab === 'export' ? 'on' : ''} onClick={() => setTab('export')}>
            导出
          </button>
          <button className={tab === 'restore' ? 'on' : ''} onClick={() => setTab('restore')}>
            恢复
          </button>
        </div>

        {tab === 'export' && (
          <>
            <div className="bk-file">
              <Icon name="file" size={14} />
              <div style={{ minWidth: 0 }}>
                <b className="ellipsis">{filePreview}</b>
                <i>
                  {p.accountCount} 个账号 · 偏好设置 · 扩展名 .json
                </i>
              </div>
            </div>

            <button
              className="bk-check"
              onClick={() => {
                setWithSecrets((v) => !v)
                setError(null)
              }}
            >
              <span className={`multi-box${withSecrets ? ' on' : ''}`} aria-hidden>
                {withSecrets && <Icon name="check" size={11} />}
              </span>
              <span style={{ textAlign: 'left' }}>
                <b>连同令牌密钥一起导出</b>
                <i>换机不用重新粘贴令牌；密钥用下面的密码加密，文件里看不到明文</i>
              </span>
            </button>

            {withSecrets && (
              <div className="field">
                <label htmlFor="bkpass">导出密码（至少 {BACKUP_PASS_MIN} 位）</label>
                <input
                  id="bkpass"
                  type="password"
                  value={pass}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={(e) => {
                    setPass(e.target.value)
                    setError(null)
                  }}
                  placeholder="恢复时要输同一个密码"
                />
                {passTooShort && <div className="err">密码至少 {BACKUP_PASS_MIN} 位</div>}
              </div>
            )}

            {error && <div className="err">{error}</div>}
            {saved && (
              <div className="bk-done">
                <Icon name="check" size={13} />
                <span>
                  已保存 <b>{saved.name}</b> · {saved.size}
                </span>
              </div>
            )}

            <button
              className="btn primary block"
              style={{ marginTop: 12 }}
              disabled={busy !== null}
              onClick={() => void doExport()}
            >
              <Icon name={busy === 'export' ? 'refresh' : 'download'} size={14} />
              {busy === 'export' ? '正在生成…' : saveTargetLabel()}
            </button>

            <div className="hint" style={{ marginTop: 8 }}>
              {p.native
                ? '会打开系统的「保存到」面板：选 Google 云端硬盘就存到云盘，选下载目录就存到本机。不需要给本应用任何存储权限。'
                : '浏览器会把它存到下载目录；手机上也可以直接在系统面板里选云端硬盘。'}
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              备份不含设备密钥、审计日志、翻译缓存与热门快照 —— 那些是本机数据，带出去没有意义，
              还会把仓库名写进云盘。
            </div>
          </>
        )}

        {tab === 'restore' && (
          <>
            {!picked && (
              <>
                <button className="btn ghost block" style={{ marginTop: 14 }} onClick={() => void chooseFile()}>
                  <Icon name="file" size={14} />
                  选择备份文件
                </button>
                <div className="hint" style={{ marginTop: 8 }}>
                  从下载目录或云端硬盘里选一个 ghx 备份（.json）。选完先显示内容摘要，确认后才写入。
                </div>
              </>
            )}

            {picked && (
              <>
                <div className="bk-file">
                  <Icon name="file" size={14} />
                  <div style={{ minWidth: 0 }}>
                    <b className="ellipsis" title={picked.name}>
                      {picked.name}
                    </b>
                    <i>
                      {prettyTime(picked.summary.exportedAt)} 导出 · v{picked.summary.appVersion}
                    </i>
                  </div>
                  <button className="icon-btn" onClick={() => void chooseFile()} aria-label="重新选择">
                    <Icon name="refresh" size={14} />
                  </button>
                </div>

                <div className="bk-grid">
                  <div>
                    <b>{picked.summary.accounts}</b>
                    <i>个账号</i>
                  </div>
                  <div>
                    <b>{picked.summary.settings}</b>
                    <i>项设置</i>
                  </div>
                  <div>
                    <b>{picked.summary.secrets > 0 ? '有' : '无'}</b>
                    <i>密钥</i>
                  </div>
                </div>

                {picked.summary.labels.length > 0 && (
                  <div className="bk-labels">
                    {picked.summary.labels.slice(0, 8).map((l) => (
                      <span className="chip" key={l}>
                        {l}
                      </span>
                    ))}
                    {picked.summary.labels.length > 8 && (
                      <span className="chip">+{picked.summary.labels.length - 8}</span>
                    )}
                  </div>
                )}

                {picked.needsPass && (
                  <div className="field" style={{ marginTop: 12 }}>
                    <label htmlFor="bkres">导出密码</label>
                    <input
                      id="bkres"
                      type="password"
                      value={restorePass}
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      onChange={(e) => {
                        setRestorePass(e.target.value)
                        setError(null)
                      }}
                      placeholder="导出这份备份时设的密码"
                    />
                  </div>
                )}

                <div className="tgl-label" style={{ marginTop: 14 }}>
                  写回方式
                </div>
                <div className="seg" style={{ margin: 0 }}>
                  <button className={mode === 'merge' ? 'on' : ''} onClick={() => setMode('merge')}>
                    合并
                  </button>
                  <button className={mode === 'replace' ? 'on' : ''} onClick={() => setMode('replace')}>
                    覆盖
                  </button>
                </div>
                <div className="hint" style={{ marginTop: 6 }}>
                  {mode === 'merge'
                    ? '只补本机没有的账号与偏好，已经调过的设置不动 —— 换机首次恢复选这个。'
                    : '同名偏好以备份为准；本机多出来的账号与设置不会被删除。'}
                </div>

                {error && <div className="err">{error}</div>}
                {restored && (
                  <div className="bk-done">
                    <Icon name="check" size={13} />
                    <span>{restored}</span>
                  </div>
                )}

                <button
                  className="btn primary block"
                  style={{ marginTop: 12 }}
                  disabled={busy !== null}
                  onClick={() => void doRestore()}
                >
                  {busy === 'restore' ? '正在写回…' : `开始恢复（${picked.summary.accounts} 个账号）`}
                </button>
              </>
            )}

            {!picked && error && <div className="err">{error}</div>}
          </>
        )}

        <div className="bk-foot">
          <Icon name="lock" size={11} />
          <span>备份文件由你保管；带密钥的那份请当密码本对待，别丢也别随手转发。</span>
        </div>
      </div>
    </>
  )
}
