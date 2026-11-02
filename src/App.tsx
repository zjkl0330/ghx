import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GitHubClient } from './lib/api'
import { appendAudit, clearAudit, readAudit } from './lib/audit'
import { buildPlan, countBy, filterRepos, runBatch } from './lib/repos'
import { createKV, type KV } from './lib/storage'
import { probeToken } from './lib/tokens'
import {
  APP_VERSION,
  DEFAULT_MIRROR,
  checkForUpdate,
  type UpdateCheckResult,
} from './lib/update'
import type { AuditEntry, BatchResult, Repo, TokenRecord, Visibility, VisibilityPlan } from './lib/types'
import { Vault } from './lib/vault'
import { AddTokenSheet } from './ui/AddTokenSheet'
import { AuditLog } from './ui/AuditLog'
import { RepoDetailSheet } from './ui/RepoDetailSheet'
import { RepoList } from './ui/RepoList'
import { SettingsPage } from './ui/SettingsPage'
import { TokenVault } from './ui/TokenVault'
import { UnlockScreen } from './ui/UnlockScreen'
import { UpdateSheet, type UpdatePhase } from './ui/UpdateSheet'
import { VisibilitySheet } from './ui/VisibilitySheet'
import { Icon } from './ui/icons'
import './styles/theme.css'

type Tab = 'repos' | 'tokens' | 'audit' | 'settings'
type Sheet = 'none' | 'add' | 'visibility' | 'update' | 'detail'

const MIRROR_KEY = 'ghx.mirror'

export default function App() {
  const kvRef = useRef<KV | null>(null)
  const vaultRef = useRef<Vault | null>(null)
  const toastTimer = useRef<number | null>(null)

  const [ready, setReady] = useState(false)
  const [vaultMode, setVaultMode] = useState<'create' | 'unlock'>('unlock')
  const [unlocked, setUnlocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const [records, setRecords] = useState<TokenRecord[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [client, setClient] = useState<GitHubClient | null>(null)
  const [quota, setQuota] = useState<Record<string, { remaining: number; limit: number }>>({})
  const [checking, setChecking] = useState<string | null>(null)

  const [repos, setRepos] = useState<Repo[]>([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [repoError, setRepoError] = useState<string | null>(null)

  const [tab, setTab] = useState<Tab>('repos')
  const [query, setQuery] = useState('')
  const [visibility, setVisibility] = useState<'all' | 'public' | 'private'>('all')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [sheet, setSheet] = useState<Sheet>('none')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const [detailRepo, setDetailRepo] = useState<Repo | null>(null)
  const [mirror, setMirror] = useState(DEFAULT_MIRROR)
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('checking')
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateCheckedAt, setUpdateCheckedAt] = useState<number | null>(null)
  const silentChecked = useRef(false)

  const [plan, setPlan] = useState<VisibilityPlan[]>([])
  const [phase, setPhase] = useState<'confirm' | 'running' | 'done'>('confirm')
  const [results, setResults] = useState<BatchResult[]>([])
  const [done, setDone] = useState(0)
  const [current, setCurrent] = useState<string | null>(null)

  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [baseUrl, setBaseUrl] = useState('https://api.github.com')
  const [toast, setToast] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }, [])

  const refreshAudit = useCallback(async () => {
    if (!kvRef.current) return
    setAudit(await readAudit(kvRef.current))
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const kv = await createKV()
      const v = new Vault(kv)
      if (cancelled) return
      kvRef.current = kv
      vaultRef.current = v
      const exists = await v.exists()
      if (cancelled) return
      const savedMirror = await kv.get(MIRROR_KEY)
      if (savedMirror && !cancelled) setMirror(savedMirror)
      setVaultMode(exists ? 'unlock' : 'create')
      setReady(true)
      await refreshAudit()
    })()
    return () => {
      cancelled = true
    }
  }, [refreshAudit])

  const loadRepos = useCallback(async (c: GitHubClient, tokenId: string | null) => {
    setLoadingRepos(true)
    setRepoError(null)
    try {
      const acc: Repo[] = []
      for (let page = 1; page <= 6; page += 1) {
        const { data, rate } = await c.listRepos(page, 30)
        acc.push(...data)
        if (rate && tokenId) {
          setQuota((q) => ({ ...q, [tokenId]: { remaining: rate.remaining, limit: rate.limit } }))
        }
        if (data.length < 30) break
      }
      setRepos(acc)
    } catch (err) {
      setRepoError((err as Error).message)
    } finally {
      setLoadingRepos(false)
    }
  }, [])

  const activate = useCallback(
    async (id: string, list?: TokenRecord[]) => {
      const v = vaultRef.current
      if (!v) return
      const source = list ?? records
      const rec = source.find((r) => r.id === id)
      if (!rec) return
      const secret = await v.secret(id)
      const c = new GitHubClient({ token: secret, baseUrl: rec.baseUrl || baseUrl })
      setClient(c)
      setActiveId(id)
      setSelected(new Set())
      setSelectMode(false)
      await loadRepos(c, id)

      // 后台确认归属与 scopes，失败不打断主流程，也不把令牌误标为失效
      void probeToken(c, rec.expiresAt)
        .then(async (probe) => {
          const updated = await v.update(id, {
            scopes: probe.scopes,
            login: probe.login,
            lastCheckedAt: probe.checkedAt,
            lastStatus: probe.status,
          })
          setRecords((prev) => prev.map((r) => (r.id === id ? updated : r)))
          if (probe.rate) {
            setQuota((q) => ({ ...q, [id]: { remaining: probe.rate!.remaining, limit: probe.rate!.limit } }))
          }
        })
        .catch(() => {
          /* 归属探测失败不影响使用，交给手动「校验」处理 */
        })

      await refreshAudit()
    },
    [records, baseUrl, loadRepos, refreshAudit],
  )

  async function handleUnlock(passphrase: string) {
    const v = vaultRef.current
    if (!v) return
    setBusy(true)
    setAuthError(null)
    try {
      if (vaultMode === 'create') await v.create(passphrase)
      else await v.unlock(passphrase)
      const list = await v.list()
      setRecords(list)
      setUnlocked(true)
      if (kvRef.current) {
        await appendAudit(kvRef.current, {
          action: 'unlock',
          target: '本地保险库',
          result: 'ok',
          detail: vaultMode === 'create' ? '首次创建' : '解锁',
        })
        await refreshAudit()
      }
      if (list[0]) await activate(list[0].id, list)
    } catch (err) {
      setAuthError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function addToken(input: { name: string; secret: string; expiresAt: string | null }) {
    const v = vaultRef.current
    if (!v) return
    setAddBusy(true)
    setAddError(null)
    try {
      const rec = await v.add({ name: input.name, secret: input.secret, expiresAt: input.expiresAt, baseUrl })
      const list = await v.list()
      setRecords(list)
      setSheet('none')
      if (kvRef.current) {
        await appendAudit(kvRef.current, {
          action: 'token-add',
          target: rec.name,
          result: 'ok',
          detail: rec.preview,
        })
        await refreshAudit()
      }
      await activate(rec.id, list)
      showToast('令牌已加密保存')
    } catch (err) {
      setAddError((err as Error).message)
    } finally {
      setAddBusy(false)
    }
  }

  async function removeToken(id: string) {
    const v = vaultRef.current
    if (!v) return
    const rec = records.find((r) => r.id === id)
    await v.remove(id)
    const list = await v.list()
    setRecords(list)
    if (kvRef.current) {
      await appendAudit(kvRef.current, {
        action: 'token-remove',
        target: rec?.name ?? id,
        result: 'ok',
        detail: '已从保险库删除',
      })
      await refreshAudit()
    }
    if (activeId === id) {
      setActiveId(null)
      setClient(null)
      setRepos([])
      if (list[0]) await activate(list[0].id, list)
    }
  }

  async function checkToken(id: string) {
    const v = vaultRef.current
    const rec = records.find((r) => r.id === id)
    if (!v || !rec) return
    setChecking(id)
    try {
      const secret = await v.secret(id)
      const c = new GitHubClient({ token: secret, baseUrl: rec.baseUrl || baseUrl })
      const probe = await probeToken(c, rec.expiresAt)
      const updated = await v.update(id, {
        scopes: probe.scopes,
        login: probe.login,
        lastCheckedAt: probe.checkedAt,
        lastStatus: probe.status,
      })
      setRecords((prev) => prev.map((r) => (r.id === id ? updated : r)))
      if (probe.rate) {
        setQuota((q) => ({ ...q, [id]: { remaining: probe.rate!.remaining, limit: probe.rate!.limit } }))
      }
      if (kvRef.current) {
        await appendAudit(kvRef.current, {
          action: 'token-check',
          target: updated.name,
          result: 'ok',
          detail: `@${probe.login} · 配额 ${probe.rate?.remaining ?? '—'}`,
        })
        await refreshAudit()
      }
      showToast(`校验通过 · @${probe.login}`)
    } catch (err) {
      const updated = await v.update(id, { lastStatus: 'invalid' })
      setRecords((prev) => prev.map((r) => (r.id === id ? updated : r)))
      if (kvRef.current) {
        await appendAudit(kvRef.current, {
          action: 'token-check',
          target: rec.name,
          result: 'failed',
          detail: (err as Error).message,
        })
        await refreshAudit()
      }
      showToast((err as Error).message)
    } finally {
      setChecking(null)
    }
  }

  function toggleSelect(repo: Repo) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(repo.full_name)) next.delete(repo.full_name)
      else next.add(repo.full_name)
      return next
    })
  }

  function startBatch(target: Visibility) {
    const chosen = repos.filter((r) => selected.has(r.full_name))
    if (chosen.length === 0) return
    setPlan(buildPlan(chosen, target))
    setResults([])
    setDone(0)
    setCurrent(null)
    setPhase('confirm')
    setSheet('visibility')
  }

  async function confirmBatch() {
    if (!client) return
    setPhase('running')
    const res = await runBatch(client, plan, {
      gapMs: 400,
      onProgress: (d, _total, last) => {
        setDone(d)
        setCurrent(last.repo)
      },
    })
    setResults(res)
    setPhase('done')

    const kv = kvRef.current
    if (kv) {
      for (const r of res) {
        await appendAudit(kv, {
          action: 'visibility',
          target: r.repo,
          result: r.status === 'ok' ? 'ok' : 'failed',
          detail: r.message ?? `切换为 ${plan[0]?.to ?? ''}`,
        })
      }
      await refreshAudit()
    }

    setRepos((prev) =>
      prev.map((r) => {
        const hit = plan.find((p) => p.repo.full_name === r.full_name)
        const ok = res.find((x) => x.repo === r.full_name && x.status === 'ok')
        if (!hit || !ok) return r
        return { ...r, private: hit.to === 'private', visibility: hit.to }
      }),
    )
    setSelected(new Set())
  }

  async function saveBaseUrl(url: string) {
    setBaseUrl(url)
    if (!activeId) {
      showToast('已保存，导入令牌后生效')
      return
    }
    const v = vaultRef.current
    if (!v) return
    const updated = await v.update(activeId, { baseUrl: url })
    setRecords((prev) => prev.map((r) => (r.id === activeId ? updated : r)))
    const secret = await v.secret(activeId)
    const c = new GitHubClient({ token: secret, baseUrl: url })
    setClient(c)
    await loadRepos(c, activeId)
    showToast('已切换 API 地址')
  }

  const runCheck = useCallback(
    async (open: boolean) => {
      if (open) setSheet('update')
      setUpdatePhase('checking')
      setUpdateError(null)
      const { result, error } = await checkForUpdate({ mirror, current: APP_VERSION })
      if (result) {
        setUpdateResult(result)
        setUpdateCheckedAt(result.checkedAt)
        setUpdatePhase(result.hasUpdate ? 'found' : 'latest')
      } else {
        setUpdateError(error)
        setUpdatePhase('error')
        // 静默检查失败不弹层，避免每次启动都被网络问题打断
        if (!open) setSheet((cur) => (cur === 'update' ? 'none' : cur))
      }
    },
    [mirror],
  )

  // 解锁后静默查一次：有新版本只在列表顶部提示，不打断使用
  useEffect(() => {
    if (!unlocked || silentChecked.current) return
    silentChecked.current = true
    void runCheck(false)
  }, [unlocked, runCheck])

  const saveMirror = useCallback(
    (url: string) => {
      setMirror(url)
      if (kvRef.current) void kvRef.current.set(MIRROR_KEY, url)
      showToast('加速前缀已保存')
    },
    [showToast],
  )

  /** 单个仓库操作成功后同步列表与详情，避免关掉详情再刷新一次。 */
  const patchRepo = useCallback((next: Repo) => {
    setRepos((prev) => prev.map((r) => (r.full_name === next.full_name ? { ...r, ...next } : r)))
    setDetailRepo((cur) => (cur && cur.full_name === next.full_name ? { ...cur, ...next } : cur))
  }, [])

  const logAudit = useCallback(
    async (action: AuditEntry['action'], target: string, detail: string) => {
      if (!kvRef.current) return
      await appendAudit(kvRef.current, { action, target, result: 'ok', detail })
      await refreshAudit()
    },
    [refreshAudit],
  )

  function lockVault() {
    vaultRef.current?.lock()
    setUnlocked(false)
    setRecords([])
    setActiveId(null)
    setClient(null)
    setRepos([])
    setSelected(new Set())
    setVaultMode('unlock')
    setTab('repos')
  }

  const counts = useMemo(() => {
    const c = countBy(repos)
    return { total: c.total, public: c.public, private: c.private }
  }, [repos])

  const filtered = useMemo(
    () => filterRepos(repos, { query, visibility, includeArchived: false }),
    [repos, query, visibility],
  )

  const activeRecord = records.find((r) => r.id === activeId) ?? null

  if (!ready) {
    return (
      <div className="app">
        <div className="empty">正在初始化…</div>
      </div>
    )
  }

  if (!unlocked) {
    return (
      <UnlockScreen mode={vaultMode} busy={busy} error={authError} onSubmit={handleUnlock} />
    )
  }

  return (
    <div className="app">
      {tab === 'repos' && (
        <RepoList
          repos={filtered}
          loading={loadingRepos}
          error={repoError}
          query={query}
          onQuery={setQuery}
          visibility={visibility}
          onVisibility={setVisibility}
          counts={counts}
          selectMode={selectMode}
          selected={selected}
          onToggleSelect={toggleSelect}
          onEnterSelect={() => setSelectMode(true)}
          onExitSelect={() => {
            setSelectMode(false)
            setSelected(new Set())
          }}
          onRefresh={() => client && void loadRepos(client, activeId)}
          hasToken={records.length > 0}
          account={activeRecord?.login ?? null}
          onOpenRepo={(r) => {
            setDetailRepo(r)
            setSheet('detail')
          }}
          updateVersion={updateResult?.hasUpdate ? (updateResult.info?.version ?? null) : null}
          onOpenUpdate={() => void runCheck(true)}
        />
      )}

      {tab === 'tokens' && (
        <TokenVault
          records={records}
          activeId={activeId}
          checking={checking}
          onActivate={(id) => void activate(id)}
          onAdd={() => {
            setAddError(null)
            setSheet('add')
          }}
          onRemove={(id) => void removeToken(id)}
          onCheck={(id) => void checkToken(id)}
          quota={quota}
        />
      )}

      {tab === 'audit' && (
        <AuditLog
          entries={audit}
          onClear={() => {
            if (!kvRef.current) return
            void clearAudit(kvRef.current).then(() => {
              setAudit([])
              showToast('审计日志已清空')
            })
          }}
        />
      )}

      {tab === 'settings' && (
        <SettingsPage
          baseUrl={baseUrl}
          login={activeRecord?.login ?? null}
          tokenCount={records.length}
          repoCount={repos.length}
          auditCount={audit.length}
          version={APP_VERSION}
          mirror={mirror}
          updateCheckedAt={updateCheckedAt}
          latestVersion={updateResult?.latest ?? null}
          hasUpdate={!!updateResult?.hasUpdate}
          onSaveMirror={saveMirror}
          onCheckUpdate={() => void runCheck(true)}
          onSaveBaseUrl={(url) => void saveBaseUrl(url)}
          onLock={lockVault}
          onClearAudit={() => {
            if (!kvRef.current) return
            void clearAudit(kvRef.current).then(() => {
              setAudit([])
              showToast('审计日志已清空')
            })
          }}
        />
      )}

      {selectMode && selected.size > 0 && (
        <div className="actionbar">
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>已选 {selected.size}</span>
          <div className="spacer" />
          <button className="btn ghost" style={{ height: 32, fontSize: 11.5 }} onClick={() => startBatch('private')}>
            转私有
          </button>
          <button className="btn ghost" style={{ height: 32, fontSize: 11.5 }} onClick={() => startBatch('public')}>
            转公开
          </button>
        </div>
      )}

      <nav className="tabbar">
        <button className={tab === 'repos' ? 'on' : ''} onClick={() => setTab('repos')}>
          <Icon name="repo" size={19} />
          仓库
        </button>
        <button className={tab === 'tokens' ? 'on' : ''} onClick={() => setTab('tokens')}>
          <Icon name="key" size={19} />
          令牌
        </button>
        <button className={tab === 'audit' ? 'on' : ''} onClick={() => setTab('audit')}>
          <Icon name="clock" size={19} />
          审计
        </button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>
          <Icon name="gear" size={19} />
          设置
        </button>
      </nav>

      {sheet === 'add' && (
        <AddTokenSheet
          busy={addBusy}
          error={addError}
          onCancel={() => setSheet('none')}
          onSubmit={(input) => void addToken(input)}
        />
      )}

      {sheet === 'visibility' && (
        <VisibilitySheet
          plan={plan}
          phase={phase}
          results={results}
          done={done}
          total={plan.length}
          current={current}
          onCancel={() => setSheet('none')}
          onConfirm={() => void confirmBatch()}
          onClose={() => {
            setSheet('none')
            setSelectMode(false)
          }}
        />
      )}

      {sheet === 'detail' && detailRepo && (
        <RepoDetailSheet
          repo={detailRepo}
          client={client}
          mirror={mirror}
          onClose={() => setSheet('none')}
          onChanged={patchRepo}
          onDeleted={(fullName) => {
            setRepos((prev) => prev.filter((r) => r.full_name !== fullName))
            setDetailRepo(null)
            setSheet('none')
            void logAudit('repo-delete', fullName, '仓库已永久删除')
          }}
          onAudit={(action, detail) => void logAudit(action, detail.target, detail.text)}
          onToast={showToast}
        />
      )}

      {sheet === 'update' && (
        <UpdateSheet
          phase={updatePhase}
          result={updateResult}
          error={updateError}
          current={APP_VERSION}
          mirror={mirror}
          onRecheck={() => void runCheck(true)}
          onClose={() => setSheet('none')}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
