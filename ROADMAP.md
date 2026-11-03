# ROADMAP.md — 往 GitHub 网页端功能补全

> 目标：用户打不开 github.com，所以网页端能做的事，App 里都要能做。
> 边界：纯客户端直连 REST，无后端。需要 `client_secret` / webhook 接收 / FCM 的功能不做。
> 每完成一批发一个小版本（patch +1，满 10 进 minor）。

## 现状盘点（v0.5.2）

| 已经能做 | 说明 |
|---|---|
| 仓库 | 列表（全量分页）、筛选、排序、新建、改简介/主页/topics、单条与批量改可见度、归档、删除、star、fork |
| 自述 | README 渲染（标题/列表/代码块/图片/徽章）、中文版优先、四通道机翻、译文语言五种 |
| Actions | 工作流列表、启停、按 ref 触发、运行列表、作业步骤、取消、重跑 |
| 发行版 | 列表、附件下载、新建、删除 |
| 其他 | 多 PAT 保险库、令牌体检、星标、热门/搜索、检查更新、加速站管理、审计日志、冷启动快照 |

**完全空白**：代码浏览与编辑、Issues、Pull Requests、分支/Tag、通知、代码/Issue/用户搜索、用户主页与关注、Gist、Watch、Release 编辑与资产上传、Actions 日志与 Artifacts。

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

## 分批原则

1. **先底座后页面**：路由栈、分页、raw/304 传输、Markdown 表格、缓存失效是 Issues/PR/代码浏览的共同前置，不先做每个页面都要重复造轮子。
2. **写操作优先**：用户痛点是「网页打不开但还要管仓库」，评论、关 issue、合并 PR、建分支、改文件价值最高。
3. **读操作服务写操作**：代码浏览是改文件的前置，PR diff 是 review/merge 的前置。
4. **classic-only 功能降级**：Notifications 与 Watch 订阅只支持 classic PAT，fine-grained 用户要按 `TokenRecord.kind` 隐藏入口并解释原因，别让人反复撞 403。
5. **GraphQL 最后做**：成本独立，风险也独立。

---

## P0 — 下一批（先把协作主链路打通）

### P0-1 底座（必须先做，无 UI）

| 改动 | 内容 |
|---|---|
| `src/lib/routes.ts`（新） | 可序列化的 `Route` 判别联合：`repo` / `dir` / `file` / `commit` / `issue` / `pull` / `user`，带 `push/pop/replace` |
| `src/App.tsx` | `screenStack: Screen[]` 升级为 `routeStack: Route[]`；页面渲染拆到 `AppRoutes.tsx` |
| `backnav.ts` | `BackState` 加 `routeDepth` / `routeKind`，返回键先处理路由栈 |
| `api.ts` | `requestText()`（raw 文件、diff）、304 处理（通知「无新数据」）、`Link` 头分页 |
| `paging.ts`（新） | `parseLink()`、`hasNext()`、`paginate()` |
| `markdown.ts` | 加表格 `\| a \| b \|` 与任务列表 `- [ ]`（Issue/PR 正文大量使用） |
| `cache.ts` | 补 `/contents` `/commits` `/branches` `/tags` `/issues` `/pulls` 的 TTL 与失效前缀 |

坑：`Link` 头在 WebView CORS 下可能读不到，要有「按返回条数判断」的兜底；raw/diff 不进 JSON 缓存。

### P0-2 Issues 全流程

端点：`GET/POST /repos/{o}/{r}/issues`、`PATCH /issues/{n}`、`/issues/{n}/comments`、`/issues/{n}/labels`、`/issues/{n}/assignees`、`/labels`、`/milestones`、`/issues/{n}/lock`。
新增：`lib/issues.ts`、`ui/IssuesPage.tsx`、`ui/IssuePage.tsx`、`ui/IssueComposer.tsx`、`ui/LabelPicker.tsx`。

坑：列表**会混入 PR**，要过滤 `pull_request` 字段；`PUT labels` 是整体替换不是追加；关 issue 带 `state_reason`；`assignees` 无 push 权限会被静默忽略。

### P0-3 Pull Requests

端点：`GET /pulls`、`/pulls/{n}`、`/pulls/{n}/files`、`/pulls/{n}/commits`、`/pulls/{n}/reviews`、`PUT /pulls/{n}/merge`、`/commits/{sha}/check-runs`。
新增：`lib/pulls.ts`、`ui/PullsPage.tsx`、`ui/PullPage.tsx`、`ui/DiffView.tsx`、`ui/MergeSheet.tsx`、`ui/ReviewSheet.tsx`。

坑：`mergeable` 初始为 `null`（后台算），要 1–2 秒后重取；merge 失败码要分开提示（405 冲突 / 409 head 变了 / 403 分支保护 / 422 参数）；`files[].patch` 可能为空（二进制/大文件）；`state=closed` 含已合并，用 `merged_at` 区分。

### P0-4 代码浏览 + 单文件编辑

端点：`GET /contents/{path}`、`GET /git/trees/{sha}`、`GET /commits?path=`、`GET /commits/{ref}`（`Accept: application/vnd.github.diff`）、`PUT/DELETE /contents/{path}`。
新增：`lib/code.ts`、`ui/RepoPage.tsx`、`ui/FilePage.tsx`、`ui/FileEditor.tsx`、`ui/CommitList.tsx`、`ui/CommitPage.tsx`、`ui/RefPicker.tsx`。

坑：目录返回数组、文件返回对象；base64 带换行要清；>1MB 用 raw 媒体类型；目录最多 1000 条，大仓库按目录懒加载别递归整棵树；`type` 可能是 `symlink`/`submodule`；更新/删除必须传 `sha`（409 = 远端已变）；UTF-8 base64 不能用裸 `btoa`；写 `.github/workflows/*` 需要额外 `workflow` scope（缺 scope 可能返回 404 而不是 403）。

### P0-5 分支与 Tag

端点：`GET /branches`、`POST /git/refs`、`DELETE /git/refs/{ref}`、`POST /branches/{branch}/rename`、`GET /tags`。
新增：`lib/refs.ts`、`ui/RefsPage.tsx`、`ui/BranchSheet.tsx`、`ui/TagSheet.tsx`。

坑：删默认分支 422、保护分支 403；分支名含 `/` 时路径编码不能整段 `encodeURIComponent`；`POST /git/refs` 建的是轻量 Tag，annotated 要先 `POST /git/tags`。

### P0-6 Actions 补全

端点：`/actions/runs/{id}/logs`（302 → zip，1 分钟有效）、`/actions/runs/{id}/artifacts`、`DELETE /actions/runs/{id}`、`POST /actions/runs/{id}/rerun-failed-jobs`、`POST /actions/jobs/{id}/rerun`。
新增：`lib/actions.ts`、`ui/LogViewer.tsx`；升级 `RunSheet.tsx`。
依赖：`fflate`（解压）、`js-yaml`（解析 `workflow_dispatch.inputs`，没有 schema API 只能读 YAML）。

坑：日志是 zip 里多个 `.txt`，按文件名排序；大日志先看 `Content-Length`；302 到预签名 URL 不需要 token，但浏览器 CORS 可能挡住，必须真机验证。

---

## P1 — 再下一批

| 项目 | 关键点 |
|---|---|
| 通知收件箱 | `GET /notifications`、`PUT /notifications`、`PATCH/DELETE /threads/{id}`；304 当「无新数据」；遵守 `X-Poll-Interval`；**fine-grained 不支持** |
| 全局搜索 | `/search/code`（必须认证，10 次/分，只搜默认分支）、`/search/issues`（要显式 `is:issue` / `is:pull-request`）、`/search/users`、`/search/commits` |
| 用户主页与社交 | `/users/{u}`、`/followers`、`/following`、`PUT/DELETE /user/following/{u}`（要 `Content-Length: 0`）、`/user/orgs`、`/orgs/{org}/repos` |
| 仓库设置 | `PATCH /repos/{o}/{r}`（改名/默认分支/功能开关/合并策略）、`POST /transfer`、`/collaborators`；改名后路由、缓存、快照 key 全要跟着改 |
| Release 补全 | `GET/PATCH /releases/{id}`、`POST uploads.github.com/.../assets`（不是 api.github.com）、删除资产 |
| Watch 订阅 | `PUT/DELETE /repos/{o}/{r}/subscription`；设置订阅**仅 classic**；`GET /user/subscriptions` 支持 fine-grained 读 |

---

## P2 — 以后 / 需新通道

| 项目 | 阻塞原因 |
|---|---|
| Gist | 独立产品，`gist` scope，使用频率低 |
| Star Lists / Discussions / Projects / blame | 只有 GraphQL，需新增 `api.github.com/graphql` 客户端 |
| 推送通知 + 后台同步 | 需要 FCM + 服务端，违反无后端约束 |
| OAuth Device Flow | 不需要 client_secret，但仍要注册 OAuth App 且用户要访问 `github.com/login/device` —— 对「打不开 github.com」的用户并不比「别处生成 PAT 再粘贴」更好 |
| 离线草稿 / 多账号并行工作区 | 本地工程活，不影响主链路 |
| Pages / Packages / 安全告警 / Secrets / Webhooks | 管理员向低频功能；Secrets 要 libsodium sealed box，Webhook 接收要后端 |

---

## 每批验收标准

1. `npx tsc -b` 无错，`npx vitest run` 全绿且总数只增。
2. 390×844 浏览器实走完整路径，收集 console 报错，截图留档。
3. 用真实令牌打一次 API，覆盖本批的写操作（create / comment / close / merge / edit file / dispatch）。
4. `pnpm build` 通过，APK 签名指纹与历史一致。
5. 每个功能写清「哪些情况不支持」，不要用「应该没问题」糊过去。

## 建议执行顺序

```
P0-1 底座
  ├─ P0-2 Issues（一次验证路由+分页+Markdown+写操作+缓存失效五件事）
  ├─ P0-4 代码浏览（产出 DiffView 基础）
  │    └─ P0-3 PR（复用 DiffView）
  ├─ P0-5 分支/Tag（可与 P0-4 并行）
  └─ P0-6 Actions（最后做，要加两个依赖）
```
