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

### ui（组件）

`RepoList` 主列表 · `RepoDetailSheet` 仓库详情动作 · `ReadmeSheet` 自述阅读+机翻 · `StarsPage` 星标 · `HotPage` 热门/搜索 · `PipelinesPage` 流水线二级页 · `WorkflowSheet`/`RunSheet` 工作流与运行 · `ReleasesSheet` · `ForksSheet` · `VisibilitySheet` 批量可见度 · `CreateRepoSheet` · `SortSheet` · `MirrorSheet` **加速站管理** · `ProfilePage` 个人页 · `SettingsPage` 设置 · `TokenVault` 令牌库 · `AuditLog` · `GuardSheet`/`UnlockScreen`/`LockedScreen` 口令三件套 · `UpdateSheet` · `RepoPickerSheet` · `useDescTranslation` 简介批量机翻 hook · `icons.tsx`

### 样式

`src/styles/theme.css` 单文件，**只用 CSS 变量**（`--bg` `--surface` `--text` `--text-dim` `--line` `--blue` `--blue-soft` `--green*` `--red*`）。深色/浅色靠 `<html data-theme>` 切换，新组件禁止写死颜色。

## 五个核心机制（改之前必须懂）

### 1. 返回键（`backnav.ts`）

优先级：键盘 → 口令面板 → 二级页面栈 `screenStack` → 弹层 → 多选 → 非首页 Tab → 首页两次确认退出。
`solveBack` 返回动作字符串（`pop-screen` / `close-sheet` / `exit-confirm`…），`App.applyBack` 执行。
**新增页面必须同步改 `backnav.ts` + 补测试**，不能只在 UI 里加 `onBack`。

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

`Screen` = `main | profile | settings | tokens | audit | pipelines`，`screenStack` 是数组。
`SheetName` 是封闭 union（`add` `visibility` `update` `detail` `create` `releases` `forks` `workflow` `run` `repoPick` `sort` `readme` `mirrors`）。
**弹层只放「单层、无下钻」的界面**；需要继续下钻的（未来的 Issue 详情、文件浏览）应该升级成 `Screen`，否则返回栈会乱。

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

## 版本与发布

- 版本号在 `package.json`、`android/app/build.gradle`（`versionCode` = 版本×1000）、`README.md`。三处要一致。
- 流程：改代码 → `tsc -b` → `vitest run` → `pnpm build` → `npx cap sync android` → gradle 打包 → 签名 → `gh release create`。
- Release 附件是 APK，正文写清这版改了什么、已知问题。
- 推送镜像偶尔 `cannot lock ref`：推临时分支上传对象，再 `PATCH /git/refs/heads/main`（`force:false`）。

## 现在到哪一步了

- 已发布 **v0.5.2**：Edge 免密钥翻译通道（默认首选，整篇一次翻完）、加速站可改地址/可自定义/可测速、仓库列表全量分页。
- 功能缺口与下一批计划见 **`ROADMAP.md`**（Issues / PR / 代码浏览 / 分支 / Actions 补全 / 通知 / 全局搜索）。
- 已知边界：无密钥时 MyMemory 额度仍有限；私有仓库图片待修；「添加多语言」被理解为译文语言，若指界面 i18n 需另做。
