import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { GitHubClient } from './lib/api'
import { appendAudit, clearAudit, readAudit } from './lib/audit'
import { exitDecision, resolveBack, type BackState, type SheetName } from './lib/backnav'
import { buildPlan, countBy, filterRepos, runBatch } from './lib/repos'
import { createKV, type KV } from './lib/storage'
import {
  applyTheme,
  readThemePref,
  resolveTheme,
  syncStatusBar,
  watchSystemTheme,
  writeThemePref,
  type ResolvedTheme,
  type ThemePref,
} from './lib/theme'
import { probeToken } from './lib/tokens'
import {
  APP_VERSION,
  DEFAULT_MIRROR,
  checkForUpdate,
  type UpdateCheckResult,
} from './lib/update'
import type {
  AuditEntry,
  BatchResult,
  Repo,
  TokenRecord,
  Visibility,
  VisibilityPlan,
  Workflow,
  WorkflowRun,
} from './lib/types'
import { Vault } from './lib/vault'
import { AddTokenSheet } from './ui/AddTokenSheet'
import { AuditLog } from './ui/AuditLog'
import { CreateRepoSheet } from './ui/CreateRepoSheet'
import { ForksSheet } from './ui/ForksSheet'
import { GuardSheet, type GuardMode } from './ui/GuardSheet'
import { HotPage } from './ui/HotPage'
import { LockedScreen } from './ui/LockedScreen'
import { PipelinesPage } from './ui/PipelinesPage'
import { ReleasesSheet } from './ui/ReleasesSheet'
import { RepoDetailSheet } from './ui/RepoDetailSheet'
import { RepoList } from './ui/RepoList'
import { RepoPickerSheet } from './ui/RepoPickerSheet'
import { RunSheet } from './ui/RunSheet'
import { SettingsPage } from './ui/SettingsPage'
import { StarsPage } from './ui/StarsPage'
import { TokenVault } from './ui/TokenVault'
import { UnlockScreen } from './ui/UnlockScreen'
import { UpdateSheet, type UpdatePhase } from './ui/UpdateSheet'
import { VisibilitySheet } from './ui/VisibilitySheet'
import { WorkflowSheet } from './ui/WorkflowSheet'
import { Icon } from './ui/icons'
import './styles/theme.css'

type Tab = 'repos' | 'stars' | 'hot' | 'pipelines' | 'tokens' | 'settings'
/** 弹层类型与返回栈共用一套定义，避免两边漏改 */
type Sheet = SheetName

const MIRROR_KEY = 'ghx.mirror'

export default function App() {
  const kvRef = useRef<KV | null>(null)
  const vaultRef = useRef<Vault | null>(null)
  const toastTimer = useRef<number | null>(null)

  const [ready, setReady] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)
  /** 启动是否需要口令：旧口令库或用户主动开启了启动验证 */
  const [needPass, setNeedPass] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [secureMode, setSecureMode] = useState<'device' | 'passphrase'>('device')
  const [guarded, setGuarded] = useState(false)
  const [guardSheet, setGuardSheet] = useState<GuardMode | null>(null)
  const [guardBusy, setGuardBusy] = useState(false)
  const [guardError, setGuardError] = useState<string | null>(null)
  const [themePref, setThemePref] = useState<ThemePref>(() => readThemePref())
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(readThemePref()))

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
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [pipelineRepo, setPipelineRepo] = useState<Repo | null>(null)
  const [pipelineReload, setPipelineReload] = useState(0)
  const [activeWorkflow, setActiveWorkflow] = useState<{ repo: Repo; workflow: Workflow } | null>(null)
  const [activeRun, setActiveRun] = useState<{ repo: Repo; run: WorkflowRun } | null>(null)
  const [auditOpen, setAuditOpen] = useState(false)
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

  /* ---------------- 返回键 ---------------- */

  const exitAtRef = useRef(0)
  const backStateRef = useRef<BackState>({
    screen: 'app',
    guardSheetOpen: false,
    auditOpen: false,
    sheet: 'none',
    hasWorkflow: false,
    selectMode: false,
    tab: 'repos',
  })

  // 每次渲染同步一份界面状态：监听器只注册一次，不必随状态反复解绑
  backStateRef.current = {
    screen: unlocked ? 'app' : needPass ? 'unlock' : 'locked',
    guardSheetOpen: guardSheet !== null,
    auditOpen,
    sheet,
    hasWorkflow: activeWorkflow !== null,
    selectMode,
    tab,
    sheetLocked: sheet === 'visibility' && phase === 'running',
  }

  const requestExit = useCallback(async () => {
    // 网页里没有「退出 App」这回事，只提示，避免按下去毫无反应
    if (Capacitor.getPlatform() === 'web') {
      showToast('已经在首页')
      return
    }
    const now = Date.now()
    if (exitDecision(exitAtRef.current, now) === 'exit') {
      exitAtRef.current = 0
      await CapacitorApp.exitApp()
      return
    }
    exitAtRef.current = now
    showToast('再按一次返回退出')
  }, [showToast])

  /** 关掉弹层；有两层堆叠时退到上一层而不是整屏收起 */
  const closeSheetTo = useCallback((to: SheetName) => {
    const from = backStateRef.current.sheet
    if (to === 'none') {
      if (from === 'detail') setDetailRepo(null)
      if (from === 'workflow') setActiveWorkflow(null)
      if (from === 'run') setActiveRun(null)
      setSheet('none')
      return
    }
    // 回到工作流详情时清掉运行对象，避免下次点进别的运行还带着旧的
    if (from === 'run') setActiveRun(null)
    setSheet(to)
  }, [])

  const applyBack = useCallback(() => {
    // 软键盘开着时先收键盘，这是安卓上最符合直觉的第一层返回
    const el = document.activeElement
    if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      el.blur()
      return
    }

    const action = resolveBack(backStateRef.current)
    switch (action.kind) {
      case 'close-guard':
        setGuardSheet(null)
        setGuardError(null)
        return
      case 'close-audit':
        setAuditOpen(false)
        return
      case 'exit-select':
        setSelectMode(false)
        setSelected(new Set())
        return
      case 'home':
        setTab('repos')
        setAuditOpen(false)
        return
      case 'sheet':
        closeSheetTo(action.to)
        return
      case 'blocked':
        showToast('正在执行，等这一批跑完再退')
        return
      default:
        void requestExit()
    }
  }, [closeSheetTo, requestExit])

  // 物理返回键：接管后系统不再直接 finish 掉 Activity
  useEffect(() => {
    if (Capacitor.getPlatform() === 'web') return
    let disposed = false
    let remove: (() => void) | null = null
    void CapacitorApp.addListener('backButton', () => {
      applyBack()
    }).then((handle) => {
      if (disposed) void handle.remove()
      else remove = () => void handle.remove()
    })
    return () => {
      disposed = true
      remove?.()
    }
  }, [applyBack])

  // 网页/桌面按 Esc 走同一套返回逻辑，方便在没有真机时验证层级
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // 根层交给浏览器自己处理，别在这里拦出一个"已在首页"的提示
      if (resolveBack(backStateRef.current).kind === 'exit') return
      e.preventDefault()
      applyBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [applyBack])


  /** 配色：首屏已由 index.html 内联脚本处理，这里负责后续切换与系统监听。 */
  useEffect(() => {
    const apply = () => {
      const next = resolveTheme(themePref)
      applyTheme(next)
      setResolvedTheme(next)
      void syncStatusBar(next)
    }
    apply()
    if (themePref !== 'system') return
    return watchSystemTheme(apply)
  }, [themePref])

  function changeTheme(pref: ThemePref) {
    writeThemePref(pref)
    setThemePref(pref)
    if (pref === 'system') {
      showToast(`已跟随系统 · 当前${resolveTheme('system') === 'dark' ? '深色' : '浅色'}`)
    } else {
      showToast(pref === 'dark' ? '已切换深色' : '已切换浅色')
    }
  }

  const refreshAudit = useCallback(async () => {
    if (!kvRef.current) return
    setAudit(await readAudit(kvRef.current))
  }, [])

  /** fresh=true 用于刷新按钮：其余情况直接吃缓存，切换页签不再重新拉一遍 */
  const loadRepos = useCallback(async (c: GitHubClient, tokenId: string | null, fresh = false) => {
    setLoadingRepos(true)
    setRepoError(null)
    try {
      const acc: Repo[] = []
      for (let page = 1; page <= 6; page += 1) {
        const { data, rate } = await c.listRepos(page, 30, fresh)
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
      setPipelineRepo(null)
      setSheet('none')
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

  /** 解锁成功后的统一入口：载入列表、自动激活第一条、记一条审计。 */
  const enterVault = useCallback(
    async (detail: string) => {
      const v = vaultRef.current
      if (!v) return
      const list = await v.list()
      setRecords(list)
      setUnlocked(true)
      setNeedPass(false)
      setSecureMode(v.mode === 'passphrase' ? 'passphrase' : 'device')
      setGuarded(v.guarded)
      if (kvRef.current) {
        await appendAudit(kvRef.current, {
          action: 'unlock',
          target: '本地保险库',
          result: 'ok',
          detail,
        })
        await refreshAudit()
      }
      if (list[0]) await activate(list[0].id, list)
    },
    [activate, refreshAudit],
  )

  /**
   * 启动流程：没有保险库就静默建一个免密的，有的话直接自动解锁。
   * 只有旧口令库或开了启动验证才会停在口令屏 —— 这是本版的默认体验。
   */
  const enterRef = useRef(enterVault)
  enterRef.current = enterVault
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const kv = await createKV()
        const v = new Vault(kv)
        kvRef.current = kv
        vaultRef.current = v

        const savedMirror = await kv.get(MIRROR_KEY)
        if (cancelled) return
        if (savedMirror) setMirror(savedMirror)

        const state = await v.autoUnlock()
        if (cancelled) return
        if (state === 'no-vault') {
          await v.createDevice()
          if (cancelled) return
        }

        setSecureMode(v.mode === 'passphrase' ? 'passphrase' : 'device')
        setGuarded(v.guarded)

        if (state === 'need-passphrase') {
          setNeedPass(true)
        } else {
          await enterRef.current(state === 'no-vault' ? '首次创建（免密）' : '自动解锁')
        }
        if (!cancelled) setReady(true)
      } catch (err) {
        if (cancelled) return
        setBootError((err as Error).message)
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleUnlock(passphrase: string) {
    const v = vaultRef.current
    if (!v) return
    setBusy(true)
    setAuthError(null)
    try {
      await v.unlock(passphrase)
      await enterVault('口令解锁')
    } catch (err) {
      setAuthError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** 旧口令库一次性迁移成免密：解密全部令牌后用设备密钥重新加密。 */
  async function handleMigrate(passphrase: string) {
    const v = vaultRef.current
    if (!v) return
    setBusy(true)
    setAuthError(null)
    try {
      await v.migrateToDevice(passphrase)
      await enterVault('旧库改为免密解锁')
      showToast('已改为免密，下次打开直接进入')
    } catch (err) {
      setAuthError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** 手动锁定后点「继续」：免密模式直接自动解锁。 */
  async function resumeVault() {
    const v = vaultRef.current
    if (!v) return
    setBusy(true)
    try {
      const state = await v.autoUnlock()
      if (state === 'need-passphrase') setNeedPass(true)
      else if (state === 'unlocked') await enterVault('免密解锁')
    } catch (err) {
      setBootError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function applyGuard(input: { current: string; next: string }) {
    const v = vaultRef.current
    const mode = guardSheet
    if (!v || !mode) return
    setGuardBusy(true)
    setGuardError(null)
    try {
      if (mode === 'migrate') {
        await v.migrateToDevice(input.current)
        setSecureMode('device')
        setGuarded(false)
      } else if (mode === 'set') {
        await v.setGuard(input.next)
      } else if (mode === 'change') {
        await v.changeGuard(input.current, input.next)
      } else {
        await v.clearGuard(input.current)
      }
      setGuarded(v.guarded)
      setGuardSheet(null)
      showToast(
        mode === 'clear'
          ? '已关闭启动验证'
          : mode === 'change'
            ? '启动口令已更新'
            : mode === 'migrate'
              ? '已改为免密，下次打开直接进入'
              : '已开启启动验证',
      )
      if (kvRef.current) {
        await appendAudit(kvRef.current, {
          action: 'security',
          target: '启动验证',
          result: 'ok',
          detail:
            mode === 'clear'
              ? '已关闭'
              : mode === 'change'
                ? '口令已修改'
                : mode === 'migrate'
                  ? '旧口令库迁移为免密'
                  : '已开启',
        })
        await refreshAudit()
      }
    } catch (err) {
      setGuardError((err as Error).message)
    } finally {
      setGuardBusy(false)
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

  async function doCreateRepo(input: {
    name: string
    description: string
    private: boolean
    autoInit: boolean
  }) {
    if (!client) return
    setCreateBusy(true)
    setCreateError(null)
    try {
      const { data } = await client.createRepo(input)
      setRepos((prev) => [data, ...prev])
      setSheet('none')
      showToast(`已创建 ${data.name}`)
      void logAudit('repo-create', data.full_name, input.private ? '私有' : '公开')
    } catch (err) {
      setCreateError((err as Error).message)
    } finally {
      setCreateBusy(false)
    }
  }

  function lockVault() {
    const v = vaultRef.current
    const needsPassword = (v?.guarded ?? false) || secureMode === 'passphrase'
    v?.lock()
    setUnlocked(false)
    setNeedPass(needsPassword)
    setRecords([])
    setActiveId(null)
    setClient(null)
    setRepos([])
    setSelected(new Set())
    setSelectMode(false)
    setPipelineRepo(null)
    setActiveWorkflow(null)
    setActiveRun(null)
    setDetailRepo(null)
    // 锁屏前把弹层一并收起，否则解锁后会直接弹回上次那个面板
    setSheet('none')
    setGuardSheet(null)
    setAuditOpen(false)
    setTab('repos')
    showToast(needsPassword ? '已锁定，需要口令解锁' : '已锁定，数据已从内存清除')
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

  // 进入流水线页默认选最近推送的仓库，省得每次都要先挑一遍
  useEffect(() => {
    if (tab !== 'pipelines') return
    if (pipelineRepo && repos.some((r) => r.full_name === pipelineRepo.full_name)) return
    if (repos.length > 0) setPipelineRepo(repos[0])
  }, [tab, pipelineRepo, repos])

  function go(next: Tab) {
    setTab(next)
    setAuditOpen(false)
  }

  if (!ready) {
    return (
      <div className="app">
        <div className="empty">正在初始化…</div>
      </div>
    )
  }

  if (bootError) {
    return (
      <div className="app">
        <div className="center-screen">
          <div className="logo-mark">
            <Icon name="warn" size={22} />
          </div>
          <h1 className="title">无法打开保险库</h1>
          <p className="muted">{bootError}</p>
          <p className="muted" style={{ marginTop: 10, fontSize: 10.5 }}>
            数据仍在本机，先别卸载重装。设备密钥缺失通常来自清除应用数据或换机迁移；若确认用不到旧数据，卸载重装会建一个新的空库。
          </p>
        </div>
      </div>
    )
  }

  if (!unlocked) {
    return needPass ? (
      <UnlockScreen
        busy={busy}
        error={authError}
        canMigrate={secureMode === 'passphrase'}
        onSubmit={(pass) => void handleUnlock(pass)}
        onMigrate={(pass) => void handleMigrate(pass)}
      />
    ) : (
      <LockedScreen busy={busy} onResume={() => void resumeVault()} />
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
          onRefresh={() => client && void loadRepos(client, activeId, true)}
          hasToken={records.length > 0}
          account={activeRecord?.login ?? null}
          onOpenRepo={(r) => {
            setDetailRepo(r)
            setSheet('detail')
          }}
          updateVersion={updateResult?.hasUpdate ? (updateResult.info?.version ?? null) : null}
          onOpenUpdate={() => void runCheck(true)}
          onCreate={() => {
            setCreateError(null)
            setSheet('create')
          }}
          canCreate={!!client}
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

      {tab === 'stars' && (
        <StarsPage
          client={client}
          login={activeRecord?.login ?? null}
          onOpenRepo={(r) => {
            setDetailRepo(r)
            setSheet('detail')
          }}
          onToast={showToast}
          onUnstarred={(fullName) => {
            setRepos((prev) =>
              prev.map((r) =>
                r.full_name === fullName
                  ? { ...r, stargazers_count: Math.max(0, r.stargazers_count - 1) }
                  : r,
              ),
            )
            setDetailRepo((cur) =>
              cur && cur.full_name === fullName
                ? { ...cur, stargazers_count: Math.max(0, cur.stargazers_count - 1) }
                : cur,
            )
          }}
        />
      )}

      {tab === 'hot' && (
        <HotPage
          client={client}
          onOpenRepo={(r) => {
            setDetailRepo(r)
            setSheet('detail')
          }}
          onToast={showToast}
        />
      )}

      {tab === 'pipelines' && (
        <PipelinesPage
          client={client}
          repo={pipelineRepo}
          reloadKey={pipelineReload}
          onPickRepo={() => setSheet('repoPick')}
          onOpenWorkflow={(w) => {
            if (!pipelineRepo) return
            setActiveWorkflow({ repo: pipelineRepo, workflow: w })
            setSheet('workflow')
          }}
          onOpenRun={(r) => {
            if (!pipelineRepo) return
            setActiveRun({ repo: pipelineRepo, run: r })
            setSheet('run')
          }}
        />
      )}

      {tab === 'settings' && !auditOpen && (
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
          themePref={themePref}
          resolvedTheme={resolvedTheme}
          onTheme={changeTheme}
          secureMode={secureMode}
          guarded={guarded}
          onSetGuard={() => {
            setGuardError(null)
            setGuardSheet('set')
          }}
          onChangeGuard={() => {
            setGuardError(null)
            setGuardSheet('change')
          }}
          onClearGuard={() => {
            setGuardError(null)
            setGuardSheet('clear')
          }}
          onMigrate={() => {
            setGuardError(null)
            setGuardSheet('migrate')
          }}
          onSaveMirror={saveMirror}
          onCheckUpdate={() => void runCheck(true)}
          onSaveBaseUrl={(url) => void saveBaseUrl(url)}
          onLock={lockVault}
          onOpenAudit={() => setAuditOpen(true)}
          onClearAudit={() => {
            if (!kvRef.current) return
            void clearAudit(kvRef.current).then(() => {
              setAudit([])
              showToast('审计日志已清空')
            })
          }}
        />
      )}

      {tab === 'settings' && auditOpen && (
        <AuditLog
          entries={audit}
          onBack={() => setAuditOpen(false)}
          onClear={() => {
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
        <button className={tab === 'repos' ? 'on' : ''} onClick={() => go('repos')}>
          <Icon name="repo" size={19} />
          仓库
        </button>
        <button className={tab === 'stars' ? 'on' : ''} onClick={() => go('stars')}>
          <Icon name="star" size={19} />
          星标
        </button>
        <button className={tab === 'hot' ? 'on' : ''} onClick={() => go('hot')}>
          <Icon name="trend" size={19} />
          热门
        </button>
        <button className={tab === 'pipelines' ? 'on' : ''} onClick={() => go('pipelines')}>
          <Icon name="play" size={19} />
          流水线
        </button>
        <button className={tab === 'tokens' ? 'on' : ''} onClick={() => go('tokens')}>
          <Icon name="key" size={19} />
          令牌
        </button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => go('settings')}>
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
          login={activeRecord?.login ?? null}
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
          onOpenWorkflows={() => {
            setPipelineRepo(detailRepo)
            setSheet('none')
            setTab('pipelines')
          }}
          onOpenReleases={() => setSheet('releases')}
          onOpenForks={() => setSheet('forks')}
        />
      )}

      {sheet === 'releases' && detailRepo && (
        <ReleasesSheet
          repo={detailRepo}
          client={client}
          mirror={mirror}
          onClose={() => setSheet('detail')}
          onToast={showToast}
          onAudit={(detail) => void logAudit('release', detailRepo.full_name, detail)}
        />
      )}

      {sheet === 'forks' && detailRepo && (
        <ForksSheet
          repo={detailRepo}
          client={client}
          login={activeRecord?.login ?? null}
          onClose={() => setSheet('detail')}
          onToast={showToast}
          onAudit={(detail) => void logAudit('fork', detailRepo.full_name, detail)}
          onOpenRepo={(r) => {
            setDetailRepo(r)
            setSheet('detail')
          }}
        />
      )}

      {sheet === 'workflow' && activeWorkflow && (
        <WorkflowSheet
          repo={activeWorkflow.repo}
          workflow={activeWorkflow.workflow}
          client={client}
          mirror={mirror}
          onClose={() => {
            setActiveWorkflow(null)
            setSheet('none')
          }}
          onChanged={(next) => {
            setActiveWorkflow((cur) => (cur ? { ...cur, workflow: next } : cur))
            setPipelineReload((n) => n + 1)
          }}
          onOpenRun={(run) => {
            setActiveRun({ repo: activeWorkflow.repo, run })
            setSheet('run')
          }}
          onToast={showToast}
          onAudit={(detail) =>
            void logAudit('workflow', `${activeWorkflow.repo.full_name} · ${activeWorkflow.workflow.name}`, detail)
          }
        />
      )}

      {sheet === 'run' && activeRun && (
        <RunSheet
          repo={activeRun.repo}
          run={activeRun.run}
          client={client}
          mirror={mirror}
          onClose={() => setSheet(activeWorkflow ? 'workflow' : 'none')}
          onToast={showToast}
          onChanged={() => setPipelineReload((n) => n + 1)}
        />
      )}

      {sheet === 'repoPick' && (
        <RepoPickerSheet
          repos={repos}
          current={pipelineRepo}
          onPick={(r) => {
            setPipelineRepo(r)
            setSheet('none')
            setPipelineReload((n) => n + 1)
          }}
          onClose={() => setSheet('none')}
        />
      )}

      {sheet === 'create' && (
        <CreateRepoSheet
          owner={activeRecord?.login ?? null}
          busy={createBusy}
          error={createError}
          onCancel={() => setSheet('none')}
          onSubmit={(input) => void doCreateRepo(input)}
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

      {guardSheet && (
        <GuardSheet
          mode={guardSheet}
          busy={guardBusy}
          error={guardError}
          onCancel={() => setGuardSheet(null)}
          onSubmit={(input) => void applyGuard(input)}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
