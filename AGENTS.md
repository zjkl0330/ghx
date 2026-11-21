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

# 预览端口必须是 4173：scripts/verify-*.py 里硬编码了这个地址，
# 换成别的端口，所有浏览器验证脚本会连不上、报「connection refused」
npx vite preview --port 4173
```

跑浏览器验证（有头 Chromium，headless 不渲染 backdrop-filter，玻璃会拍成色板）：

```bash
xvfb-run -a python3 scripts/verify-archived.py    # 换你想跑的那个
```

打 APK（环境已就绪，不要重新装 SDK）：

```bash
cd android && JAVA_HOME=/opt/jdk-21.0.2 /opt/gradle-8.11.1/bin/gradle assembleDebug
# 等价写法：JAVA_HOME=/root/.sdkman/candidates/java/21.0.13.1.2-amzn ./gradlew assembleDebug
# 产物 android/app/build/outputs/apk/debug/app-debug.apk
# 对齐/签名：/opt/android-sdk/build-tools/35.0.0/{zipalign,apksigner}
```

> 别用 `java -version` 猜 JAVA_HOME：默认 java 可能是 17 或别的，AGP 8.x 要 21。上面两条路径实测都能用。

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
| `repos.ts` | 仓库归一化、筛选（`RepoFilterVisibility` 四档：全部/公开/私有/**归档**）、`countBy`（公开+私有=全部，都不含归档）、批量动作计划 `planBatch` / `runBatchActions` |
| `sort.ts` `stars.ts` `topics.ts` | 排序、语言分组、话题解析 |
| `snapshot.ts` | 仓库列表冷启动快照 |
| `storage.ts` | KV 抽象（Capacitor Preferences / localStorage / 内存） |
| `mirrors.ts` | 下载加速站：站点表、测速、URL 拼接、**自定义站点与改地址** |
| `update.ts` | 自更新：版本比较、加速站 URL、打开外部链接、`headReachable` 下载探活 |
| `releases.ts` `forks.ts` `workflows.ts` | 发行版/复刻/工作流的状态与校验 |
| `readme.ts` `markdown.ts` `images.ts` | README 解码、自研 Markdown 解析为 Block（含参考式链接展开 `expandLinkRefs`）、图片路径与镜像 |
| `translate.ts` | 多通道机翻：Edge / Azure / MyMemory / Google，切段、降级、缓存键，`translateBlocks` 支持 guard 钩子（翻译前改写/还原）；`isNameLike` / `looksLikePinyin` 把拼音与代号型简介挡在翻译之外 |
| `linkguard.ts` | 机翻保链接：链接标签换成 ⟦⟧ 占位符（实测 Edge 幸存 6/6 且标签被顺便翻译），译文按出现顺序回填 spans；通道吞掉占位符时退回纯译文 |
| `search.ts` `trending.ts` `hotCache.ts` `tabs.ts` `theme.ts` `backnav.ts` `audit.ts` `types.ts` | 搜索语法、热门查询、热门榜单缓存（内存 + 本机快照 + 淘汰）、底栏配置、主题、返回键决策（软键盘视口启发式 `softKeyboardOpen`）、审计、领域类型 |
| `apkstore.ts` | 热门页「APK 商店」入口 + 清单弹层：komi-store 三源合并目录（feed 轮换精选 + most-popular + new-releases，去重 ~174+，静态 JSON 非 GitHub API），多线路候选（自建站队首/官方 raw/公共代理）、rotation 缓存 6h（缓存键 v2）、`avatarSources` 头像多线路回退（原图 → 自建站头像域名 → url 风格代理改写 → 首字母）、新旧 schema 双认（stargazersCount/stars、owner.avatarUrl/顶层 avatarUrl）、`apkPlatforms` 平台归属、`apkAppToRepo` 复用仓库详情链路 |
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
| `download.ts` | 下载域：`DownloadTarget`（apk/asset/archive）、`mirrorOfUrl`、`measureRoutes`（**分批并发**）、`rankRoutes`（先分档再比速度）、`SpeedBoard`（按站点存、按自然日有效）、`parseDlParts` / `PARTS_OF`（分片偏好） |
| `native-download.ts` | 原生下载桥：`status` / `exists` / `takePending` / `notifyState` / `openNotifySettings`，字段与 `DownloadPlugin.java` 逐项对齐 |
| `dl-history.ts` | 下载记录：`pushRecord` / `parseHistory` / `removeRecord`，上限 60、去重键 `repo\|kind\|name`、取消不留记录 |
| `graphql.ts` | 批量查发行版资产（一页仓库一次请求）；`NOT_FOUND` 缓存空、`FORBIDDEN`/`RATE_LIMITED` 不缓存 |
| `rel-badge.ts` | 仓库行 APK / EXE 标记的判定与缓存键 |
| `font.ts` | 界面字体偏好：`readFontPref` / `writeFontPref` / `applyFont`（只写 `<html data-font>`） |
| `update-pref.ts` | 更新提示开关：只有明确存了 `off` 才关，读不到按开 |

> 原生层（`android/app/src/main/java/dev/zjkl/ghx/`）：`MainActivity` · `InsetsBridge` · `ImmersivePlugin` · `DownloadPlugin` · `DownloadHub`（进程级单例，活的下载线程在这里） · `ChunkedFetch` / `ChunkPlan`（4 路分片，**不依赖 android.\***，能在普通 JVM 上真跑） · `NotifText`（通知文案格式化，同样纯 Java） · `DownloadService`（前台服务） · `DownloadActionReceiver`（通知上的取消按钮） · `ApkInstaller`（安装入口，页面与通知共用）。

> 原生逻辑怎么测：`scripts/test-chunked.sh` 会 `javac` 编译 `ChunkPlan` / `ChunkedFetch` / `NotifText` + 三个测试类，在**普通 JVM** 上起本地 HTTP 服务造 206 / 200 / 302 / 限速 / 偶发 503 五种线路，跑 33 + 39 = 72 条断言。CI 里挂在构建 APK 之前，原生逻辑坏了不用等十分钟才红。**沙箱没有模拟器、没有 /dev/kvm，别指望跑 Instrumented Test。**

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

## 七个核心机制（改之前必须懂）

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
- **链接保活（v0.9.6）**：机翻只换 `block.text`，spans 一失效整段链接变死文字。解法在 `linkguard.ts`：翻译前把链接标签换成 ⟦标签⟧（U+27E6/27E7，实测 Edge 通道整存整取、标签还会被顺便翻译；**不要用数字序号**，会被中文化成「1个」），地址按出现顺序存数组，译文回来按出现顺序回填。占位符被通道吞掉时退回纯译文，不更糟。
- **参考式链接（v0.9.6）**：`expandLinkRefs` 在解析前把 `[文字][ref]`、`[文字][]`、`![alt][ref]`、快捷式 `[ref]` 展开成行内链接，`[ref]: url` 定义行收集后从正文剔除；围栏代码块内的定义与引用原样保留。LocalSend、SoftEther 这类 README 以前会吐一屏 URL。
- **GitHub 链接 App 内打开（v0.9.6）**：`mdlink.routeForGithubPath` 把 github.com 路径映射成 App 内 Route（repo/code/issues/pull/commits/actions/user），`SpanText` 有 `onRoute` 时优先 App 内跳转（收弹层、压路由），App 没有的页面（releases/wiki/discussions）与外站仍走外部浏览器。
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

### 7. 下载链路（`download.ts` + 三个 Java 类）

三段路，各自有独立的坑，别把它们混成「下载」一件事：

**候选表**（`mirrors.ts` 的 `releaseCandidates` / `archive.ts` 的 `archiveCandidates`）—— 顺序是实测出来的，**不要在新模块里重排**。要点：自建站常驻、官方恒沉底、ZIP 只有 `gh-proxy.com` 能吃 codeload。`slice(0, 6)` / `slice(0, 4)` 是探活成本的上限，加条目前先想清楚「多等一条要多久」。

**分片**（`ChunkedFetch`）—— 必须 206 才切；每跳重设 `Range`；`Accept-Encoding: identity`；定位写入；失败降级单连接。`MAX_PARTS = 4` 是实测上限，改大只会更慢。

**通知与前台服务**（`DownloadService`）—— 它是唯一能挡 Android 12+ Cached Apps Freezer 的东西，**不是「顺便加个通知」**。`handleOnDestroy` 只解绑监听、不取消下载；终态通知必须先 `DETACH` 再 `notify`，顺序反了等于没发。

`DownloadHub` 是进程级单例，`SharedPreferences` 里那份 `pending` 结果**取走即清空**，保证「界面已经没了时下载完成」也只记一次。

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
- **当 `github.com:443` 不通时（这个环境长期如此），`git push` / `git fetch` 会超时（22 MB 的字体对象尤其），改走 Git Data API**：

```bash
TOKEN=<PAT> BASE=<本地上一个提交，如 HEAD~1> python3 scripts/push-via-api.py
```

  脚本做的是 blobs → trees → commits → `PATCH /git/refs/heads/main`。`BASE` 有两个硬条件：①必须是**本地**存在的提交（要 `git rev-parse` 得到，填远端 sha 会抛 `CalledProcessError`）；②它的**树必须与远端 main 的树相同**，脚本会先比对，不一致就退出以防覆盖别人的提交。正常情况就是 `HEAD~1`。**结果：本地与远端的树相同、commit hash 不同**，属于预期。等直连恢复后再 `git fetch gh main && git reset --soft gh/main` 对齐。
- **tag 也要经 API 建**（本地 tag 推不上去）：`POST /git/tags`（附注对象）→ `POST /git/refs`（`refs/tags/vX.Y.Z`）。`object` 必须用**远端** main 的 sha，不是本地 HEAD，否则 CI 检出的是不存在的提交。
- `git tag -a -F -` 的正文用 heredoc 时加 `--cleanup=verbatim`，否则 `#` 开头的行会被当注释删掉。

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

- **v0.8.3**：下载线路扩容 + 官方降档 + 仓库行安装包标记。
  - **候选从 3 条到 6 条**。`KNOWN_RELEASE_PROXIES` 原来只有 gh-proxy.com / ghfast.top；实测 2026-11-20 对 v0.8.2 的 APK 做 HEAD，ghproxy.imciel.com（1.07s）、gh-proxy.com（2.33s）、ghfast.top（3.28s）、ghproxy.net（3.46s）都是 `200` 且 `content-length: 4392600`（与发布包逐字节一致），四条都能用。上限 `slice(0,4)` → `slice(0,6)`。**gitproxy.click 不能进表**：它回 `200` 但只有 195 字节的错误页，长度是唯一能识破它的信号。
  - **官方直连不能靠测速排序**。`probeMirror` 只拉 256 KB，测的是建连与首包，官方直连在这段常年第一；真正的差别在几百 KB 之后的吞吐衰减，探针看不见。改法：`DownloadRoute.official`（按 base 域名判定，不按 label —— 同一条线路在 `OFFICIAL_MIRROR` 里叫「官方直连」、在 `mirrorOfUrl` 里叫「GitHub 官方」），`rankRoutes` 先比档位再比 kbps。`releaseCandidates` 里当前镜像若是官方则不重复占位，官方固定最后一条。
  - **面板渲染顺序要注意测速是流式的**。`entries` 一条条回来，若直接 `ranked.map`，列表会从六行缩到两行。现在的 `order` 是「已测的（按档位/速度）+ 未测的（原顺序）」，行数恒等于候选数。
  - **仓库行的 APK/EXE 标记**：列表接口不含发行版资产，只能逐仓库查 `/releases?per_page=10`。约束是「只查当前列表、`probedRef` 防重复、结果按 `tokenId + full_name` 存 24 小时、并发 3、游客不查」。游客必须跳过 —— 匿名 60 次/小时，一页 25 个仓库就把配额吃光，热门与搜索会跟着挂。私有仓库不进这个流程（`/releases` 对无权仓库直接 404，不影响其它行）。
  - 实测（`scripts/verify-dl.py`，mock 24 个仓库）：3 行 APK、2 行 EXE、24 次 `/releases`；徽标 DOM 顺序是 `row-name → badge → badge pkg apk`；线路表 6 条且官方垫底；测速后第一条仍是代理。单测 1176 → 1181（新增 `rel-badge` 23 条，`download`/`mirrors` 各补档位断言）。

- **v0.8.4**：仓库徽标改为 GraphQL 批量，一页 25 个仓库只发 1 次请求。
  - **为什么必须改**。v0.8.3 是逐仓库 `/releases`，一页 25 个就是 25 次；REST 的 `core` 额度是 5000/小时，翻二十页归零，期间任何别的功能都会 403。这不是「可以接受」的量级。
  - **GraphQL 与 REST 是两个独立配额池**。`GET /rate_limit` 的 `resources` 里 `core` 与 `graphql` 各自 5000，实测 core 已用 33 时 graphql 仍是 0，互不扣减。所以批量这条链路现在完全不占 REST 额度 —— 这是比「25 次变 1 次」更强的论据，别只记次数。
  - 实测 2026-11-20：把 N 个 `repository(owner:, name:)` 用别名并进一次 POST `/graphql`，25 个别名 **HTTP 200、0.77s、query cost 仍是 1 点**（`rateLimit { cost }` 查的）。单个别名出错时该别名回 `null`，`errors[].path[0]` 标明是哪个，其余别名照常返回 —— 这是能用批量的前提。
  - CORS 也通：`OPTIONS https://api.github.com/graphql` → `204` + `access-control-allow-origin: *`，`allow-headers` 含 `Authorization, Content-Type`，所以 WebView 里直接 fetch 即可，不需要原生旁路。
  - **`NOT_FOUND` 与其它错误的处理必须分开**。仓库不存在/无权限是确定结论，缓存空数组（否则每次进列表都重问）；`FORBIDDEN`、`RATE_LIMITED` 是暂时的，算「没问到」，不写缓存，交给逐条路径重试。混为一谈会把一次抖动记成 24 小时的「没有安装包」。
  - **`graphqlUrl` 只在 `baseUrl === https://api.github.com` 时非空**。自建镜像与 GHES 没有同构的 `/graphql`，拼过去只会 404；返回 `null` 让整批走原来的逐条路径，别试图嗅探。
  - 结构归一成 REST 那份 `{ draft, assets }` 再交给同一个 `badgesOfReleases`，两套路径的判定规则只有一份，不会漂移。
  - 实测（`scripts/verify-batch.py`，mock 24 个仓库、拦真实请求计数）：GraphQL 正常 → `/graphql` **1 次**、`/releases` **0 次**、徽标 3 APK / 2 EXE；GraphQL 回 500 → `/graphql` 1 次 + `/releases` **24 次**回落、徽标仍是 3/2（降级不能变成没有）。单测 1181 → 1210（`graphql` 23 条 + `api` 的 `graphql()` 6 条）。
  - **仍未验证**：fine-grained 令牌只授 `metadata: read` 时 `releases` 字段的行为（可能回空 nodes，被判成「没有包」）。REST 路径有同样的权限前提，这一版没有额外劣化，但也没实测。

- **v0.8.5**：复制仓库地址在华为上冒红字。
  - **根因是「写剪贴板没走原生」**。`RepoDetailSheet` 里那一行直连 `navigator.clipboard.writeText`，没兜底也没 `try`。华为 EMUI 的 WebView 把这个接口整个裁掉，于是抛 `Cannot read properties of undefined (reading 'writeText')`，被 `run()` 的 catch 接住塞进 `setError`，`.errline` 用的是 `var(--red)` —— 用户看到的那串红字就是这个。
  - **补 try/catch 不算修好**。只吞掉错误，地址还是复制不出来。真正的解是接上 `@capacitor/clipboard`：依赖早就装了、`capacitor.plugins.json` 里也注册了、读剪贴板（`Clipboard.read`）一直在用它，唯独写走的是 web API。
  - **判断必须在取值之前**。老内核里 `navigator.clipboard` 是 `undefined`，`api && typeof api.writeText === 'function'` 这样写才安全；而且访问 `navigator.clipboard` 这个 getter 本身在某些内核会抛，取值也要包在 try 里。
  - 三条通道顺序：原生 → `navigator.clipboard` → `execCommand`。`execCommand` 路径里 `focus()` 不能省，华为 WebView 上不 focus 时选区是空的，会「复制成功但内容是空串」。
  - **兜底块的位置要贴按钮**。第一版把它渲染在弹层顶部（errline 旁边），截图一看：按钮在列表中部，点完根本看不到那块。现在插在「复制仓库地址」这一行下面，当 `.acts` 里的一整行做，接上分割线。
  - 实测（`scripts/verify-copy.py`，390×844，mock，xvfb）：①正常内核复制成功、剪贴板精确等于 `https://github.com/zjkl0330/clist-cf`、红字 0 行；②把 `navigator.clipboard` 用 `defineProperty` 置成 `undefined` 模拟华为 → 走 `execCommand` 仍复制成功、红字 0 行；③再让 `document.execCommand` 返回 false → 出现可长按兜底块、提示是中文、红字仍是 0 行；④在同一环境里跑旧写法，复现出 `Cannot read properties of undefined (reading 'writeText')` —— 这条是根因证据，不是猜测。截图 `docs/screenshots/copy-085-*.png`。
  - 单测 1210 → 1218（`clipboard.test.ts` 8 条，测的是 `copyWithDeps` 的通道选择与错误聚合，注入 fake，不碰真实插件）。
  - **仍未验证**：真机华为上的实际表现。沙箱只能模拟「接口不存在」，模拟不出它其余的内核怪癖；但原生通道不经过 WebView，理论上不受影响。

- **v0.8.6**：长简介（尤其机翻后的中文）在华为上顶出屏幕。
  - **根因还是「别指望老内核认 flex 的 min-width: 0」**。`.row-desc` 是 flex，`.desc-text` 靠 `min-width: 0` 收缩；标准内核正常，华为的 WebView 不认，`white-space: nowrap` 且没有空格的中文按 max-content 排开，整行被顶宽。实测对照：旧写法在同一注入条件下 `.row` 被撑到 **2018px**，屏宽 390。
  - **改法是「不依赖 flex 收缩」，不是再加一条 min-width**。`.row-desc` 改 `display: block` + `overflow: hidden` + `text-overflow: ellipsis`，`.desc-text` 同样是块级裁剪 —— 块级宽度只由父级决定，这是 CSS 里最老的行为，老内核算不错。纯文本调用方（个人页、工作流路径）直接往 `.row-desc` 里塞文字，所以裁剪规则在两处各写一份。
  - **「译」标必须脱离文本流**。原来靠 flex 分栏，现在 `.tr-mark` 绝对定位到 `right: 0`；有标记时给 `.desc-text` 加 `padding-right: 26px`（类名 `with-mark`，由 JSX 按有无译文决定），省略号正好停在标记左边，不需要给标记加背景去遮文字。
  - **`.row-hit` 加 `overflow: hidden` 是兜底**，不是主修法。它会把「算宽了」的结果裁在行里；但只有兜底、没有块级裁剪时，文本是被硬切掉而不是显示省略号，所以两条都要。
  - 副作用：`UserPage` 的仓库简介原来是可折行的（那边没套 `.desc-text`，`white-space` 继承 normal），现在统一成单行省略。一致，且不会再撑宽，接受。
  - 实测（`scripts/verify-overflow.py`，390×844，mock 3 个仓库 = 长中文 + 80 字符仓库名 + 长英文，Edge 翻译端点 mock 成长中文以便真的出现「译」标）：A 三页（仓库/星标/热门）文档 390/390、3 行全在屏内、3 行都出现省略、译标 1 个；B 注入 `min-width: auto`（模拟老内核不收缩）仍不溢出；C 旧 flex 写法在同样注入下 3 行被撑到 2018px —— 证明 B 的通过不是假阳性。截图 `docs/screenshots/overflow-085-*.png`。
  - **仍未验证**：真机华为。沙箱只能模拟「min-width 不生效」这一条，模拟不出它其它内核怪癖。

- **v0.8.7**：界面字体可选，默认内置 OPPO Sans 4.0。
  - **授权决定实现方式，不是「顺手加个字体」**。`OPPO Sans Fonts License Agreement` 原文（`licenses/OPPO Sans 4.0.txt`）：grant 的是 "use, copy, merge, embed, bundle, redistribute and/or sell **unmodified copies** of OPPO Sans Fonts with any software"，条件两条 ——「软件内要有显著声明」「不得对字体或任何组成部分做修改」。所以：①随包打包**合法**；②**子集化违法条款**（删字符就是修改）；③必须写明用了它。设置页那句版权说明不是装饰，是许可条件。
  - **体积就是代价，别偷偷瘦身**。官方 OPPO Sans 4.0 Regular 单个字重 `22,741,096` 字节，cmap 29197 字（GB2312 6763 字全覆盖，实测缺字 0）。APK 从 4.4 MB → **20.3 MB**（`21,243,324` 字节）。想瘦到 9 MB 只能转 woff2 或子集化，前者是灰色地带、后者明确违规，所以选了最笨但站得住的那个。
  - **只声明 400 一档**。`@font-face { font-weight: 400 }`，标题要 600 时由浏览器合成加粗；声明成 `100 900` 反而不会合成，粗体看起来没区别，还多骗自己一句「有 Bold」。
  - **`font-display: swap` 是必须的**。22 MB 字体解析要时间，`block` 会让首屏白字等字体。
  - **切换只改 `--font-ui` 一个变量**，字号行高一个字不动 —— 否则切换瞬间整页重排、滚动位置跟着跳。
  - 首屏一致性和主题、外观同一套路：`index.html` 内联脚本读 `ghx.font` 打 `data-font`，React 挂载后 `applyFont` 只做对齐。白名单在两处，改一处要改两处。
  - 实测（`scripts/verify-font.py`，390×844，mock）：字体文件 21.7 MB、本地请求 29 ms；同一串「设置字体仓库提交 Issue」在 OPPO Sans 下 **330.56px**、系统字体 **343.66px**（差 13px，证明字形真的换了，不是「显示已生效但没换」）；切系统字体后 `data-font=system` 且 `body` 字体族里不再有 OPPO Sans；刷新后保持；切回后恢复。截图 `docs/screenshots/font-086-*.png`。单测 1218 → 1227（`font.test.ts` 9 条）。
  - **踩过的坑**：第一版用 `canvas.measureText` 量宽度，两种字体都返回 106.68px —— canvas 的 `font` 简写在无头环境里静默回退，量的是同一个 fallback。改成真实 DOM（隐藏 div + `getBoundingClientRect`）才量出差异。以后测字体一律用 DOM。
  - **仍未验证**：真机 WebView 解析 22 MB 字体的耗时与内存占用。低端机可能要几百毫秒并多吃几十 MB 内存，这一版没有实测数据。

- **v0.8.8**：熄屏 / 切后台不再中断下载 + 下载记录。
  - **断的原因有三个，修一个不够**。①下载线程原来是 `DownloadPlugin` 的成员，Plugin 跟 Activity 一起销毁 —— `handleOnDestroy` 里 `cancelled = true` 加 `disconnect()`，熄屏被回收就断；②就算线程活着，熄屏后 CPU 进 suspend，`setReadTimeout(30000)` 一到就抛；③WiFi 射频在熄屏后休眠，包收不到。三条分别对应：进程级单例、`PARTIAL_WAKE_LOCK`、`WifiLock`。
  - **Android 12+ 还有第四刀：Cached Apps Freezer**。进程退到后台进 cached 状态十来秒后被整组冻结，CPU 时间归零，**wake lock 拦不住**。唯一可靠解法是前台服务。所以 `DownloadService` 不是「顺便加个通知」，是这套改动里唯一能对付冻结的那一环；它不下载，只 `startForeground` 然后等结束 `stopSelf`。
  - **两把锁都要带超时**：`wake.acquire(30 分钟)`、`setReferenceCounted(false)`。异常路径没走到 `release` 时，不能让手机 CPU 一直醒着。
  - **`handleOnDestroy` 只解绑监听、不取消下载**。这是「熄屏断开」的直接成因，`scripts/check-download-native.py` 里拿正则盯着它，别哪天又被人加回去。
  - **回来要能对账**：页面重建后原来的 Promise 没了，`status()` 给出 `{running, hasResult, bytes, total, kbps, fileName, path, error}`。DownloadSheet 挂载时问一次：同一个文件就接着显示进度，别的文件就明说「另一个文件在下」，不要让人重复点。
  - **记录不能只靠 JS 写**。下载可能在「界面已经没了」的时候结束（用户退了 App、WebView 被回收）。原生完成时把结果落一份到 SharedPreferences（`ghx_dl/pending`），谁先来谁取走，**取走即清空**，所以同一个结果不会被记两次。
  - **记录去重键是 `repo|kind|name`**。同一个包重下十次只留一条（最新那次），列表才有用。`kind` 参与去重是必要的 —— 同一个 `x.zip` 可能既是发行版附件又是源码包。
  - **取消不留记录**：那是用户自己按的，不需要事后解释。原生侧 `if (!cancelled) persist(...)`。
  - 实测：`scripts/check-download-native.py` 20 条静态断言全过（4 个权限、service 的 `dataSync` 类型、两把锁与超时、onDestroy 不取消、APK 里真有这两个类）；`scripts/verify-dlhistory.py` 四段过（入口条数、三条记录与状态点、点击跳回仓库、清空后 localStorage 键删除）。截图 `docs/screenshots/dlh-088-*.png`。单测 1227 → 1253（`dl-history.test.ts` 26 条）。
  - **仍未验证**：真机上的熄屏行为。沙箱里没有 Android 运行时，WakeLock / WifiLock / 前台服务 / 冻结策略全都验不了 —— 只能证明「接上了」，不能证明「在这台手机上一定不断」。装到华为上如果还断，先看通知栏有没有那条下载通知：没有就说明前台服务被系统拒了。

- **v0.8.9**：测速改并发 + 结果按自然日持久化（一天只测一次）。
  - **串行是那 48 秒的元凶，不是「网络慢」**。`measureRoutes` 原来一条测完再测下一条，单条超时 8 秒 —— 六条线路里只要挂两条，用户就得盯着「测速中 4/6」干等十几秒，全挂是 48 秒。候选是**不同站点**，不是同一条链路的分片，前 256 KB 的带宽争抢可以忽略，所以按 3 条一批并发：总耗时从 `sum` 变成 `sum(max(每批))`。
  - **超时跟着一起收**。`PROBE_TIMEOUT` 8s → 6s。串行时代 8 秒是为了给「建连 + 首包」留余量；并发之后最坏也就两轮，6 秒够，而且真慢到 6 秒还没吐完 256 KB 的线路本来就不该排第一。
  - **缓存维度从「文件」改成「站点」**，这是流量省下来的关键。以前 `speedKey` 带 url，下 A 包测一轮、下 B 包再测一轮，而候选线路压根是同一批代理。现在 `SpeedBoard` 是 `base → sample` 的映射，所有包共用一份 —— 实测换仓库换包，新增请求 **0** 条。
  - **「每天一次」按自然日判，不是滚动 24 小时**。`boardFresh` 比较 `dayKeyOf(at)` 与 `dayKeyOf(now)`。用滚动窗口会出现「早上八点开 App，因为距上次才 20 小时又白测一轮」，与用户说的「每天」不符。时间被往回拨（`at > now`）一律当过期，宁可多测。
  - **只补缺的**。`routesWithoutSample` 让自动测速跳过已有样本的线路 —— 用户新加一个自定义站，不该把另外五条再拉一遍。
  - **`concurrency: 1` 必须还能用**。几条依赖 `now()` 递增来算 kbps 的测试，并发下时钟会交错，统一显式传 1，语义才稳。
  - **下载面板按 `kind:fileName` 重挂**（App 里的 `key`）。以前在同一个位置换包，React 复用组件实例 —— 上一个包的 `entries`、进度、错误会留在界面上，测速也不会按新包的线路重来。
  - 实测（`scripts/verify-speed.py`，390×844，mock 六条线路各自不同延迟：120/200/300/400/500/900 ms，用 `add_init_script` 包 `window.fetch` 记录每条开始/结束）：峰值 **3 并发**、实测 **1201 ms**（串行 2420 ms / 三并发理论 1200 ms）；关掉重开 **0** 条新请求且六行都有速度；换仓库换包 **0** 条；手动重测 +6；把看板 `at` 改成昨天后 reload 自动重测。单测 1253 → **1262**。
  - **仍未验证**：真机移动网络下并发 3 条会不会互相抢带宽到「名次失真」。沙箱里用的是固定延迟，测不出射频层的争抢；如果真机上出现「同一个站每次排名差很多」，把 `PROBE_CONCURRENCY` 调回 2 即可。

- **v0.9.0**：自建加速站「消失」与更新只提示正式版。
  - **用户报「我的自建站呢」，它其实没坏**。实测对 v0.8.9 的 APK 发 `Range` 请求，回 `206` + `content-range: 0-1023/21253906`（与发布包一致）+ `ACAO: *`，拉 3 MB 用 3.9 s，源码 ZIP 直接 `200`。消失的原因在 `releaseCandidates` 只把「当前镜像」放进候选：`mirrorAuto` 默认开着，启动后自动选最快会把当前镜像切成公共代理，自建站于是整行不见。
  - 改法：自建站**常驻**候选表（跟在选中站后面，设置页改过地址会跟着走），展示时钉在第 2 位、速度照实显示 —— 不插队到第一，否则就是在替用户判断「哪个快」。源码 ZIP 候选同样保留它。
  - **官方直连整组沉底**。原来只把官方排在「成功组」末尾，代理一失败官方就跳到第一行，看起来像在推荐官方线路。现在 `rankRoutes` 先分档（代理 0 / 官方 1）再比速度，官方只在代理全挂时被选中。
  - **更新只认正式版**：`prerelease` 一律不提示；`/releases/latest` 返回 404（还没有正式版）也按「已是最新」处理，不再弹错。设置里新增「更新提示」开关，关掉后启动不再请求 `/releases/latest`，横幅消失，手动检查照常。
  - CI 发布的 release 一律 `prerelease: true` —— 开发中的包不该占用 `latest`、也不该在别人手机里催升级。想转正式版去 GitHub 页面取消勾选即可。
  - 实测：`verify-selfmirror.py`（7 行、自建站第 2、官方末位、无溢出、重开不掉）、`verify-update.py`（正式版提示、关开关后 0 次请求、预发布/404 都不报错）。单测 1262 → 1274。

- **v0.9.1**：应用内下载改 4 路分片并行。
  - 此前是**一条连接从头拉到尾**：`HttpURLConnection` + 64 KB 缓冲循环，连 `Range` 头都没发过。
  - 先发 **2 字节探针**（`Range: bytes=0-1`），只有拿回 `206` 且 `Content-Range` 带总长才切片；各片用 `FileChannel.write(buf, pos)` 定位写入（不移动游标，所以不用锁），收尾校验总字节数。
  - **三个坑**：①线路无视 `Range` 回 200 → 各片写全文互相覆盖，出花文件；②302 到签名地址丢 `Range` → 每片都拿全文，所以每一跳都要重设；③中间层 gzip → 分段偏移按压缩字节算、写入按解压字节算，全错位，必须显式 `Accept-Encoding: identity`。
  - **并发上限 4**：实测 8 路被 CDN 限流，比单路还慢 8 倍。分片失败删半截改走单连接；已下过大半就不再重来；单片偶发失败重试一次；取消掐断所有在途连接。
  - 设置里加「分片下载」（4 路 / 单线程），默认开，只作用于应用内下载，进度右侧显示实时路数。
  - **纯逻辑抽出来就能在没有模拟器的情况下真测**：`ChunkedFetch` / `ChunkPlan` 不 import 任何 `android.*`，`scripts/test-chunked.sh` 在普通 JVM 上起本地 HTTP 服务造五种线路，33 条断言（含 md5 与服务器侧并发峰值）。真线路下整包与单连接**逐字节一致**。
  - 实测（自建站真下 20.3 MB）：4 路 11.2 s / 单连 10.8 s，**没有变快** —— 沙箱到 CF 的出口带宽本身打满了。分片只在「单连接被窗口/丢包压住」时有效。单测 1274 → 1279，静态检查 20 → 37 条。

- **v0.9.2**：通知栏实时显示下载进度。
  - **根因不是「没做通知」**：`targetSdk` 早就 35，但 manifest 里**从来没声明 `POST_NOTIFICATIONS`**。Android 13 起缺这条声明，系统把通知直接丢弃；前台服务照跑、下载照走 —— 表现就是「进度只在应用里看得见，消息栏空白」。
  - **第二个老 bug**：`finishWith` 先 `notify(完成通知)` 再 `stopForeground(REMOVE)`，而 `REMOVE` 按**同一个 NOTIF_ID** 把刚发的通知一并删掉。所以即使有权限，下完一个包通知栏也是瞬间变空。改成先 `DETACH` 再 `notify`。
  - 通知内容：文件名（截断但保留 `.apk`）、`已下 / 总量`、速度、剩余时间、几路并行、百分比，600 ms 一帧；完成后点通知直接进安装器，另有「安装」按钮；失败显示「下载中断 + 原因」。
  - 取消按钮走 `BroadcastReceiver` 当场掐断，不用先开界面；取消与失败分开，不再把用户主动取消显示成「下载失败」。
  - `FOREGROUND_SERVICE_IMMEDIATE`：Android 12+ 前台服务通知默认被压 10 秒再显示，不给这个标志开头一段进度看不见。
  - 下载发起那一刻申请一次通知权限；拒绝不影响下载，设置页能查到状态并一键跳系统设置。
  - 格式化逻辑抽成 `NotifText`（纯 Java），`NotifTest` 39 条真跑：除零、99.6% 不能说 100%、扩展名不能被截掉、极慢封顶 24 小时。静态检查 37 → 56 条。单测 1279。
  - **仍未验证**：真机上通知长什么样、EMUI 会不会折叠成一行。沙箱没有设备。

- **v0.9.3**：归档仓库在列表里找得到。
  - **根因**：`App.tsx` 把 `includeArchived` 写死成 `false`，界面上又没有对应档位 —— 归档一个仓库就等于把它弄丢了，想取消归档只能去 GitHub 网页。
  - 新增第四档「归档 N」，**只在真有归档仓库时出现**（绝大多数账号看不到变化）。归档档里能搜索、能批量操作。
  - **顺手修数字不自洽**：`countBy` 的公开/私有原来把归档算进去，于是「公开 2 + 私有 1」和「全部 2」对不上 —— 第一反应就是仓库丢了。现在公开 + 私有 = 全部，都不含归档；头像旁仍显示含归档的真实总数。
  - 看板的「N 已归档」可点，直接跳归档档。
  - 详情页文案方向反了：已归档时副标题还写「归档后仓库只读」（读起来像正要归档），改成「恢复后可继续提交、开 Issue」。
  - `verify-archived.py` 九段，含完整闭环：详情里归档 →「全部」4 变 3 → 归档档涨到 3 → 里面找得到 → 入口变「取消归档」。单测 1279 → 1285。

- **v0.9.4**：热门页顶部插入「APK 商店」横滑区（komi-store 精选目录）。
  - **数据不是 GitHub API**：komi-store（原 GitHub Store）把每天轮换的安卓应用精选目录缓存在公开仓库 `komi-store/komi-store-backend-data` 的 `cached-data/feed/android.json`（2026-11-21 核实 150 条，`latestReleaseTag` / `hasInstallersAndroid` 全有值）。静态 JSON、免令牌、不占 api 配额，游客也能看 —— 与热门页「公开数据匿名可看」定位一致。
  - **线路候选**：自建站队首（实测 200 且会顺手把 feed 里的 `avatars.githubusercontent.com` 改写成镜像域名，头像白捡一层加速）→ 官方 raw → gh-proxy 系，保序去重；一条线路超时 8s 收敛 null 换下一条，绝不全断。**全部失败时回退未过期缓存**（3 天内可用），而不是整块消失。
  - **编排（v0.9.5 已重排）**：入口在热门页标题栏（包裹图标，feed 可用才显示），内容收进**全屏弹层** —— 两列网格 + 名称/简介过滤 + 点应用进仓库详情。第一版把横滑卡插在筛选区与榜单之间，喧宾夺主，用户否了。
  - **头像坑**：`<img>` 等待响应期间不触发 onerror（RULES 记过），挂起也按失败算 —— 8 秒没加载出来就换首字母，不让空白方块挂首页。
  - komi-store 的时间是 `2026-11-20 14:36:03+00`（空格 + 双位时区），不是 ISO：`normalizeTs` 补全后再 `Date.parse`，垃圾输入一律 null。
  - `verify-apkstore.py` 八段（mock feed）+ 真实 feed 复验（12 张卡、首字母兜底全对）+ 挂起头像回退实测。单测 1285 → 1314。
  - **边界**：真机未验；komi-store 目录是第三方维护的精选（非官方 trending），若上游改版/仓库消失，入口会静默隐藏，不影响榜单。

- **v0.9.5**：APK 商店重排 —— 页内横滑卡撤掉，收进标题栏入口 + 全屏弹层。
- **v0.9.6**：翻译链接三连修复 —— 参考式链接支持（原文视图 + 定义行剔除）、机翻保链接（⟦⟧ 占位符方案，`translateBlocks` 加 guard 钩子）、GitHub 链接映射 App 内路由（不再跳系统浏览器）。`verify-trlink.py` 五段。
- **v0.9.7**：商店图标复活 + 平台归属 —— 用户反馈「图标怎么变成 ls 字母了」「它是 EXE 的还是 macOS 的还是安卓的」。
  - **图标根因是个渲染死锁**：v0.9.5 的 `ShopAvatar` 把 `<img>` 的渲染条件写成 `ok` 为真才挂载，而 `ok` 只在 `onLoad` 里置真 —— **img 不挂载就永远不会触发 onLoad**，头像从头到尾没被加载过，全部走首字母兜底。教训：`<img>` 的失败兜底要按「候选线路逐个换」来写，不能按「加载成功才显示」来写。
  - **头像多线路**（`avatarSources`）：原图队首 → avatars.githubusercontent.com 判定时按 url 风格公共代理逐个改写垫后（2026-11-21 实测 gh-proxy.com 代理头像 200、ghfast/ghproxy.net 403、imciel 404）→ 全阵亡才首字母。每条线路 6s 超时；原图已被自建站改写成镜像域名时直接单线返回，不二次包壳。
  - **平台归属**（`apkPlatforms`）：feed 的 `hasInstallersAndroid/Windows/Macos/Linux` 四布尔 + `platformReleases` 键兜底，全缺按 android feed 本来面目兜 `['android']`；落盘缓存往返认解析后的 `platforms` 字段。卡片带平台小标，弹层加平台筛选 tabs（全部/安卓/Win/macOS/Linux 带计数），与名称/简介过滤可叠加。2026-11-21 真实 feed 分布：安卓 150 / Win 60 / macOS 57 / Linux 66。
  - `verify-apkstore.py` 扩成十段：头像原图线路掐死后 gh-proxy 线路接管（10/10 出 `<img>` 无首字母）、平台 tabs 计数与切换、平台+关键词叠加过滤。单测 1345 → 1352。

- **v0.9.8**：返回键一下就退 —— 用户反馈「部分地方点一下就能返回上一级，你这全部都要点两下」。
  - **根因是焦点残留吃掉第一次返回**：`applyBack` 见到 `activeElement` 是输入框就只 blur —— 这是给「键盘开着先收键盘」设计的，但 WebView 里键盘收起后输入框焦点经常残留（点过搜索框之后再点别处，焦点还在），于是每次返回都被白吃一下，感觉处处要点两下；没碰过输入框的层级自然点一下就退，观感就是「不区分」。
  - **修复**：`softKeyboardOpen(vh, innerHeight)`（阈值 120px）用视口高度差确认键盘**真的开着**才只收键盘；焦点残留时收掉焦点 + 这次返回继续往下走，一下就是一层。视觉视口取不到时（web）按键盘没开处理。
  - 各层语义不变：弹层一下收、路由栈一下退、非首页页签根层返回回首页页签、根层连按两次退出、批量执行中返回仍拦截。
  - `verify-backkey.py` 五段（焦点残留一下收弹层、模拟键盘开着第一下只收键盘、商店详情弹层/路由栈单按语义、根层 home 语义）。单测 1352 → 1356。

  - **为什么改**：v0.9.4 把商店横滑区插在筛选区和榜单之间，三张大卡占掉半屏，榜单被挤得看不见 —— 用户原话「丑成这个屌样了，入口放在这里不尴尬吗」。热门页的本职是看榜单，商店不该抢屏。
  - **现在的编排**：标题栏（刷新按钮左侧）一个包裹图标入口；点开是全屏弹层（`ApkStoreSheet`，新弹层类型 `apkstore`，返回键直接收起）：头部来源 + rotation 日期 + 总数，过滤框按名称/简介即时过滤，两列网格卡片（头像/名称/星数语言/版本 tag/两行简介），点应用收弹层、进现有仓库详情。
  - feed 拉不到时入口整个不出现，热门页无痕；单测净 +1（backnav 补 `apkstore` 层级）。`verify-apkstore.py` 九段重写（含「页内无内嵌区块」「feed 404 入口隐藏」「返回键收弹层」）。
  - 上一版的横滑卡样式（`.store-*`）已从 `theme.css` 删除，换成弹层网格（`.shop-*`）。

- **v0.9.9**：商店扩容 + 图标/翻译三连修复 —— 用户反馈「就 150 个应用」「这翻译是什么鬼」「图标又是字母」。
  - **真机三症状同根**：设备上还留着 v0.9.5 时代旧 schema 的目录缓存（旧格式星数字段叫 `stars`、头像在顶层 `avatarUrl`、没有 hasInstallers），解析器只认新 schema → 星数全 0、平台全兜安卓、头像地址为空只剩首字母。**缓存键升到 `ghx.apkstore.v2`** 直接作废旧缓存，同时解析器新旧双认（`stargazersCount||stars`、`owner.avatarUrl||avatarUrl`），以后上游再改字段也不至于全零。
  - **目录扩容**：komi-store 除了每日轮换的 `feed/android.json`（150），还有 `most-popular/android.json`（~143 按星排序）与 `new-releases/android.json`（~43）。三源各走各的候选线路（`fetchApkStoreMulti`），`mergeApkStores` 去重保序合并 —— 2026-11-21 真实数据 174 个应用；单源挂了不拖累其它源。most-popular 没有 `latestReleaseTag`，tag 从 `platformReleases.android` 兜底（v0.9.7 已实现，这里吃到红利）。
  - **头像候选加自建站专用域名**：`avatars-githubusercontent-com-{host}`（自建 worker 的通配改写，实测 200）排在原图之后、公共代理之前。
  - **README 译文死链接的真凶是翻译缓存**：真实 Edge 通道实测 9 个 ⟦⟧ 占位符 9/9 幸存，占位符方案本身没问题；设备上命中了 v0.9.6 之前（无 guard 时代）存的纯译文缓存，restore 找不到占位符就退成死文字（截图里唯一活着的「SoftEther VPN」是因为它是名字没翻）。修复：**带 guard 的译文另开缓存命名空间（键尾 `.g`）**，旧条目自然过期。同时 `unguardLinks` 收紧：token 比地址少（通道真吞了）时整段降级纯文字，**不再按顺序硬配** —— 错位的链接比死文字更糟。
  - **详情简介里的 URL 变可点**（`mdlink.linkifyUrls`）：简介不是 Markdown，URL 以前是死文字。译文/原文都做链接化，字符集排除 CJK 汉字与全角标点（「https://a.b/c，后续」不能整句吞成 URL），句尾 ASCII 句读不算 URL。
  - `verify-apkstore.py` 十二段重写（三源合并 13 应用、旧 schema 条目解析、简介 URL 渲染成链接）。单测 1356 → 1366。

- **v1.0.0**：下载选线不再跳动 —— 用户反馈「下载链接加速选择页点一个他会跳到第一个展示，有点难判断」。`DownloadSheet` 的 `order` 以前把手动挑中的线路 splice 到第一行，列表当场重排，刚点的行窜去顶部。修复：**选线只做高亮**（`picked` 只控制 `.on`），顺序完全交给测速排序 + 自建站钉位维持稳定。`verify-dl.py` 补第 3 段：点倒数第二行断言整表顺序不变、有且只有该行高亮。

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
