# ROADMAP.md — 往 GitHub 网页端功能补全

> 目标：用户打不开 github.com，所以网页端能做的事，App 里都要能做。
> 边界：纯客户端直连 REST，无后端。需要 `client_secret` / webhook 接收 / FCM 的功能不做。
> 每完成一批发一个小版本（patch +1，满 10 进 minor）。

> **跨平台**：iOS / Windows / macOS / Linux 的取舍、兼容性摸排与 P0–P4 计划见 [`docs/cross-platform.md`](docs/cross-platform.md)。
> **AI 能力**：动作枚举、令牌隔离的三条路线（本地执行器 / Worker 代理 / 直连）、分阶段计划见 [`docs/ai-plan.md`](docs/ai-plan.md)。

## 现状盘点（v0.7.6）

| 能做的事 | 说明 |
|---|---|
| 仓库 | 列表（全量分页）、筛选、排序、**置顶/收藏（本地 KV，按账号分片）**、新建、改简介/主页/topics、单条与**批量操作（可见度 / 归档 / 加话题）**、删除、star、fork |
| 源码获取 | 下载默认分支 ZIP（四条候选地址 HEAD 探活，绕开 codeload 不通）、复制仓库网页地址、浏览器打开仓库 |
| 自述 | README 渲染（标题/列表/代码块/表格/任务列表/图片/徽章）、**目录（1–3 级标题、点击跳转、滚动高亮）**、中文版优先、四通道机翻 |
| 代码 | 目录浏览、面包屑、文件查看（行号 + 语法分类）、**文件内查找（计数 / 上下跳 / 高亮）**、**一键复制内容 / 链接 / 路径**、**字号三档与长行折行**、图片预览（加速失败回退原图）、二进制提示、单文件新建/编辑/删除、**提交历史逐页加载（`Link` 头 + sha 去重）**、单次提交 diff |
| Gist | 列表（自己的含私有 / 他人只公开）、详情、新建、编辑（描述 + 多文件增删改名，只发改动项）、删除、加星、复制全部与单文件、网页打开；`GET /gists` 与 `/users/{login}/gists` 两种范围 |
| 模板 | Issue：读 `.github/ISSUE_TEMPLATE/*.md|yml`，frontmatter 与表单都转成可编辑正文（表单字段拼成 Markdown，注明不是控件）；PR：六个候选路径按优先级找 `pull_request_template.md` 并预填 |
| 限定搜索 | 仓库页放大镜进入，搜索锁 `repo:owner/name`，类别收窄为代码 / Issue / PR / 提交；代码与提交结果直接打开文件 / 提交 |
| Issues | 列表（开/关/全部 + 关键词 + 标签计数）、**高级筛选（作者 / 指派 / 里程碑 / 标签 / 近 N 天更新，条件进服务端 query）**、详情、正文与评论 Markdown、评论、新建、关闭/重开（带 `state_reason`）、标签整体替换、指派、**设置里程碑**、锁定、认领 |
| Pull Requests | 列表（含**客户端高级筛选**：接口不支持 labels/assignee/since）、详情（对话/更改分段）、逐文件 diff（单文件 400 行截断）、提交列表、批准/要求修改、合并（squash/merge/rebase，带 head sha 防错合）、关闭/重开、新建 |
| 分支 / Tag | 分支列表（默认分支置顶）、新建、删除、改名（含 `/` 的编码）、标签列表与新建/删除（轻量/附注） |
| Actions | 工作流列表、启停、按 ref 触发（**含 `workflow_dispatch.inputs` 动态表单**）、运行列表、作业步骤、取消、全部重跑、**只重跑失败作业**、**单作业重跑**、**日志下载解压查看**、**产物列表与删除**、**删除运行记录** |
| 发行版 | 列表、附件下载、新建（可存草稿）、编辑（标签/标题/说明/预发行）、发布草稿、删除附件、删除发行版（可同时删 tag） |
| 通知 | 收件箱（未读/全部）、按仓库分组、**线程直读（面板内看最近 8 条评论，Markdown 渲染）**、标记已读/完成、全部已读、条件请求 304 省配额、铃铛未读红点 + 5 分钟轮询 |
| 搜索 | 仓库 / 代码 / Issue / PR / 用户 / 提交 六类，配额提示，不做输入即搜；**代码命中自动定位并高亮**；用户结果带头像与组织徽标，关键词可带 `@` |
| 多账号 | 保险库存多个 PAT，顶栏账号名或个人页账号卡片一键切；**每账号一套工作区（路由栈 / 列表 / 搜索词 / 筛选 / 排序 / 未读 / 置顶），切走再切回接着看**；客户端实例复用，切回走缓存；切换记审计 |
| 多设备 | 手机满宽、平板 620px 居中、大屏 760px 居中；横屏（任意高度）内容铺满不留白；弹层同宽居中；四边 safe-area；横屏矮屏压底栏并收窄到 460px；锁双指缩放（系统字号仍生效） |
| 全屏 | 状态栏/导航栏透明、内容铺满整块屏幕（Android 6–15 一致）；真实 insets 由原生注入成 CSS 变量；设置里可开「沉浸式全屏」藏掉系统栏，边缘滑入临时唤出；键盘弹出时页面让位、底栏淡出 |
| 外观 | 液态玻璃底栏（悬浮胶囊或贴底通栏；深色 0.26 底色 + `blur(12px)`，浅色 0.20 + `blur(6px)`；1px conic 镜面环由 `::after` 蒙版只留边；背后压暗层 + 环境光）、GitHub 猫反色图标（白底 + 深色圆盘） |
| 自定义 | 强调色六选一（蓝 / 紫 / 青 / 绿 / 琥珀 / 洋红）、底栏形态与文字、背景纯色或氛围光、玻璃三档（通透 / 标准 / 厚实）、动效两档；即时生效并记住 |
| 启动画面 | 系统启动屏（矢量正圆图标，Android 6–15 同一套）→ 首屏内联遮罩（同图标 / 同底色 / 同位置）→ 淡出到页面；`values-night` 深色启动屏 |
| 机翻覆盖 | 仓库、星标、热门三处列表与详情页简介统一走 `pickDescItems`；自述另按语言版优先；`isNameLike` 拦住拼音 / camelCase / 编号型名字，不送机翻 |
| 用户与社交 | 用户主页（资料事实行 / 三个统计 / **内联主页自述** / 仓库三种排序 + 只看源仓库 + 加载更多）、关注/取关、关注者与正在关注可点开列表并继续跳转、我的主页入口；仓库详情与 Issue/PR 作者、审核人都能进主页 |
| 主页自述 | 读 `{login}/{login}` 仓库的 README 直接铺在资料下方：标题（含 `<h1 align=center>` 写法）、列表、表格、代码块、图片全部渲染，图片走加速前缀并在失败时回退原图；超过 300px 折叠成「展开全文」；自己账号可**新建/编辑**（带 sha 乐观锁，避免把更新当新建）；没有自述时给出「建同名仓库」的引导 |
| 数据看板 | 仓库/Star/提交/连续活跃四个指标；活动柱状图（14 / 30 / 90 天可切，提交·Issue·PR 三色堆叠）；**贡献日历（13 周格子图，深浅五档，虚线标未来）**；语言分布（按仓库数，尾部合并「其它 N 种」）；Star 排行；最近推送；仓库构成（源/fork/归档/话题/90 天没动）；接口配额条 |
| 仓库设置 | 简介/主页/默认分支/功能开关/合并策略、改名（带影响清单）、转移、协作员列表、Watch 订阅 |
| 热门缓存 | 时间段 × 语言各存一份（内存 / 本机 / 请求缓存三层）；切换实测 27–31ms、0 请求（旧 740ms）；空闲预取另两个时间段；10 分钟内不发请求，超过先渲染再静默刷新；冷启动 147ms 出列表（旧 868ms） |
| 其他 | 多 PAT 保险库、令牌体检、星标、热门、检查更新、加速站管理、审计日志、冷启动快照、可序列化路由栈 |

## 本批（v0.5.3）交付明细

P0 六项与 P1 六项全部落地，外加两处顺手补齐（提交历史页、Issue 指派与锁定）。新增 12 个 lib 模块、17 个页面/组件，单测 467 → 564。

| 计划项 | 落地情况 |
|---|---|
| P0-1 底座 | `routes.ts`（可序列化路由栈）、`paging.ts`（Link + 满页兜底）、`api.rawText`、ETag/304、`markdown.ts` 表格与任务列表、`cache.ts` TTL 与失效前缀 |
| P0-2 Issues | `issues.ts` + `IssuesPage` + `IssuePage` + `ComposeSheet`，含指派人（整体替换）与锁定对话（四种原因）；PR 过滤与 `PUT labels` 整体替换两个坑都已处理 |
| P0-3 PR | `pulls.ts` + `PullsPage` + `PullPage` + `DiffView`，`mergeable` 2 秒重取、405/409/403/422 分开提示 |
| P0-4 代码 | `code.ts` + `RepoPage` + `CodePage` + `FileEditor` + `CommitsPage`（文件历史与单次提交 diff），目录/文件/图片/二进制四态，409 与 workflow-404 提示 |
| P0-5 分支/Tag | `refs.ts` + `RefsPage`，含 `/` 的改名、轻量标签 |
| P0-6 Actions | `actions-ext.ts` + `LogSheet`，日志解压排序、Artifacts、重跑与删除全部接线 |
| P1 通知 | `notifications.ts` + `NotificationsPage`，classic-only 判断前置 |
| P1 搜索 | `search-ext.ts` + `SearchPage`，六类查询拼装与配额文案 |
| P1 用户社交 | `repo-admin.ts`（用户部分）+ `UserPage` |
| P1 仓库设置 | `RepoAdminPage`，改名后路由与快照 key 一起换 |
| P1 Release | `release-ext.ts` + `ReleasesSheet`（编辑/发布/删附件/删 tag） |
| P1 Watch | `repo-admin.ts` 订阅部分，只对 classic PAT 显示 |

## 与计划的偏差（都是实测撞出来的，不是偷懒）

| 计划 | 实际情况 | 处理 |
|---|---|---|
| 用 `js-yaml` 解析 `workflow_dispatch.inputs` | 只需要缩进层级、`- ` 选项、`key: value` 这三件事，引 40KB 解析器不划算 | 手写 `parseDispatchInputs`，支持 string/boolean/choice/environment/number 与行内/块状 options，解析不出来就降级成「只填 ref」 |
| 「上传发行版附件」 | `uploads.github.com` 响应**没有** `Access-Control-Allow-Origin`，预检过不去；curl 直传 201 说明端点没问题，纯跨域限制。原生 `CapacitorHttp` 也不支持二进制请求体（JS 字符串过桥按 UTF-8 编码，会把 APK 传坏） | 界面不提供上传，改成「网页上传附件」入口并在面板里写明原因；删除/改名/改说明仍可做 |
| 锁定/解锁后立刻重拉详情 | GitHub 偶尔会返回旧值，界面表现为「点了解锁又变回已锁定」 | 改成按请求结果本地置位、失败回滚，不重拉（只改 `locked` 一个字段，没有别的要同步） |
| 独立的 `MergeSheet` / `LabelPicker` | 合并只有「方式 + 确认」两步，标签是整体替换，做成独立弹层反而多一层跳转 | 并入 `PullPage` / `IssuePage`，`backnav` 里对应的 `merge` / `labels` 两个枚举一并删掉，不留死代码 |
| 日志用 `fetch` 直接取 | 日志是 302 到预签名 zip，浏览器里必被跨域挡住 | 真机走 `CapacitorHttp`（`responseType: 'arraybuffer'`）+ `fflate` 解压；浏览器里给出降级说明 |
| `Link` 头分页 | WebView 里可能读不到 | `nextPage()` 在无 Link 时按「本页是否满页」推断 |

## 硬边界（做不了，别答应）

| 功能 | 原因 |
|---|---|
| OAuth Web Flow 登录 | 需要 `client_secret`，不能放进 APK |
| GitHub App 登录 | 需要私钥签 JWT，必须服务端 |
| Webhook 接收 | 需要公网回调地址 |
| App 关闭时推送通知 | 需要 FCM + 服务端；只能前台轮询 |
| Wiki 内容 | 官方无 REST API，只能 clone `.wiki.git` |
| Discussions / Projects / Star Lists / 逐行 blame | 只有 GraphQL，需先加 GraphQL 通道 |
| PR draft → ready | REST 无此字段，需 GraphQL |
| 发行版附件上传 | `uploads.github.com` 无 CORS 头，WebView 发得出去读不回来 |
| 通知与 Watch（fine-grained 令牌） | 只有 classic PAT 支持；界面上直接给原因，不让人撞 403 |

## P2 与本批不做的项（自主决定，附理由）

| 项 | 决定 | 理由 |
|---|---|---|
| Gist | 不做 | 独立产品，要单独的 `gist` scope，与「管仓库」主链路无关 |
| GraphQL 系（Discussions / Projects / Star Lists / blame） | 不做 | 需新增 GraphQL 通道，成本与风险独立，本批没有收益 |
| 推送通知 / 后台同步 | 不做 | 违反「无后端」约束 |
| OAuth Device Flow | 不做 | 仍需访问 `github.com/login/device`，对目标用户不比「别处生成 PAT 再粘贴」更省事 |
| Pages / Packages / Secrets / Webhooks / 安全告警 | 不做 | 管理员向低频功能；Secrets 要 libsodium sealed box，Webhook 要后端 |
| Copilot 对话 | 不做（见下） | PAT 拿不到 Copilot token，见 `AGENTS.md` 的调研结论 |

## Copilot 结论（已核实，2026-11）

| 路径 | 结果 |
|---|---|
| `GET /copilot_internal/v2/token` | 对 PAT 返回 404 |
| `https://api.githubcopilot.com` 直连 | 400 `Personal Access Tokens are not supported` |
| `GET /copilot_internal/user` | 仍可读套餐信息（只读，无法用于推理） |
| GitHub Models | 2026-07-30 停服 |

→ App 里做不了「登录 GitHub Copilot」。可行的替代是「自带 OpenAI 兼容大模型」（DeepSeek / 通义 / Kimi / 硅基流动，CORS 实测可用，密钥复用现有 AES-256-GCM 保险库）。首个功能建议做「PR diff 讲解 + 一键生成 Issue/PR 描述」，但那是新一批的活，不在本批范围。

## 每批验收标准

1. `npx tsc -b` 无错，`npx vitest run` 全绿且总数只增。
2. 390×844 浏览器实走完整路径，收集 console 报错，截图留档。
3. 用真实令牌打一次 API，覆盖本批的写操作（create / comment / close / merge / edit file / dispatch / publish）。
4. `pnpm build` 通过，APK 签名指纹与历史一致。
5. 每个功能写清「哪些情况不支持」，不要用「应该没问题」糊过去。

## 功能池

按「能不能只靠现有 REST 做完」分成两堆。排序大致按性价比，不是优先级承诺。

### A. 纯 REST，不需要新依赖

| 功能 | 价值 | 成本 | 卡点 / 备注 |
|---|---|---|---|
| **提交列表分页** | 中 | 小 | 现在固定最近 30 条，`Link` 头已经能读，只差界面 |
| **通知线程直读** | 中 | 中 | 现在只能跳到 Issue/PR 详情，多一次跳转 |
| **搜索命中行高亮** | 中 | 小 | 代码搜索返回的是文件路径，要再拉一次内容定位 |
| **README 目录** | 中 | 小 | 长 README 抽标题生成锚点，跳转 |
| **仓库列表置顶/收藏** | 中 | 小 | 纯本地（KV），给几个常用仓库钉到最上面 |
| **多账号并行工作区** | 高 | 大 | 现在一次只能激活一个令牌，切换会清路由栈；要做并行得把 client 从单例改成池 |
| **批量操作扩展** | 中 | 中 | 现在只有可见度；可以扩到归档、加话题、加主题 |

### B. 卡在别处，短期做不了

| 功能 | 卡在哪 |
|---|---|
| Discussions、Projects、置顶仓库（pinned） | **只有 GraphQL**。现在整套是 REST，要新增 GraphQL 客户端、分页（cursor）、错误模型，属于另一条技术线 |
| 代码扫描 / Dependabot 告警 | 需要 `security_events` scope，`classic` PAT 默认没有，细粒度令牌要单独勾；大多数用户开不出来 |
| 上传发行版附件 | `uploads.github.com` 没有 CORS 头，WebView 的 fetch 读不到结果；原生 `CapacitorHttp` 传二进制会按 UTF-8 编码把包传坏。已放弃，只给「网页上传」入口 |
| 登录 GitHub Copilot | PAT 不被接受（`api.githubcopilot.com` 回 400），GitHub Models 已于 2026-07-30 停服。替代方案是自带 OpenAI 兼容通道，见下方 |
| AI 写操作 | 见 [`docs/ai-plan.md`](docs/ai-plan.md)，要先做动作框架与确认链路 |

### 功能池已清空

v0.7.4 → v0.7.6 把 A 类七项全部做完：提交分页、README 目录、仓库置顶、通知直读、搜索高亮、批量扩展、多账号并行工作区。

**剩下的都做不了**，不是排期问题：
- 需要 GraphQL（Discussions / Projects / Star Lists / pinned / 逐行 blame / PR draft→ready）
- 需要服务端（OAuth Web Flow / GitHub App / Webhook / FCM 推送）
- 需要额外 scope 或没有 CORS（`security_events` 告警、发行版附件上传）
- AI 写操作见 `docs/ai-plan.md`，要先做动作框架；跨平台见 `docs/cross-platform.md`，等平台范围确认

真要继续往前，方向是那两份独立计划，而不是这个功能池。
