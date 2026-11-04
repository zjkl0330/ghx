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
| `update.ts` | 自更新：版本比较、加速站 URL、打开外部链接 |
| `releases.ts` `forks.ts` `workflows.ts` | 发行版/复刻/工作流的状态与校验 |
| `readme.ts` `markdown.ts` `images.ts` | README 解码、自研 Markdown 解析为 Block、图片路径与镜像 |
| `translate.ts` | 多通道机翻：Edge / Azure / MyMemory / Google，切段、降级、缓存键 |
| `search.ts` `trending.ts` `tabs.ts` `theme.ts` `backnav.ts` `audit.ts` `types.ts` | 搜索语法、热门查询、底栏配置、主题、返回键决策、审计、领域类型 |
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
| `format.ts` | 相对时间、短日期、体积、紧凑数字、路径切分 |

### ui（组件）

`RepoList` 主列表 · `RepoDetailSheet` 仓库详情动作 · `ReadmeSheet` 自述阅读+机翻 · `StarsPage` 星标 · `HotPage` 热门/搜索 · `PipelinesPage` 流水线二级页 · `WorkflowSheet`/`RunSheet` 工作流与运行 · `LogSheet` **日志与产物** · `ReleasesSheet` · `ForksSheet` · `VisibilitySheet` 批量可见度 · `CreateRepoSheet` · `SortSheet` · `MirrorSheet` **加速站管理** · `ProfilePage` 个人页 · `SettingsPage` 设置 · `TokenVault` 令牌库 · `AuditLog` · `GuardSheet`/`UnlockScreen`/`LockedScreen` 口令三件套 · `UpdateSheet` · `RepoPickerSheet` · `useDescTranslation` 简介批量机翻 hook · `icons.tsx`

第二批（v0.5.3）：`RepoPage` 仓库主页（自述/发行版/分支/流水线/复刻/设置 chips + 代码/Issues/PR/动作页签）· `IssuesPage`/`IssuePage` · `PullsPage`（含 `PullPage`）/`DiffView` · `CodePage`（含 `FileEditor`）· `CommitsPage`（含 `CommitPage`）· `RefsPage` · `NotificationsPage` · `SearchPage` · `UserPage` · `RepoAdminPage` · `ComposeSheet` 新建 Issue/PR · `MarkdownView` 通用渲染（表格/任务列表）· `PageHeader`+`PageState` 统一顶栏与状态 · `useLoad` 统一加载 hook

第三批（v0.5.4）：`AccountSheet` 账号切换面板 + 多设备响应式（内容居中、safe-area、横屏矮屏）

第四批（v0.5.5）：磨砂玻璃底栏（悬浮胶囊 + 厚底色 + 砂面噪点 + 实心选中态图标）· 热门/星标接入简介机翻 · 应用图标与启动图重绘（`assets/icon/*.svg` + `scripts/make-icons.py`）· `scripts/shots.py` 用 mock API 出 README 截图

### 样式

`src/styles/theme.css` 单文件，**只用 CSS 变量**（`--bg` `--surface` `--text` `--text-dim` `--line` `--blue` `--blue-soft` `--green*` `--red*`，以及底栏专用的 `--glass-*` 与 `--tab-active-*`）。深色/浅色靠 `<html data-theme>` 切换，新组件禁止写死颜色。

> 玻璃底栏的坑：① 选中态药丸是 `position: absolute` 的伪元素，**必须 `z-index: -1`**，否则它会盖住图标与文字；② 底栏 `position: fixed` 后，`.app.with-tabs > .page` 的 `padding-bottom` 是唯一让最后一行不被压住的东西；③ 别指望 `backdrop-filter` —— 在这套结构里 `blur(0px)` 与 `blur(100px)` 渲染完全一致，它不执行。质感靠不透明底色 + 砂面噪点，模糊只是加分项；④ 居中别用 `left:50% + translateX(-50%)`，`transform` 会让 backdrop 采样进一步失准。

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

## 版本与发布

- 版本号在 `package.json`、`android/app/build.gradle`（`versionCode` = 版本×1000）、`README.md`。三处要一致。
- 流程：改代码 → `tsc -b` → `vitest run` → `pnpm build` → `npx cap sync android` → gradle 打包 → 签名 → `gh release create`。
- Release 附件是 APK，正文写清这版改了什么、已知问题。
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
- **v0.5.6**：底栏改成「厚度优先」的真磨砂（`backdrop-filter` 在本页面结构里实测不执行）；锁掉双指缩放（`viewport` + `MainActivity` 两处），系统字号不受影响。单测仍 597。
- 已知边界：发行版附件只能网页上传（CORS）；通知与 Watch 仅 classic 令牌；私有仓库 README 图片仍待修；无密钥时 MyMemory 额度有限。
