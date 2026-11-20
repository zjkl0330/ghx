# AGENTS.md — 交接文档

> 给接手的 AI / 未来的自己：**读完这一份就够开工，不用把 `src/` 全读一遍。**
> 真有需要再按下面「目录地图」去精准打开对应文件。
> 用户偏好：中文、结论先行、表格优先、先侦察再动手、不猜、不擅自扩大范围。

## 一句话

安卓上的 GitHub 本地控制台（包名 `dev.zjkl.ghx`）。纯前端直连 `api.github.com`，不依赖任何后端 —— 因为用户经常打不开 github.com，但 API 通常还是通的。

## 30 秒上手

```bash
cd /workspace/ghx
npx tsc -b                 # 类型检查（noUnusedLocals 开着，未用变量会报错）
npx vitest run             # 单测，必须全绿
pnpm build                 # vite 构建到 dist/
npx vite preview --port 5201   # 本地看效果
```

打 APK（环境已就绪，不要重新装 SDK）：

```bash
cd android && JAVA_HOME=/opt/jdk-21.0.2 /opt/gradle-8.11.1/bin/gradle assembleDebug
# 产物 android/app/build/outputs/apk/debug/app-debug.apk
# 对齐/签名：/opt/android-sdk/build-tools/35.0.0/{zipalign,apksigner}
```

签名密钥在 `keystore/`，**指纹必须与历史一致**，否则用户覆盖安装会丢本地数据（保险库、缓存、设置全在 App 私有目录）。

## 技术栈

Capacitor 7 + React 19 + TypeScript + Vite。没有 router、没有 markdown 库、没有状态管理库 —— 全部手写，`src/lib/` 是纯函数层（可单测），`src/ui/` 是组件层，`src/App.tsx` 是唯一的装配点。

## 目录地图

### lib（纯逻辑，必须有测试）

| 文件 | 职责 |
|---|---|
| `api.ts` | GitHub REST 客户端。`request()` 统一入口：GET 走缓存、写后按前缀失效、403 分限流/权限、错误码翻中文 |
| `cache.ts` | 内存 TTL 缓存。`ttlFor()` 按路径分档，`invalidationPrefixes()` 决定写操作清哪些 |
| `vault.ts` | 令牌保险库，AES-256-GCM。设备密钥 + 可选口令 guard |
| `tokens.ts` | 令牌体检：`probeToken`、过期分级、风险 scope |
| `repos.ts` | 仓库归一化、筛选、批量可见度计划 `buildPlan` / `runBatch` |
| `sort.ts` `stars.ts` `topics.ts` | 排序、语言分组、话题解析 |
| `snapshot.ts` | 仓库列表冷启动快照 |
| `storage.ts` | KV 抽象（Capacitor Preferences / localStorage / 内存） |
| `mirrors.ts` | 下载加速站：站点表、测速、URL 拼接、**自定义站点与改地址** |
| `update.ts` | 自更新：版本比较、加速站 URL、打开外部链接、`headReachable` 下载探活 |
| `releases.ts` `forks.ts` `workflows.ts` | 发行版/复刻/工作流的状态与校验 |
| `readme.ts` `markdown.ts` `images.ts` | README 解码、自研 Markdown 解析为 Block、图片路径与镜像 |
| `translate.ts` | 多通道机翻：Edge / Azure / MyMemory / Google，切段、降级、缓存键；`isNameLike` / `looksLikePinyin` 把拼音与代号型简介挡在翻译之外 |
| `search.ts` `trending.ts` `hotCache.ts` `tabs.ts` `theme.ts` `backnav.ts` `audit.ts` `types.ts` | 搜索语法、热门查询、热门榜单缓存（内存 + 本机快照 + 淘汰）、底栏配置、主题、返回键决策、审计、领域类型 |
| `routes.ts` | **可序列化路由栈**：`Route` 判别联合 + `pushRoute`/`popRoute`/`replaceTop`/`routeKey`/`repoOf`/`routeLabel` |
| `paging.ts` | `Link` 头解析（大小写与空白不敏感，畸形片段跳过）、`nextPage` 无 Link 时按满页兜底 |
| `issues.ts` | Issue 领域：PR 剔除、状态文案、标签配色与计数、筛选；`listIssues`/`getIssue`/`addComment`/`updateIssue`/`setIssueLabels`/`setAssignees`（PATCH 整体替换）/`setLocked` |
| `pulls.ts` | PR 领域：mergeable 提示、合并/评审失败码翻译、`parsePatch`/`slicePatch`（400 行上限）、`mergePull`（带 head sha）、`submitReview`、`checkRuns` |
| `code.ts` | 代码浏览：UTF-8 base64 编解码（分块防爆栈）、语言判定、目录排序与摘要、`getFile`/`getMeta`（**目录返回数组、文件返回对象**）、`putFile`/`deleteFile`、提交历史与 diff、`writeErrorHint` |
| `refs.ts` | 分支与标签：命名校验、默认分支置顶、含 `/` 的编码处理、新建/删除/改名 |
| `actions-ext.ts` | Actions 补全：日志 zip 解压排序（`fflate`）、`fetchRunLogs`（真机走 `CapacitorHttp`）、产物列表与删除、重跑失败/单作业、`parseDispatchInputs`/`buildDispatchInputs`/`validateInputs` |
| `search-ext.ts` | 六类搜索的查询拼装（code 加引号、issue 强制 `is:issue`）、配额文案 |
| `notifications.ts` | 通知：原因文案、按仓库分组、未读数、`canUseNotifications`（classic-only 判断）、条件请求 |
| `repo-admin.ts` | 仓库设置开关表、改名影响清单、协作员、Watch 订阅、用户资料与关注 |
| `release-ext.ts` | 发行版编辑/发布草稿/删附件（**上传不在这里，见下方 CORS 坑**） |
| `accounts.ts` | 多账号视图：`buildAccounts`（当前置顶）、`nextAccount`（轮换）、`accountLabel`、`switchMessage`、`needsAccountReset` |
| `desc.ts` | 列表简介取数：`pickDescItems`（跳过空简介、按 full_name 去重、只取前 N 条 + 详情保底）、`descText`（译文取值，空串当没翻） |
| `archive.ts` | 源码 zip：`archiveFileName` / `archivePath` / `codeloadViaProxy`、`archiveCandidates`（四条候选按可通性排序）、`pickArchive`（HEAD 探活取第一条通的） |
| `immersive.ts` | 沉浸式全屏的 JS 侧：`setImmersive(on)` 调自写的 `Immersive` 原生插件（Web 端静默跳过） |
| `users.ts` | 用户维度纯逻辑：`visibleUserRepos`（排序 + 只看源仓库）、`forkCount`、`userKindLabel`、`displayName`、`userFacts`（公司/位置/博客/X/加入，空字段不出现）、`normalizeBlogUrl`（补协议）、`joinedText`、`followPath`、`hasMoreFollowers`、`userRepoSummary` |
| `appearance.ts` | 外观偏好（强调色 / 底栏形态 / 底栏文字 / 背景 / 玻璃 / 动效）：`normalizeAppearance` 逐字段兜底、`applyAppearance` 只写 `<html data-*>`、`ACCENTS` 色板、`accentSwatch` |
| `boot.ts` | 首屏遮罩的撤除：给 `#boot` 打 `data-leaving`，`transitionend` + 420ms 超时双保险，重复调用幂等 |
| `format.ts` | 相对时间、短日期、体积、紧凑数字、路径切分 |

### ui（组件）

`RepoList` 主列表 · `RepoDetailSheet` 仓库详情动作 · `ReadmeSheet` 自述阅读+机翻 · `StarsPage` 星标 · `HotPage` 热门/搜索 · `PipelinesPage` 流水线二级页 · `WorkflowSheet`/`RunSheet` 工作流与运行 · `LogSheet` **日志与产物** · `ReleasesSheet` · `ForksSheet` · `VisibilitySheet` 批量可见度 · `CreateRepoSheet` · `SortSheet` · `MirrorSheet` **加速站管理** · `ProfilePage` 个人页 · `SettingsPage` 设置 · `TokenVault` 令牌库 · `AuditLog` · `GuardSheet`/`UnlockScreen`/`LockedScreen` 口令三件套 · `UpdateSheet` · `RepoPickerSheet` · `useDescTranslation` 简介批量机翻 hook · `icons.tsx`

第二批（v0.5.3）：`RepoPage` 仓库主页（自述/发行版/分支/流水线/复刻/设置 chips + 代码/Issues/PR/动作页签）· `IssuesPage`/`IssuePage` · `PullsPage`（含 `PullPage`）/`DiffView` · `CodePage`（含 `FileEditor`）· `CommitsPage`（含 `CommitPage`）· `RefsPage` · `NotificationsPage` · `SearchPage` · `UserPage` · `RepoAdminPage` · `ComposeSheet` 新建 Issue/PR · `MarkdownView` 通用渲染（表格/任务列表）· `PageHeader`+`PageState` 统一顶栏与状态 · `useLoad` 统一加载 hook

第三批（v0.5.4）：`AccountSheet` 账号切换面板 + 多设备响应式（内容居中、safe-area、横屏矮屏）

第四批（v0.5.5）：磨砂玻璃底栏（悬浮胶囊 + 厚底色 + 砂面噪点 + 实心选中态图标）· 热门/星标接入简介机翻 · 应用图标与启动图重绘（`assets/icon/*.svg` + `scripts/make-icons.py`）· `scripts/shots.py` 用 mock API 出 README 截图（含主页自述与看板，图片也在本地造） · `scripts/probe-webkit.py` 比对 Chromium / WebKit 渲染

第六批（v0.6.4）：`SettingsPage` 的外观面板（色板 / 六组分段控件）· 首屏遮罩改为 `index.html` 内联，不经 React

第五批（v0.6.3）：`UserListSheet` 关注者 / 正在关注列表（30 一页，点人继续跳）· `UserPage` 重写（头像 / 资料事实行 / 三个统计 / 仓库排序与 fork 过滤 / 加载更多）

### 样式

`src/styles/theme.css` 单文件，**只用 CSS 变量**（`--bg` `--surface` `--text` `--text-dim` `--line` `--blue` `--blue-soft` `--green*` `--red*`，以及底栏专用的 `--glass-*` 与 `--tab-active-*`）。深色/浅色靠 `<html data-theme>` 切换，新组件禁止写死颜色。

> 图标的坑：① GitHub mark 是「实心圆盘 − 猫」的复合路径，直接填色得到的是「深圆盘 + 白猫」；想要「黑猫剪影」必须反相负空间（遮罩里铺黑、画白圆、再用 path 挖掉 F，剩下圆盘 − F = 猫），但反相后猫底会被原图的圆裁成平口，小尺寸下退化成黑块，所以最终选的是标准反色（深圆盘 + 白猫）。② SVG 渐变默认 `objectBoundingBox`，遇到细长/零面积包围盒会退化成纯色（细线直接消失），一律写 `gradientUnits="userSpaceOnUse"`。③ 图标改白底后，`splash_background` 必须一起改白，否则深色圆盘压在深色启动屏上不可见；而它同时被 `windowBackground` / 系统栏色引用，直接改白会让横屏白边复活 —— 拆出独立的 `window_background` 才是正解。

> 玻璃底栏的坑：① 选中态药丸是 `position: absolute` 的伪元素，**必须 `z-index: -1`**，否则它会盖住图标与文字；② 底栏 `position: fixed` 后，`.app.with-tabs > .page` 的 `padding-bottom` 是唯一让最后一行不被压住的东西；③ `backdrop-filter` 是可靠的 —— 之前判断「完全不执行」是被截图环境骗了：Playwright 默认的 headless shell 不做 blur，`blur(0px)` 与 `blur(100px)` 才会一模一样。换成有头 Chromium（`xvfb-run` + `--use-angle=swiftshader`）后 `blur(64px)` 能把正文彻底抹平。所以底栏必须有真模糊，老 WebView 由 `@supports not` 兜到 0.96；**`scripts/shots.py` 必须跑有头浏览器**，否则 README 里拍出来是块没有模糊的色板；④ 居中别用 `left:50% + translateX(-50%)`，`transform` 会让 backdrop 采样进一步失准；⑤ 横屏白边有两个来源，一个是内容列被 `--content-max` 卡住（现在只要 `orientation: landscape` 就铺满，别再加高度条件），另一个是 `AppTheme.NoActionBar` 在 DayNight 浅色模式下 `windowBackground` 是白的，横屏时系统导航栏那一条会露白 —— 必须在主题里显式给深色 windowBackground + navigationBarColor。

> **玻璃为什么看起来像实心板（v0.6.2 量出来的，别再靠调 alpha 试）**：① 旧 tint `rgba(22,27,34,.42)` 叠在 `#0D1117` 上是 `rgb(17,21,28)`，对比度 **1.03:1**；浅色白 tint 叠白底更彻底，**1.00:1** —— 填充色和页面底色其实是一个颜色，看得见它全靠边框 + 顶边高光 + 大投影，而那三样都是「实体卡片」的线索。② `blur(<length>)` 的参数是高斯核**标准差**，`blur(34px)` 的 3σ≈102px，胶囊只有 58px 高，一半以上采样能量来自元素外，背后内容被平均成色斑 —— 透不出形状，眼睛就判定成不透明。③ `brightness(1.02)` 对 `(13,17,23)` 取整后完全不变，是空操作；浅色下还会被 clip。④ 解法不是降 alpha（降到 0.1 只是「没有板」），而是：tint 0.26 + `blur(12px)` + `saturate(185%)` + 1px `conic-gradient` 镜面环，可读性交给玻璃**背后**的 `.glass-backdrop` 压暗层 —— 这正是 HIG 对 clear 变体的建议：不透明度加在玻璃背后，不是加在玻璃上。⑤ `isolation: isolate` **不在** backdrop root 的触发条件里（Filter Effects 2 只列 filter / opacity<1 / mask / clip-path / backdrop-filter / mix-blend-mode / 对应 will-change），别再把它写成「会切断模糊」；`.tabbar button.on::before` 里的 `backdrop-filter` 才是真空操作 —— 父级已建 backdrop root，子元素采样到的是父级填充。⑥ 老 WebView 降级分支要同时补回实色 `border-color`，否则 transparent 边框会露出窗口底色。
> **镜面环不能和底色挤在一组 `background` 里（v0.6.5 的根因）**：`linear-gradient(玻璃色) padding-box, conic(环) border-box` 这招只在不透明底色下成立。玻璃是半透明的，padding-box 那层压不住 border-box 的 conic —— 环在 0deg/360deg 是纯白，整块底栏被垫成白板，**alpha 调到 0.18 也一样白**，所以「浅色怎么调都不透」根本不是色值问题。现在环由 `.tabbar::after` 画：`padding: 1px` + `mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)` + `mask-composite: exclude`，只留 1px 边。另：浅色用 0.20 底色 + `blur(6px)`，`blur` 是标准差，σ=12px 时 3σ=36px 已超过胶囊高度，一行 14px 正文会被平均成纯色 —— 想「看见背后」就必须把 σ 压到 6px 附近，不能只降 alpha。

> **全屏（edge-to-edge）的坑**：① 别把 Capacitor 的 `adjustMarginsForEdgeToEdge` 设成 `auto`/`force` —— 它会直接给 WebView 加四边 margin 并 `CONSUMED`，全屏立刻失效；保持 `disable`，由 `MainActivity` 自己 `setDecorFitsSystemWindows(false)`。② `env(safe-area-inset-*)` 在 Android WebView 多数机型恒为 0，必须把 `WindowInsetsCompat` 量出来的值注入成 `--inset-*`，CSS 里用 `max(env(...), var(--inset-*))` 取大值（不能相加，否则重复让位）。③ `setDecorFitsSystemWindows(false)` 之后 `adjustResize` 不再缩窗口，输入法只报 `ime` insets —— 页面要自己 `padding-bottom: var(--inset-ime)`，底栏与压暗层同时淡出，否则键盘会盖住输入框。④ `StatusBar.setOverlaysWebView()` 只动状态栏、用的全是 API 30 就废弃的 `setSystemUiVisibility`，铺不到导航栏；`StatusBar.hide()` 也不设 `systemBarsBehavior`。要沉浸式全屏就用自写的 `ImmersivePlugin`（`WindowInsetsControllerCompat.hide(systemBars)` + `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`）。⑤ 自定义插件必须在 `super.onCreate()` **之前** `registerPlugin()`，Bridge 在 `super` 里就建好了。

> **启动屏的三个坑（v0.6.4）**：① `android:background` 是 View 属性，写在主题里对窗口无效 —— 启动背景必须用 `android:windowBackground`，否则 Android 11 及以下显示的是 DayNight 默认底色，开屏先白/黑闪一下。② `windowSplashScreenAnimatedIcon` 不要复用 `@mipmap/ic_launcher_foreground`：自适应图标前景层是 108dp 画布里只占 66dp，系统又按 192dp 的圆裁一次，图标会小到看不清。用专用矢量，且形状必须是正圆（无 `iconBackgroundColor` 时系统强制圆裁，方形图标的四角会被切）。③ WebView 内的启动遮罩尺寸要对齐系统 splash：Android 12 的内容圆是 192dp，遮罩里的图标直径按 192 铺（本项目的 SVG viewBox 就是 192，铺 184px），差一倍时切换会明显「缩一下」。

> **用户主页的两个坑（v0.6.3）**：① `.avatar` 是固定尺寸容器（30 / 58px），往里塞 `<img>` 必须给 `width:100%; height:100%`，容器还要 `overflow:hidden` —— 少了这一步，460px 原图按自身尺寸绘制，整页被横向撑爆：统计卡飘到头像上、仓库列表被推出屏幕，表现上就是「个人主页打不开」。更稳的是照其它页面把 `.avatar` 直接写在 `<img>` 上。② `theme.css` 里 `.badge` 有两处定义，后一处是通知未读角标的红底方块，它会把仓库行的 Public / 私有 / 已归档标签一起染成红块。计数角标现在叫 `.badge.count`，新加标签类别再撞 `.badge`。

> 下 zip 的坑：`/archive/refs/heads/<branch>.zip` 只是个 302，真字节在 `codeload.github.com`；自建站是透明路径代理，把 302 交出去就断了，只有 url 型反代能整段代理。实测只有 `gh-proxy.com` 能吃 codeload（`ghfast.top` / `ghproxy.net` 403、`ghproxy.imciel.com` 404），所以候选顺序是「当前镜像 codeload → gh-proxy → 当前镜像 archive → 官方」，并且必须 HEAD 探活（Capacitor 原生 HTTP 支持 HEAD，`HttpRequestHandler` 只在非 GET/HEAD 时才挂 body）。Web 端别探活，CORS 会把 HEAD 全判死。

## 五个核心机制（改之前必须懂）

### 1. 返回键（`backnav.ts`）

优先级：键盘 → 口令面板 → 二级页面栈 `routeStack` → 弹层 → 多选 → 非首页 Tab → 首页两次确认退出。
`resolveBack` 返回动作对象（`pop-route` / `sheet` / `exit-confirm`…），`App.applyBack` 执行。
**新增页面必须同步改 `backnav.ts` + 补测试**，不能只在 UI 里加 `onBack`。

两个容易漏的参数：

- `hasWorkflow`：运行详情是从工作流详情点进来的，返回要回工作流而不是整屏收起。
- `subReturn`：自述/发行版/复刻面板既可从仓库详情弹层进、也可从仓库主页进，返回目标不同，由调用点分别传 `'detail'` / `'none'`。

### 2. 缓存（`cache.ts`）

GET 默认缓存，TTL 按路径：搜索 5min、`/user/repos` 60s、actions/runs 15s、其他 `/repos/*` 60s。
写操作后 `invalidationPrefixes()` 决定清哪些；刷新按钮与轮询传 `{ fresh: true }` 绕过缓存。
**新增写接口必须同时扩 `invalidationPrefixes()`**，否则改完列表还是旧的。

### 3. 翻译（`translate.ts`）

四条通道，`auto` 顺序：**Edge → Azure（有密钥）→ MyMemory → Google**。

- **Edge**（默认首选）：`POST https://edge.microsoft.com/translate/translatetext?to=zh-Hans`，body 是 JSON 数组。**不要带 `from` 参数** —— 带上会把中文段落改坏；不带则服务端自动识别，已是目标语言的段落原样返回。免密钥、CORS `*`、单次 5 万字符、批量 40 条。**必须带浏览器 UA**，否则 400。
- 历史教训：老端点 `GET edge.microsoft.com/translate/auth` 已于 2026-07-30 下线，固定 404，别再尝试。
- 缓存键 = 通道 + 目标语言 + 内容哈希（中文默认不带语言段，兼容旧缓存）。
- 长段落先按通道上限切分再翻，单段失败只留原文，不能让整篇崩。
- **名字不翻**：`needsTranslation()` 先问 `isNameLike()`。单段纯字母、无空格、且（camelCase / 带数字下划线 / 能按拼音音节表切完 / 三字母内无元音）就判定为名字，直接返回 false。原因：机翻拿到纯拼音会按音硬凑，`MiyoQian` 被翻成「美代倩」；这类简介翻了只会得到一句不存在的中文。`looksLikePinyin()` 用 DP 逐段切音节（拼音没有词边界，正则不可靠），会有误伤（`case` = ca+se），代价只是少一次没必要的翻译，可以接受。

### 4. 加速站（`mirrors.ts`）

两种路径风格，传错就 404：

- `path`：`{base}/{owner}/{repo}/...`（自建 Worker、gitproxy）
- `url`：`{base}/https://github.com/{owner}/{repo}/...`（gh-proxy 系）

站点表存在 `ghx.mirror.store`：`{ overrides: {内置id→新地址}, custom: [自定义站点] }`。
启动时 `parseMirrorStore` → `setMirrorRegistry(effectiveMirrors(store))`，**注册表是模块级变量**，因为 `githubUrlAt(base)` / `rawUrlAt(base)` 只拿到 base，得靠它反查风格。
改地址/加站/删站都要走 `App.saveMirrorStore`，它会同步注册表并作废本轮测速结果。

### 5. 导航与页面

二级页面一律走**路由栈**（`routes.ts`）：`Route` 是判别联合，空栈 = 主界面。

```
repo / code / edit / commits / commit / issue / pull / issues / pulls / refs / actions / admin
user / notifications / search / profile / settings / tokens / audit
```

- `pushRoute` 会按 `routeKey` 去重（连点两下不会压两层）。
- 页签切换、文件内换 ref 用 `replaceTop`：换的是当前页，不该多一层返回。
- 仓库改名后要 `replaceTop` 成新名字，否则返回上一层会撞 404。
- `repoOf` 从路由反查仓库，`routeRepo` 用它 + `repos` 列表兜底造一个最小 `Repo`（从搜索/通知进来时列表里没有这条）。

`SheetName` 是给**真弹层**用的封闭 union（`add` `visibility` `update` `detail` `create` `releases` `forks` `workflow` `run` `repoPick` `sort` `readme` `mirrors` `compose` `logs`）。
**弹层只放「单层、无下钻」的界面**；需要继续下钻的一律升级成 `Route`（Issue 详情、文件浏览当初就是弹层，v0.5.3 全改成路由了）。

### 6. 传输层三个细节（`api.ts`）

| 能力 | 用法 | 坑 |
|---|---|---|
| 分页 | `request()` 返回 `link`，配 `paging.nextPage(link, 本页条数)` | WebView 可能读不到 `Link`，所以无 Link 时按「本页是否满页」推断 |
| 条件请求 | `{ conditional: true }` 发 `If-None-Match`，304 时 `notModified: true` 并复用缓存 | **条件请求必须绕过缓存读取**（否则直接命中缓存、根本不发请求），但成功响应仍要写回并更新 etag |
| 纯文本 | `rawText()`（diff、raw 文件），不进 JSON 缓存 | 体积可能很大，默认 2MB 上限并返回 `truncated` |

## 硬约束（违反就是返工）

1. **只做 Android APK**，不做 Web 版，按 390×844 触摸尺寸设计。
2. **不引入后端**、不做账号体系、不加遥测。凡需要 `client_secret` / webhook 接收 / FCM 的功能，一律标「需后端」不做。
3. **禁止自动 git commit / push**。做完只报告改动与未提交状态，等用户发话。
4. 破坏性操作（删仓库、公开转私有、批量改可见度、删分支）必须二次确认。
5. 新增纯逻辑必须有单测；总数只增不减。
6. 视觉只用 `theme.css` 的 CSS 变量。
7. 版本 patch +1，满 10 进 minor；每次改动都发 Release。

## 踩过的坑（别再踩）

| 坑 | 正确做法 |
|---|---|
| `useMemo` 写在提前 return 之后 | 钩子数量会变，改用立即执行函数或把钩子提到 return 之前 |
| `fallbackTab` 返回 `pipelines` 当内容页 | 先过滤掉 `pipelines` 再取首项 |
| MyMemory 整段超 450 字节被静默拒绝 | 先 `splitByBytes` 再翻 |
| 中英混排被 `hasChinese` 判成中文而跳过 | 用 `needsTranslation` 占比判定 |
| 429 直接判失败 | 退让重试 2 次（700ms、1400ms） |
| 仓库列表只拉 6 页 ×30 = 180 个 | 已改 100/页 × 最多 20 页 |
| 私有仓库 README 图片加载不出 | `<img>` 不带令牌，下版改用带令牌的 contents 接口取 |
| Edge 翻译带 `from=en` | 中文段落会被改写，必须省略 `from` |
| 加速站只在代码里写死 | 域名会换，必须支持 `overrides` 改地址 |
| 浏览器预览与真机行为不同（CORS / 302 / zip） | 涉及下载、日志、原生请求的功能必须真机验证 |
| `GET /repos/{o}/{r}/contents/{path}` 目录返回**数组**、文件返回**对象** | 先 `getMeta` 判 `Array.isArray`，别直接当对象读 `.content` |
| `GET /issues` 会混进 PR | 用条目的 `pull_request` 字段过滤 |
| `PUT /issues/{n}/labels` 是**整体替换** | 提交时必须带上没动过的标签 |
| `POST /issues/{n}/assignees` 只加不减 | 想表达「最终名单」用 `PATCH /issues/{n}` 带 `assignees` |
| 锁定/解锁后立刻重拉详情会拿到旧值 | 按请求结果本地置位、失败回滚，别重拉 |
| `mergeable` 初始是 `null`（后台在算） | 2 秒后重取一次 |
| `PUT/DELETE /contents/{path}` 不带 `sha` | 带 sha 当乐观锁，冲突是 409 |
| UTF-8 内容用裸 `btoa` | 用 `encodeBase64Utf8`（分块，防 `fromCharCode` 爆栈） |
| 写 `.github/workflows/*` 缺 `workflow` scope 返回的是 **404** | `writeErrorHint` 单独解释 |
| 分支名带 `/` 时整段 `encodeURIComponent` | 改名接口是单参数，必须整段编码；`git/refs` 路径按段保留 |
| `POST /git/refs` 建的是**轻量标签** | 附注标签要先 `POST /git/tags` |
| 删除发行版不会删 tag | 界面给「同时删除标签」勾选，默认勾上 |
| `uploads.github.com` 没有 CORS 头 | **App 里不做上传**，只给网页入口（curl 直传 201 说明端点本身没问题） |
| 日志接口 302 到预签名 zip，浏览器必挂 | 真机走 `CapacitorHttp`（`responseType: 'arraybuffer'`）+ `fflate`，浏览器给降级说明 |
| 通知/Watch 用 fine-grained 令牌必 403 | `canUseNotifications(scopes, kind)` 提前判断并解释 |
| 给 `workflow_dispatch` 引 `js-yaml` | 只为 `inputs` 那一小块手写解析就够，解析失败降级成「只填 ref」 |
| 切账号只换 `client` | 路由栈、仓库列表、未读数、搜索词会留上一个账号的；统一在 `activate()` 里清，别分散到调用方 |
| 新账号没有本地快照时 | `activate` 必须先 `setRepos([])`，否则 `snap` 为 null 分支会把旧账号的列表留在界面上 |
| 新增令牌后直接 `activate` | 多账号时会把正在用的账号踢掉；只在「当前没有账号」时自动激活 |
| 大屏直接铺满 | `.app` 用 `--content-max` 居中（620 / 760 两档），弹层同步；否则平板上拉成一条横幅 |
| 锁 `user-scalable=no` | 阻碍系统字号放大，已放开到 5 倍 |
| 全屏后键盘盖住输入框 | `decorFitsSystemWindows(false)` 让 `adjustResize` 失效，自己吃 `ime` insets 写 `--inset-ime` |
| 用 `StatusBar.hide()` 做沉浸式 | 只藏状态栏、不设 behavior；改用 `ImmersivePlugin`（`WindowInsetsControllerCompat`） |
| 直接用 `env(safe-area-inset-*)` 让位 | Android WebView 多数恒为 0，必须原生注入 `--inset-*` 再 `max()` |
| 把 `adjustMarginsForEdgeToEdge` 设成 auto | 会给 WebView 加四边 margin，全屏失效；保持 `disable` |

## 版本与发布

- 版本号在 `package.json`、`android/app/build.gradle`（`versionCode` = 版本×1000）、`README.md`。三处要一致。
- 流程：改代码 → `tsc -b` → `vitest run` → `pnpm build` → 提交推 `main` → 打**注解 tag** 推上去。CI 见到 `refs/tags/v*` 才构建签名 APK 并 `softprops/action-gh-release` 发版；普通 push 只留 workflow artifact，**Releases 页不会出现新版本**。
- 发版说明直接取 tag 注解（`%(contents:subject)` + `%(contents:body)`），所以内容写在 tag 里，不写进代码。
- **`git tag -a -F notes.txt` 默认 `--cleanup=strip`，会把以 `#` 开头的行当注释删掉** —— 正文里的 `## 小节标题` 会整行消失，Releases 上只剩连成一片的段落。v0.7.7 与 v0.8.2 都踩过（v0.8.2 事后用 `PATCH /releases/{id}` 补回正文）。要么加 `--cleanup=verbatim`，要么小节标题改用 `**加粗**`。
- 一旦 tag 推上去，`main` 上的后续文档修正不会进这个 Release 的正文与源码包；要改正文用 `PATCH /repos/{owner}/{repo}/releases/{release_id}`（按 tag 名的端点只支持 GET，会 404）。
- 推送镜像偶尔 `cannot lock ref`：推临时分支上传对象，再 `PATCH /git/refs/heads/main`（`force:false`）。

## Copilot 调研结论（2026-11，别再试一遍）

| 路径 | 结果 |
|---|---|
| `GET /copilot_internal/v2/token` | 对 PAT **404** |
| `https://api.githubcopilot.com` 直连 | 400 `Personal Access Tokens are not supported` |
| `GET /copilot_internal/user` | 能读套餐，但拿不到可用于推理的 token |
| GitHub Models | 2026-07-30 停服 |

→ App 里做不了「登录 Copilot」。替代方案是自带 OpenAI 兼容大模型（DeepSeek / 通义 / Kimi / 硅基流动，跨域实测可用，密钥复用现有保险库），属下一批。

## 现在到哪一步了

- 已发布 **v0.5.3**：ROADMAP 里 P0 六项 + P1 六项全部落地 —— 路由栈底座、Issues、PR、代码浏览与编辑、提交历史、分支/Tag、Actions 日志与产物、通知、全局搜索、用户主页、仓库设置、发行版编辑。单测 467 → 564。
- **v0.5.4**：多账号切换（顶栏账号名 / 个人页卡片 → 面板，切换时清路由与列表）+ 多设备适配（620/760 两档居中、safe-area、横屏矮屏、放开缩放）。单测 564 → 584。
- **v0.5.5**：磨砂玻璃底栏、热门/星标简介机翻（抽 `desc.ts` 统一取数）、图标与启动图重绘、README 截图入库；顺手把「检查更新」指向 `zjkl0330/ghx`。单测 584 → 597。
- **v0.5.6**：底栏改成「厚度优先」的磨砂（当时误判 `backdrop-filter` 不执行）；锁掉双指缩放（`viewport` + `MainActivity` 两处），系统字号不受影响。单测仍 597。
- **v0.5.7**：底栏砂面颗粒加粗到肉眼可见，底色略降。
- **v0.5.8**：底栏换成真模糊的液态玻璃（0.62 底色 + `blur(64px) saturate(180%)`，误判的根源是 headless 截图不渲染 blur）；图标改 22px 实心剪影；横屏取消 620px 限宽改铺满，底栏收窄到 460px 居中，消掉两侧白边；`shots.py` 固定有头浏览器并补浅色底栏特写。单测 597。
- **v0.5.9**：底栏底色 0.42 + `blur(34px) saturate(200%)`（半径再大就只剩均匀灰雾），选中药丸同步降到 0.5；横屏媒体查询去掉高度条件，任意高度都铺满；主题里补深色 `windowBackground` / `navigationBarColor`，堵系统栏白边。单测仍 597。
- **v0.6.0**：新增「下载源码 ZIP」（`src/lib/archive.ts` 生成四条候选 + HEAD 探活）与「打开仓库」（`repoPageUrl` 统一走能翻页的镜像）；仓库页 chip 从横向滚动改成换行；仓库页补 `mirror` / `onToast` 两个属性。新增 24 项单测，总数 621。
- **v0.6.1**：应用图标换成 GitHub 官方 mark 反色（白底 + 深色圆盘 + 白猫，标记占底板 58%）；启动图与 `splash_background` 同步改白，Android 12+ 的 `windowSplashScreenBackground` 一起；新增 `window_background`（#0D1117）承接 `windowBackground` / 系统栏色，避免白底启动屏把横屏白边带回来。单测仍 621。
- **v0.6.2**：全屏铺满（`setDecorFitsSystemWindows(false)` + 原生 insets 注入成 `--inset-*`，`adjustMarginsForEdgeToEdge: 'disable'`）+ 沉浸式全屏开关（自写 `ImmersivePlugin`，`WindowInsetsControllerCompat`）；键盘改用 `ime` insets 让位、底栏淡出；底栏玻璃按「对比度 1.03:1 / σ 超过胶囊高度 / brightness 空操作」三个实测结论重做（tint 0.26 + `blur(12px)` + conic 镜面环 + 背后 `.glass-backdrop` 压暗层）。设计依据见 `docs/liquid-glass-and-edge-to-edge.md`。新增 2 项单测，总数 623。
- **v0.6.3**：修好用户主页（旧版 `<img>` 无尺寸约束把整页撑爆，现在头像与仓库行都按列表页结构）；用户搜索结果补头像 / 组织徽标 / 箭头，`name` 图标（不存在）换回 `user`，关键词自动去前导 `@`；用户主页扩展（关注者与正在关注可点开列表、仓库三种排序 + 只看源仓库 + 加载更多、公司/位置/博客/X/加入成行且外链可开）；仓库详情与仓库页的 owner、Issue/PR 作者与审核人可点进主页；拆分 `.badge.count` 修掉仓库标签被染红。新增 `users.ts` 与 `UserListSheet`，单测 623 → 657。
- **v0.6.7**：热门提速。`hotCache.ts` 按 (range, lang) 存快照，三层（模块内存 / Preferences / api 请求缓存），切换 740ms → 27–31ms 且 0 请求；首屏出数据 1.5s 后空闲预取另外两个时间段；10 分钟内不发请求，超过先渲染再静默刷新；冷启动 147ms（旧 868ms）。`HotPage` 增加骨架行与 3px 刷新条，`loaded` 与 `refreshing` 分开表达「没内容」与「在更新」。落盘只写公开仓库（剔除 private / disabled / permissions），删账号时 `clearHotCache` 一并清。单测 686 → 709。
- **v0.6.6**：安装包下载改成多候选 + 探活（当前镜像 → gh-proxy.com → ghfast.top → 官方直连），只有 2xx 才算通；此前单条地址直交浏览器，自建站资产偶发 522 时用户只看到白页。`headReachable` 判定由 `< 400` 收紧到 `< 300`。单测 682 → 686。
- **v0.6.5**：浅色底栏真正透出来 —— 根因是镜面环和半透明底色挤在同一组 `background` 里，`border-box` 的 conic 从 padding-box 底下透出来把整块垫成白板；改成 `::after` 蒙版只留 1px 边，浅色 0.20 底色 + `blur(6px)`。仓库详情「复制克隆地址」改为「复制仓库地址」（网页地址，不带 `.git`）。简介机翻新增名字识别（`isNameLike` / `looksLikePinyin`），拼音不再被音译成汉字。`shots.py` 截图前先把整行挪到底栏正中。单测 678 → 682。
- **v0.6.4**：启动动画重做 —— 旧系统改用 `windowBackground` + layer-list（`android:background` 对窗口不生效，之前开屏会先闪一下默认底色）；Android 12+ 换专用矢量启动图标（正圆白底 + 深色猫，不再复用自适应图标前景层）；新增 `values-night` 深色启动屏；`index.html` 内联首屏遮罩与系统 splash 同构图同尺寸，保险库就绪后淡出，中间不再有白屏。外观新增六组选项（强调色六选一、底栏悬浮/通栏、底栏文字图文/仅图标、背景纯色/氛围光、玻璃三档、动效两档），全部存 localStorage 并在首屏内联脚本里先应用一遍。新增 `appearance.ts` 与 `boot.ts`，单测 657 → 678。
- **v0.6.8**：修「顶栏钻进状态栏」。根因是 insets 竞态 —— 启动那次 `evaluateJavascript` 落在 `about:blank`，变量随导航丢失，而 400/1600ms 的补推被 `lastTop` 去重直接 return，`--inset-top` 永久为空。现在补推 force，覆盖 300/900/2000/4000ms，`onResume` 再补一次，React 就绪后由 `Immersive.syncInsets` 主动要一次；换算抽成 `InsetsBridge`。设置页外观卡片加实时预览（真的 `.tabbar` 改绝对定位，跟随全部 `data-*`）。单测仍 709。
- **v0.6.9**：三个东西。
  - **主页自述**：`UserPage` 之前只拉 user + repos，GitHub 个人主页那份 README（在 `{login}/{login}` 同名仓库里）从来没请求过，所以一直是空的。新增 `ProfileReadme`，内联渲染 + 300px 折叠 + 图片加速，自己账号能编辑。`ReadmeFile` 补了 `sha`（编辑不带 sha 会被 GitHub 当新建，回 422）；`branchFromBlobUrl` 从 `html_url` 反推分支，省一次 `GET /repos`。
  - **数据看板**：`stats.ts` 纯函数 + `DashboardPage`。底栏页签 `dashboard`（默认收起，`TAB_DEFS` 里加）。只有一张 SVG 柱状图，其余是 div 拼的条 —— 不引图表库。口径：语言按仓库数不按 star、提交按 `distinct_size`、日均的分母是事件覆盖天数而不是窗口。
  - **错误边界**：`Boundary.tsx` 包住页面区、留在底栏之外。起因是真实白屏 —— `/users/{o}/r` 返回 `{}` 时 `[...list]` 抛 TypeError，React 卸掉整棵树，连底栏都没了。现在崩的是那一页，导航还在，`resetKey`（路由键 / 页签）变化自动清错。
  - 顺手：`MarkdownView` 支持 `mirror`（Issue/PR 正文图片也能加速）；`<h1 align=center>` 识别成标题；`--text-dim-rgb` / `--chart-issue-rgb` / `--chart-pull-rgb` 三个新变量。
  - **踩过的坑**：代理或镜像忽略 `page` 参数时会把同一页回三遍，事件数直接翻三倍还误判成「已取到 300 条上限」→ `mergeEvents` 按 id 去重；跨域下 `x-ratelimit-*` 读不到是因为没 expose（截图 mock 已补）。
  - 单测 709 → 759。
- **v0.7.0**：修真机上刷出 `Failed to fetch` 的红条。根因不在 GitHub —— 断网 / 切基站 / 代理抖一下时，`fetch` 直接 reject 一个原生 `TypeError`，文案按内核不同（Chromium `Failed to fetch`、老 WebKit `Load failed`、Firefox `NetworkError…`），而 `api.ts` 没接住，`(err as Error).message` 原样进了红条。
  - 新增 `NetworkError`（`status = 0`，和 GitHub 的 4xx/5xx 区分开）+ `isNetworkError`；`request` / `rawText` 统一走 `send()` 包住网络层失败，`navigator.onLine === false` 时说「设备已离线」。
  - `send()` 对 **GET 重试一次**（默认 400ms，`retryDelayMs` 可注入）—— 手机上的失败多半是瞬时的；写操作不重试，重发可能建出重复仓库 / 重复评论；`AbortError`（切页、卸载）原样抛出。
  - 列表错误条：已有数据时改成「刷新失败：…。下面是上次拿到的列表」，右侧加 `.warn-retry` 重试按钮。
  - `translate.ts` 四个通道全挂时不再拼四遍 `Failed to fetch`，统一成「翻译服务连不上」。
  - 实测（390×844，Playwright 把 `/user/repos` 改成 `route.abort('failed')`）：请求 2 次、列表 20 行不丢、文案中文、重试按钮 1 个、网络恢复后错误条消失。单测 759 → 766。
- **v0.7.1**：文件页补动作能力。原先只有「编辑」一个按钮，复制、查找、下载、字号全没有。
  - 新增 `lib/code-view.ts`：阅读偏好（字号 12/13/15 + 折行）的解析与序列化、`findHits` / `splitHighlight` / `groupHitsByLine` / `stepHit`、`blobUrl`、`fileStats`。全部纯函数，29 条单测。
  - 文件信息栏改成一排：路径 + 查找 + ⋯ + 编辑。查找栏独立一条（`filebar` 塞不下输入框），计数用 `cur/total`，当前命中 `scrollIntoView({block:'center'})`。
  - 「⋯」面板：复制内容 / 复制链接 / 复制路径 / 在浏览器打开 / 下载原文件 / 提交历史，加字号与折行；复制带 `execCommand` 兜底，WebView 拒绝 Promise 时仍能成。
  - 面板抽成公共块，图片与二进制复用（原来这两类只能看）；图片预览抽 `FileImage`，加速地址失败自动回退原图。
  - 默认字号 10.5 → 13（真机上偏小）；`.code-no` 改 `min-width` 自适应，三位数行号不再被裁。
  - 实测（390×844）：199 行文件、查找 `1/39 → 2/39`、39 处高亮、关闭后 0 残留、剪贴板 3664 字符与原文件逐字一致、字号 13→15、折行 `white-space: pre-wrap`、偏好落盘 `{"size":15,"wrap":true}`；图片面板 5 个动作（无文本专属项）。单测 766 → 795。
- **v0.7.2**：按 `ROADMAP.md` 的功能池推荐接了三件 —— Gist、Issue 模板、仓库内搜索。
  - `lib/gists.ts`：`gistFiles`（README 优先）、`gistTitle` / `gistLanguage` / `gistBytes`、`draftFromGist`、`validateDraft`（空名 / 重名 / 带斜杠）、`filesPatch`（只发改动项；删给 `null`；改名 = 旧名 `null` + 新名内容）、`filesCreate`。19 条单测。
  - `lib/templates.ts`：手写 YAML 子集解析（`key: value` / `- ` 列表 / 两层嵌套 / `|` `>` 块标量 / 引号内 `#` 不当注释）；frontmatter 与 Issue form 都转成 `IssueTemplate`；`renderIssueForm` 把字段拼成 `### 标题` + `- [ ]` 清单 + placeholder 注释。22 条单测。
  - `GistsPage` / `GistPage`：列表带私有徽标，详情可 star / 复制全部 / 复制链接 / 浏览器打开 / 删除（二次点击确认），编辑态多文件增删改名。新建用空 id 直接进编辑态，保存后 `replaceTopTo` 换成详情，返回不会回到空表单。
  - `ComposeSheet`：Issue 顶部加模板 chips（`config.yml` 排除、大写/小写目录都试、坏模板跳过不阻断）；PR 模板自动预填并显示用了哪个文件。模板带的标签随创建提交，GitHub 回 422 时去掉标签重试一次。
  - 搜索：`Route.search` 加 `repo?`，从仓库页放大镜进入后锁定 `repo:o/r`，类别收窄为代码 / Issue / PR / 提交；代码结果 `onOpenCode` 直接开文件，提交结果 `onOpenCommit` 直接开提交（原来都只回仓库根）。
  - `lib/clipboard.ts`：从 `CodePage` 抽出 `copyText`，Gist 复用。
  - 实测（390×844，Playwright + 真构建产物）：Gist 列表 2 行 → 详情 208 B / 2 评论 → 编辑只发 `ci.yml` 且描述更新 → 新建 POST `hello.txt`（私有）→ 删除二次确认后 DELETE 发出；模板 chips `空白 / Bug report / 功能建议`，套用后标题 `[Bug] `、正文含 `### 复现步骤` 与 `- [ ]`；限定搜索请求带 `repo%3Azjkl0330%2Fghx`、结果 2 行、点击进文件页显示行号内容。单测 795 → 841。
- **v0.7.3**：按 `ROADMAP.md` 的功能池推荐接了三件 —— Issue/PR 高级筛选、贡献日历、里程碑。
  - `lib/issue-filter.ts`：`IssueFilter`（作者 / 指派 / 里程碑 / 标签 / 近 N 天）、`buildIssueParams` 拼服务端 query（**作者要传 `creator` 不是 `author`**，后者是搜索 API 的限定符，写错会静默失效）、`matchesFilter` 客户端兜底（PR 端点不支持这些参数）、`activeCount` / `filterSummary` / `sinceLabel`。29 条单测。
  - `lib/milestones.ts`：`milestoneProgress`（空里程碑返回 0 而非 NaN）、`dueInfo`（7 天内 `soon`、过期 `over`、已关闭不标红）、`setMilestone` 走 `PATCH /issues/{n}`（无专用端点，传 `null` 移出）。18 条单测。
  - `stats.ts`：`contributionGrid`（13 周 × 7 天，列从周日起，`future` 标今天之后；用 `Date.UTC` 的日历坐标推算避免时区挪一天）+ `gridLevel`（固定阈值 1 / 2-3 / 4-6 / 7+，不用分位数 —— 分位数会让整体很闲时也出深格子）。12 条单测。
  - `IssueFilterSheet`：作者 / 指派（我·无人·已指派）/ 里程碑（带百分比）/ 时间四段；Issue 与 PR 共用，PR 侧写明「只能在这一页里筛」。
  - `IssuesPage` / `PullsPage`：状态分段右侧加漏斗按钮（有条件是「筛选 N」），下方一行摘要 + 清除；标签 chips 并入 `adv.label`，与弹层同一份状态。
  - `IssuePage`：加「里程碑」按钮与选择区，pill 用新的 `.detail-pills`（`.pill` 自带 `margin-left:auto`，多个会各占两端）。
  - `DashboardPage`：`ContributionGrid` 用 SVG（正方形格子，`viewBox` 等比缩放），`fill` 走 `--grid-0..4` 五个 CSS 变量；下方给总数 / 活跃天数 / 单日最高与口径说明。
  - 实测（390×844，Playwright + 真构建产物）：日历 91 格 / 5 个未来虚线格 / 共 158 次 / 活跃 51 天；Issue 4 行 →「无人指派」2 行且请求带 `assignee=none` → 叠加「近 7 天」1 行且带 `since` → 清除回 4 行无摘要；里程碑 PATCH `{milestone:2}`，pill 从「v0.7 收尾」变「v0.8 计划」且旧的消失；PR 2 行 → 作者我 1 行。单测 841 → 900。
- **v0.7.4**：功能池里的三个小成本项 —— 提交列表分页、README 目录、仓库置顶。
  - `code.ts`：`listCommitsPage` 返回 `{ items, next }`，`next` 走 `paging.nextPage`（有 `Link` 按 `Link`，没有就按「本页满 30 条」推断）；`mergeCommits` 按 sha 去重 —— force push 后分页边界会吐重复项，不去重会出现重复行与虚高条数。`listCommits` 保留为包装，调用方不需要改。11 条单测。
  - `lib/toc.ts`：`buildToc` 只收 1–3 级标题、按**最小级别**归一化 `depth`（很多 README 从 `##` 起，照 level 硬编码会让整排缩进一格）、少于 3 个标题直接返回空、最多 40 条；`tocAnchor(index)` 用块下标当锚点（同名标题很常见，slug 会撞）；`activeHeading(offsets, scrollTop, slack)` 返回已越过顶部留白的最后一节。17 条单测。
  - `lib/pins.ts`：`parsePins` 只认 `owner/repo` 形态、去重、上限 60，脏数据一律丢；`togglePin` 大小写不敏感；`applyPins` 把置顶项按**添加顺序**提到最前，其余保持当前排序；`pinKey(accountId)` 按账号分片。21 条单测。
  - `CommitsPage`：底部换成分页按钮，累积合并；刷新一律回第 1 页（用户点刷新是要最新的，不是接着翻）；翻页失败单独一条错误条 + 重试。
  - `ReadmeSheet`：目录按钮只在标题 ≥3 时出现。**目录必须是覆盖层**：先做成 `.sheet` 里的 sticky 面板，它占高度会把正文整体下移，跳转位置按「有目录」的布局算，一收起就偏一屏（实测 scrollTop 从 1804 变 0）。现在 `.toc-mask` 是 `position:fixed`，不参与布局。
  - `RepoList`：行尾 `.pin-btn` 放在 `.row-main` **之外**（放在里面长仓库名会把钉子挤出屏幕），`e.stopPropagation()` 防止顺手打开仓库；置顶行加 `pinned` 类画左侧竖线，不用 `:has()`（minSdk 23 的旧 WebView 不认，会静默丢整条规则）。
  - 置顶不写审计：一天能点十几次，会把真正的写操作淹掉。
  - 实测（390×844，Playwright + 真构建产物）：置顶 `esp32-wol` → 排首、有 `pinned` 类、toast 正确；钉第二个后 `[esp32-wol, niuma, ...]`（按添加顺序）；**刷新页面后仍是这个顺序**（落盘生效）；取消后回到原位；提交历史 30 → 60 → 72 条，末页显示「已到最早一条，共 72 条」；目录 9 条、点「常见问题」滚动 0 → 1804、重开目录高亮「常见问题」、面板自动收起；console 零报错。单测 900 → 941。
- **v0.7.5**：功能池里的另外三项 —— 通知直读、搜索命中高亮、批量操作扩展。
  - `notifications.ts`：`threadComments`（Issue 与 PR 共用 `/issues/{n}/comments`，取最近 8 条）；`threadNumber` 解析 `/issues/12` 与 `/pulls/7` 两种 URL；评论**显式按 `created_at` 排序**而不是 `reverse()` —— 镜像偶尔忽略 `direction=desc`，靠 reverse 会把顺序弄反；`isFreshComment` 标 24 小时内。
  - **修了一个存量 bug**：`subjectTarget` 原来只匹配 `/issues/(\d+)`，而 PR 的 `subject.url` 是 `/pulls/7`，于是 PR 通知点进去落到仓库首页。现在两种都认，`PullPage` 能正常打开。
  - `search-ext.ts`：`highlightTerm` 从查询串里剔掉 `key:value` 与 `key:"a b"`，取剩下的第一个词。整串丢给查找栏一条都匹配不上（文件里没有 `repo:` 这种字面量）。
  - `routes.ts`：`Route.code` 加 `find?`，`routeKey` 带上它；`CodePage` 加 `initialFind`，**等文件加载完再开查找栏**（提前开会拿到空行数组，计数显示 0/0），用 `seeded` ref 防止重渲染时反复重置。
  - `repos.ts`：`BatchAction` 封闭枚举（visibility / archive / unarchive / topics）+ `planBatch`（纯函数，先算出 label / destructive / blocked / skip）+ `runBatchActions`（串行 + gap，逐条回执）。`runBatch` 保留为可见度专用包装，行为不变。
  - 加话题必须先 GET 再合并：`PUT /repos/{o}/{r}/topics` 是**整体替换**，直接写会把仓库原有话题全冲掉。`mergeTopics` 做归一化 + 去重 + 20 个上限。
  - `BatchSheet`（三态：确认 / 执行 / 结果）取代 `VisibilitySheet`（已删）；`BatchPickSheet` 放归档、取消归档与话题输入。警告文案按动作区分：转私有说「失去 star」，归档说「变只读」。
  - `IssuePage` 对缺失 `labels` 兜底（`issue.labels?.length ?? 0`）：mock 数据缺字段时整页会白屏，真实环境虽有但畸形响应同样会炸。
  - 实测（390×844，Playwright + 真构建产物）：通知 2 条 → 面板 2 条评论（Markdown 标题块与引用块都渲染、24 小时内标绿）→ 标记完成后列表剩 1 条且 DELETE 真的发出 → 第二条（PR）「打开完整页面」到 `#7` 且标题正确；搜索 `useState` → 1 条结果 → 文件页查找栏自动打开 `1/41`、41 行高亮、当前命中 1 行；批量选 2 个 → 更多 → 归档（黄色只读警告、红色确认按钮）→ 两条「已完成」→ 归档后列表只剩未归档的；话题输入 `React, 工具` 解析出 `react`（中文按 GitHub 规则丢弃）。console 零报错。单测 941 → 975。
- **v0.7.6**：功能池最后一项 —— 多账号并行工作区。
  - `lib/workspace.ts`：`Workspace`（路由栈 / 列表 / 快照时间 / 搜索词 / 可见度 / 排序 / 未读 / 置顶）+ `saveWorkspace` / `restoreWorkspace` / `dropWorkspace` / `patchWorkspace` / `hasContent`。全是不可变表操作，不碰 React。13 条单测。
  - `saveWorkspace` 对数组字段逐层复制：`{...ws}` 只拷引用，外面继续 `pins.push()` 会把「历史现场」也改掉（第一版就是这么挂的，测试逮到）。
  - `App.activate`：切走前 `saveWorkspace(liveRef.current)`，切换后 `restoreWorkspace(id)` 恢复；`liveRef` 每次渲染同步一次，避免把七八个 state 塞进 useCallback 依赖。
  - `clientsRef`：按账号缓存 `GitHubClient`，请求缓存挂在实例上，切回来第一屏直接吃缓存（实测每账号列表请求只发 1 次）。
  - `loadSeq`：列表拉取领序号，切账号或连点刷新让旧请求作废，`setRepos` / `setRepoError` / `setLoadingRepos` 全部按序号判断 —— 否则 A 的 6 页回来会覆盖 B 的列表。
  - `wipeWorkspaces()`：锁定保险库与删号都要清客户端实例（里面存着解密后的令牌），锁定路径顺带 `loadSeq += 1` 让在飞请求失败。
  - 实测（390×844，Playwright + 真构建产物，两个 mock 账号）：A 搜 `main` 剩 1 行 → 进个人页 → 从个人页切 B（B 回主界面、列表是 B 的、搜索框为空）→ B 进个人页 → 切回 A（回到 A 的个人页、账号 `@zjkl0330`）→ 返回主界面搜索框仍是 `main`、仍 1 行 → 再切 B 回到 B 的个人页。列表请求 `{a:1,b:1}`。console 零报错。单测 975 → 988。
- **v0.7.7**：多账号不再只是「切换」，一条动作可以同时作用到多个账号。
  - `lib/multi.ts`：`planMultiTasks`（先算每个账号是做还是跳过：已 star / 本来没 star / 已有复刻）+ `defaultSelection` + `toggleSelection` / `toggleAllSelection` + `runMultiTasks`（串行 + `onDone` 逐条回调）+ `summarize`。17 条单测。
  - 串行而不是并发：同一枚令牌连敲 GitHub 会撞二级限流，六七个账号串行也就多花一秒，换来一条能看懂的回执。
  - 跳过规则按动作分开：「已 star 过」「本来就没 star」「已有复刻」。**已有状态的账号在面板里不可勾**（勾上却不执行比不许勾更让人困惑）。
  - `MultiAccountSheet`：勾选框 / 头像 / 账号名 / 状态标签 / 逐条结果。跑起来后那一行立刻从「待执行」变「已完成」，不做转圈等全部跑完。
  - `RepoDetailSheet` 加 `onMultiStar`：多账号时 Star 行改成进面板（只有一个账号时不传，保持点一下直接生效的老手感）；`starTick` 让批量结束后详情页重查一次状态。
  - `ForksSheet` 同理加 `onMultiFork` / `forkTick`；当前账号已复刻时，「打开我的复刻」旁边多一个「让其他账号也复刻」。
  - `backnav`：`SheetName` 加 `multi`，`sheetBackTarget` 加第五个参数 `multiReturn` — 面板可能从详情进来也可能从复刻页进来，返回要各回各的。
  - **修了一个存量 bug**：`activate` 里的归属探测引用了重构时删掉的 `v`（`vaultRef.current`），异常被 `.catch(() => {})` 吞掉，导致首个导入的账号永远「未校验」，`@login`、复刻归属、「你」标记全部退化。发现方式：`tsc --noEmit` 读的是 solution 配置等于空跑，改 `tsc -b` 才暴露。
  - 实测（390×844，Playwright + 真构建产物，两个 mock 账号）：详情页 Star 行提示「2 个账号可同时操作」→ 面板两行都是「将 star 这个仓库」且默认全选 → 执行 → 两行「已完成」、toast「2 个账号已 star」、服务端两个令牌都置为已 star、关面板后详情页变「取消 Star」；复刻页「让其他账号也复刻」→ 面板里 A「已有复刻，不用动」不可勾、B 可选 → 执行 → toast「1 个账号已提交复刻」、只有 B 发了 POST；关面板回到复刻页。请求轨迹 `PUT starred [a] → PUT starred [b] → POST fork [b]`，console 零报错。单测 988 → 1006。
- **v0.7.8**：下载统一到一处，并支持应用内安装。
  - `lib/download.ts`：`DownloadTarget`（apk / asset / archive）+ `mirrorOfUrl`（按 base 前缀最长匹配反查站点，避免 `github.com` 抢走自建站）+ `measureRoutes` / `rankRoutes` / `fastestRoute` + 进度与文件名工具。候选顺序**不在新模块里重排**，直接沿用 `releaseCandidates` / `archiveCandidates` —— 那里的顺序是实测出来的（自建站对 release 资产 302 到 522 等），挪一次等于把坑再踩一遍。
  - `native-download.ts` + `DownloadPlugin.java`：`HttpURLConnection` 流式写 `getExternalFilesDir(DIRECTORY_DOWNLOADS)`，每 200ms 推 `progress` 事件（含瞬时 KB/s）；完成后 `FileProvider` + `ACTION_VIEW` 拉起安装器。`canRequestPackageInstalls()` 为 false 时跳 `ACTION_MANAGE_UNKNOWN_APP_SOURCES` 并回 `needPermission`。
  - **不用 CapacitorHttp 整包返回**：4 MB 一次性进 JS 内存既慢又容易被系统回收；也不用 `getContentLengthLong()`（API 24，本项目 minSdk 23），改成手动解析 `Content-Length`。
  - **应用内只对 `.apk` 开放**：其它附件落在 App 私有目录，文件管理器看不到，选了应用内反而更难找到 —— 此时面板强制「交给浏览器」，设置说明里写清这个边界。
  - `DownloadSheet`：线路表复用 `.multi-row` 骨架；打开即逐条测速（4 条 × 256 KB），结果按 `${kind}:${首个候选 URL}` 缓存 6 小时；应用内失败自动换下一条，最多试三条。
  - `backnav`：`SheetName` 加 `download`，`sheetBackTarget` 加第六个参数 `downloadReturn` —— 面板可能从更新弹层、发行版面板、仓库详情或仓库主页进来，各回各的。
  - 接入点：`UpdateSheet` 主按钮改为打开面板；`ReleasesSheet` 的资产 `<a>` 改成按钮回调；`RepoPage` / `RepoDetailSheet` 的源码 ZIP 走 `onDownloadArchive`（保留旧 `openArchive` 作为调用方未接线时的兜底）。
  - 实测（390×844，Playwright + mock 三条线路）：设置页「下载方式」在、网页版「应用内下载」禁用且说明写「一律交给浏览器」；更新面板 → 面板标题 `ghx v0.7.8 安装包`、副标题带 4.2 MB、三条线路 `2.5 MB/s / 451 KB/s / 17 KB/s`、最快标 gh-proxy；点「用浏览器下载」后 `window.open` 恰好 1 次且拿到的是**最快那条**；关面板回到更新面板。发行版附件 → 标题 `ghx-0.7.8-debug.apk`；源码 ZIP → `ghx-main.zip`、三条线路分别标「codeload 直取 / 经 github 302 / codeload.github.com」、说明改为「完成后可直接打开」。console 零报错，单测 1006 → 1042。
  - APK 校验：指纹 `fd6a8ea4…b2de` 不变、versionCode 708 / versionName 0.7.8、`REQUEST_INSTALL_PACKAGES` 在包内、`file_paths.xml` 含 `external-files-path name="downloads"`、dex 里 `DownloadPlugin` 与 `download/install/cancel` 三个方法都在。
  - **未验证**：沙箱没有 adb / 模拟器 / `/dev/kvm`，真机上「下载 → 安装器 → 覆盖安装」这一段没跑过；JS 与 Java 的字段名做了逐项比对（插件名、方法名、`url` / `fileName` / `expectBytes` / `path`、`progress` 事件、`path` / `bytes` / `ms` / `opened` / `needPermission`、FileProvider authority）全部一致。

- **v0.7.9**：自述里的链接真能点了，正文更黑，列表能翻页。
  - **根因不是样式**：`markdown.ts` 的 `inline()` 第 43 行把 `[文字](地址)` 替换成 `$1`，地址就地丢掉；`Block` 类型里根本没有 link 这种块。所以整篇 README 一个可点链接都没有，跟有没有给 `a` 上色无关。另有一半原因在表格：`renderBlock` 压根没有 `table` 分支，表格直接不渲染。
  - `Span` + `parseInline()`：有序规则表扫描，同位置命中按数组顺序取优先。**刻意不用后行断言** `(?<!…)` —— iOS 16.4 以前不支持，正则会直接抛语法错误，表现为整页白屏。斜体只认 `*`，不认 `_`（`snake_case` 遍地都是）。
  - **块上多挂 `spans` 而不是替换 `text`**：翻译、摘要、缓存全都读 `text`，换字段等于把三条链路重写。另存 `spansFor`（生成 spans 时的纯文本快照），机翻换掉 `text` 后两者不等，渲染侧自动退回纯文本 —— 否则译文里会混进一截原文。
  - `Block` 的 `spans` / `spansFor` 直接展开在每个分支上，**不用 `& Rich` 交叉类型**：交叉会让 TS 丢掉对象字面量的隐式索引签名，`Block` 随即不满足 `translate.ts` 的 `BlockLike`（那里靠 `[key: string]: unknown` 遍历）。
  - `mdlink.ts`：`safeHref`（只放行 http/https/mailto/tel/锚点，`javascript:` 与 `data:` 渲染成纯文字）、`joinPath`（`..` 顶到仓库根就返回空串，不拼出 404 地址）、`resolveHref`（相对路径按**自述所在目录**算，不是仓库根）、`isRepoPath`。
  - `toc.ts`：`slugOf` + `anchorIndexOf`。同名标题按 GitHub 规则补 `-1` / `-2`，`#修复-1` 落到第二处。
  - `SpanText`：链接渲染成 `<button class="md-link">` 而不是 `<a href>` —— WebView 里点 `a` 会先走一次真实导航，长按、中键、无障碍焦点都可能把当前页顶掉。
  - **表格单元格改为保留原文**：`splitCells(line)` 不再 `.map(inline)`，改由渲染层 `SpanText` 解析；`blocksToText` / `summarize` 里才清洗。不这么改，表格里的链接与 `代码` 永远没有格式。
  - 字体：浅色主题 `--text` / `--text-2` / `--text-3` / `--text-dim` / `--icon-dim` / `--text-dim-rgb` 统一乘 0.8（`#424a53` → `#353b42`）。**深色主题不动** —— 那里「加深」等于更难看清。
  - `ui/useMore.ts`：首屏仍归 `useLoad`，这个只管后续页。筛选一变就清空（否则新旧筛选的页会混在一起），页码与在途状态放 ref（闭包里的 state 是旧的，连点两次会拉同一页），不满一页即判定到底（镜像站常吞 `Link` 头）。接在 Issue / PR 列表上。
  - 星标：首屏仍拉 3 页，`nextPage` / `allLoaded` 支撑后续加载，去掉 150 硬顶。
  - 实测（390×844，Playwright + mock 一份链接密集的 README，浅/深两套主题）：`.md-link` 13 个、表格 1 张、表格内 `.md-icode` ≥1 且 `.md-link` ≥2；链接 computed color `rgb(9, 105, 218)`、`text-decoration-line: underline`；点第一个链接 `window.open` 打开 `https://x.com/hassanyehiiaa` 且地址完全一致；正文 `max(r,g,b) ≤ 66`。脚本 `scripts/verify-md.py` 可重跑，截图 `docs/screenshots/md-links-079.png`。console 零报错，单测 1042 → 1103。
  - **CI 产物下载**：`GET /repos/{o}/{r}/actions/artifacts/{id}/zip` 必须带令牌，且 302 到 pipelines 的签名地址；浏览器路径拿不到（`redirect: 'manual'` 只能读到不透明响应，`Location` 为空），所以只有一条线路、只能应用内下。`DownloadPlugin` 新增 `headers` 入参，并把 `setInstanceFollowRedirects` 关掉改成手动跟 5 跳 —— **跳转后不再带 Authorization**，签名地址本身不需要，也没理由把令牌交给别的域。产物不是安装包，下完不调安装器，只提示落盘位置。网页端因为 `isNativePlatform()` 为 false，面板直接禁用主按钮并写明「要在 App 里下载」，不装作能下。
  - **仍未验证**：产物这条 UI 分支（运行 → 日志 → 产物 → 下载面板）没在浏览器里实走，要构造 Actions 全链路 mock 才点得进去；原生「带令牌请求 → 302 → 签名地址」也没真机跑过。已做的静态比对：JS 传 `headers`、Java 用 `call.getObject("headers")` 读，字段名一致；`artifactTarget` 的 URL / `auth` 标记 / 文件名 / `installable` 有 7 条单测。

- **v0.8.0**：剪贴板直达 —— 从别处复制一个 GitHub 地址，切回 App 就落在那个页面上。
  - **Android 10+ 禁止后台读剪贴板**，这是系统限制，不是没做。可用的时机只有两个：冷启动（`client` 一就绪）与 `appStateChange` 的 `isActive: true`。所以「在后台读」实际是「回前台那一下读」，设置页的说明里把这点写明了，没有含糊成「实时监听」。
  - **冷启动不要用固定延时**。最初写的是 `setTimeout(1200)` 等启动流程，但解密保险库要多久取决于设备：早了 `client` 还是 null（探测被 `ready` 判定跳过），晚了白等。改成 `useEffect([client])` —— 客户端一就绪就探，天然对齐。
  - `lib/clipboard-link.ts` 全是纯函数：`parseClipRoute`（SSH / 带协议 / 不带协议 / 分享文案夹带 / 中文标点尾巴）、`looksSecret`、`clipFingerprint`、`clipBlockedByRoute`、`parseClipOpen`。37 条单测。
  - **`github.com` 前面必须有 `[^\w.-]` 边界**。少了它，`notgithub.com/a/b` 会被从中间截出 `github.com/a/b` 当成真地址；`gist.github.com` 也靠这条规则挡住（前面是点）。
  - **不接裸 `owner/repo`**。`src/lib`、`docs/api` 这类字符串在代码里到处都是，误判的代价是把人从当前页面硬弹走，比「少认一种写法」糟得多。
  - **指纹而非原文落盘**：djb2 + 长度，只回答「这条是不是刚处理过」。令牌类内容（`ghp_` / `github_pat_` 等）连指纹都不写 —— 没有理由把凭据的存在痕迹留在磁盘上。
  - **三种情况主动放弃跳转**：有弹层开着（会把弹层顶掉）、正在编辑文件或 Gist（会冲掉没保存的输入）、`client` 为空（还没解锁，跳了也没数据）。判断放在 `probeClipboard` 开头，每次触发都重新看当前状态（经 ref 读，不进监听器依赖数组）。
  - 停在同一个页面时只记指纹、不压栈、不弹提示 —— `pushRoute` 虽然会去重，但提示还是会响一下，吵。
  - 插件用官方的 `@capacitor/clipboard`（7.0.4）。**不能改用 `navigator.clipboard.readText()`**：Android WebView 不会给这个页面授 `clipboard-read`，自动调用必然 reject；官方插件在原生侧走 `ClipboardManager`，没有这个问题。
  - 实测（390×844，Playwright + mock，`scripts/verify-clip.py`，9 个断言点）：写 URL 后派发 `visibilitychange` → 顶栏变 `clist-cf`、提示「从剪贴板打开 zjkl0330/clist-cf」；同内容再触发 → 页面不动、无提示；换 issue 链接 → `#12`；换 `tree/main/src/lib` → 代码页 `lib`；换只有用户名的地址 → `@zjkl0330`；令牌内容 → 页面不动、无提示；设置页关掉开关 → 新链接不跳；重新开启 + 清指纹 + 整页重载 → 自动跳到 `esp32-wol`。console 零报错，单测 1110 → 1150。
  - **仍未验证**：真机上 `appStateChange` 的触发时机（Android 12+ 读剪贴板会弹系统的「已粘贴」提示，属于系统行为，App 无法抑制）。Web 端验证的是同一段逻辑的等价事件路径，不是 Android 的 `onResume`。

- **v0.8.1**：无令牌也能看热门。
  - 表因有两层。架构层：没导入令牌时 `client` 就是 `null`，`HotPage.load` 第一句 `if (!client) { setRepos([]); return }`，页面停在空态。协议层更隐蔽 —— `request()` 无论有没有令牌都写 `Authorization: Bearer ${this.token}`，空令牌拼出来是 `Bearer `（后面什么都没有），GitHub 认它是坏凭据并回 **401 Bad credentials**，而不是按匿名请求处理。两条都修掉才算真的能用。
  - `GitHubClient` 现在把 `token.trim()` 后存，空串即 `anonymous`；鉴权头集中到 `authHeaders()`，空令牌返回 `{}`。`rawText` 与 `request` 共用这一处，避免两边再次走偏。
  - App 里另建一个 `guestClient`（空令牌、默认 `api.github.com`），只在 `client === null` 时喂给热门页；不复用同一个实例是为了让缓存与配额互不污染。
  - 游客只读：star 按钮直接 `display:none`（留着点一次报一次错），页面顶部写明「游客模式」。匿名搜索配额只有 10 次/分钟，所以**预取另外两个时间段必须关掉**，否则点两下就限流。
  - 缓存按 `GUEST_ID = 'anon'` 单独存一份，登录后不会把游客那份当成账号快照，退出登录也不会被按账号清掉又在同一秒重建。
  - 实测（390×844，Playwright + **不 mock 任何请求**，`scripts/verify-guest.py`）：无令牌直接进主界面 → 点热门 → 30 行真实仓库、副标题「刚刚更新」、游客提示在、可见 star 按钮 0 个、抓到的请求头全部没有 `Authorization`；切 TypeScript 仍然 30 行。单测 1150 → 1153。
  - **仍未验证**：真机匿名配额下的实际可用次数（网页端 10 次/分钟是同一个池，切换时间段 + 语言很容易打满）。

- **v0.8.2**：底栏改成高透液态玻璃。
  - **「不透」的两个真因都不是 alpha**。一是 tint 用了页面底色（`24,29,36`），叠在 `#0D1117` 上合成 `rgb(17,21,28)`，对比度 1.03:1 —— 人眼判定「这里没有东西」，降到 0.05 也一样；必须掺白。二是 `.glass-backdrop` 的压暗写到了 `rgba(1,4,9,0.5)`，它铺在正文与底栏之间，把滚过的文字压成黑，玻璃再薄也只能透出黑。压暗降到 0.1、tint 换白色 0.075 之后才有真正的穿透。
  - 量化口径：同一位置滚动到 620px 与 980px，取胶囊内部（避开图标与药丸）的像素均值，真实玻璃差约 2.5 级；把底栏临时改成不透明 `#000` 后两次完全相同。这条对照写在 `scripts/verify-glass.py` 的同源诊断里，是判断「到底透没透」的唯一可靠办法 —— 肉眼看整屏缩略图会误判成实心块。
  - **渐变淡出不能靠底栏自己**。`backdrop-filter` 的边界是硬边，只给 `.tabbar` 加模糊，文字滚到上缘会从「完全清晰」跳到「完全模糊」。做法是在 `.tabbar` 与正文之间那层 `.glass-backdrop` 上也加模糊，并用 `mask-image: linear-gradient(to top, #000 0 44%, transparent 72%)` 让模糊从底栏内部往上渐隐；44% 是 `58/132`，正好等于底栏高度，再高就会把底栏上方的内容提前糊掉。
  - `--glass-rim` 从 conic 整圈镜面环改成「从上往下淡出」的线性渐变，配合原来的 1px mask 后只剩上缘一条会化没的高光。整圈环在小尺寸下读起来就是分割线，与「液态玻璃」相抵。
  - 底色改成 `linear-gradient`（上缘 22% 浓度 → 下缘 100%），内容进入时先碰到几乎没有底色的区域。顶部不能给 0：完全为 0 时玻璃上缘消失，只剩一片悬空模糊。
  - 三档统一进 10–16px：clear 10 / normal 12 / thick 16。超过 16px 时 3σ 已大于栏高，14px 正文被平均成纯色。
  - 图标用 `filter: drop-shadow(...)` 而不是把 text-shadow 套在按钮上 —— 后者对 SVG 无效；浅色主题不加，深色图标配白影只会让边缘发毛。
  - 实测（390×844，Playwright + mock，`scripts/verify-glass.py`）：浅/深 × 胶囊/通栏 × 三档共 7 组，每组断言底色是渐变、blur 在 10–16、`borderTopWidth=0px`、文字阴影非 none；浅色底栏像素 σ=28.8、深色 37.7（纯色板接近 0）。截图 `docs/screenshots/glass-*-082.png`。
  - **仍未验证**：真机 GPU 下的折射观感。xvfb 是软件合成，`backdrop-filter` 的采样偏弱，整屏缩略图里底栏比真机更像实心块；放大到 2× 才能看清背后的字。
  - 老 WebView 的降级路径同步改了：`@supports not (backdrop-filter)` 里补的是实色 `border`，因为基础样式已经没有边框，只写 `border-color` 不会画出线。

- 已知边界：发行版附件上传在 WebView 路线走不通（预检不放行 `Content-Type`），要传只能自写原生流式上传，本版未做；通知与 Watch 仅 classic 令牌；私有仓库 README 图片仍待修；无密钥时 MyMemory 额度有限。

## AI（方案已定，未开工）

`docs/ai-plan.md`。一句话：**默认走本地执行器** —— AI 只输出封闭枚举里的「动作」，客户端校验 + 确认 + 用自己的令牌执行，令牌一步都不离开设备。破坏性动作（删仓库、改可见度、force push、合并 PR）压根不进枚举。

用户提的「环境变量代理」在 Worker 上成立，但有两个前提：工具必须是**有语义的白名单**（不能是 `gh_api(method, path, body)` 万能代理，那等于把令牌整个交出去）；并且要接受「令牌从本机搬到 Cloudflare」这个安全模型的改变，所以只能默认关闭。

## 跨平台（方案已定，未开工）

方案在 `docs/cross-platform.md`，三条结论先记住，别重复调研：

1. **iOS 用 Capacitor 7 iOS，桌面用 Tauri 2**。Capacitor 官方没有桌面平台，`@capacitor-community/electron` 停在 Cap 5/6。
2. **最低版本 iOS 15.4 / macOS 12**，正好卡在 `mask-composite` 进 Safari 的版本（MDN BCD：Safari 15.4）。低于它镜面环要么写 `-webkit-mask-composite: xor` 旁路，要么整条不画。
3. **玻璃不需要为 iOS 另调参数**。实测 Chromium 145 与 WebKit 26 在底栏上的区域均值差 ≤6.6，环的像素差 ≤2；唯一可见差异是 WebKit 文字抗锯齿更粗（单像素能差 70），所以判定用区域均值，别用单像素。

复跑对比：`pnpm build` → `npx vite preview --port 4199` → `xvfb-run -a python3 scripts/probe-webkit.py`。
