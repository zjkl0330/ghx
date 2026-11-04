import { useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import { listBranches, type Branch } from '../lib/refs'
import {
  REPO_SWITCHES,
  getWatch,
  renameImpact,
  repoNameError,
  setWatch,
  transferRepo,
  updateRepoSettings,
  watchLabel,
  type RepoSettingsPatch,
  type WatchState,
} from '../lib/repo-admin'
import type { Repo } from '../lib/types'
import { PageHeader, PageState } from './PageHeader'
import { Icon } from './icons'

/**
 * 仓库设置：简介、主页、默认分支、功能开关、改名、转移、订阅。
 *
 * 改名与转移都要二次确认，并且把连带影响写清楚 —— 这两件事做错了
 * 用户会找不到自己的仓库。
 */
export function RepoAdminPage(p: {
  client: GitHubClient | null
  repo: Repo
  onBack: () => void
  onChanged: (next: Repo) => void
  onToast: (s: string) => void
}) {
  const [name, setName] = useState(p.repo.name)
  const [description, setDescription] = useState(p.repo.description ?? '')
  const [homepage, setHomepage] = useState(p.repo.homepage ?? '')
  const [defaultBranch, setDefaultBranch] = useState(p.repo.default_branch)
  const [flags, setFlags] = useState<RepoSettingsPatch>({})
  const [branches, setBranches] = useState<Branch[]>([])
  const [watch, setWatchState] = useState<WatchState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [transferTo, setTransferTo] = useState('')
  const [transferOpen, setTransferOpen] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      if (!p.client) return
      try {
        const [b, w] = await Promise.all([
          listBranches(p.client, p.repo.owner, p.repo.name),
          getWatch(p.client, p.repo.owner, p.repo.name),
        ])
        if (!alive) return
        setBranches(b)
        setWatchState(w)
      } catch {
        /* 分支列表读不到不影响其它设置 */
      }
    })()
    return () => {
      alive = false
    }
  }, [p.client, p.repo.owner, p.repo.name])

  async function save() {
    if (!p.client || busy) return
    if (renaming) {
      const err = repoNameError(name)
      if (err) {
        setError(err)
        return
      }
    }
    setBusy(true)
    setError(null)
    try {
      const patch: RepoSettingsPatch = {}
      if (description !== (p.repo.description ?? '')) patch.description = description || null
      if (homepage !== (p.repo.homepage ?? '')) patch.homepage = homepage || null
      if (defaultBranch !== p.repo.default_branch) patch.default_branch = defaultBranch
      if (renaming && name !== p.repo.name) patch.name = name
      for (const [k, v] of Object.entries(flags)) {
        if (v !== undefined) (patch as Record<string, unknown>)[k] = v
      }
      if (Object.keys(patch).length === 0) {
        p.onToast('没有改动')
        setBusy(false)
        return
      }
      const next = await updateRepoSettings(p.client, p.repo.owner, p.repo.name, patch)
      p.onChanged(next)
      setRenaming(false)
      p.onToast(patch.name ? `已改名为 ${next.name}` : '设置已保存')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function toggleWatch() {
    if (!p.client || busy) return
    setBusy(true)
    try {
      const next: WatchState | 'none' = watch === 'subscribed' ? 'none' : 'subscribed'
      await setWatch(p.client, p.repo.owner, p.repo.name, next)
      setWatchState(next === 'none' ? null : next)
      p.onToast(next === 'none' ? '已取消订阅' : '已订阅这个仓库的动态')
    } catch (err) {
      p.onToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function doTransfer() {
    if (!p.client || busy || !transferTo.trim()) return
    setBusy(true)
    try {
      await transferRepo(p.client, p.repo.owner, p.repo.name, transferTo.trim())
      setTransferOpen(false)
      p.onToast('转移请求已发出，需要对方接受邀请')
    } catch (err) {
      p.onToast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const impact = renameImpact(p.repo.full_name, name)

  return (
    <>
      <PageHeader
        title="仓库设置"
        sub={p.repo.full_name}
        onBack={p.onBack}
        right={
          <button className="icon-btn" onClick={() => void save()} aria-label="保存" disabled={busy}>
            <Icon name="check" size={18} />
          </button>
        }
      />

      <div className="page" style={{ marginTop: 0 }}>
        <PageState error={error} />

        <div className="field" style={{ margin: '12px 16px 0' }}>
          <label>简介</label>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="一句话说明这个仓库做什么" />
        </div>

        <div className="field" style={{ margin: '12px 16px 0' }}>
          <label>主页</label>
          <input className="input" value={homepage} onChange={(e) => setHomepage(e.target.value)} placeholder="https://" />
        </div>

        <div className="field" style={{ margin: '12px 16px 0' }}>
          <label>默认分支</label>
          <select className="input" value={defaultBranch} onChange={(e) => setDefaultBranch(e.target.value)}>
            {(branches.length > 0 ? branches : [{ name: p.repo.default_branch, commit: { sha: '' } }]).map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="section-title">功能开关</div>
        <div style={{ padding: '0 16px' }}>
          {REPO_SWITCHES.map((s) => {
            const raw = (p.repo as unknown as Record<string, unknown>)[s.key as string]
            const value = (flags[s.key] as boolean | undefined) ?? (typeof raw === 'boolean' ? raw : true)
            return (
              <label className="tglrow" key={String(s.key)}>
                <span>
                  <b>{s.label}</b>
                  <i>{s.hint}</i>
                </span>
                <span
                  className={`tgl${value ? ' on' : ''}`}
                  onClick={() => setFlags((f) => ({ ...f, [s.key]: !value }))}
                />
              </label>
            )
          })}
        </div>

        <div className="section-title">改名</div>
        <div style={{ padding: '0 16px' }}>
          {!renaming ? (
            <button className="linkrow" onClick={() => setRenaming(true)}>
              <span className="linkrow-main">
                <b>重命名仓库</b>
                <i>当前叫 {p.repo.name}，改名会连带改地址</i>
              </span>
              <Icon name="chevron" size={13} className="linkrow-arrow" />
            </button>
          ) : (
            <div className="panel" style={{ margin: 0 }}>
              <div className="field" style={{ marginTop: 0 }}>
                <label>新名字</label>
                <input className="input mono" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              {impact.length > 0 && (
                <ul className="impact">
                  {impact.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
              <div className="btnrow" style={{ marginTop: 10 }}>
                <button
                  className="btn ghost"
                  onClick={() => {
                    setRenaming(false)
                    setName(p.repo.name)
                  }}
                >
                  取消
                </button>
                <button className="btn primary" disabled={busy} onClick={() => void save()}>
                  确认改名
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="section-title">订阅</div>
        <div style={{ padding: '0 16px' }}>
          <button className="linkrow" onClick={() => void toggleWatch()} disabled={busy}>
            <span className="linkrow-main">
              <b>{watchLabel(watch)}</b>
              <i>订阅后，这个仓库的新 Issue、PR、发行版会进通知收件箱</i>
            </span>
            <Icon name={watch === 'subscribed' ? 'check' : 'plus'} size={15} />
          </button>
        </div>

        <div className="section-title">转移</div>
        <div style={{ padding: '0 16px 24px' }}>
          {!transferOpen ? (
            <button className="linkrow danger" onClick={() => setTransferOpen(true)}>
              <span className="linkrow-main">
                <b>转移到其他账号或组织</b>
                <i>需要对方接受邀请，不是立即完成</i>
              </span>
              <Icon name="chevron" size={13} className="linkrow-arrow" />
            </button>
          ) : (
            <div className="panel dangerbox" style={{ margin: 0 }}>
              <b>转移仓库</b>
              <div className="hint">输入目标账号或组织名。转移后你会失去这个仓库的管理权限。</div>
              <input
                className="input mono"
                style={{ marginTop: 8 }}
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
                placeholder="账号名"
              />
              <div className="btnrow" style={{ marginTop: 10 }}>
                <button className="btn ghost" onClick={() => setTransferOpen(false)}>
                  取消
                </button>
                <button className="btn primary" disabled={busy || !transferTo.trim()} onClick={() => void doTransfer()}>
                  转移
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
