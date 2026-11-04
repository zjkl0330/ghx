import { useCallback, useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import {
  branchNameError,
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  elideBranch,
  listBranches,
  listTags,
  shortSha,
  sortBranches,
  suggestBranch,
  tagNameError,
  type Branch,
  type Tag,
} from '../lib/refs'
import { shortDate } from '../lib/format'
import { PageHeader, PageState } from './PageHeader'
import { Icon } from './icons'

type Tab = 'branches' | 'tags'

/** 分支与标签：列表、新建、删除 */
export function RefsPage(p: {
  client: GitHubClient | null
  owner: string
  repo: string
  defaultBranch: string
  onBack: () => void
  onToast: (s: string) => void
  onOpenRef: (ref: string) => void
}) {
  const [tab, setTab] = useState<Tab>('branches')
  const [branches, setBranches] = useState<Branch[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [base, setBase] = useState(p.defaultBranch)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (!p.client) {
        setLoading(false)
        return
      }
      if (!silent) setLoading(true)
      setError(null)
      try {
        const [b, t] = await Promise.all([
          listBranches(p.client, p.owner, p.repo, silent),
          listTags(p.client, p.owner, p.repo, silent),
        ])
        setBranches(sortBranches(b, p.defaultBranch))
        setTags(t)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [p.client, p.owner, p.repo, p.defaultBranch],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function submit() {
    if (!p.client || busy) return
    const err = tab === 'branches' ? branchNameError(name) : tagNameError(name)
    if (err) {
      p.onToast(err)
      return
    }
    setBusy(true)
    try {
      if (tab === 'branches') {
        const from = branches.find((b) => b.name === base)
        await createBranch(p.client, p.owner, p.repo, { name, sha: from?.commit.sha ?? base })
        p.onToast(`已创建分支 ${name}`)
      } else {
        const from = branches.find((b) => b.name === base)
        await createTag(p.client, p.owner, p.repo, { name, sha: from?.commit.sha ?? base, lightweight: true })
        p.onToast(`已创建标签 ${name}`)
      }
      setAdding(false)
      setName('')
      await load(true)
    } catch (e) {
      p.onToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(target: string) {
    if (!p.client || busy) return
    setBusy(true)
    try {
      if (tab === 'branches') await deleteBranch(p.client, p.owner, p.repo, target)
      else await deleteTag(p.client, p.owner, p.repo, target)
      p.onToast(`已删除 ${target}`)
      setConfirmDelete(null)
      await load(true)
    } catch (e) {
      p.onToast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="分支与标签"
        sub={`${p.owner}/${p.repo} · ${branches.length} 个分支 · ${tags.length} 个标签`}
        onBack={p.onBack}
        right={
          <button className="icon-btn" onClick={() => void load(true)} aria-label="刷新">
            <Icon name="refresh" size={17} />
          </button>
        }
        action={{
          label: '新建',
          icon: 'plus',
          onClick: () => {
            setName(tab === 'branches' ? suggestBranch() : 'v1.0.0')
            setAdding((v) => !v)
          },
        }}
      />

      <div className="page" style={{ marginTop: 0 }}>
        <div className="seg" style={{ margin: '8px 16px 0' }}>
          <button className={tab === 'branches' ? 'on' : ''} onClick={() => { setTab('branches'); setAdding(false) }}>
            分支
          </button>
          <button className={tab === 'tags' ? 'on' : ''} onClick={() => { setTab('tags'); setAdding(false) }}>
            标签
          </button>
        </div>

        {adding && (
          <div className="panel" style={{ margin: '12px 16px' }}>
            <div className="field" style={{ marginTop: 0 }}>
              <label>{tab === 'branches' ? '新分支名' : '新标签名'}</label>
              <input
                className="input mono"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={tab === 'branches' ? 'feature/login' : 'v1.0.0'}
              />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label>从哪个分支开始</label>
              <select className="input" value={base} onChange={(e) => setBase(e.target.value)}>
                {branches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="btnrow" style={{ marginTop: 12 }}>
              <button className="btn ghost" onClick={() => setAdding(false)}>
                取消
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void submit()}>
                {tab === 'branches' ? '创建分支' : '创建标签'}
              </button>
            </div>
          </div>
        )}

        <PageState loading={loading} error={error} onRetry={() => void load()} />

        {!loading && !error && tab === 'branches' && (
          <div className="rows">
            {branches.length === 0 && <div className="empty">读不到分支，检查令牌是否有 repo 权限</div>}
            {branches.map((b) => {
              const isDefault = b.name === p.defaultBranch
              return (
                <div className="row ref-row" key={b.name}>
                  <span className="file-ic">
                    <Icon name="branch" size={16} />
                  </span>
                  <div className="row-main" onClick={() => p.onOpenRef(b.name)} role="button" tabIndex={0}>
                    <span className="row-l1">
                      <span className="row-name mono ellipsis">{elideBranch(b.name)}</span>
                      {isDefault && <span className="pill">默认</span>}
                      {b.protected && <span className="pill">受保护</span>}
                    </span>
                    <span className="row-meta mono">{shortSha(b.commit.sha)}</span>
                  </div>
                  {!isDefault && (
                    <button
                      className="icon-btn"
                      onClick={() => setConfirmDelete(b.name)}
                      aria-label={`删除 ${b.name}`}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!loading && !error && tab === 'tags' && (
          <div className="rows">
            {tags.length === 0 && <div className="empty">还没有标签。发版时打一个，方便回头找。</div>}
            {tags.map((t) => (
              <div className="row ref-row" key={t.name}>
                <span className="file-ic">
                  <Icon name="tag" size={16} />
                </span>
                <div className="row-main" onClick={() => p.onOpenRef(t.name)} role="button" tabIndex={0}>
                  <span className="row-l1">
                    <span className="row-name mono ellipsis">{t.name}</span>
                  </span>
                  <span className="row-meta mono">{shortSha(t.commit.sha)}</span>
                </div>
                <button className="icon-btn" onClick={() => setConfirmDelete(t.name)} aria-label={`删除 ${t.name}`}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
          </div>
        )}

        {confirmDelete && (
          <div className="panel dangerbox" style={{ margin: '12px 16px 24px' }}>
            <b>删除 {tab === 'branches' ? '分支' : '标签'}「{confirmDelete}」</b>
            <div className="hint">
              {tab === 'branches'
                ? '分支上的提交不会消失，但指向它的引用会没。受保护分支会被 GitHub 拒绝。'
                : '标签删除后，指向它的发行版会失去关联。'}
            </div>
            <div className="btnrow" style={{ marginTop: 10 }}>
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>
                取消
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void remove(confirmDelete)}>
                确认删除
              </button>
            </div>
          </div>
        )}

        <div className="hint" style={{ padding: '0 16px 24px' }}>
          默认分支删不掉（GitHub 会返回 422）；受保护分支需要先取消保护。
        </div>
      </div>
    </>
  )
}

/** 提交时间只在有数据时展示，这里留个占位供以后复用 */
export function refTime(iso?: string | null): string {
  return iso ? shortDate(iso) : '—'
}
