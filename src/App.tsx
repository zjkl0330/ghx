import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { GitHubClient } from './lib/api'
import { appendAudit, clearAudit, readAudit } from './lib/audit'
import { pickDescItems } from './lib/desc'
import { exitDecision, resolveBack, type BackState, type SheetName } from './lib/backnav'
import {
  DEFAULT_MIRROR,
  EMPTY_STORE,
  effectiveMirrors,
  mirrorCandidates,
  mirrorDefFor,
  mirrorLabel,
  normalizeBase,
  parseMirrorStore,
  parseSnapshot,
  pickFastest,
  probeAll,
  rawUrlAt,
  releaseDownloadUrl,
  serializeMirrorStore,
  setMirrorRegistry,
  snapshotFresh,
  snapshotOf,
  type MirrorStore,
  type ProbeResult,
} from './lib/mirrors'
import { buildPlan, countBy, filterRepos, runBatch } from './lib/repos'
import { popRoute, pushRoute, replaceTop, repoOf, type Route } from './lib/routes'
import { listBranches } from './lib/refs'
import { createIssue } from './lib/issues'
import { createPull } from './lib/pulls'
import { canUseNotifications, listNotifications, unreadCount } from './lib/notifications'
import { loadSnapshot, saveSnapshot, type Snapshot } from './lib/snapshot'
import { DEFAULT_SORT, normalizeSort, sortRepos, type RepoSort } from './lib/sort'
import { createKV, type KV } from './lib/storage'
import {
  applyTheme,
  readFullscreen,
  readThemePref,
  resolveTheme,
  syncStatusBar,
  watchSystemTheme,
  writeFullscreen,
  writeThemePref,
  type ResolvedTheme,
  type ThemePref,
} from './lib/theme'
import { probeToken } from './lib/tokens'
import { dismissBoot } from './lib/boot'
import { applyAppearance, readAppearance, writeAppearance, type Appearance } from './lib/appearance'
import { setImmersive } from './lib/immersive'
import { DEFAULT_TABS, TAB_DEFS, fallbackTab, normalizeTabs, toggleTab, type TabKey } from './lib/tabs'
import {
  DEFAULT_CHANNEL,
  DEFAULT_SCOPE,
  DEFAULT_TARGET,
  kvStore,
  normalizeAutoTranslate,
  normalizeChannel,
  normalizeTarget,
  parseScope,
  type TargetLang,
  type TranslateChannel,
  type TranslateScope,
  type TranslationStore,
} from './lib/translate'
import { APP_VERSION, checkForUpdate, UPDATE_OWNER, UPDATE_REPO, type UpdateCheckResult } from './lib/update'
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
import { buildAccounts, switchMessage } from './lib/accounts'
import { AccountSheet } from './ui/AccountSheet'
import { AddTokenSheet } from './ui/AddTokenSheet'
import { AuditLog } from './ui/AuditLog'
import { CodePage, FileEditor } from './ui/CodePage'
import { CommitPage, CommitsPage } from './ui/CommitsPage'
import { ComposeSheet, type ComposeMode } from './ui/ComposeSheet'
import { CreateRepoSheet } from './ui/CreateRepoSheet'
import { ForksSheet } from './ui/ForksSheet'
import { GuardSheet, type GuardMode } from './ui/GuardSheet'
import { HotPage } from './ui/HotPage'
import { IssuePage } from './ui/IssuePage'
import { LockedScreen } from './ui/LockedScreen'
import { LogSheet } from './ui/LogSheet'
import { MirrorSheet, type MirrorProbeState } from './ui/MirrorSheet'
import { PipelinesPage } from './ui/PipelinesPage'
import { NotificationsPage, targetRoute } from './ui/NotificationsPage'
import { ProfilePage } from './ui/ProfilePage'
import { PullPage } from './ui/PullsPage'
import { RefsPage } from './ui/RefsPage'
import { ReleasesSheet } from './ui/ReleasesSheet'
import { RepoAdminPage } from './ui/RepoAdminPage'
import { RepoPage } from './ui/RepoPage'
import { SearchPage } from './ui/SearchPage'
import { UserPage } from './ui/UserPage'
import { ReadmeSheet } from './ui/ReadmeSheet'
import { RepoDetailSheet } from './ui/RepoDetailSheet'
import { RepoList } from './ui/RepoList'
import { RepoPickerSheet } from './ui/RepoPickerSheet'
import { RunSheet } from './ui/RunSheet'
import { SettingsPage } from './ui/SettingsPage'
import { SortSheet } from './ui/SortSheet'
import { StarsPage } from './ui/StarsPage'
import { TokenVault } from './ui/TokenVault'
import { UnlockScreen } from './ui/UnlockScreen'
import { UpdateSheet, type UpdatePhase } from './ui/UpdateSheet'
import { VisibilitySheet } from './ui/VisibilitySheet'
import { WorkflowSheet } from './ui/WorkflowSheet'
import { useDescTranslation, type DescOptions } from './ui/useDescTranslation'
import { Icon } from './ui/icons'
import './styles/theme.css'

/** 底栏页签：只有仓库 / 星标 / 热门，用户可在设置里勾掉其中几个 */
type Tab = TabKey
/** 弹层类型与返回栈共用一套定义，避免两边漏改 */
type Sheet = SheetName

const MIRROR_KEY = 'ghx.mirror'
const MIRROR_AUTO_KEY = 'ghx.mirror.auto'
const MIRROR_SPEED_KEY = 'ghx.mirror.speed'
/** 站点表的「改地址 + 自定义站」，与当前选中的是哪台分开存 */
const MIRROR_STORE_KEY = 'ghx.mirror.store'
const SORT_KEY = 'ghx.sort'
const AUTO_TRANSLATE_KEY = 'ghx.readme.auto'
const TRANSLATE_CHANNEL_KEY = 'ghx.readme.channel'
const TRANSLATE_TARGET_KEY = 'ghx.tr.target'
const TRANSLATE_SCOPE_KEY = 'ghx.tr.scope'
const AZURE_KEY = 'ghx.tr.azure'
const TABS_KEY = 'ghx.tabs'

/** 深链进来的仓库可能不在当前列表里（比如从搜索点进来），给它造一个最小对象 */
function makeRepo(owner: string, name: string): Repo {
  return {
    id: 0,
    name,
    full_name: `${owner}/${name}`,
    owner,
    private: false,
    visibility: 'public',
    archived: false,
    disabled: false,
    description: null,
    language: null,
    stargazers_count: 0,
    forks_count: 0,
    pushed_at: '',
    default_branch: 'main',
  }
}

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
  /** 外观选项：首屏已由 index.html 应用到 <html>，这里接管后续变更 */
  const [appearance, setAppearance] = useState<Appearance>(() => readAppearance())
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(readThemePref()))
  /** 沉浸式全屏：连状态栏一起藏掉，只留内容。只在原生端有意义，Web 上是个空开关。 */
  const [fullscreen, setFullscreen] = useState<boolean>(() => readFullscreen())

  const [records, setRecords] = useState<TokenRecord[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [client, setClient] = useState<GitHubClient | null>(null)
  const [quota, setQuota] = useState<Record<string, { remaining: number; limit: number }>>({})
  const [checking, setChecking] = useState<string | null>(null)
  /** 正在切换的账号 id，切换期间面板上显示占位 */
  const [switching, setSwitching] = useState<string | null>(null)

  const [repos, setRepos] = useState<Repo[]>([])
  const [loadingRepos, setLoadingRepos] = useState(false)
  const [repoError, setRepoError] = useState<string | null>(null)
  /** 当前列表来自本地快照的时间戳；有值说明还在后台刷新 */
  const [snapshotAt, setSnapshotAt] = useState<number | null>(null)
  const [sort, setSort] = useState<RepoSort>(DEFAULT_SORT)
  /** 要翻哪些内容（自述 / 简介），落盘后冷启动沿用 */
  const [scope, setScope] = useState<TranslateScope>(DEFAULT_SCOPE)
  const [translateChannel, setTranslateChannel] = useState<TranslateChannel>(DEFAULT_CHANNEL)
  const [translateTarget, setTranslateTarget] = useState<TargetLang>(DEFAULT_TARGET)
  const [azureKey, setAzureKey] = useState('')
  const [translateStore, setTranslateStore] = useState<TranslationStore | null>(null)

  const [tab, setTab] = useState<Tab>('repos')
  /** 底栏要显示哪些入口，用户可在设置里勾 */
  const [tabs, setTabs] = useState<TabKey[]>(DEFAULT_TABS)
  /** 路由栈。空数组代表主界面，其余每一层都是一个可返回的页面 */
  const [routeStack, setRouteStack] = useState<Route[]>([])
  const route = routeStack[routeStack.length - 1] ?? null
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
  /** 未读通知数，给底栏/个人页角标用 */
  const [unread, setUnread] = useState(0)
  /** 新建 Issue / PR 的表单状态；null 表示没在填 */
  const [compose, setCompose] = useState<{
    mode: ComposeMode
    owner: string
    repo: string
    branches: string[]
    base: string
  } | null>(null)
  const [composeBusy, setComposeBusy] = useState(false)
  const [composeError, setComposeError] = useState<string | null>(null)
  /** 正在看日志的运行 */
  const [logsRun, setLogsRun] = useState<{ owner: string; repo: string; id: number; title: string } | null>(null)
  /** 写完数据后加一，强制列表重新拉（新建 issue 后回列表要能看到） */
  const [pageTick, setPageTick] = useState(0)
  const [activeWorkflow, setActiveWorkflow] = useState<{ repo: Repo; workflow: Workflow } | null>(null)
  const [activeRun, setActiveRun] = useState<{ repo: Repo; run: WorkflowRun } | null>(null)
  const [mirror, setMirror] = useState(DEFAULT_MIRROR)
  /** 站点表：内置站点的改地址 + 用户自定义站点。改一处，全局（图片/安装包/发行版页）跟着变 */
  const [mirrorStore, setMirrorStore] = useState<MirrorStore>(EMPTY_STORE)
  /** 是否让测速结果自动挑站；关掉就是用户自己指定 */
  const [mirrorAuto, setMirrorAuto] = useState(true)
  const [probe, setProbe] = useState<MirrorProbeState>({
    running: false,
    done: 0,
    total: 0,
    results: [],
    error: null,
    at: null,
    light: false,
  })
  /** 从加速站面板返回时要回到哪一层（从更新弹层进来就回更新弹层） */
  const [mirrorReturn, setMirrorReturn] = useState<SheetName>('none')
  /** 自述/发行版/复刻面板的返回目标：仓库详情弹层 or 直接回仓库主页 */
  const [subReturn, setSubReturn] = useState<SheetName>('detail')
  // 测速相关的回调里要读到最新值，用 ref 兜住闭包，避免测速跑到一半还在用旧状态
  const probeRef = useRef<MirrorProbeState>(probe)
  probeRef.current = probe
  const mirrorAutoRef = useRef(mirrorAuto)
  mirrorAutoRef.current = mirrorAuto
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('checking')
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateCheckedAt, setUpdateCheckedAt] = useState<number | null>(null)
  const updateResultRef = useRef<UpdateCheckResult | null>(null)
  updateResultRef.current = updateResult
  const silentChecked = useRef(false)
  /** 上次落盘的测速原文，用来判断快照是否还新鲜 */
  const speedCacheRef = useRef<string | null>(null)
  const speedTried = useRef(false)

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
    routeDepth: 0,
    sheet: 'none',
    hasWorkflow: false,
    selectMode: false,
    tab: 'repos',
    homeTab: 'repos',
    mirrorReturn: 'none',
  })

  // 每次渲染同步一份界面状态：监听器只注册一次，不必随状态反复解绑
  backStateRef.current = {
    screen: unlocked ? 'app' : needPass ? 'unlock' : 'locked',
    guardSheetOpen: guardSheet !== null,
    routeDepth: routeStack.length,
    sheet,
    hasWorkflow: activeWorkflow !== null,
    selectMode,
    tab,
    homeTab: tabs[0] ?? 'repos',
    mirrorReturn,
    subReturn,
    sheetLocked: sheet === 'visibility' && phase === 'running',
  }

  /** 压一层页面；同一个页面连点两次只留一条 */
  const pushTo = useCallback((next: Route) => {
    setRouteStack((prev) => pushRoute(prev, next))
  }, [])

  /** 退一层；已经在主界面就什么都不做 */
  const popTo = useCallback(() => {
    setRouteStack((prev) => popRoute(prev))
  }, [])

  /** 只换栈顶：仓库页签切换、切分支用，不增加返回层级 */
  const replaceTopTo = useCallback((next: Route) => {
    setRouteStack((prev) => replaceTop(prev, next))
  }, [])

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
      case 'pop-screen':
        popTo()
        return
      case 'exit-select':
        setSelectMode(false)
        setSelected(new Set())
        return
      case 'home':
        setTab(tabs[0] ?? 'repos')
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
  }, [closeSheetTo, popTo, requestExit, tabs])

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


  /**
   * 启动遮罩的撤除。
   * 两个条件：保险库初始化完（ready）→ 再等一帧让首屏画进屏幕，然后淡出。
   * 另有一个 4 秒兜底：保险库卡住时也不能让遮罩永远盖着。
   */
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => dismissBoot(), 120)
    return () => clearTimeout(t)
  }, [ready])

  useEffect(() => {
    const t = setTimeout(() => dismissBoot(), 4000)
    return () => clearTimeout(t)
  }, [])

  // 外观与配色一样：首屏内联脚本已经打上 data-*，这里只做挂载后的对齐
  useEffect(() => {
    applyAppearance(appearance)
  }, [appearance])

  /** 配色：首屏已由 index.html 内联脚本处理，这里负责后续切换与系统监听。 */
  useEffect(() => {
    const apply = () => {
      const next = resolveTheme(themePref)
      applyTheme(next)
      setResolvedTheme(next)
      void syncStatusBar(next)
      // 全屏是独立的原生通道：状态栏显隐跟配色无关，但每次切换都对齐一次最省心
      void setImmersive(fullscreen)
    }
    apply()
    if (themePref !== 'system') return
    return watchSystemTheme(apply)
  }, [themePref, fullscreen])

  function changeTheme(pref: ThemePref) {
    writeThemePref(pref)
    setThemePref(pref)
    if (pref === 'system') {
      showToast(`已跟随系统 · 当前${resolveTheme('system') === 'dark' ? '深色' : '浅色'}`)
    } else {
      showToast(pref === 'dark' ? '已切换深色' : '已切换浅色')
    }
  }

  function changeAppearance(patch: Partial<Appearance>, hint: string) {
    const next = { ...appearance, ...patch }
    writeAppearance(next)
    setAppearance(next)
    showToast(hint)
  }

  function changeFullscreen(on: boolean) {
    writeFullscreen(on)
    setFullscreen(on)
    showToast(on ? '已进入全屏 · 上滑边缘可唤出系统栏' : '已恢复状态栏')
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
      // 每页 100（GitHub 上限），最多 20 页 = 2000 个仓库。
      // 旧实现写死 6 页 ×30，最多只拉 180 个 —— 仓库多的人会「看不到自己的仓库」。
      const PER_PAGE = 100
      const MAX_PAGES = 20
      const acc: Repo[] = []
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const { data, rate } = await c.listRepos(page, PER_PAGE, fresh)
        acc.push(...data)
        if (rate && tokenId) {
          setQuota((q) => ({ ...q, [tokenId]: { remaining: rate.remaining, limit: rate.limit } }))
        }
        if (data.length < PER_PAGE) break
      }
      setRepos(acc)
      setSnapshotAt(null)
      setRepoError(null)
      if (kvRef.current && tokenId) {
        void saveSnapshot(kvRef.current, 'repos', tokenId, acc)
      }
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
      setDetailRepo(null)
      setSheet('none')
      // 换账号时先把上一个账号的痕迹擦干净，再按新账号重新填：
      // 路由栈压着旧 Issue/文件页会 404，仓库列表与未读数留着旧值就是串号。
      setRouteStack([])
      setQuery('')
      setRepos([])
      setSnapshotAt(null)
      setRepoError(null)
      setUnread(0)

      // 冷启动时先拿本地快照顶上，界面立刻有内容；网络请求放后台跑，
      // 否则要等 6 页全部回来才能看到第一屏
      const kv = kvRef.current
      const snap: Snapshot<Repo[]> | null = kv
        ? ((await loadSnapshot<Repo[]>(kv, 'repos', id)) as Snapshot<Repo[]> | null)
        : null
      if (snap) {
        setRepos(snap.data)
        setSnapshotAt(snap.at)
        setLoadingRepos(true)
      }
      void loadRepos(c, id)

      // 后台确认归属与 scopes，失败不打断主流程，也不把令牌误标为失效
      void probeToken(c, rec.expiresAt)
        .then(async (probe) => {
          const updated = await v.update(id, {
            scopes: probe.scopes,
            login: probe.login,
            avatarUrl: probe.avatarUrl,
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

  /**
   * 切换账号。
   *
   * 界面状态的清理统一在 activate 里做（路由栈、仓库列表、未读、选择态），
   * 这里只负责切换本身与提示 —— 免得两个地方各清一半、漏掉一样就串号。
   */
  async function switchAccount(id: string) {
    if (id === activeId) {
      setSheet('none')
      return
    }
    setSwitching(id)
    try {
      await activate(id)
      const rec = records.find((r) => r.id === id)
      if (kvRef.current && rec) {
        await appendAudit(kvRef.current, {
          action: 'account-switch',
          target: rec.login ? `@${rec.login}` : rec.name,
          result: 'ok',
          detail: '已切换当前账号',
        })
        await refreshAudit()
      }
      showToast(rec ? switchMessage(buildAccounts([rec], id)[0]) : '已切换账号')
    } catch (err) {
      showToast((err as Error).message)
    } finally {
      setSwitching(null)
    }
  }

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
        const savedAutoMirror = await kv.get(MIRROR_AUTO_KEY)
        const savedSpeed = await kv.get(MIRROR_SPEED_KEY)
        const savedMirrorStore = await kv.get(MIRROR_STORE_KEY)
        if (cancelled) return

        // 先恢复站点表再谈「当前用哪台」：改过地址的站点必须先进注册表，
        // 后面的 mirrorDefFor / githubUrlAt 才知道新域名该走哪种路径风格。
        const store = parseMirrorStore(savedMirrorStore)
        setMirrorStore(store)
        setMirrorRegistry(effectiveMirrors(store))

        if (savedMirror) setMirror(savedMirror)

        // 加速站：自动模式下直接沿用上次测速选出的那台，冷启动不重复测
        const auto = savedAutoMirror !== 'off'
        speedCacheRef.current = savedSpeed
        setMirrorAuto(auto)
        const snap = parseSnapshot(savedSpeed)
        if (snap) {
          setProbe((prev) => ({
            ...prev,
            at: snap.at,
            results: snap.results.map((r) => {
              const def = mirrorDefFor(r.base)
              return {
                base: r.base,
                label: def.label,
                style: def.style,
                status: r.kbps > 0 ? 'ok' : 'fail',
                ms: r.ms,
                bytes: 0,
                kbps: r.kbps,
                error: r.kbps > 0 ? undefined : '上次没测通',
              } as ProbeResult
            }),
          }))
          if (auto && snapshotFresh(snap) && snap.best) setMirror(snap.best)
        }

        const savedSort = await kv.get(SORT_KEY)
        if (cancelled) return
        setSort(normalizeSort(savedSort))

        // 自述翻译的偏好与译文缓存：译文按内容哈希存，重开 App 不必重新消耗额度
        const savedAuto = await kv.get(AUTO_TRANSLATE_KEY)
        const savedChannel = await kv.get(TRANSLATE_CHANNEL_KEY)
        const savedScope = await kv.get(TRANSLATE_SCOPE_KEY)
        const savedTarget = await kv.get(TRANSLATE_TARGET_KEY)
        const savedAzure = await kv.get(AZURE_KEY)
        const savedTabs = await kv.get(TABS_KEY)
        if (cancelled) return
        // 旧版只存了「自述自动翻译」一个开关，迁移成翻译范围里的自述项
        const legacyZh = normalizeAutoTranslate(savedAuto)
        setScope(savedScope ? parseScope(savedScope) : { ...DEFAULT_SCOPE, readme: legacyZh })
        setTranslateTarget(normalizeTarget(savedTarget))
        setAzureKey(savedAzure ?? '')
        setTranslateChannel(normalizeChannel(savedChannel))
        setTranslateStore(kvStore(kv))
        const savedTabList = normalizeTabs(savedTabs)
        setTabs(savedTabList)
        setTab((cur) => fallbackTab(savedTabList, cur))

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
      if (!activeId) {
        // 首次导入：直接用它，省一步
        await activate(rec.id, list)
        showToast('令牌已加密保存')
      } else {
        // 已经有账号在用：新增不抢当前会话，否则多账号时每加一个都被踢走
        showToast(`已添加「${rec.name}」，可在账号面板切换`)
        void (async () => {
          try {
            const secret = await v.secret(rec.id)
            const c = new GitHubClient({ token: secret, baseUrl: rec.baseUrl || baseUrl })
            const probe = await probeToken(c, rec.expiresAt)
            const updated = await v.update(rec.id, {
              scopes: probe.scopes,
              login: probe.login,
              avatarUrl: probe.avatarUrl,
              lastCheckedAt: probe.checkedAt,
              lastStatus: probe.status,
            })
            setRecords((prev) => prev.map((r) => (r.id === rec.id ? updated : r)))
          } catch {
            /* 归属探测失败不打断，账号面板里会显示「未校验」 */
          }
        })()
      }
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

  // 未读通知：解锁后拉一次，之后每 5 分钟刷一次。fine-grained 令牌直接跳过
  useEffect(() => {
    if (!unlocked || !client) return
    if (!canUseNotifications(client.scopes)) return
    let cancelled = false
    const tick = async () => {
      try {
        const r = await listNotifications(client, { conditional: true })
        if (!cancelled && !r.notModified) setUnread(unreadCount(r.items))
      } catch {
        /* 网络不通或权限不足都不该打断主流程 */
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 5 * 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [unlocked, client])

  // 解锁后静默查一次：有新版本只在列表顶部提示，不打断使用
  useEffect(() => {
    if (!unlocked || silentChecked.current) return
    silentChecked.current = true
    void runCheck(false)
  }, [unlocked, runCheck])

  /** 手动指定加速站：同时关掉自动测速，免得下次启动又被覆盖 */
  const useMirror = useCallback(
    (base: string) => {
      const next = normalizeBase(base) || DEFAULT_MIRROR
      setMirror(next)
      setMirrorAuto(false)
      if (kvRef.current) {
        void kvRef.current.set(MIRROR_KEY, next)
        void kvRef.current.set(MIRROR_AUTO_KEY, 'off')
      }
      showToast(`已切换到 ${mirrorLabel(next)}`)
    },
    [showToast],
  )

  /** 打开加速站面板；记下来源，返回键才能退对层 */
  const openMirrors = useCallback((from: SheetName) => {
    setMirrorReturn(from)
    setSheet('mirrors')
  }, [])

  /** 进入流水线。底栏、仓库详情、仓库主页三处都走这里，保证行为一致 */
  const openPipelines = useCallback(
    (repo: Repo | null) => {
      if (!repo) {
        showToast('还没有可用的仓库')
        return
      }
      setPipelineRepo(repo)
      pushTo({ kind: 'actions', owner: repo.owner, repo: repo.name })
    },
    [pushTo, showToast],
  )

  /**
   * 新建 Issue / PR。分支列表现取，失败就只留默认分支 ——
   * 读不到分支不该让整个表单打不开。
   */
  const openCompose = useCallback(
    async (mode: ComposeMode, owner: string, repo: string, base: string) => {
      setComposeError(null)
      setCompose({ mode, owner, repo, branches: [base], base })
      setSheet('compose')
      if (!client) return
      try {
        const list = await listBranches(client, owner, repo)
        if (list.length === 0) return
        setCompose((cur) =>
          cur && cur.owner === owner && cur.repo === repo
            ? { ...cur, branches: list.map((b) => b.name), base: cur.base === '' ? base : cur.base }
            : cur,
        )
      } catch {
        /* 令牌读不到分支时保留默认分支 */
      }
    },
    [client],
  )

  async function submitCompose(input: { title: string; body: string; head?: string; base?: string }) {
    if (!compose || !client) return
    setComposeBusy(true)
    setComposeError(null)
    try {
      if (compose.mode === 'issue') {
        const issue = await createIssue(client, compose.owner, compose.repo, {
          title: input.title,
          body: input.body,
        })
        setSheet('none')
        setCompose(null)
        setPageTick((n) => n + 1)
        showToast(`已创建 #${issue.number}`)
        void logAudit('issue', `${compose.owner}/${compose.repo}#${issue.number}`, input.title)
        pushTo({ kind: 'issue', owner: compose.owner, repo: compose.repo, number: issue.number })
      } else {
        const pr = await createPull(client, compose.owner, compose.repo, {
          title: input.title,
          body: input.body,
          head: input.head ?? '',
          base: input.base ?? compose.base,
        })
        setSheet('none')
        setCompose(null)
        setPageTick((n) => n + 1)
        showToast(`已创建 PR #${pr.number}`)
        void logAudit('pull', `${compose.owner}/${compose.repo}#${pr.number}`, input.title)
        pushTo({ kind: 'pull', owner: compose.owner, repo: compose.repo, number: pr.number })
      }
    } catch (err) {
      setComposeError((err as Error).message)
    } finally {
      setComposeBusy(false)
    }
  }

  /** 打开日志面板。日志是 zip，单独一层看 */
  const openLogs = useCallback(
    (repo: Repo, run: WorkflowRun) => {
      setLogsRun({
        owner: repo.owner,
        repo: repo.name,
        id: run.id,
        title: `${repo.full_name} · #${run.run_number} · ${run.display_title || run.name || ''}`,
      })
      setSheet('logs')
    },
    [],
  )

  /**
   * 只切当前站点，不改「自动/手动」偏好，也不关面板。
   * 用在「给正在用的站点改地址」：用户只想换域名，不该顺手把自动测速关掉。
   */
  const applyMirror = useCallback((base: string) => {
    const next = normalizeBase(base) || DEFAULT_MIRROR
    setMirror(next)
    if (kvRef.current) void kvRef.current.set(MIRROR_KEY, next)
  }, [])

  /**
   * 保存站点表（改地址 / 加站 / 删站）。
   *
   * 这里必须同步更新模块级注册表：图片、安装包、发行版页只拿到 base，
   * 靠注册表才知道该走「路径」还是「整段 URL」风格。改完不清空测速结果的话，
   * 用户会看到旧域名还标着速度 —— 所以顺手作废本轮测速。
   */
  const saveMirrorStore = useCallback((next: MirrorStore) => {
    setMirrorStore(next)
    setMirrorRegistry(effectiveMirrors(next))
    if (kvRef.current) void kvRef.current.set(MIRROR_STORE_KEY, serializeMirrorStore(next))
    setProbe((prev) => ({ ...prev, results: [], at: null, error: null }))
  }, [])

  /**
   * 逐个测速并落盘结果。
   *
   * 有安装包就测安装包（最贴近真实下载），没有就退化成测 README 的连通性 ——
   * 顺序发请求而不是并发，否则几个站互相抢带宽，测出来的名次是噪声。
   */
  const speedTest = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (probeRef.current.running) return
      const bases = mirrorCandidates(mirror).map((r) => r.base)
      const info = updateResultRef.current?.info ?? null
      const asset = info?.asset ?? null
      const light = !asset
      const urlFor = (b: string) =>
        asset && info
          ? releaseDownloadUrl(b, UPDATE_OWNER, UPDATE_REPO, info.tag, asset.name)
          : rawUrlAt(b, UPDATE_OWNER, UPDATE_REPO, 'main', 'README.md')

      setProbe({ running: true, done: 0, total: bases.length, results: [], error: null, light, at: null })
      const results = await probeAll(bases, urlFor, {
        onResult: (r, i) =>
          setProbe((prev) => ({ ...prev, done: i + 1, results: [...prev.results, r] })),
      })
      const snap = snapshotOf(results)
      const best = pickFastest(results)
      setProbe({
        running: false,
        done: bases.length,
        total: bases.length,
        results,
        error: best ? null : '所有加速站都测不通，换个网络再试',
        at: snap.at,
        light,
      })
      const kv = kvRef.current
      if (kv) await kv.set(MIRROR_SPEED_KEY, JSON.stringify(snap))

      if (best && (opts.silent ? mirrorAutoRef.current : true)) {
        setMirror(best.base)
        if (kv) await kv.set(MIRROR_KEY, best.base)
        if (!opts.silent) showToast(`已选用最快的 ${best.label}`)
      }
    },
    [mirror, showToast],
  )

  const setAutoMirror = useCallback(
    (on: boolean) => {
      setMirrorAuto(on)
      if (kvRef.current) void kvRef.current.set(MIRROR_AUTO_KEY, on ? 'on' : 'off')
      if (!on) return
      const best = pickFastest(probeRef.current.results)
      if (best) {
        setMirror(best.base)
        if (kvRef.current) void kvRef.current.set(MIRROR_KEY, best.base)
        showToast(`已选用最快的 ${best.label}`)
        return
      }
      void speedTest()
    },
    [showToast, speedTest],
  )

  /**
   * 后台测速：只有「自动选最快」打开、且没有新鲜结果时才跑一次。
   * 等更新检查出结果再测，才有真实安装包可测；检查失败也照测（退化成连通性测试）。
   */
  useEffect(() => {
    if (!unlocked || !mirrorAuto || speedTried.current) return
    if (updatePhase === 'checking') return
    speedTried.current = true
    const cached = parseSnapshot(speedCacheRef.current)
    if (snapshotFresh(cached) && cached?.best) return
    void speedTest({ silent: true })
  }, [unlocked, mirrorAuto, updatePhase, speedTest])

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
    setRouteStack([])
    setTab('repos')
    showToast(needsPassword ? '已锁定，需要口令解锁' : '已锁定，数据已从内存清除')
  }

  const counts = useMemo(() => {
    const c = countBy(repos)
    return { total: c.total, public: c.public, private: c.private }
  }, [repos])

  const filtered = useMemo(
    () => sortRepos(filterRepos(repos, { query, visibility, includeArchived: false }), sort),
    [repos, query, visibility, sort],
  )

  const activeRecord = records.find((r) => r.id === activeId) ?? null

  /** 当前路由指向的仓库对象。列表里有就用真的，没有就造一个最小的 */
  const routeRepo = useMemo<Repo | null>(() => {
    const ref = route ? repoOf(route) : null
    if (!ref) return null
    return repos.find((r) => r.full_name === `${ref.owner}/${ref.repo}`) ?? makeRepo(ref.owner, ref.repo)
  }, [route, repos])

  // 进入流水线页默认选最近推送的仓库，省得每次都要先挑一遍
  const onPipelines = route?.kind === 'actions' || tab === 'pipelines'
  useEffect(() => {
    if (!onPipelines) return
    if (pipelineRepo && repos.some((r) => r.full_name === pipelineRepo.full_name)) return
    if (repos.length > 0) setPipelineRepo(repos[0])
  }, [onPipelines, pipelineRepo, repos])

  function go(next: Tab) {
    setTab(next)
    setRouteStack([])
  }

  // 简介机翻：只翻当前列表前 30 条 + 正在看的详情，结果按 full_name 索引。
  // 钩子必须放在口令屏 / 锁定屏的提前 return 之前，否则钩子数量会不固定。
  const descItems = useMemo(() => pickDescItems(filtered, 30, detailRepo), [filtered, detailRepo])

  // 热门 / 星标各自持有列表，所以把这套参数整包传下去，由页面自己翻可见的那几十行
  const descOpts = useMemo<DescOptions>(
    () => ({
      enabled: scope.desc,
      channel: translateChannel,
      target: translateTarget,
      azureKey,
      store: translateStore,
    }),
    [scope.desc, translateChannel, translateTarget, azureKey, translateStore],
  )

  const descZh = useDescTranslation(descItems, descOpts)

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

  // 当前镜像的实测速度；换站后按站点取，没测过就空着。
  // 注意不能写成 useMemo —— 这行在口令屏/锁定屏的提前 return 之后，钩子数量会不固定
  const currentSpeed = (() => {
    const cur = normalizeBase(mirror).toLowerCase()
    const hit = probe.results.find((r) => normalizeBase(r.base).toLowerCase() === cur)
    return hit?.status === 'ok' ? hit.kbps : null
  })()

  return (
    <div className={route ? 'app' : 'app with-tabs'}>
      {!route && tab === 'repos' && (
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
          account={
            activeRecord ? (activeRecord.login ? `@${activeRecord.login}` : activeRecord.name) : null
          }
          avatarUrl={activeRecord?.avatarUrl ?? null}
          onOpenProfile={() => pushTo({ kind: 'profile' })}
          onOpenAccounts={() => setSheet('accounts')}
          accountCount={records.length}
          unread={unread}
          onOpenNotifications={() => pushTo({ kind: 'notifications' })}
          descZh={descZh}
          onOpenRepo={(r) => {
            setDetailRepo(r)
            setSheet('detail')
          }}
          updateVersion={updateResult?.hasUpdate ? (updateResult.info?.version ?? null) : null}
          onOpenUpdate={() => void runCheck(true)}
          sort={sort}
          onOpenSort={() => setSheet('sort')}
          snapshotAt={snapshotAt}
          onCreate={() => {
            setCreateError(null)
            setSheet('create')
          }}
          canCreate={!!client}
        />
      )}

      {!route && tab === 'stars' && (
        <StarsPage
          client={client}
          login={activeRecord?.login ?? null}
          descOpts={descOpts}
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

      {!route && tab === 'hot' && (
        <HotPage
          client={client}
          descOpts={descOpts}
          onOpenRepo={(r) => {
            setDetailRepo(r)
            setSheet('detail')
          }}
          onToast={showToast}
        />
      )}

      {route?.kind === 'profile' && (
        <ProfilePage
          login={activeRecord?.login ?? null}
          accountName={activeRecord?.name ?? null}
          avatarUrl={activeRecord?.avatarUrl ?? null}
          repoCount={repos.length}
          tokenCount={records.length}
          auditCount={audit.length}
          accountCount={records.length}
          onOpenAccounts={() => setSheet('accounts')}
          version={APP_VERSION}
          latestVersion={updateResult?.latest ?? null}
          hasUpdate={!!updateResult?.hasUpdate}
          onBack={popTo}
          onOpenTokens={() => pushTo({ kind: 'tokens' })}
          onOpenSettings={() => pushTo({ kind: 'settings' })}
          onOpenAudit={() => pushTo({ kind: 'audit' })}
          onOpenNotifications={() => pushTo({ kind: 'notifications' })}
          unreadCount={unread}
          onOpenSearch={() => pushTo({ kind: 'search' })}
          onOpenMe={() => {
            if (activeRecord?.login) pushTo({ kind: 'user', login: activeRecord.login })
            else showToast('还没有读到登录名')
          }}
          onCheckUpdate={() => void runCheck(true)}
          onLock={lockVault}
        />
      )}

      {route?.kind === 'settings' && (
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
          appearance={appearance}
          onAppearance={changeAppearance}
          native={Capacitor.isNativePlatform()}
          fullscreen={fullscreen}
          onFullscreen={changeFullscreen}
          scope={scope}
          onScope={(next) => {
            setScope(next)
            if (kvRef.current) void kvRef.current.set(TRANSLATE_SCOPE_KEY, JSON.stringify(next))
            showToast(
              next.readme || next.desc
                ? `翻译范围：${[next.readme ? '自述' : '', next.desc ? '简介' : ''].filter(Boolean).join('、')}`
                : '已关闭机翻',
            )
          }}
          target={translateTarget}
          onTarget={(t) => {
            setTranslateTarget(t)
            if (kvRef.current) void kvRef.current.set(TRANSLATE_TARGET_KEY, t)
            showToast(`译文语言改为${t}`)
          }}
          translateChannel={translateChannel}
          onTranslateChannel={(ch) => {
            setTranslateChannel(ch)
            if (kvRef.current) void kvRef.current.set(TRANSLATE_CHANNEL_KEY, ch)
            showToast(`翻译通道已切换`)
          }}
          azureKey={azureKey}
          onAzureKey={(key) => {
            setAzureKey(key)
            if (kvRef.current) void kvRef.current.set(AZURE_KEY, key)
            showToast(key ? '微软翻译密钥已保存' : '已清除微软翻译密钥')
          }}
          tabs={tabs}
          onToggleTab={(key) => {
            const next = toggleTab(tabs, key)
            if (next === tabs) {
              showToast('底栏至少要留一个入口')
              return
            }
            setTabs(next)
            setTab((cur) => fallbackTab(next, cur))
            if (kvRef.current) void kvRef.current.set(TABS_KEY, JSON.stringify(next))
          }}
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
          mirrorAuto={mirrorAuto}
          mirrorSpeed={currentSpeed}
          mirrorCheckedAt={probe.at}
          mirrorCustom={mirrorStore.custom.length}
          mirrorChanged={Object.keys(mirrorStore.overrides).length}
          onOpenMirrors={() => openMirrors('none')}
          onOpenTokens={() => pushTo({ kind: 'tokens' })}
          onBack={popTo}
          onCheckUpdate={() => void runCheck(true)}
          onSaveBaseUrl={(url) => void saveBaseUrl(url)}
          onLock={lockVault}
          onOpenAudit={() => pushTo({ kind: 'audit' })}
          onClearAudit={() => {
            if (!kvRef.current) return
            void clearAudit(kvRef.current).then(() => {
              setAudit([])
              showToast('审计日志已清空')
            })
          }}
        />
      )}

      {route?.kind === 'tokens' && (
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
          onBack={popTo}
        />
      )}

      {route?.kind === 'audit' && (
        <AuditLog
          entries={audit}
          onBack={popTo}
          onClear={() => {
            if (!kvRef.current) return
            void clearAudit(kvRef.current).then(() => {
              setAudit([])
              showToast('审计日志已清空')
            })
          }}
        />
      )}

      {route?.kind === 'repo' && (
        <RepoPage
          client={client}
          owner={route.owner}
          repo={route.repo}
          tab={route.tab ?? 'code'}
          reloadKey={pageTick}
          mirror={mirror}
          onToast={showToast}
          onBack={popTo}
          onTab={(t) => {
            if (t === 'actions') {
              openPipelines(routeRepo)
              return
            }
            replaceTopTo({ kind: 'repo', owner: route.owner, repo: route.repo, tab: t })
          }}
          onOpenIssue={(n) => pushTo({ kind: 'issue', owner: route.owner, repo: route.repo, number: n })}
          onOpenPull={(n) => pushTo({ kind: 'pull', owner: route.owner, repo: route.repo, number: n })}
          onOpenDir={(path) => pushTo({ kind: 'code', owner: route.owner, repo: route.repo, path })}
          onOpenFile={(path) => pushTo({ kind: 'code', owner: route.owner, repo: route.repo, path })}
          onOpenRefs={() => pushTo({ kind: 'refs', owner: route.owner, repo: route.repo })}
          onOpenHome={() => pushTo({ kind: 'code', owner: route.owner, repo: route.repo, path: '' })}
          onNewFile={() => pushTo({ kind: 'edit', owner: route.owner, repo: route.repo, path: '' })}
          onOpenReadme={() => {
            if (routeRepo) setDetailRepo(routeRepo)
            setSubReturn('none')
            setSheet('readme')
          }}
          onOpenReleases={() => {
            if (routeRepo) setDetailRepo(routeRepo)
            setSubReturn('none')
            setSheet('releases')
          }}
          onOpenForks={() => {
            if (routeRepo) setDetailRepo(routeRepo)
            setSubReturn('none')
            setSheet('forks')
          }}
          onOpenWorkflows={() => openPipelines(routeRepo)}
          onOpenSettings={() => pushTo({ kind: 'admin', owner: route.owner, repo: route.repo })}
          onOpenOwner={() => pushTo({ kind: 'user', login: route.owner })}
          onCompose={() =>
            void openCompose(
              route.tab === 'pulls' ? 'pull' : 'issue',
              route.owner,
              route.repo,
              routeRepo?.default_branch ?? 'main',
            )
          }
        />
      )}

      {route?.kind === 'admin' && routeRepo && (
        <RepoAdminPage
          client={client}
          repo={routeRepo}
          onBack={popTo}
          onToast={showToast}
          onChanged={(next) => {
            patchRepo(next)
            if (next.name !== routeRepo.name) {
              // 改名后地址变了，把栈顶换成新名字，否则返回上一层会回到 404
              replaceTopTo({ kind: 'repo', owner: next.owner, repo: next.name, tab: 'code' })
            }
          }}
        />
      )}

      {route?.kind === 'issue' && (
        <IssuePage
          client={client}
          owner={route.owner}
          repo={route.repo}
          number={route.number}
          onBack={popTo}
          onToast={showToast}
          onOpenUser={(login) => pushTo({ kind: 'user', login })}
        />
      )}

      {route?.kind === 'pull' && (
        <PullPage
          client={client}
          owner={route.owner}
          repo={route.repo}
          number={route.number}
          login={activeRecord?.login ?? null}
          onBack={popTo}
          onToast={showToast}
          onOpenUser={(login) => pushTo({ kind: 'user', login })}
        />
      )}

      {route?.kind === 'code' && (
        <CodePage
          client={client}
          owner={route.owner}
          repo={route.repo}
          path={route.path}
          ref={route.ref}
          mirror={mirror}
          onBack={popTo}
          onToast={showToast}
          onOpenDir={(path) => pushTo({ kind: 'code', owner: route.owner, repo: route.repo, path, ref: route.ref })}
          onOpenFile={(path) => pushTo({ kind: 'code', owner: route.owner, repo: route.repo, path, ref: route.ref })}
          onEdit={(path, sha) =>
            pushTo({ kind: 'edit', owner: route.owner, repo: route.repo, path, sha, ref: route.ref })
          }
          onPickRef={() => pushTo({ kind: 'refs', owner: route.owner, repo: route.repo })}
          onHistory={(path) => pushTo({ kind: 'commits', owner: route.owner, repo: route.repo, path, ref: route.ref })}
        />
      )}

      {route?.kind === 'commits' && (
        <CommitsPage
          client={client}
          owner={route.owner}
          repo={route.repo}
          path={route.path}
          ref={route.ref}
          onBack={popTo}
          onOpenCommit={(sha) => pushTo({ kind: 'commit', owner: route.owner, repo: route.repo, sha })}
        />
      )}

      {route?.kind === 'commit' && (
        <CommitPage
          client={client}
          owner={route.owner}
          repo={route.repo}
          sha={route.sha}
          onBack={popTo}
        />
      )}

      {route?.kind === 'edit' && (
        <FileEditor
          client={client}
          owner={route.owner}
          repo={route.repo}
          path={route.path}
          ref={route.ref}
          sha={route.sha}
          onBack={popTo}
          onToast={showToast}
          onSaved={(msg) => {
            setPageTick((n) => n + 1)
            showToast(msg)
            popTo()
          }}
        />
      )}

      {route?.kind === 'refs' && (
        <RefsPage
          client={client}
          owner={route.owner}
          repo={route.repo}
          defaultBranch={routeRepo?.default_branch ?? 'main'}
          onBack={popTo}
          onToast={showToast}
          onOpenRef={(ref) =>
            replaceTopTo({ kind: 'code', owner: route.owner, repo: route.repo, path: '', ref })
          }
        />
      )}

      {route?.kind === 'notifications' && (
        <NotificationsPage
          client={client}
          scopes={client?.scopes ?? []}
          tokenKind={activeRecord?.kind ?? 'classic'}
          onBack={popTo}
          onToast={showToast}
          onUnread={setUnread}
          onOpen={(t) => {
            const next = targetRoute(t)
            if (next) pushTo(next)
          }}
        />
      )}

      {route?.kind === 'search' && (
        <SearchPage
          client={client}
          onBack={popTo}
          onToast={showToast}
          onOpenRepo={(full) => {
            const [owner, repo] = full.split('/')
            if (owner && repo) pushTo({ kind: 'repo', owner, repo, tab: 'code' })
          }}
          onOpenUser={(login) => pushTo({ kind: 'user', login })}
          onOpenIssue={(owner, repo, n) => pushTo({ kind: 'issue', owner, repo, number: n })}
        />
      )}

      {route?.kind === 'user' && (
        <UserPage
          client={client}
          login={route.login}
          selfLogin={activeRecord?.login ?? null}
          mirror={mirror}
          onBack={popTo}
          onToast={showToast}
          onOpenUser={(login) => pushTo({ kind: 'user', login })}
          onOpenRepo={(full) => {
            const [owner, repo] = full.split('/')
            if (owner && repo) pushTo({ kind: 'repo', owner, repo, tab: 'code' })
          }}
        />
      )}

      {route?.kind === 'actions' && (
        <PipelinesPage
          client={client}
          repo={pipelineRepo ?? routeRepo}
          reloadKey={pipelineReload}
          onBack={popTo}
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

      {!route && selectMode && selected.size > 0 && (
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

      {!route && (
        <>
          {/* 玻璃背后的压暗层：让底栏静息时也有可采样的明暗过渡，见 theme.css */}
          <div className="glass-backdrop" aria-hidden="true" />
          <nav className="tabbar">
          {tabs.map((key) => {
            const def = TAB_DEFS.find((t) => t.key === key)
            if (!def) return null
            const on = tab === key
            return (
              <button
                key={key}
                className={on ? 'on' : ''}
                aria-current={on ? 'page' : undefined}
                onClick={() => {
                  if (key === 'pipelines') openPipelines(pipelineRepo ?? repos[0] ?? null)
                  else go(key)
                }}
              >
                <Icon name={def.icon} size={22} />
                <span className="tab-label">{def.label}</span>
              </button>
            )
          })}
        </nav>
        </>
      )}


      {sheet === 'accounts' && (
        <AccountSheet
          accounts={buildAccounts(records, activeId)}
          switching={switching}
          onSwitch={(id) => void switchAccount(id)}
          onManage={() => {
            setSheet('none')
            pushTo({ kind: 'tokens' })
          }}
          onAdd={() => setSheet('add')}
          onClose={() => setSheet('none')}
        />
      )}

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
          descZh={descZh[detailRepo.full_name] ?? null}
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
            pushTo({ kind: 'actions', owner: detailRepo.owner, repo: detailRepo.name })
          }}
          onOpenHome={() => {
            setSheet('none')
            pushTo({ kind: 'repo', owner: detailRepo.owner, repo: detailRepo.name, tab: 'code' })
          }}
          onOpenReleases={() => {
            setSubReturn('detail')
            setSheet('releases')
          }}
          onOpenForks={() => {
            setSubReturn('detail')
            setSheet('forks')
          }}
          onOpenReadme={() => {
            setSubReturn('detail')
            setSheet('readme')
          }}
          onOpenOwner={() => {
            // 搜索结果里的仓库对象 owner 未必归一化过，从 full_name 拆更稳
            const login = detailRepo.owner || detailRepo.full_name.split('/')[0]
            setSheet('none')
            pushTo({ kind: 'user', login })
          }}
        />
      )}

      {sheet === 'releases' && detailRepo && (
        <ReleasesSheet
          repo={detailRepo}
          client={client}
          mirror={mirror}
          onClose={() => setSheet(subReturn)}
          onToast={showToast}
          onAudit={(detail) => void logAudit('release', detailRepo.full_name, detail)}
        />
      )}

      {sheet === 'forks' && detailRepo && (
        <ForksSheet
          repo={detailRepo}
          client={client}
          login={activeRecord?.login ?? null}
          onClose={() => setSheet(subReturn)}
          onToast={showToast}
          onAudit={(detail) => void logAudit('fork', detailRepo.full_name, detail)}
          onOpenRepo={(r) => {
            setDetailRepo(r)
            setSheet('detail')
          }}
        />
      )}

      {sheet === 'readme' && detailRepo && (
        <ReadmeSheet
          repo={detailRepo}
          client={client}
          mirror={mirror}
          autoTranslate={scope.readme}
          channel={translateChannel}
          target={translateTarget}
          azureKey={azureKey}
          store={translateStore}
          onClose={() => setSheet(subReturn)}
          onToast={showToast}
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
          onOpenLogs={() => openLogs(activeRun.repo, activeRun.run)}
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

      {sheet === 'sort' && (
        <SortSheet
          current={sort}
          onPick={(next) => {
            setSort(next)
            if (kvRef.current) void kvRef.current.set(SORT_KEY, next)
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
          mirrorSpeed={currentSpeed}
          onOpenMirrors={() => openMirrors('update')}
          onRecheck={() => void runCheck(true)}
          onClose={() => setSheet('none')}
        />
      )}

      {sheet === 'mirrors' && (
        <MirrorSheet
          current={mirror}
          auto={mirrorAuto}
          probe={probe}
          store={mirrorStore}
          onProbe={() => void speedTest()}
          onUse={(base) => {
            useMirror(base)
            setSheet(mirrorReturn)
          }}
          onAuto={setAutoMirror}
          onStore={saveMirrorStore}
          onSwitch={applyMirror}
          onClose={() => setSheet(mirrorReturn)}
        />
      )}

      {sheet === 'compose' && compose && (
        <ComposeSheet
          mode={compose.mode}
          owner={compose.owner}
          repo={compose.repo}
          branches={compose.branches}
          defaultBranch={compose.base}
          busy={composeBusy}
          error={composeError}
          onSubmit={(input) => void submitCompose(input)}
          onCancel={() => {
            setSheet('none')
            setCompose(null)
          }}
        />
      )}

      {sheet === 'logs' && logsRun && (
        <LogSheet
          client={client}
          owner={logsRun.owner}
          repo={logsRun.repo}
          runId={logsRun.id}
          runTitle={logsRun.title}
          onClose={() => setSheet('run')}
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
