import { useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import type { AuditEntry, Repo, Visibility } from '../lib/types'
import { openExternal } from '../lib/update'
import { Icon, type IconName } from './icons'

interface Props {
  repo: Repo
  client: GitHubClient | null
  mirror: string
  onClose: () => void
  onChanged: (repo: Repo) => void
  onDeleted: (fullName: string) => void
  onAudit: (action: AuditEntry['action'], detail: { target: string; text: string }) => void
  onToast: (msg: string) => void
  onOpenWorkflows: () => void
  onOpenReleases: () => void
  onOpenForks: () => void
}

function relTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const d = Math.floor((Date.now() - t) / 86400000)
  if (d < 1) return '今天'
  if (d < 30) return `${d} 天前`
  if (d < 365) return `${Math.floor(d / 30)} 个月前`
  return `${Math.floor(d / 365)} 年前`
}

const LANG_COLOR: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Kotlin: '#A97BFF',
  Java: '#b07219',
  Python: '#3572A5',
  'C++': '#f34b7d',
  Rust: '#dea584',
  Go: '#00ADD8',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Shell: '#89e051',
  Dart: '#00B4AB',
  Swift: '#F05138',
}

export function RepoDetailSheet(p: Props) {
  const [starred, setStarred] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [typed, setTyped] = useState('')

  const owner = p.repo.owner
  const name = p.repo.name

  useEffect(() => {
    let alive = true
    setStarred(null)
    setError(null)
    setConfirmDelete(false)
    setTyped('')
    if (!p.client) return () => { alive = false }
    p.client
      .isStarred(owner, name)
      .then((v) => {
        if (alive) setStarred(v)
      })
      .catch(() => {
        if (alive) setStarred(null)
      })
    return () => {
      alive = false
    }
  }, [p.client, owner, name])

  async function run(key: string, fn: () => Promise<void>) {
    if (busy) return
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  function action(
    key: string,
    icon: IconName,
    label: string,
    hint: string,
    fn: () => Promise<void>,
    tone?: 'danger',
  ) {
    return (
      <button className={`actrow${tone === 'danger' ? ' danger' : ''}`} disabled={!!busy} onClick={() => void run(key, fn)}>
        <span className="act-ic">
          <Icon name={icon} size={15} />
        </span>
        <span className="act-txt">
          <b>{label}</b>
          <i>{hint}</i>
        </span>
        {busy === key && <span className="spin" style={{ width: 13, height: 13 }} />}
        {busy !== key && <Icon name="chevron" size={13} className="act-arrow" />}
      </button>
    )
  }

  const canDelete = typed.trim() === name

  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ wordBreak: 'break-all' }}>{name}</h3>
            <div className="sheet-sub">
              {owner} · {p.repo.private ? '私有' : '公开'}
              {p.repo.archived ? ' · 已归档' : ''} · 默认分支 {p.repo.default_branch}
            </div>
          </div>
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭" style={{ marginTop: -4 }}>
            <Icon name="close" size={16} />
          </button>
        </div>

        {p.repo.description && (
          <div className="det-desc">{p.repo.description}</div>
        )}

        <div className="det-stats">
          <div>
            <b>{p.repo.stargazers_count}</b>
            <i>Star</i>
          </div>
          <div>
            <b>{p.repo.forks_count}</b>
            <i>Fork</i>
          </div>
          <div>
            <b style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center' }}>
              {p.repo.language && (
                <span
                  className="dot"
                  style={{ background: LANG_COLOR[p.repo.language] ?? '#8b949e' }}
                />
              )}
              {p.repo.language ?? '—'}
            </b>
            <i>语言</i>
          </div>
          <div>
            <b>{relTime(p.repo.pushed_at)}</b>
            <i>最后推送</i>
          </div>
        </div>

        {error && (
          <div className="errline" style={{ marginTop: 2, marginBottom: 6 }}>
            {error}
          </div>
        )}

        <div className="acts">
          {action(
            'star',
            'star',
            starred ? '取消 Star' : 'Star 该仓库',
            starred === null ? '状态未知，操作前会先查询' : starred ? '当前已 star' : '当前未 star',
            async () => {
              if (!p.client) throw new Error('未连接令牌')
              const next = !starred
              await p.client.setStarred(owner, name, next)
              setStarred(next)
              p.onAudit('repo-star', { target: p.repo.full_name, text: next ? '已 star' : '已取消 star' })
              p.onToast(next ? '已 star' : '已取消 star')
            },
          )}

          {action(
            'archive',
            'archive',
            p.repo.archived ? '取消归档' : '归档仓库',
            p.repo.archived ? '归档后仓库只读' : '归档后变为只读，可随时撤销',
            async () => {
              if (!p.client) throw new Error('未连接令牌')
              const next = !p.repo.archived
              const { data } = await p.client.setArchived(owner, name, next)
              p.onChanged(data ? { ...p.repo, archived: next } : { ...p.repo, archived: next })
              p.onAudit('repo-archive', { target: p.repo.full_name, text: next ? '已归档' : '已取消归档' })
              p.onToast(next ? '已归档' : '已取消归档')
            },
          )}

          {action(
            'visibility',
            'globe',
            p.repo.private ? '转为公开' : '转为私有',
            p.repo.private ? '公开后任何人可搜索到' : '公开转私有会永久失去 star 与 watcher',
            async () => {
              if (!p.client) throw new Error('未连接令牌')
              const next: Visibility = p.repo.private ? 'public' : 'private'
              await p.client.setVisibility(owner, name, next)
              p.onChanged({ ...p.repo, private: next === 'private', visibility: next })
              p.onAudit('visibility', { target: p.repo.full_name, text: `切换为 ${next}` })
              p.onToast(next === 'private' ? '已转为私有' : '已转为公开')
            },
          )}

          {action('workflows', 'play', '工作流', '查看 Actions、启停与手动运行', async () => p.onOpenWorkflows())}

          {action('releases', 'package', '发行版', '查看标签、附件与下载', async () => p.onOpenReleases())}

          {action('forks', 'fork', '复刻', `${p.repo.forks_count} 份复刻 · 可复刻到自己账号`, async () => p.onOpenForks())}

          {action('clone', 'copy', '复制克隆地址', `https://github.com/${p.repo.full_name}.git`, async () => {
            const url = `https://github.com/${p.repo.full_name}.git`
            await navigator.clipboard.writeText(url)
            p.onToast('克隆地址已复制')
          })}

          {action(
            'open',
            'arrowRight',
            '在浏览器打开',
            `经 ${p.mirror.replace(/^https?:\/\//, '')} 访问`,
            async () => {
              await openExternal(`${p.mirror.replace(/\/+$/, '')}/${p.repo.full_name}`)
            },
          )}

          {!confirmDelete &&
            action(
              'delete',
              'trash',
              '删除仓库',
              '永久删除，无法恢复，需输入仓库名确认',
              async () => {
                setConfirmDelete(true)
              },
              'danger',
            )}
        </div>

        {confirmDelete && (
          <div className="dangerbox">
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--red)', display: 'flex', marginTop: 1 }}>
                <Icon name="warn" size={14} />
              </span>
              <div>
                <b style={{ fontSize: 12, color: '#f0a9a6' }}>永久删除 {p.repo.full_name}</b>
                <div style={{ fontSize: 11, color: '#c98d8a', marginTop: 4, lineHeight: 1.55 }}>
                  issue、PR、release、star 全部消失，无法撤销。输入仓库名 <code className="mono">{name}</code> 以确认。
                </div>
              </div>
            </div>
            <input
              className="danger-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={name}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
              <button
                className="btn ghost"
                style={{ flex: 1 }}
                onClick={() => {
                  setConfirmDelete(false)
                  setTyped('')
                }}
              >
                取消
              </button>
              <button
                className="btn danger"
                style={{ flex: 1 }}
                disabled={!canDelete || !!busy}
                onClick={() =>
                  void run('delete-do', async () => {
                    if (!p.client) throw new Error('未连接令牌')
                    await p.client.deleteRepo(owner, name)
                    p.onDeleted(p.repo.full_name)
                    p.onToast('仓库已删除')
                  })
                }
              >
                {busy === 'delete-do' ? '删除中…' : '确认删除'}
              </button>
            </div>
            <div className="hint" style={{ marginTop: 7 }}>
              删除需要令牌具备 delete_repo 权限，否则会返回 403。
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
