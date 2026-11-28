import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Clipboard } from '@capacitor/clipboard'
import { Capacitor } from '@capacitor/core'
import { GitHubClient, GitHubError } from './lib/api'
import { appendAudit, clearAudit, readAudit } from './lib/audit'
import {
  CLIP_OPEN_KEY,
  CLIP_SEEN_KEY,
  clipBlockedByRoute,
  clipFingerprint,
  clipRouteLabel,
  looksSecret,
  parseClipOpen,
  parseClipRoute,
  serializeClipOpen,
} from './lib/clipboard-link'
import { pickDescItems } from './lib/desc'
import { exitDecision, resolveBack, softKeyboardOpen, type BackState, type SheetName } from './lib/backnav'
import {
  applySettings,
  backupFileName,
  buildBackup,
  mergePins,
  newAccounts,
  openSecrets,
  parseBackup,
  readSettings,
  sealSecrets,
  serializeBackup,
  type BackupAccount,
  type BackupSecretEntry,
  type RestoreMode,
  type SealedSecrets,
} from './lib/backup'
import {
  checkRevealPass,
  clearRevealPass,
  hasRevealPass,
  setRevealPass,
} from './lib/reveal'
import {
  DEFAULT_MIRROR,
  EMPTY_STORE,
  effectiveMirrors,
  mirrorCandidates,
  mirrorDefFor,
  mirrorKnown,
  mirrorLabel,
  migrateLegacyMirrorStore,
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
import {
  planBatch,
  runBatchActions,
  countBy,
  filterRepos,
  type BatchAction,
  type BatchPlanItem,
  type RepoFilterVisibility,
} from './lib/repos'
import { popRoute, pushRoute, replaceTop, repoOf, routeKey, type Route } from './lib/routes'
import { listBranches } from './lib/refs'
import { findPrTemplate, listIssueTemplates, type IssueTemplate } from './lib/templates'
import { createIssue } from './lib/issues'
import { createPull } from './lib/pulls'
import {
  canUseNotifications,
  listNotifications,
  markThreadDone,
  unreadCount,
  type NotificationThread,
} from './lib/notifications'
import { loadSnapshot, saveSnapshot, type Snapshot } from './lib/snapshot'
import { GUEST_ID, clearHotCache } from './lib/hotCache'
import { apkAppToRepo } from './lib/apkstore'
import { DEFAULT_SORT, normalizeSort, sortRepos, type RepoSort } from './lib/sort'
import { applyPins, isPinned, parsePins, pinKey, serializePins, togglePin } from './lib/pins'
import {
  BADGE_RELEASE_PAGE,
  loadBadges,
  readCachedBadges,
  runBadgeQueue,
  saveBadges,
  type PkgKind,
} from './lib/rel-badge'
import { queryRepoPkgs } from './lib/graphql'
import {
  dropWorkspace,
  emptyWorkspace,
  restoreWorkspace,
  saveWorkspace,
  type Workspace,
  type WorkspaceTable,
} from './lib/workspace'
import {
  ACCOUNT_PREF_KEY,
  DEFAULT_ACCOUNT_PREF,
  dropWorkspaceKV,
  loadWorkspace,
  parseAccountPref,
  persistWorkspace,
  writeAccountPref,
  type AccountPref,
} from './lib/account-pref'
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
import { applyFont, readFontPref, writeFontPref, type FontPref } from './lib/font'
import { probeToken } from './lib/tokens'
import { dismissBoot } from './lib/boot'
import { applyAppearance, readAppearance, writeAppearance, type Appearance } from './lib/appearance'
import { setImmersive, syncInsets } from './lib/immersive'
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
import {
  readUpdateMode,
  updateModeEnabled,
  writeUpdateMode,
  type UpdateChannel,
  type UpdateMode,
} from './lib/update-pref'
import {
  apkTarget,
  archiveTarget,
  artifactTarget,
  assetTarget,
  DOWNLOAD_MODE_KEY,
  parseDownloadMode,
  serializeDownloadMode,
  parseDlParts,
  serializeDlParts,
  DL_PARTS_KEY,
  PARTS_OF,
  type DownloadMode,
  type DlParts,
  type DownloadTarget,
} from './lib/download'
import { appendRecord, clearHistory, readHistory, recordFromPending, type DlRecord } from './lib/dl-history'
import {
  downloadStatus,
  filesExist,
  installApk,
  nativeDownloadAvailable,
  openNotifySettings,
  readNotifyState,
  takePendingDownload,
} from './lib/native-download'
import { bgDownloadView } from './lib/download'
import type {
  AuditEntry,
  BatchResult,
  Repo,
  TokenRecord,
  Workflow,
  WorkflowRun,
} from './lib/types'
import { Vault } from './lib/vault'
import { buildAccounts, switchMessage } from './lib/accounts'
import {
  defaultSelection,
  forkOwners,
  planMultiTasks,
  runMultiTasks,
  summarize,
  toggleAllSelection,
  toggleSelection,
  type AccountState,
  type MultiAccount,
  type MultiKind,
  type MultiResult,
} from './lib/multi'
import { AccountSheet } from './ui/AccountSheet'
import { AddTokenSheet } from './ui/AddTokenSheet'
import { AuditLog } from './ui/AuditLog'
import { BackupSheet } from './ui/BackupSheet'
import { RevealSheet, type RevealMode } from './ui/RevealSheet'
import { SecretSheet } from './ui/SecretSheet'
import { AuthImageProvider } from './ui/AuthImage'
import { BackToTop } from './ui/BackToTop'
import { CodePage, FileEditor } from './ui/CodePage'
import { CommitPage, CommitsPage } from './ui/CommitsPage'
import { ComposeSheet, type ComposeMode, type ComposeSubmit } from './ui/ComposeSheet'
import { CreateRepoSheet } from './ui/CreateRepoSheet'
import { ForksSheet } from './ui/ForksSheet'
import { MultiAccountSheet } from './ui/MultiAccountSheet'
import { GuardSheet, type GuardMode } from './ui/GuardSheet'
import { Boundary } from './ui/Boundary'
import { DashboardPage } from './ui/DashboardPage'
import { GistPage } from './ui/GistPage'
import { WebOnlyPage } from './ui/WebOnlyPage'
import { GistsPage } from './ui/GistsPage'
import { HotPage } from './ui/HotPage'
import { IssuePage } from './ui/IssuePage'
import { LockedScreen } from './ui/LockedScreen'
import { LogSheet } from './ui/LogSheet'
import { MirrorSheet, type MirrorProbeState } from './ui/MirrorSheet'
import { PipelinesPage } from './ui/PipelinesPage'
import { NotificationsPage, targetRoute } from './ui/NotificationsPage'
import { ThreadSheet } from './ui/ThreadSheet'
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
import { DownloadSheet } from './ui/DownloadSheet'
import { DlHistorySheet } from './ui/DlHistorySheet'
import { ApkStoreSheet } from './ui/ApkStoreSheet'
import { BatchSheet } from './ui/BatchSheet'
import { BatchPickSheet } from './ui/BatchPickSheet'
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
/**
 * 旧版加速站只接回一次。
 *
 * 不设这个标记的话，用户手动删掉继承来的站，下次启动又会被测速快照
 * 里的地址补回来 —— 删除操作必须算数。
 */
const MIRROR_RESTORED_KEY = 'ghx.mirror.restored'
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
  /** 按账号缓存客户端实例：请求缓存跟着实例走，切回来第一屏立刻有数据 */
  const clientsRef = useRef<Record<string, GitHubClient>>({})
  /** 按账号缓存的界面现场 */
  const wsRef = useRef<WorkspaceTable>({})
  /** 当前账号 id 的即时值，给异步回调判断「有没有切走」用 */
  const activeIdRef = useRef<string | null>(null)
  /** 列表请求序号：切账号或连点刷新时丢弃过期响应，避免旧列表覆盖新账号 */
  const loadSeq = useRef(0)
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
  /** 界面字体：默认随包内置的 OPPO Sans，可切回系统字体 */
  const [fontPref, setFontPref] = useState<FontPref>(() => readFontPref())
  /** 外观选项：首屏已由 index.html 应用到 <html>，这里接管后续变更 */
  const [appearance, setAppearance] = useState<Appearance>(() => readAppearance())
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(readThemePref()))
  /** 沉浸式全屏：连状态栏一起藏掉，只留内容。只在原生端有意义，Web 上是个空开关。 */
  const [fullscreen, setFullscreen] = useState<boolean>(() => readFullscreen())

  const [records, setRecords] = useState<TokenRecord[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [client, setClient] = useState<GitHubClient | null>(null)
  /**
   * 游客客户端：没导入令牌时用它读公开数据（热门榜单、公开仓库页）。
   *
   * 空令牌的客户端不会发 Authorization 头，走 GitHub 的匿名配额；
   * 之前无令牌时热门页直接空白，是因为整个界面拿不到 client 就放弃了请求。
   * 单独建实例而不是复用 client，是为了缓存与配额互不污染。
   */
  const guestClient = useMemo(() => new GitHubClient({ token: '' }), [])
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
  const [visibility, setVisibility] = useState<RepoFilterVisibility>('all')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /** 本地置顶的仓库，按账号分开存 */
  const [pins, setPins] = useState<string[]>([])
  /**
   * 仓库列表上的「有 APK / 有 EXE」标记，按 full_name 索引。
   *
   * 列表接口不带发行版资产，只能一个仓库查一次 `/releases`。所以这份数据
   * 是异步补上来的：列表先渲染，查到一条更新一条，缺项就当作「还没查到」。
   */
  const [pkgBadges, setPkgBadges] = useState<Record<string, PkgKind[]>>({})
  /** 已经入过队的仓库，避免列表重渲染时重复请求（刷新页面/重进 App 才会重置） */
  const probedRef = useRef<Set<string>>(new Set())

  const [sheet, setSheet] = useState<Sheet>('none')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // ── 主 / 副密钥与备份 ─────────────────────────────────────────────
  /** 正在看密钥的账号；null 表示面板没开 */
  const [secretId, setSecretId] = useState<string | null>(null)
  /** 本机有没有设主密钥查看密码 */
  const [revealSet, setRevealSet] = useState(false)
  const [revealMode, setRevealMode] = useState<RevealMode>('set')
  const [revealBusy, setRevealBusy] = useState(false)
  const [revealError, setRevealError] = useState<string | null>(null)

  const [detailRepo, setDetailRepo] = useState<Repo | null>(null)
  const [createBusy, setCreateBusy] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [pipelineRepo, setPipelineRepo] = useState<Repo | null>(null)
  const [pipelineReload, setPipelineReload] = useState(0)
  /** 未读通知数，给底栏/个人页角标用 */
  const [unread, setUnread] = useState(0)
  /** 正在直读的通知线程；null 表示没开面板 */
  const [thread, setThread] = useState<NotificationThread | null>(null)
  /** 通知页重拉信号：面板里标记完成后加一 */
  const [notifTick, setNotifTick] = useState(0)
  /** 新建 Issue / PR 的表单状态；null 表示没在填 */
  const [compose, setCompose] = useState<{
    mode: ComposeMode
    owner: string
    repo: string
    branches: string[]
    base: string
    templates: IssueTemplate[]
    templatesLoading: boolean
    prTemplate: { path: string; body: string } | null
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

  // ── 统一下载：更新包 / 发行版附件 / 源码 ZIP 共用一个面板 ─────────────
  /** 应用内下载还是交给浏览器。默认交给浏览器：环境不支持时不会卡住 */
  const [downloadMode, setDownloadMode] = useState<DownloadMode>('outer')
  /** 应用内下载切几路并行。默认「自动」：原生按文件大小算，封顶 32 路 */
  const [dlParts, setDlParts] = useState<DlParts>('auto')
  /**
   * 通知栏进度能不能看见。null=还没查过。
   * 只在原生壳里有意义：Android 13+ 没给通知权限时，下载照跑但消息栏一片空白，
   * 设置页要能说清楚「为什么看不见」，并给一条去开启的路。
   */
  const [notifyVisible, setNotifyVisible] = useState<boolean | null>(null)
  const refreshNotify = useCallback(async () => {
    const st = await readNotifyState()
    setNotifyVisible(st.visible)
  }, [])

  useEffect(() => {
    void refreshNotify()
  }, [refreshNotify])

  const [downloadTarget, setDownloadTarget] = useState<DownloadTarget | null>(null)
  /** 本次会话里点过星标的仓库：列表上的 ☆ 立刻变 ★，不用等重新拉列表 */
  const [starredSet, setStarredSet] = useState<Set<string>>(new Set())
  /** 关掉下载面板后回到哪一层：更新弹层 / 发行版面板 / 仓库详情 */
  const [downloadReturn, setDownloadReturn] = useState<SheetName>('none')
  /** 本机下载记录（面板打开时重读，写入发生在下载面板里） */
  const [dlHistory, setDlHistory] = useState<DlRecord[]>(() => readHistory())
  /** 记录里的文件是否还在：用户清过 App 存储后，路径会指空 */
  const [dlExists, setDlExists] = useState<Record<string, boolean>>({})

  // ── 剪贴板直达：切回前台读一眼剪贴板，是仓库地址就跳过去 ──────────────
  /** 默认开。关掉后冷启动和切回都不再读剪贴板 */
  const [clipOpen, setClipOpen] = useState(true)
  // 测速相关的回调里要读到最新值，用 ref 兜住闭包，避免测速跑到一半还在用旧状态
  const probeRef = useRef<MirrorProbeState>(probe)
  probeRef.current = probe
  const mirrorAutoRef = useRef(mirrorAuto)
  mirrorAutoRef.current = mirrorAuto
  /**
   * 后台下载横幅。
   *
   * 面板关掉后（点「后台下载」或从通知栏回来）还得有个地方能看见进度，
   * 否则用户以为下载停了。原生侧只有一条下载，这里只是它的镜子。
   */
  const [bgDl, setBgDl] = useState<{ running: boolean; name: string; sub: string } | null>(null)

  useEffect(() => {
    if (!nativeDownloadAvailable()) return
    let stop = false
    let timer = 0
    const tick = async () => {
      const s = await downloadStatus()
      if (stop) return
      // 拼文案的规则抽在 download.ts 里（有单测）；这里只负责喂原生状态
      setBgDl(bgDownloadView(s))
      // 在跑的时候勤一点；停着的时候只是看有没有断点，6 秒足够
      timer = window.setTimeout(() => void tick(), s.running ? 1200 : 6000)
    }
    void tick()
    return () => {
      stop = true
      window.clearTimeout(timer)
    }
  }, [])

  /** 账号偏好：切回某个账号时要不要接着上次的位置（v1.1.1 起可关） */
  const [acctPref, setAcctPref] = useState<AccountPref>(DEFAULT_ACCOUNT_PREF)
  const acctPrefRef = useRef<AccountPref>(DEFAULT_ACCOUNT_PREF)
  acctPrefRef.current = acctPref
  /** 更新通道：正式版 / 测试版 / 关掉（v1.1.0 起由布尔开关升级为三档） */
  const [updateMode, setUpdateMode] = useState<UpdateMode>(readUpdateMode)
  /*
   * 关了更新提示就别停在 'checking'：后台测速在等这个状态结束，
   * 一直 checking 会让它永远不跑（而测速跟提示是两回事）。
   */
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>(() =>
    updateModeEnabled(readUpdateMode()) ? 'checking' : 'latest',
  )
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updateCheckedAt, setUpdateCheckedAt] = useState<number | null>(null)
  const updateResultRef = useRef<UpdateCheckResult | null>(null)
  updateResultRef.current = updateResult
  const silentChecked = useRef(false)
  /** 上次落盘的测速原文，用来判断快照是否还新鲜 */
  const speedCacheRef = useRef<string | null>(null)
  const speedTried = useRef(false)

  const [plan, setPlan] = useState<BatchPlanItem[]>([])
  /** 批量面板标题（「修改可见度」/「归档」/「加话题」…），由动作决定 */
  const [batchTitle, setBatchTitle] = useState('批量操作')
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

  // ── 多账号批量动作：同时 star / 同时复刻 ─────────────────────────
  const [multiKind, setMultiKind] = useState<MultiKind | null>(null)
  const [multiStates, setMultiStates] = useState<Record<string, AccountState>>({})
  const [multiSel, setMultiSel] = useState<Set<string>>(new Set())
  const [multiLoading, setMultiLoading] = useState(false)
  const [multiRunning, setMultiRunning] = useState(false)
  const [multiResults, setMultiResults] = useState<MultiResult[] | null>(null)
  /** 面板关掉之后要回到哪一层：详情页或复刻页 */
  const [multiReturn, setMultiReturn] = useState<SheetName>('detail')
  /** 批量改完之后让详情页重新查一次 star 状态 */
  const [starTick, setStarTick] = useState(0)
  const [forkTick, setForkTick] = useState(0)

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
    multiReturn,
    downloadReturn,
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

  /* ---------------- 剪贴板直达 ---------------- */

  // 监听回调注册一次就不再重注册，所以最新状态经 ref 读取，而不是进依赖数组
  const clipOpenRef = useRef(clipOpen)
  clipOpenRef.current = clipOpen
  const clipStateRef = useRef<{ sheet: SheetName; route: Route | null; ready: boolean }>({
    sheet: 'none',
    route: null,
    ready: false,
  })
  clipStateRef.current = { sheet, route, ready: client !== null }
  const clipSeenRef = useRef('')

  /**
   * 读一眼剪贴板，能认成 GitHub 地址就跳过去。
   *
   * 静默失败：这是锦上添花的入口，读不到（Web 端没有用户手势、系统权限被拒）
   * 就什么都不做，绝不弹错。以下几种情况主动放弃：
   * - 还没解锁（`client` 为空），跳了也没数据；
   * - 有弹层开着，跳转会把弹层顶掉；
   * - 正在编辑文件或 Gist，跳转会冲掉没保存的输入。
   */
  const probeClipboard = useCallback(async () => {
    if (!clipOpenRef.current) return
    const st = clipStateRef.current
    if (!st.ready || st.sheet !== 'none' || clipBlockedByRoute(st.route ?? undefined)) return

    let text = ''
    try {
      const res = await Clipboard.read()
      text = res.value ?? ''
    } catch {
      return
    }
    if (!text) return
    // 令牌、密钥：连指纹都不写。剪贴板里有什么不该在磁盘上留痕
    if (looksSecret(text)) return

    const next = parseClipRoute(text)
    if (!next) return

    const fp = clipFingerprint(text)
    if (fp === clipSeenRef.current) return
    clipSeenRef.current = fp
    void kvRef.current?.set(CLIP_SEEN_KEY, fp)

    const label = clipRouteLabel(next)
    // 已经停在同一页：记下指纹就够了，不再压一条相同路由、也不再提示
    if (st.route && routeKey(st.route) === routeKey(next)) return

    pushTo(next)
    if (label) showToast(`从剪贴板打开 ${label}`)
  }, [pushTo, showToast])

  // 冷启动：客户端一就绪就探一次。不用固定延时 —— 解密保险库要多久取决于设备，
  // 猜一个毫秒数要么早了（client 还没好，探测被跳过）要么晚了（白等一秒多）。
  useEffect(() => {
    if (!client) return
    void probeClipboard()
  }, [client, probeClipboard])

  // 之后每次切回前台再读。Android 10+ 不允许后台应用读剪贴板，
  // 所以「在后台读」实际就是「回前台那一下读」。
  useEffect(() => {
    let disposed = false
    let remove: (() => void) | null = null

    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return
      void probeClipboard()
      // 用户可能刚从系统设置里把通知开关拨开，回来要重新看一眼
      void refreshNotify()
    }).then((handle) => {
      if (disposed) void handle.remove()
      else remove = () => void handle.remove()
    })
    return () => {
      disposed = true
      remove?.()
    }
  }, [probeClipboard, refreshNotify])

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

  /**
   * 页内弹层的返回拦截。
   *
   * 全局返回栈只认识 App 自己管的 sheet；星标文件夹这类「长在某个页面里」的弹层
   * 不在里面，不拦的话按返回会带着面板直接跳页签。子组件开面板时注册一个函数，
   * 关掉时注销 —— 返回键先问它，它说吃掉了就不再往下走。
   */
  const localBackRef = useRef<(() => boolean) | null>(null)
  const registerLocalBack = useCallback((fn: (() => boolean) | null) => {
    localBackRef.current = fn
  }, [])

  const applyBack = useCallback(() => {
    // 软键盘开着时先收键盘，这是安卓上最符合直觉的第一层返回。
    // 但键盘收起后输入框的焦点经常残留 —— 只看 activeElement 是不是 input
    // 会让用户点两下才能退一层，所以用视口高度差确认键盘真的开着
    const el = document.activeElement
    if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      el.blur()
      if (softKeyboardOpen(window.visualViewport?.height ?? window.innerHeight, window.innerHeight)) {
        return
      }
      // 键盘没开，只是焦点残留：收掉焦点，这次返回继续往下走
    }

    if (localBackRef.current?.()) return

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
      // 根层交给浏览器自己处理，别在这里拦出一个"已在首页"的提示；
      // 但页内弹层还开着时不算根层，要先把它收掉
      if (resolveBack(backStateRef.current).kind === 'exit' && !localBackRef.current) return
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

  /*
   * 就绪后主动要一次 insets。
   * 原生侧启动时推了四次，但页面挂载完成的时刻不受它控制；这里补的是「最后一次」，
   * 保证已加载的文档里一定有 --inset-*，顶栏不会被状态栏压住。
   */
  useEffect(() => {
    if (!ready) return
    void syncInsets()
  }, [ready])

  useEffect(() => {
    const t = setTimeout(() => dismissBoot(), 4000)
    return () => clearTimeout(t)
  }, [])

  // 外观与配色一样：首屏内联脚本已经打上 data-*，这里只做挂载后的对齐
  useEffect(() => {
    applyAppearance(appearance)
  }, [appearance])

  /** 字体同理：首屏内联脚本先打上 data-font，这里接管后续切换 */
  useEffect(() => {
    applyFont(fontPref)
  }, [fontPref])

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

  /*
   * 仓库列表的「有 APK / 有 EXE」标记。
   *
   * 列表接口（`/user/repos`）只给仓库元数据，不含发行版资产。逐仓库补一次
   * `/releases` 的代价是「一页 25 个仓库 = 25 次请求」，翻二十页就把 5000/小时
   * 的令牌额度烧光 —— 所以这里先走 GraphQL 批量：25 个别名一个请求（cost 1 点），
   * 只有当前线路不支持 GraphQL 或批量失败时才逐条回落。
   *
   * 另外两层节省不变：结果存 24 小时（含「确实没有包」的空结果，否则空仓库
   * 每次进列表都会被重问一遍）；游客完全不查 —— 匿名 60 次/小时，一页就吃光。
   */
  useEffect(() => {
    if (tab !== 'repos' || !client || !activeId) return
    const names = repos.map((r) => r.full_name).filter(Boolean)
    if (names.length === 0) return

    const todo: string[] = []
    for (const name of names) {
      const k = `${activeId}:${name}`
      if (probedRef.current.has(k)) continue
      probedRef.current.add(k)
      todo.push(name)
    }
    if (todo.length === 0) return

    let alive = true
    void (async () => {
      // 先把本地 24 小时内的结果贴上去，剩下的才发请求
      const cached = await readCachedBadges(kvRef.current, activeId, todo)
      if (!alive) return
      if (Object.keys(cached).length > 0) setPkgBadges((prev) => ({ ...prev, ...cached }))

      const miss = todo.filter((n) => !(n in cached))
      if (miss.length === 0) return

      // 一次问回来。空结果也要写缓存 —— 「这个仓库没有安装包」同样是有用的结论
      const batch = await queryRepoPkgs(client, miss)
      if (!alive) return
      if (Object.keys(batch.ok).length > 0) {
        await saveBadges(kvRef.current, activeId, batch.ok)
        if (!alive) return
        const shown: Record<string, PkgKind[]> = {}
        for (const [full, kinds] of Object.entries(batch.ok)) {
          if (kinds.length > 0) shown[full] = kinds
        }
        if (Object.keys(shown).length > 0) setPkgBadges((prev) => ({ ...prev, ...shown }))
      }

      // 批量没问到的（镜像站没有 /graphql、限流、结构异常）才逐条补
      if (batch.failed.length === 0) return
      await runBadgeQueue({
        names: batch.failed,
        probe: async (fullName) => {
          const [owner, name] = fullName.split('/')
          if (!owner || !name) return null
          return loadBadges({
            kv: kvRef.current,
            tokenId: activeId,
            fullName,
            fetchReleases: async () => {
              const { data } = await client.listReleases(owner, name, 1, BADGE_RELEASE_PAGE)
              return data
            },
          })
        },
        onEach: (fullName, kinds) => {
          if (!kinds || kinds.length === 0) return
          setPkgBadges((prev) => ({ ...prev, [fullName]: kinds }))
        },
        isAlive: () => alive,
      })
    })()

    return () => {
      alive = false
    }
  }, [tab, client, activeId, repos])

  function changeTheme(pref: ThemePref) {
    writeThemePref(pref)
    setThemePref(pref)
    if (pref === 'system') {
      showToast(`已跟随系统 · 当前${resolveTheme('system') === 'dark' ? '深色' : '浅色'}`)
    } else {
      showToast(pref === 'dark' ? '已切换深色' : '已切换浅色')
    }
  }

  function changeFont(pref: FontPref) {
    writeFontPref(pref)
    setFontPref(pref)
    showToast(pref === 'sans' ? '字体：OPPO Sans' : '字体：跟随手机系统')
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
    // 每次拉取领一个号：切账号、连点刷新都会让旧的那次作废，
    // 否则 A 的 6 页回来时会把 B 的列表覆盖掉
    const seq = ++loadSeq.current
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
      if (seq !== loadSeq.current) return
      setRepos(acc)
      setSnapshotAt(null)
      setRepoError(null)
      if (kvRef.current && tokenId) {
        void saveSnapshot(kvRef.current, 'repos', tokenId, acc)
      }
    } catch (err) {
      if (seq !== loadSeq.current) return
      setRepoError((err as Error).message)
    } finally {
      if (seq === loadSeq.current) setLoadingRepos(false)
    }
  }, [])

  /**
   * 按账号 id 拿客户端，没有就现建。
   *
   * 切账号那条路径只会用到「当前账号」，多账号批量动作却要在不切换的前提下
   * 借别的账号的令牌，所以把这段抽出来共用。
   */
  const ensureClient = useCallback(
    async (id: string, list?: TokenRecord[]): Promise<GitHubClient | null> => {
      const v = vaultRef.current
      if (!v) return null
      const rec = (list ?? records).find((r) => r.id === id)
      if (!rec) return null
      // 同一账号复用同一个客户端：请求缓存挂在实例上，切回来不用重新打网络。
      // 但地址被改过（镜像面板 / 备份恢复）就得重建 —— 否则会拿着旧域名的实例一直请求。
      const wantBase = (rec.baseUrl || baseUrl).replace(/\/+$/, '')
      let c: GitHubClient | undefined = clientsRef.current[id]
      if (c && c.baseUrl !== wantBase) c = undefined
      if (!c) {
        const secret = await v.secret(id)
        c = new GitHubClient({ token: secret, baseUrl: rec.baseUrl || baseUrl })
        clientsRef.current[id] = c
      }
      return c
    },
    [records, baseUrl],
  )

  const activate = useCallback(
    async (id: string, list?: TokenRecord[]) => {
      const v = vaultRef.current
      if (!v) return
      const source = list ?? records
      const rec = source.find((r) => r.id === id)
      if (!rec) return
      // 切走之前先把当前账号的现场存下来：内存一份（切回即用），磁盘一份（重启还在）
      const prevId = activeIdRef.current
      if (prevId && prevId !== id) {
        wsRef.current = saveWorkspace(wsRef.current, prevId, liveRef.current)
        const prevWs = wsRef.current[prevId]
        if (prevWs) void persistWorkspace(kvRef.current, prevId, prevWs)
      }

      const c = await ensureClient(id, source)
      if (!c) return
      setClient(c)
      setActiveId(id)
      activeIdRef.current = id
      // 选择态、子面板这些是「当前这一刻的操作」，不跟着账号走
      setSelected(new Set())
      // 本次会话里点过星标的仓库属于上一个账号：不清掉的话，B 的列表里
      // A 点过的仓库仍显示实心星，点一下还会被当成「取消 B 的 star」
      setStarredSet(new Set())
      setSelectMode(false)
      setPipelineRepo(null)
      setDetailRepo(null)
      setSheet('none')
      setRepoError(null)

      // 恢复目标账号的现场：先看内存（刚切走那份），再看磁盘（上次关 App 前那份）
      const cached = restoreWorkspace(wsRef.current, id)
      const fromDisk =
        cached || !acctPrefRef.current.keepWorkspace ? null : await loadWorkspace(kvRef.current, id)
      const saved = cached ?? fromDisk
      // 从磁盘捞回来的填进内存表，后面切走时才有东西可存
      if (!cached && fromDisk) wsRef.current = saveWorkspace(wsRef.current, id, fromDisk)
      // 关掉「保留现场」就每次都回首页，只保留列表与筛选（不保留栈）
      setRouteStack(saved && acctPrefRef.current.keepWorkspace ? saved.routeStack : [])
      setQuery(saved?.query ?? '')
      setVisibility(saved?.visibility ?? 'all')
      setSort(saved?.sort ?? DEFAULT_SORT)
      setUnread(saved?.unread ?? 0)

      const kv = kvRef.current
      if (saved) {
        setPins(saved.pins)
        setRepos(saved.repos)
        setSnapshotAt(saved.snapshotAt)
      } else {
        setRepos([])
        setSnapshotAt(null)
        setPins(kv ? parsePins(await kv.get(pinKey(id))) : [])
        // 冷启动时先拿本地快照顶上，界面立刻有内容；网络请求放后台跑，
        // 否则要等全部页回来才能看到第一屏
        const snap: Snapshot<Repo[]> | null = kv
          ? ((await loadSnapshot<Repo[]>(kv, 'repos', id)) as Snapshot<Repo[]> | null)
          : null
        if (snap) {
          setRepos(snap.data)
          setSnapshotAt(snap.at)
          setLoadingRepos(true)
        }
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
    [records, baseUrl, loadRepos, refreshAudit, ensureClient],
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
      showToast(rec ? `${switchMessage(buildAccounts([rec], id)[0])} · 上次的位置还在` : '已切换账号')
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
        const savedRestored = await kv.get(MIRROR_RESTORED_KEY)
        if (cancelled) return

        // 先恢复站点表再谈「当前用哪台」：改过地址的站点必须先进注册表，
        // 后面的 mirrorDefFor / githubUrlAt 才知道新域名该走哪种路径风格。
        //
        // v1.1.3 起包里不再预置加速站。老版本的加速站是写在包里的常量、从不落盘，
        // 所以升级时要从**本机已有的两份记录**里把地址认回来：当前选中（ghx.mirror）
        // 和上次测速快照（ghx.mirror.speed 的 results）。这样从没动过设置的用户
        // 升级后站点表也还在；新装机这两个键都不存在，结果仍是只有官方直连。
        //
        // 只接一次（MIRROR_RESTORED_KEY）：否则用户删掉某个站，下次启动又被补回来。
        const parsedStore = parseMirrorStore(savedMirrorStore)
        let nextStore = parsedStore
        let nextMirror = normalizeBase(savedMirror ?? '') || DEFAULT_MIRROR
        if (savedRestored !== '1') {
          const snap = parseSnapshot(savedSpeed)
          const mig = migrateLegacyMirrorStore(parsedStore, {
            selected: savedMirror,
            probed: (snap?.results ?? []).map((r) => r.base),
          })
          nextStore = mig.store
          nextMirror = mig.selected
          void kv.set(MIRROR_RESTORED_KEY, '1')
          if (mig.changed) {
            void kv.set(MIRROR_STORE_KEY, serializeMirrorStore(mig.store))
            void kv.set(MIRROR_KEY, mig.selected)
          }
        }
        setMirrorStore(nextStore)
        setMirrorRegistry(effectiveMirrors(nextStore))
        setMirror(nextMirror)

        // 下载方式：默认交给浏览器。老版本没这个键，解析成 outer。
        const savedDownloadMode = await kv.get(DOWNLOAD_MODE_KEY)
        if (cancelled) return
        setDownloadMode(parseDownloadMode(savedDownloadMode))

        // 账号偏好：默认「切回时接着上次看」，老版本没有这个键
        const savedAcctPref = await kv.get(ACCOUNT_PREF_KEY)
        if (cancelled) return
        setAcctPref(parseAccountPref(savedAcctPref))

        // 主密钥查看密码是否设过：只影响密钥面板的文案与流程
        const reveal = await hasRevealPass(kv)
        if (cancelled) return
        setRevealSet(reveal)

        // 分片下载：老版本没有这个键，按「开」处理
        const savedDlParts = await kv.get(DL_PARTS_KEY)
        if (cancelled) return
        setDlParts(parseDlParts(savedDlParts))

        // 剪贴板直达：老版本没有这个键，解析成「开」
        const savedClipOpen = await kv.get(CLIP_OPEN_KEY)
        if (cancelled) return
        setClipOpen(parseClipOpen(savedClipOpen))
        // 上次处理过的那条，重启后不该再跳一次
        const savedClipSeen = await kv.get(CLIP_SEEN_KEY)
        if (cancelled) return
        clipSeenRef.current = savedClipSeen ?? ''

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

  async function addToken(input: {
    name: string
    secret: string
    secondary: string | null
    expiresAt: string | null
  }) {
    const v = vaultRef.current
    if (!v) return
    setAddBusy(true)
    setAddError(null)
    try {
      const rec = await v.add({
        name: input.name,
        secret: input.secret,
        secondary: input.secondary,
        expiresAt: input.expiresAt,
        baseUrl,
      })
      const list = await v.list()
      setRecords(list)
      setSheet('none')
      if (kvRef.current) {
        await appendAudit(kvRef.current, {
          action: 'token-add',
          target: rec.name,
          result: 'ok',
          detail: rec.hasSecondary ? `${rec.preview} · 含副密钥` : rec.preview,
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

  /**
   * 把内存里的多账号现场全部丢掉。
   * 锁定与删号都要走这里 —— 承诺过「锁定后数据从内存清除」，
   * 客户端实例里存着解密后的令牌，留着就等于没清。
   */
  function wipeWorkspaces(only?: string) {
    if (only) {
      delete clientsRef.current[only]
      wsRef.current = dropWorkspace(wsRef.current, only)
      return
    }
    clientsRef.current = {}
    wsRef.current = dropWorkspace(wsRef.current)
    activeIdRef.current = null
    // 让在飞的列表请求作废，避免锁定后又把数据写回内存
    loadSeq.current += 1
  }

  async function removeToken(id: string) {
    const v = vaultRef.current
    if (!v) return
    const rec = records.find((r) => r.id === id)
    await v.remove(id)
    await dropWorkspaceKV(kvRef.current, id)
    // 账号删了，它名下的热门快照与筛选也一起清掉，别留明文仓库名在设备上
    void clearHotCache(kvRef.current, id)
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
    wipeWorkspaces(id)
    if (activeId === id) {
      setActiveId(null)
      setClient(null)
      setRepos([])
      setRouteStack([])
      setPins([])
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

  /* ── 主 / 副密钥 ───────────────────────────────────────────────── */

  /** 正在查看密钥的那条记录；删号后可能瞬间为 null，面板要能自己收起来 */
  const secretRecord = records.find((r) => r.id === secretId) ?? null

  function openSecret(id: string) {
    setSecretId(id)
    setSheet('secret')
  }

  async function readSecondary(id: string): Promise<string | null> {
    const v = vaultRef.current
    if (!v) return null
    try {
      return await v.secondarySecret(id)
    } catch {
      return null
    }
  }

  async function writeSecondary(id: string, secret: string | null): Promise<void> {
    const v = vaultRef.current
    if (!v) throw new Error('保险库未解锁')
    const updated = await v.setSecondary(id, secret)
    setRecords((prev) => prev.map((r) => (r.id === id ? updated : r)))
    const kv = kvRef.current
    if (kv) {
      await appendAudit(kv, {
        action: 'token-edit',
        target: updated.name,
        result: 'ok',
        detail: secret ? `已设置副密钥 ${updated.secondaryPreview ?? ''}` : '已清除副密钥',
      })
      await refreshAudit()
    }
  }

  /** 主密钥必须过闸门才交给界面：开了启动验证就验口令，否则验本机查看密码 */
  async function checkReveal(kind: 'vault' | 'reveal', pass: string): Promise<boolean> {
    const v = vaultRef.current
    if (kind === 'reveal') return checkRevealPass(kvRef.current, pass)
    if (!v) return false
    try {
      await v.verifyPassphrase(pass)
      return true
    } catch {
      return false
    }
  }

  async function applyRevealPass(next: string) {
    setRevealBusy(true)
    setRevealError(null)
    try {
      await setRevealPass(kvRef.current, next)
      setRevealSet(true)
      setSheet('none')
      showToast('查看密码已保存')
    } catch (err) {
      setRevealError((err as Error).message)
    } finally {
      setRevealBusy(false)
    }
  }

  async function dropRevealPass() {
    setRevealBusy(true)
    setRevealError(null)
    try {
      await clearRevealPass(kvRef.current)
      setRevealSet(false)
      setSheet('none')
      showToast('查看密码已清除，主密钥回到「点开即看」')
    } catch (err) {
      setRevealError((err as Error).message)
    } finally {
      setRevealBusy(false)
    }
  }

  /* ── 备份与恢复 ───────────────────────────────────────────────── */

  /**
   * 组装备份。
   *
   * 密钥只在这里短暂出现：从保险库解出来，立刻用导出密码封进 sealed，
   * 中间结果不回传给 React 状态，也不写日志。
   */
  async function buildBackupText(o: { withSecrets: boolean; passphrase: string }) {
    const v = vaultRef.current
    if (!v) throw new Error('保险库未解锁，先解锁再导出')
    const kv = kvRef.current
    const settings = await readSettings(kv)

    const accounts: BackupAccount[] = []
    for (const rec of records) {
      const own = kv ? parsePins(await kv.get(pinKey(rec.id))) : []
      accounts.push({
        id: rec.id,
        name: rec.name,
        login: rec.login ?? null,
        preview: rec.preview,
        kind: rec.kind,
        scopes: rec.scopes,
        expiresAt: rec.expiresAt ?? null,
        baseUrl: rec.baseUrl,
        avatarUrl: rec.avatarUrl ?? null,
        pins: own,
      })
    }

    let sealed: SealedSecrets | null = null
    if (o.withSecrets) {
      const all = await v.allSecrets()
      const map: Record<string, BackupSecretEntry> = {}
      for (const [id, entry] of Object.entries(all)) map[id] = entry
      if (Object.keys(map).length > 0) sealed = await sealSecrets(o.passphrase, map)
    }

    const me = records.find((r) => r.id === activeId) ?? null
    const file = buildBackup({
      appVersion: APP_VERSION,
      account: { login: me?.login ?? null, name: me?.name ?? null },
      settings,
      accounts,
      sealed,
    })
    const fileName = backupFileName({ login: me?.login, name: me?.name })
    return { fileName, text: serializeBackup(file) }
  }

  /**
   * 写回备份。
   *
   * 只添加、不删除：
   * - 账号按「登录名 + 指纹」去重，已经有的跳过；
   * - 没有密钥的账号跳过（只有元数据的账号切过去也拿不到仓库，加了等于挖坑）；
   * - 设置按面板选的合并/覆盖写，写不到也不报错。
   * 最后重载一次页面 —— 主题、字体、底栏这些都从存储里重建，比逐个 setState 可靠。
   */
  async function restoreBackup(o: {
    text: string
    passphrase: string
    mode: RestoreMode
  }): Promise<string> {
    const parsed = parseBackup(o.text)
    if (!parsed.ok) throw new Error(parsed.error)
    const v = vaultRef.current
    if (!v) throw new Error('保险库未解锁')
    const kv = kvRef.current

    let secrets: Record<string, BackupSecretEntry> = {}
    if (parsed.file.sealed) {
      if (!o.passphrase) throw new Error('这份备份带着密钥，需要导出时设的密码')
      secrets = await openSecrets(o.passphrase, parsed.file.sealed)
    }

    const { written, kept } = await applySettings(kv, parsed.file.settings, o.mode)

    const fresh = newAccounts(parsed.file.accounts, records)
    let added = 0
    let missing = 0
    for (const a of fresh) {
      const entry = a.id ? secrets[a.id] : undefined
      if (!entry || !entry.secret) {
        missing += 1
        continue
      }
      try {
        const rec = await v.restore({
          name: a.name,
          secret: entry.secret,
          secondary: entry.secondary ?? null,
          login: a.login,
          avatarUrl: a.avatarUrl ?? null,
          scopes: a.scopes,
          expiresAt: a.expiresAt,
          baseUrl: a.baseUrl,
        })
        added += 1
        if (kv && a.pins && a.pins.length > 0) {
          const existed = parsePins(await kv.get(pinKey(rec.id)))
          await kv.set(pinKey(rec.id), serializePins(mergePins(existed, a.pins)))
        }
      } catch {
        missing += 1
      }
    }

    if (added > 0) {
      const list = await v.list()
      setRecords(list)
    }
    if (kv) {
      await appendAudit(kv, {
        action: 'backup',
        target: '恢复备份',
        result: 'ok',
        detail: `设置 ${written} 项 · 新增 ${added} 个账号${missing > 0 ? ` · ${missing} 个缺少密钥` : ''}`,
      })
      await refreshAudit()
    }

    const parts = [`设置写回 ${written} 项`]
    if (kept > 0) parts.push(`保留本机 ${kept} 项`)
    if (added > 0) parts.push(`新增 ${added} 个账号`)
    if (missing > 0) parts.push(`${missing} 个账号没有密钥，跳过`)

    // 设置已经落到存储里：重载一次让主题、字体、底栏全部按新值重建
    globalThis.setTimeout(() => {
      try {
        globalThis.location?.reload?.()
      } catch {
        /* 重载失败也不影响已写入的数据 */
      }
    }, 1400)

    return `${parts.join(' · ')}，即将重载`
  }

  function toggleSelect(repo: Repo) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(repo.full_name)) next.delete(repo.full_name)
      else next.add(repo.full_name)
      return next
    })
  }

  function startBatchAction(action: BatchAction) {
    const chosen = repos.filter((r) => selected.has(r.full_name))
    if (chosen.length === 0) return
    const items = planBatch(chosen, action)
    if (items.length === 0) return
    const title =
      action.kind === 'visibility'
        ? `修改可见度 · ${action.to === 'private' ? '转私有' : '转公开'}`
        : action.kind === 'archive'
          ? '归档仓库'
          : action.kind === 'unarchive'
            ? '取消归档'
            : '加话题'
    setBatchTitle(title)
    setPlan(items)
    setResults([])
    setDone(0)
    setCurrent(null)
    setPhase('confirm')
    setSheet('visibility')
  }

  async function confirmBatch() {
    if (!client) return
    setPhase('running')
    const action = plan[0]?.action
    const res = await runBatchActions(client, plan, {
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
      const auditAction =
        action?.kind === 'archive' || action?.kind === 'unarchive'
          ? 'repo-archive'
          : action?.kind === 'topics'
            ? 'repo-edit'
            : 'visibility'
      for (const r of res) {
        await appendAudit(kv, {
          action: auditAction,
          target: r.repo,
          result: r.status === 'ok' ? 'ok' : 'failed',
          detail: r.message ?? batchTitle,
        })
      }
      await refreshAudit()
    }

    // 本地只改能确定的那几个字段；话题不回写（列表接口本来也不返回 topics）
    setRepos((prev) =>
      prev.map((r) => {
        const hit = plan.find((it) => it.repo.full_name === r.full_name)
        const ok = res.find((x) => x.repo === r.full_name && x.status === 'ok')
        if (!hit || !ok || hit.skip) return r
        if (hit.action.kind === 'visibility') {
          return { ...r, private: hit.action.to === 'private', visibility: hit.action.to }
        }
        if (hit.action.kind === 'archive') return { ...r, archived: true }
        if (hit.action.kind === 'unarchive') return { ...r, archived: false }
        return r
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
    // 客户端实例按账号缓存（ensureClient）。换地址后必须把这台也换掉，
    // 否则切走再切回来时 ensureClient 又会把旧地址的实例交出去。
    clientsRef.current[activeId] = c
    setClient(c)
    await loadRepos(c, activeId)
    showToast('已切换 API 地址')
  }

  const runCheck = useCallback(
    async (open: boolean, channel?: UpdateChannel) => {
      if (open) setSheet('update')
      setUpdatePhase('checking')
      setUpdateError(null)
      // 切换通道后要立刻用新通道重查，所以允许调用方显式指定，避免读到旧 state
      const ch: UpdateChannel = channel ?? (updateMode === 'beta' ? 'beta' : 'stable')
      const { result, error } = await checkForUpdate({ mirror, current: APP_VERSION, channel: ch })
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
    [mirror, updateMode],
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

  // 解锁后静默查一次：有新版本只在列表顶部提示，不打断使用。
  // 关掉「更新提示」就一次都不查 —— 省请求，也省掉那个红点。
  useEffect(() => {
    if (!unlocked || silentChecked.current) return
    if (!updateModeEnabled(updateMode)) {
      setUpdatePhase((cur) => (cur === 'checking' ? 'latest' : cur))
      return
    }
    silentChecked.current = true
    void runCheck(false)
  }, [unlocked, runCheck, updateMode])

  /**
   * 切换「更新提示」：正式版 / 测试版 / 关掉。
   *
   * 关掉时顺手把结果清空：红点/横幅的数据源就是它，不清会留一条旧提示在界面上。
   * 换通道时立刻用新通道重查一次 —— 否则用户点了「测试版」还看着正式版的结果，
   * 会以为没生效。
   */
  const changeUpdateMode = useCallback(
    (mode: UpdateMode) => {
      setUpdateMode(mode)
      writeUpdateMode(mode)
      if (mode === 'off') {
        setUpdateResult(null)
        setUpdateError(null)
        setUpdatePhase('latest')
        return
      }
      setUpdateResult(null)
      // 这次就算「已经静默查过」了：否则 updateMode 变化会再触发启动副作用，
      // 一次切换发出两三个请求，白白消耗 API 配额
      silentChecked.current = true
      void runCheck(false, mode)
    },
    [runCheck],
  )

  /** 账号偏好落盘：只影响下次切号怎么恢复，不动当前页面 */
  const changeAcctPref = useCallback((next: AccountPref) => {
    const prev = acctPrefRef.current
    acctPrefRef.current = next
    setAcctPref(next)
    void writeAccountPref(kvRef.current, next)
    if (next.keepWorkspace !== prev.keepWorkspace) {
      showToast(next.keepWorkspace ? '切回账号会接着上次看' : '切回账号会回到首页')
      return
    }
    showToast(
      next.multiCount === 0
        ? 'Star / 复刻默认勾全部账号'
        : `Star / 复刻默认勾 ${next.multiCount} 个账号`,
    )
  }, [showToast])

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

  /**
   * 打开统一下载面板。
   *
   * 更新包、发行版附件、源码 ZIP 都从这里进 —— 「从哪进来」决定关掉之后回哪，
   * 但面板本身只有一套：线路表、测速、进度、安装器。
   */
  const openDownload = useCallback((target: DownloadTarget, from: SheetName) => {
    setDownloadTarget(target)
    setDownloadReturn(from)
    setSheet('download')
  }, [])

  /**
   * 打开下载记录。
   *
   * 每次打开都重读 localStorage —— 记录是在下载面板里写的，那边写完
   * 不一定有机会回调到这里，重读一次比维护跨组件状态简单可靠。
   * 顺带问一次原生「这些文件还在不在」：清过 App 存储后路径会指空。
   */
  const openDlHistory = useCallback(async () => {
    const list = readHistory()
    setDlHistory(list)
    setSheet('dlHistory')
    const paths = list.map((r) => r.path).filter((v): v is string => !!v)
    if (paths.length === 0) return
    const map = await filesExist(paths)
    setDlExists(map)
  }, [])

  // 面板关掉之后回到设置页，条数要跟着变
  useEffect(() => {
    setDlHistory(readHistory())
  }, [sheet])

  /**
   * 启动时补一条：上次的下载是在「界面已经没了」的情况下结束的
   * （用户退出了 App、或 WebView 被系统回收），记录没人写，原生替我们留着。
   */
  useEffect(() => {
    void (async () => {
      const pend = await takePendingDownload()
      if (!pend) return
      appendRecord(recordFromPending(pend))
      setDlHistory(readHistory())
    })()
  }, [])

  const changeDownloadMode = useCallback(
    (mode: DownloadMode) => {
      setDownloadMode(mode)
      if (kvRef.current) void kvRef.current.set(DOWNLOAD_MODE_KEY, serializeDownloadMode(mode))
      showToast(mode === 'inner' ? '已改为应用内下载' : '已改为交给浏览器下载')
    },
    [showToast],
  )

  const changeDlParts = useCallback(
    (v: DlParts) => {
      setDlParts(v)
      if (kvRef.current) void kvRef.current.set(DL_PARTS_KEY, serializeDlParts(v))
      showToast(v === 'single' ? '已改为单线程下载' : `下载会切 ${PARTS_OF[v]} 路并行` )
    },
    [showToast],
  )

  const changeClipOpen = useCallback(
    (on: boolean) => {
      setClipOpen(on)
      clipOpenRef.current = on
      if (kvRef.current) void kvRef.current.set(CLIP_OPEN_KEY, serializeClipOpen(on))
      showToast(on ? '切回 App 时会读取剪贴板' : '已关闭剪贴板直达')
    },
    [showToast],
  )

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
      setCompose({
        mode,
        owner,
        repo,
        branches: [base],
        base,
        templates: [],
        templatesLoading: mode === 'issue',
        prTemplate: null,
      })
      setSheet('compose')
      if (!client) return

      // 模板单独读：目录不存在、没权限、单个文件写坏，都不该影响「新建」本身
      const stillOpen = (cur: typeof compose) => !!cur && cur.owner === owner && cur.repo === repo
      if (mode === 'issue') {
        void listIssueTemplates(client, owner, repo).then(({ templates }) => {
          setCompose((cur) => (stillOpen(cur) ? { ...cur!, templates, templatesLoading: false } : cur))
        })
      } else {
        void findPrTemplate(client, owner, repo).then((tpl) => {
          setCompose((cur) => (stillOpen(cur) ? { ...cur!, prTemplate: tpl } : cur))
        })
      }

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

  async function submitCompose(input: ComposeSubmit) {
    if (!compose || !client) return
    setComposeBusy(true)
    setComposeError(null)
    try {
      if (compose.mode === 'issue') {
        const labels = input.labels ?? []
        let issue
        try {
          issue = await createIssue(client, compose.owner, compose.repo, {
            title: input.title,
            body: input.body,
            ...(labels.length > 0 ? { labels } : {}),
          })
        } catch (err) {
          // 模板里的标签在仓库里不存在时 GitHub 回 422，去掉标签再建一次，
          // 不要因为「标签没对上」让人白写一篇。
          if (labels.length > 0 && err instanceof GitHubError && err.status === 422) {
            issue = await createIssue(client, compose.owner, compose.repo, {
              title: input.title,
              body: input.body,
            })
            showToast('模板标签在这个仓库不存在，已按无标签创建')
          } else {
            throw err
          }
        }
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

      /*
       * 从旧版本继承来的站只记了地址、没记风格。主拼法按 path 猜，猜错时再试
       * 一次 url 拼法 —— 否则这类站测速永远是 0，用户以为站废了。
       */
      const altFor = (b: string) =>
        mirrorKnown(b) ? '' : `${b}/${urlFor('https://github.com')}`

      setProbe({ running: true, done: 0, total: bases.length, results: [], error: null, light, at: null })
      const results = await probeAll(bases, urlFor, {
        altFor,
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

  // ── 多账号批量动作（状态声明在返回键快照之前，见顶部） ───────────
  const multiAccounts = useMemo<MultiAccount[]>(
    () =>
      buildAccounts(records, activeId).map((a) => ({
        id: a.id,
        label: a.label,
        login: a.login,
        avatarUrl: a.avatarUrl,
      })),
    [records, activeId],
  )

  const multiTasks = useMemo(
    () => (multiKind ? planMultiTasks(multiAccounts, multiKind, multiStates) : []),
    [multiKind, multiAccounts, multiStates],
  )

  const openMulti = useCallback(
    async (kind: MultiKind, repoArg?: Repo) => {
      const repo = repoArg ?? detailRepo
      if (!repo || multiAccounts.length < 2) return
      // 从列表星标直接进来的：顺手把详情目标换成这个仓库，
      // 面板关掉后落在它的详情页，而不是上一次看过的那一个
      if (repoArg) setDetailRepo(repoArg)
      setMultiReturn(sheet === 'forks' ? 'forks' : 'detail')
      setMultiKind(kind)
      setMultiResults(null)
      setMultiSel(new Set())
      setMultiStates({})
      setMultiLoading(true)
      setSheet('multi')
      try {
        const states: Record<string, AccountState> = {}
        if (kind === 'fork') {
          // 复刻列表是公共数据，用当前账号取一次就够，不必每个账号各查一遍
          let owners = new Set<string>()
          if (client) {
            try {
              const { data } = await client.listForks(repo.owner, repo.name, 1, 100, true)
              owners = forkOwners(data)
            } catch {
              /* 取不到就按「都没复刻」处理；真重复了 GitHub 会返回已有仓库，不会出错 */
            }
          }
          for (const a of multiAccounts) {
            states[a.id] = { forked: a.login ? owners.has(a.login.toLowerCase()) : null }
          }
        } else {
          // star 状态是「按账号」的，只能逐个查；一个账号失败不影响其它账号
          const settled = await Promise.allSettled(
            multiAccounts.map(async (a) => {
              const c = await ensureClient(a.id)
              if (!c) return { id: a.id, starred: null as boolean | null }
              return { id: a.id, starred: await c.isStarred(repo.owner, repo.name) }
            }),
          )
          for (const s of settled) {
            if (s.status === 'fulfilled') states[s.value.id] = { starred: s.value.starred }
          }
        }
        setMultiStates(states)
        // 默认勾几个由「多账号偏好」定：0 全部、1/2/3 取前几个（当前账号永远第一）
        setMultiSel(
          defaultSelection(planMultiTasks(multiAccounts, kind, states), acctPrefRef.current.multiCount),
        )
      } finally {
        setMultiLoading(false)
      }
    },
    [detailRepo, multiAccounts, client, ensureClient, sheet],
  )

  /**
   * 列表行内的星标。
   *
   * 单账号：直接 PUT/DELETE，乐观更新那一行的星标；多账号：开面板让用户确认
   * 要对几个账号动手（默认勾选数来自设置里的偏好）。
   */
  const quickStar = useCallback(
    async (r: Repo) => {
      const on = starredSet.has(r.full_name)
      if (multiAccounts.length > 1) {
        void openMulti(on ? 'unstar' : 'star', r)
        return
      }
      if (!client) {
        showToast('未连接令牌')
        return
      }
      try {
        await client.setStarred(r.owner, r.name, !on)
        setStarredSet((prev) => {
          const next = new Set(prev)
          if (on) next.delete(r.full_name)
          else next.add(r.full_name)
          return next
        })
        showToast(on ? '已取消 star' : '已 star')
        setStarTick((v) => v + 1)
      } catch (e) {
        showToast((e as Error).message)
      }
    },
    [starredSet, multiAccounts.length, client, openMulti, showToast],
  )

  const runMulti = useCallback(async () => {
    const kind = multiKind
    const repo = detailRepo
    if (!kind || !repo || multiRunning) return
    const picked = multiAccounts.filter((a) => multiSel.has(a.id))
    if (picked.length === 0) return

    const tasks = planMultiTasks(picked, kind, multiStates)
    setMultiRunning(true)
    setMultiResults([])
    const collected: MultiResult[] = []
    const results = await runMultiTasks(
      tasks,
      async (t) => {
        const c = await ensureClient(t.id)
        if (!c) throw new Error('令牌不可用')
        if (t.kind === 'fork') await c.createFork(repo.owner, repo.name)
        else await c.setStarred(repo.owner, repo.name, t.kind === 'star')
      },
      {
        onDone: (r) => {
          collected.push(r)
          setMultiResults([...collected])
        },
      },
    )
    setMultiRunning(false)

    const done = results.filter((r) => r.ok && !r.skipped)
    if (done.length > 0) {
      await logAudit(
        kind === 'fork' ? 'fork' : 'repo-star',
        repo.full_name,
        `${summarize(results, kind)}（${done.map((r) => r.label).join('、')}）`,
      )
    }
    showToast(summarize(results, kind))
    if (kind === 'fork') setForkTick((v) => v + 1)
    else setStarTick((v) => v + 1)
  }, [
    multiKind,
    detailRepo,
    multiRunning,
    multiAccounts,
    multiSel,
    multiStates,
    ensureClient,
    logAudit,
    showToast,
  ])

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
    wipeWorkspaces()
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

  /**
   * 当前现场的快照，每次渲染同步一次。
   * activate 是 useCallback，直接依赖这七八个 state 会让它每改一个字就重建，
   * 用 ref 读即时值更省事，也不会拿到过期闭包。
   */
  const liveRef = useRef<Workspace>(emptyWorkspace(DEFAULT_SORT))
  liveRef.current = { routeStack, repos, snapshotAt, query, visibility, sort, unread, pins }

  const counts = useMemo(() => {
    const c = countBy(repos)
    return { total: c.total, public: c.public, private: c.private, archived: c.archived, live: c.live }
  }, [repos])

  const filtered = useMemo(
    () =>
      applyPins(
        sortRepos(filterRepos(repos, { query, visibility }), sort),
        pins,
      ),
    [repos, query, visibility, sort, pins],
  )

  /** 钉/取消钉。纯本地，不碰接口，所以立即生效、失败也没得失败 */
  const toggleRepoPin = useCallback(
    async (full: string) => {
      const next = togglePin(pins, full)
      if (next === pins) {
        showToast(`最多置顶 60 个仓库，先取消几个再钉`)
        return
      }
      setPins(next)
      const kv = kvRef.current
      // 置顶是纯本地的界面偏好，不写审计：它一天能点十几次，会把真正的写操作淹掉
      if (kv && activeId) await kv.set(pinKey(activeId), serializePins(next))
      showToast(isPinned(next, full) ? `已置顶 ${full}` : `已取消置顶 ${full}`)
    },
    [pins, activeId],
  )

  /**
   * 打开数据看板。
   *
   * 看板是底栏页签，不是路由 —— 这样它和仓库/星标/热门是同一层，
   * 侧滑返回与底栏高亮都不用另写一套。从个人页进来时先弹掉路由栈那一层。
   */
  const openDashboard = useCallback(() => {
    setTabs((prev) => {
      if (prev.includes('dashboard')) return prev
      const next = TAB_DEFS.map((t) => t.key).filter(
        (k) => k === 'dashboard' || prev.includes(k),
      ) as TabKey[]
      if (kvRef.current) void kvRef.current.set(TABS_KEY, JSON.stringify(next))
      return next
    })
    setRouteStack([])
    setSheet('none')
    setTab('dashboard')
  }, [])

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
    <AuthImageProvider client={client}>
    <div className={route ? 'app' : 'app with-tabs'}>
      {/*
        页面区套一层错误边界，底栏留在外面：某个页面因为脏数据崩掉时，
        导航还在，用户能退出去，而不是整屏白掉只能杀进程。
        切路由或切页签都会换 resetKey，错误状态自动清空。
      */}
      <Boundary
        resetKey={route ? routeKey(route) : `tab:${tab}`}
        onBack={route ? popTo : undefined}
      >
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
          updateBeta={!!updateResult?.info?.prerelease}
          onOpenUpdate={() => void runCheck(true)}
          sort={sort}
          onOpenSort={() => setSheet('sort')}
          snapshotAt={snapshotAt}
          pins={pins}
          onTogglePin={(r) => void toggleRepoPin(r.full_name)}
          pkgBadges={pkgBadges}
          starred={starredSet}
          onStar={(r) => void quickStar(r)}
          dl={bgDl}
          onOpenDownload={() => {
            if (downloadTarget) {
              setSheet('download')
              return
            }
            setSheet('dlHistory')
            showToast('下载在后台进行，完成后会出现在这里')
          }}
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
          accountId={activeRecord?.id ?? null}
          registerBack={registerLocalBack}
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

      {!route && tab === 'dashboard' && (
        <DashboardPage
          client={client}
          login={activeRecord?.login ?? null}
          isSelf
          onOpenRepo={(full) => {
            const [owner, repo] = full.split('/')
            if (!owner || !repo) return
            pushTo({ kind: 'repo', owner, repo, tab: 'code' })
          }}
          onOpenArchived={() => {
            setTab('repos')
            setVisibility('archived')
            showToast('已切到归档仓库')
          }}
        />
      )}

      {!route && tab === 'hot' && (
        <HotPage
          client={client ?? guestClient}
          readOnly={!client}
          kv={kvRef.current}
          tokenId={activeId ?? GUEST_ID}
          descOpts={descOpts}
          onOpenRepo={(r) => {
            setDetailRepo(r)
            setSheet('detail')
          }}
          onOpenShop={() => setSheet('apkstore')}
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
          latestIsBeta={!!updateResult?.info?.prerelease}
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
          onOpenDashboard={openDashboard}
          onOpenGists={() => pushTo({ kind: 'gists' })}
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
          latestIsBeta={!!updateResult?.info?.prerelease}
          updateMode={updateMode}
          onUpdateMode={changeUpdateMode}
          acctPref={acctPref}
          onAcctPref={changeAcctPref}
          themePref={themePref}
          resolvedTheme={resolvedTheme}
          onTheme={changeTheme}
          fontPref={fontPref}
          onFont={changeFont}
          appearance={appearance}
          onAppearance={changeAppearance}
          native={Capacitor.isNativePlatform()}
          fullscreen={fullscreen}
          onFullscreen={changeFullscreen}
          downloadMode={downloadMode}
          dlParts={dlParts}
          onDlParts={changeDlParts}
          notifyVisible={notifyVisible}
          onOpenNotifySettings={() => void openNotifySettings()}
          onDownloadMode={changeDownloadMode}
          clipOpen={clipOpen}
          onClipOpen={changeClipOpen}
          scope={scope}
          onScope={(next) => {
            setScope(next)
            if (kvRef.current) void kvRef.current.set(TRANSLATE_SCOPE_KEY, JSON.stringify(next))
            showToast(
              next.readme || next.desc || next.release || next.issue
                ? `翻译范围：${[
                    next.readme ? '自述' : '',
                    next.desc ? '简介' : '',
                    next.release ? '发行说明' : '',
                    next.issue ? 'Issue/PR' : '',
                  ]
                    .filter(Boolean)
                    .join('、')}`
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
          revealSet={revealSet}
          onSetReveal={() => {
            setRevealError(null)
            setRevealMode('set')
            setSheet('reveal')
          }}
          onClearReveal={() => {
            setRevealError(null)
            setRevealMode('clear')
            setSheet('reveal')
          }}
          onOpenBackup={() => setSheet('backup')}
          mirrorAuto={mirrorAuto}
          mirrorSpeed={currentSpeed}
          mirrorCheckedAt={probe.at}
          mirrorCustom={mirrorStore.custom.length}
          mirrorChanged={Object.keys(mirrorStore.overrides).length}
          dlCount={dlHistory.length}
          onOpenHistory={() => void openDlHistory()}
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
          onOpenSecret={openSecret}
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
          onSearch={() => pushTo({ kind: 'search', repo: `${route.owner}/${route.repo}` })}
          me={activeRecord?.login ?? null}
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
          onDownloadArchive={(ref) =>
            openDownload(
              archiveTarget({ mirror, owner: route.owner, repo: route.repo, ref }),
              'none',
            )
          }
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
          mirror={mirror}
          autoTranslate={scope.issue}
          channel={translateChannel}
          target={translateTarget}
          azureKey={azureKey}
          store={translateStore}
          onBack={popTo}
          onToast={showToast}
          onOpenUser={(login) => pushTo({ kind: 'user', login })}
          onOpenRoute={pushTo}
        />
      )}

      {route?.kind === 'pull' && (
        <PullPage
          client={client}
          owner={route.owner}
          repo={route.repo}
          number={route.number}
          login={activeRecord?.login ?? null}
          mirror={mirror}
          autoTranslate={scope.issue}
          channel={translateChannel}
          target={translateTarget}
          azureKey={azureKey}
          store={translateStore}
          onBack={popTo}
          onToast={showToast}
          onOpenUser={(login) => pushTo({ kind: 'user', login })}
          onOpenRoute={pushTo}
        />
      )}

      {route?.kind === 'code' && (
        <CodePage
          client={client}
          owner={route.owner}
          repo={route.repo}
          path={route.path}
          ref={route.ref}
          initialFind={route.find}
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
          reloadKey={notifTick}
          onOpen={(t) => setThread(t)}
        />
      )}

      {thread && (
        <ThreadSheet
          client={client}
          thread={thread}
          mirror={mirror}
          autoTranslate={scope.issue}
          channel={translateChannel}
          target={translateTarget}
          azureKey={azureKey}
          store={translateStore}
          onClose={() => setThread(null)}
          onToast={showToast}
          onOpenRoute={(r) => {
            // 和自述一样：弹层不收掉的话，压上去的页面会藏在它下面
            setThread(null)
            pushTo(r)
          }}
          onOpenFull={() => {
            const next = targetRoute(thread)
            setThread(null)
            if (next) pushTo(next)
          }}
          onDone={() => {
            const t = thread
            setThread(null)
            if (!client) return
            void markThreadDone(client, t.id)
              .then(() => {
                showToast('已移出收件箱')
                setUnread((n) => Math.max(0, n - (t.unread ? 1 : 0)))
                setNotifTick((v) => v + 1)
              })
              .catch((err: Error) => showToast(err.message))
          }}
        />
      )}

      {route?.kind === 'search' && (
        <SearchPage
          client={client}
          scope={route.repo}
          onBack={popTo}
          onToast={showToast}
          onOpenCode={(owner, repo, path, find) => pushTo({ kind: 'code', owner, repo, path, find })}
          onOpenCommit={(owner, repo, sha) => pushTo({ kind: 'commit', owner, repo, sha })}
          onOpenRepo={(full) => {
            const [owner, repo] = full.split('/')
            if (owner && repo) pushTo({ kind: 'repo', owner, repo, tab: 'code' })
          }}
          onOpenUser={(login) => pushTo({ kind: 'user', login })}
          onOpenIssue={(owner, repo, n) => pushTo({ kind: 'issue', owner, repo, number: n })}
        />
      )}

      {route?.kind === 'gists' && (
        <GistsPage
          client={client}
          login={route.login ?? null}
          onBack={popTo}
          onToast={showToast}
          onOpen={(id) => pushTo({ kind: 'gist', id })}
          onCreate={() => pushTo({ kind: 'gist', id: '' })}
        />
      )}

      {route?.kind === 'webOnly' && (
        <WebOnlyPage
          path={route.path}
          mirror={mirror}
          onBack={popTo}
          onToast={showToast}
          onOpenRepo={(owner, repo) => pushTo({ kind: 'repo', owner, repo, tab: 'code' })}
        />
      )}

      {route?.kind === 'gist' && (
        <GistPage
          client={client}
          id={route.id}
          onBack={popTo}
          onToast={showToast}
          onSaved={(id) => {
            setPageTick((n) => n + 1)
            // 新建成功后把「新建」那条路由换成详情，返回时不会又回到空表单
            if (route.id !== id) replaceTopTo({ kind: 'gist', id })
          }}
          onDeleted={() => {
            setPageTick((n) => n + 1)
            popTo()
          }}
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
          onOpenGists={() => pushTo({ kind: 'gists', login: route.login })}
          onOpenRoute={pushTo}
          onEditReadme={(sha) => {
            // 没有 sha 说明 README 还不存在，交给编辑器走「新建」分支
            pushTo({
              kind: 'edit',
              owner: route.login,
              repo: route.login,
              path: 'README.md',
              ...(sha ? { sha } : {}),
            })
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
          <button
            className="btn ghost"
            style={{ height: 32, fontSize: 11.5 }}
            onClick={() => startBatchAction({ kind: 'visibility', to: 'private' })}
          >
            转私有
          </button>
          <button
            className="btn ghost"
            style={{ height: 32, fontSize: 11.5 }}
            onClick={() => startBatchAction({ kind: 'visibility', to: 'public' })}
          >
            转公开
          </button>
          <button
            className="btn ghost"
            style={{ height: 32, fontSize: 11.5 }}
            onClick={() => setSheet('batchpick')}
          >
            更多
          </button>
        </div>
      )}

      </Boundary>

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


      {sheet === 'backup' && (
        <BackupSheet
          version={APP_VERSION}
          login={records.find((r) => r.id === activeId)?.login ?? null}
          accountName={records.find((r) => r.id === activeId)?.name ?? null}
          accountCount={records.length}
          native={Capacitor.isNativePlatform()}
          onClose={() => setSheet('none')}
          onToast={showToast}
          onExport={buildBackupText}
          onRestore={restoreBackup}
        />
      )}

      {sheet === 'secret' && secretRecord && (
        <SecretSheet
          record={secretRecord}
          guarded={guarded}
          hasRevealPass={revealSet}
          onClose={() => {
            setSecretId(null)
            setSheet('none')
          }}
          onToast={showToast}
          onCheckVaultPass={(pass) => checkReveal('vault', pass)}
          onCheckRevealPass={(pass) => checkReveal('reveal', pass)}
          onSetRevealPass={async (pass) => {
            await setRevealPass(kvRef.current, pass)
            setRevealSet(true)
          }}
          onLoadPrimary={async () => {
            const v = vaultRef.current
            if (!v || !secretRecord) throw new Error('保险库未解锁')
            return v.secret(secretRecord.id)
          }}
          onLoadSecondary={() => (secretRecord ? readSecondary(secretRecord.id) : Promise.resolve(null))}
          onSaveSecondary={(secret) =>
            secretRecord ? writeSecondary(secretRecord.id, secret) : Promise.resolve()
          }
        />
      )}

      {sheet === 'reveal' && (
        <RevealSheet
          mode={revealMode}
          hasPass={revealSet}
          busy={revealBusy}
          error={revealError}
          onCancel={() => setSheet('none')}
          onSubmit={(next) => {
            if (revealMode === 'clear') void dropRevealPass()
            else void applyRevealPass(next)
          }}
        />
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

      {sheet === 'batchpick' && (
        <BatchPickSheet
          count={selected.size}
          archivedCount={repos.filter((r) => selected.has(r.full_name) && r.archived).length}
          onClose={() => setSheet('none')}
          onPick={(action) => {
            setSheet('none')
            startBatchAction(action)
          }}
        />
      )}

      {sheet === 'visibility' && (
        <BatchSheet
          title={batchTitle}
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
          onOpenRoute={(r) => {
            // 弹层先收，再压路由：简介里的链接要真的落到页面上
            setSheet('none')
            pushTo(r)
          }}
          onOpenForks={() => {
            setSubReturn('detail')
            setSheet('forks')
          }}
          onMultiStar={multiAccounts.length > 1 ? (kind) => void openMulti(kind) : undefined}
          accountCount={multiAccounts.length}
          starTick={starTick}
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
          onDownloadArchive={() =>
            openDownload(
              archiveTarget({
                mirror,
                owner: detailRepo.owner || detailRepo.full_name.split('/')[0],
                repo: detailRepo.name,
                ref: detailRepo.default_branch,
              }),
              'detail',
            )
          }
        />
      )}

      {sheet === 'releases' && detailRepo && (
        <ReleasesSheet
          repo={detailRepo}
          client={client}
          mirror={mirror}
          autoTranslate={scope.release}
          channel={translateChannel}
          target={translateTarget}
          azureKey={azureKey}
          store={translateStore}
          onOpenRoute={(r) => {
            // 和自述一样：收掉弹层再压路由，否则弹层盖在详情页上看不见
            setSheet('none')
            pushTo(r)
          }}
          onClose={() => setSheet(subReturn)}
          onToast={showToast}
          onAudit={(detail) => void logAudit('release', detailRepo.full_name, detail)}
          onDownloadAsset={(release, asset) =>
            openDownload(
              assetTarget({
                mirror,
                owner: detailRepo.owner || detailRepo.full_name.split('/')[0],
                repo: detailRepo.name,
                tag: release.tag_name,
                asset: asset.name,
                size: asset.size,
              }),
              'releases',
            )
          }
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
          onMultiFork={multiAccounts.length > 1 ? () => void openMulti('fork') : undefined}
          accountCount={multiAccounts.length}
          forkTick={forkTick}
        />
      )}

      {sheet === 'multi' && detailRepo && multiKind && (
        <MultiAccountSheet
          kind={multiKind}
          title={multiKind === 'fork' ? '同时复刻' : multiKind === 'unstar' ? '同时取消 Star' : '同时 Star'}
          subtitle={`${detailRepo.full_name} · ${multiAccounts.length} 个账号`}
          accounts={multiAccounts}
          tasks={multiTasks}
          states={multiStates}
          selected={multiSel}
          loading={multiLoading}
          running={multiRunning}
          results={multiResults}
          onToggle={(id) => setMultiSel((prev) => toggleSelection(prev, id))}
          onToggleAll={() => setMultiSel((prev) => toggleAllSelection(prev, multiTasks))}
          onRun={() => void runMulti()}
          onClose={() => {
            setSheet(multiReturn)
            setMultiKind(null)
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
          onOpenRoute={(r) => {
            // App 内打开：收掉弹层、压路由。GitHub 链接跳系统浏览器是用户点名要改的
            setSheet('none')
            pushTo(r)
          }}
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
          mode={downloadMode}
          native={Capacitor.isNativePlatform()}
          onOpenMirrors={() => openMirrors('update')}
          onRecheck={() => void runCheck(true)}
          onDownload={() => {
            const info = updateResult?.info
            if (!info?.asset) {
              showToast('这个版本还没有附带安装包')
              return
            }
            openDownload(
              apkTarget({
                mirror,
                owner: UPDATE_OWNER,
                repo: UPDATE_REPO,
                tag: info.tag,
                asset: info.asset.name,
                size: info.asset.size,
                version: info.version,
              }),
              'update',
            )
          }}
          onClose={() => setSheet('none')}
        />
      )}

      {sheet === 'download' && downloadTarget && (
        <DownloadSheet
          /* 换一个包就重挂：测速结果、进度、错误都是这一个包的，不能串到下一个包 */
          key={`${downloadTarget.kind}:${downloadTarget.fileName}`}
          target={downloadTarget}
          mode={downloadMode}
          onMode={changeDownloadMode}
          parts={PARTS_OF[dlParts]}
          onClose={() => setSheet(downloadReturn)}
          onToast={showToast}
          auth={client?.authToken ?? null}
        />
      )}

      {sheet === 'dlHistory' && (
        <DlHistorySheet
          records={dlHistory}
          exists={dlExists}
          onClose={() => setSheet('none')}
          onOpenRepo={(full) => {
            const [owner, repo] = full.split('/')
            if (!owner || !repo) {
              showToast('这条记录没有来源仓库')
              return
            }
            setSheet('none')
            pushTo({ kind: 'repo', owner, repo, tab: 'code' })
          }}
          onInstall={(rec) => {
            if (!rec.path) return
            void installApk(rec.path).then(
              (r) =>
                showToast(
                  r.needPermission ? '请在系统设置里允许「安装未知应用」，再回来点一次' : '已调起安装器',
                ),
              (e: Error) => showToast(e.message),
            )
          }}
          onClear={() => {
            clearHistory()
            setDlHistory([])
            showToast('下载记录已清空')
          }}
        />
      )}

      {sheet === 'apkstore' && (
        <ApkStoreSheet
          kv={kvRef.current}
          onClose={() => setSheet('none')}
          onOpenApp={(app) => {
            setDetailRepo(apkAppToRepo(app))
            setSheet('detail')
          }}
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
          templates={compose.templates}
          templatesLoading={compose.templatesLoading}
          prTemplate={compose.prTemplate}
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
          onDownloadArtifact={(a) =>
            openDownload(
              artifactTarget({
                owner: logsRun.owner,
                repo: logsRun.repo,
                runId: logsRun.id,
                artifactId: a.id,
                name: a.name,
                size: a.size_in_bytes,
              }),
              'logs',
            )
          }
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
    {/* 全局一份：每个页面的滚动容器都是自己的 .page，按钮挂在根上才不用改十几处页面 */}
    <BackToTop resetKey={route ? routeKey(route) : `tab:${tab}`} raised={!route} />
    </AuthImageProvider>
  )
}
