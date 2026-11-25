# ghx 交接文档

> **适用版本 v1.2.0**（2026-11-25 整理）。读者：接手这个项目的人或新模型——手上只有这个仓库，没有历史对话。
>
> 本文件是**现场恢复手册 + 状态快照**。设计细节看 [`AGENTS.md`](../AGENTS.md)，行为守则看 [`RULES.md`](../RULES.md)，待办看 [`ROADMAP.md`](../ROADMAP.md)。

---

## 1. 它是什么

安卓上的 GitHub 客户端，包名 `dev.zjkl.ghx`。纯前端直连 `api.github.com`：**没有后端、没有账号体系、没有遥测**。

存在的理由很具体：用户经常打不开 `github.com`，但 API 通常还通——所以界面全部自己渲染，不套 WebView 网页。

技术栈：Capacitor 7 + React 19 + TypeScript + Vite。**没有 router、没有状态库、没有 markdown 库**，路由栈、Markdown 解析、玻璃视觉全部手写。

规模参考：`src/` 约 4.9 万行 TS/TSX，63 个 UI 组件，`theme.css` 6513 行。

---

## 2. 新沙箱恢复现场

### 2.1 拉代码

```bash
git clone https://github.com/zjkl0330/ghx.git && cd ghx
```

`main` 应为 `c5b6b75`（merge: 并入远端 v1.1.5 的渲染进程兜底与兼容模式）。

若 `github.com` 的 git 传输报 `GnuTLS recv error (-110)`，见 §7.1；镜像 `gh.zjkl0330.dpdns.org` 的 git 端点要认证（401），**不要指望它拉代码**。

### 2.2 装依赖

```bash
pnpm install --frozen-lockfile
```

Node 22 / pnpm 10，与 CI 一致（lockfile 是 pnpm 生成的）。

### 2.3 恢复签名（**最关键的一步，做错会静默出废包**）

签名材料**故意不在仓库里**，`.gitignore` 明确挡住：

```
*.jks
keystore/
android/keystore.properties
```

新沙箱里没有它们。缺了会怎样：`android/app/build.gradle` 里 `hasGhxSigning` 为 false 时，debug 构建退回 runner 自带的临时 debug 密钥——**包能装，但签名指纹不是 `fd6a8ea4…`**。用户覆盖安装会报「签名不一致」，只能卸载重装，代价是本地令牌、审计日志、缓存全丢。

需要恢复两个东西：

**① 密钥库** `keystore/ghx-release.jks`（约 2.6 KB，别名 `ghx`）

只能从私有备份取回，或从 GitHub Secrets 的 `GHX_KEYSTORE_BASE64` 解出来：

```bash
mkdir -p keystore
echo "$GHX_KEYSTORE_BASE64" | base64 -d > keystore/ghx-release.jks
```

**② 签名配置** 二选一：

- 文件方式 `android/keystore.properties`（内容含口令，**不要提交**）：

```properties
storeFile=/绝对路径/ghx/keystore/ghx-release.jks
storePassword=<GitHub Secrets: GHX_KEYSTORE_PASSWORD>
keyAlias=ghx
keyPassword=<GitHub Secrets: GHX_KEY_PASSWORD>
```

- 环境变量方式（更适合一次性构建）：

```bash
export GHX_KEYSTORE_PATH=/绝对路径/ghx/keystore/ghx-release.jks
export GHX_KEYSTORE_PASSWORD=...
export GHX_KEY_ALIAS=ghx
export GHX_KEY_PASSWORD=...
```

**验证指纹必须等于**（CI 里硬编码同一条，不符会直接失败）：

```
fd6a8ea4445b0ada2c06065f38e9c8ea011df02c1eb484abd5ab6824c79eb2de
```

```bash
/opt/android-sdk/build-tools/35.0.0/apksigner verify --print-certs \
  android/app/build/outputs/apk/debug/app-debug.apk | grep SHA-256
```

### 2.4 指向 SDK

`android/local.properties`（同样被忽略，需手建）：

```properties
sdk.dir=/opt/android-sdk
```

### 2.5 自检（五分钟内能跑完）

| 检查 | 命令 | 期望 |
|---|---|---|
| 类型 | `npx tsc -b` | 无输出。**必须用 `-b`**，`tsc --noEmit` 对 project references 是空跑 |
| 单测 | `npx vitest run` | `1462 passed (65 files)` |
| NPE 红线 | `python3 scripts/check-npe-guards.py` | 9 条 PASS |
| 前端构建 | `pnpm build` | 出 `dist/` |
| 签名 | 见 2.3 | 指纹 `fd6a8ea4…` |

---

## 3. 工具链（本机实测，2026-11-25）

| 组件 | 版本 / 路径 | 备注 |
|---|---|---|
| Node | v22.13.1 | 系统自带 |
| pnpm | 10.28.2 | |
| JDK | 21.0.2，`/opt/jdk-21.0.2` | Capacitor 7 硬要求 21 |
| Gradle | 8.11.1，`/opt/gradle-8.11.1/bin/gradle` | 直接调二进制，不走 wrapper |
| Android SDK | `/opt/android-sdk` | platform `android-35`，build-tools `35.0.0`（另有 34.0.0） |
| Python | 3.11 | `playwright 1.58` + `pillow`，验证脚本用 |
| 显示 | `xvfb-run` | 浏览器验证必须**有头** |

`xvfb-run` 不能省：headless 下 Chromium 不渲染 `backdrop-filter`，玻璃会被拍成一块色板，脚本的像素方差断言必然误判。

**没有模拟器、没有 `/dev/kvm`、没有 adb。** 见 §10。

---

## 4. 常用命令

```bash
cd /workspace/ghx

npx tsc -b                      # 类型检查
npx vitest run                  # 单测（1462 / 65 文件）
pnpm build                      # tsc -b && vite build → dist/
npx vite preview --port 4173    # 端口必须 4173，29 个验证脚本里 28 个硬编码了它

xvfb-run -a python3 scripts/verify-features.py    # 功能入口盘点
bash scripts/test-chunked.sh                      # 原生纯 Java 逻辑（89 条断言，不需要模拟器）
```

打 APK：

```bash
npx cap sync android
cd android
JAVA_HOME=/opt/jdk-21.0.2 /opt/gradle-8.11.1/bin/gradle assembleDebug --no-daemon
# 产物 app/build/outputs/apk/debug/app-debug.apk（约 20.6 MiB）
```

---

## 5. 验收闸门（2026-11-25 在当前代码重跑的结果）

| 闸门 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `npx vitest run` | **1462 通过 / 65 文件** |
| 类型检查 | `npx tsc -b` | 通过 |
| NPE 红线 | `scripts/check-npe-guards.py` | **9 条全过**（Context 先装、用处处判空、插件方法不外抛） |
| 原生下载接线 | `scripts/check-download-native.py --apk …` | **77 条全过** |
| 原生纯逻辑 | `scripts/test-chunked.sh` | **89 条全过**（分片 / 通知文案） |
| 功能盘点 | `scripts/verify-features.py` | **77 项全过**：底栏 3、仓库页 11、批量 3、我的 10、设置 7、外观/翻译 8、底栏页签 2、热门 7、商店 3、星标 2、详情 11、搜索 6、通知 1、看板 2、Gist 1 |
| 玻璃视觉 | `scripts/verify-glass.py` | 四项指标 + 像素方差，全过 |
| APK 商店 | `scripts/verify-apkstore.py` | 10 项全过（单列 / 平台筛选 / 头像回退 / 返回键） |

`scripts/` 共 **40 个**脚本，其中 `verify-*.py` **29 个**，覆盖归档、批量、复制、下载、下载历史、分片、字体、游客模式、Markdown、镜像恢复、通知、溢出、发版说明、测速、目录、翻译保活、链接、更新、返回键等。

**诚实说明**：上面 8 条是本次实际重跑的；其余 21 个 `verify-*.py` 上一版通过、这次**没有复跑**。改动碰到对应模块时再跑，不要因为「历史全绿」就跳过。`scripts/repro-upgrade.py` 是复现升级场景的一次性脚本，不是闸门。

---

## 6. 发版

### 6.1 版本规则

- 补丁位 +1；满 10 进次版本（`0.9.9 → 1.0.0`）。
- 版本号**只在 `package.json` 维护**，`scripts/sync-version.mjs` 同步到 gradle：`versionName` = 字面版本，`versionCode` = `major*10000 + minor*100 + patch`（1.2.0 → `10200`）。
- 当前：`versionName 1.2.0` / `versionCode 10200`。

```bash
node scripts/bump-version.mjs 1.2.0    # 传「当前」版本，产出 1.2.1
node scripts/sync-version.mjs 1.2.0    # 只同步，不升
```

### 6.2 流程

```bash
npx tsc -b && npx vitest run && pnpm build
npx cap sync android && (cd android && JAVA_HOME=/opt/jdk-21.0.2 /opt/gradle-8.11.1/bin/gradle assembleDebug --no-daemon)
# 归档安装包：cp …/app-debug.apk /workspace/ghx-X.Y.Z-debug.apk

git add -A
git commit -m "fix: 说清为什么"      # 提交信息写「为什么」，不是「改了什么」
git tag -a vX.Y.Z -F /tmp/notes.txt  # 注解 = 发版说明正文
git push gh main
git push gh refs/tags/vX.Y.Z
```

### 6.3 CI 行为（`.github/workflows/build-apk.yml`）

| 触发 | 结果 |
|---|---|
| push `main` / PR | 只跑构建，留 30 天 artifact |
| push tag `v*` | 构建 + 发 Release（附 APK），**默认预发布** |
| `workflow_dispatch` | 手动跑 |

tag 触发时版本取 tag 名，所以 **tag 必须与 `package.json` 一致**，否则产物版本和关于页对不上。

### 6.4 正式版 vs 预发布

发版说明直接取 tag 注解。要发**正式版**，注解里必须有一行 HTML 注释：

```markdown
<!-- release: stable -->
```

- 有 → 不勾 Pre-release，并占用 `/releases/latest`（用户端会弹更新）。
- 没有 → 预发布，`latest` 不动，静默更新。

日常改动发预发布；用户确认过的版本才发正式版。当前 `latest` = **v1.2.0**（正式版，2026-11-22 发布）。

CI 第 18 步 `Verify signature` 硬校验指纹，签错直接失败——这是防止「包能装但覆盖不了」的最后一道闸。

### 6.5 发版说明从哪来

tag 注解的 subject + body。CI 会追加安装包文件名、覆盖安装说明、`Full Changelog` 链接。所以注解要写给人看：**用户能感知的变化在前，内部重构在后**。

---

## 7. 网络与凭据（本沙箱实测，别照旧文档做）

### 7.1 `git push` 会 TLS 中断 → 强制 HTTP/1.1

症状：`ls-remote` 能通，`push` 报

```
GnuTLS recv error (-110): The TLS connection was non-properly terminated.
```

读操作走小请求没事，写操作要上传 pack，就断。**加一个参数即可**：

```bash
git -c http.version=HTTP/1.1 push gh main
```

2026-11-22 用这条把 `main` 与 `v1.2.0` 都推上去了，CI 正常触发。若仍失败，再考虑降到 SSH 或走 API 兜底（§7.4）。

### 7.2 凭据不落盘

不要把 PAT 写进 `git remote url`、`.git-config`、`.git-credentials`。用一次性 askpass：

```bash
cat > /tmp/askpass.sh <<'EOF'
#!/bin/sh
case "$1" in
  *sername*) echo "x-access-token" ;;
  *) echo "$GHX_TOKEN" ;;
esac
EOF
chmod +x /tmp/askpass.sh

export GHX_TOKEN=<PAT>
export GIT_ASKPASS=/tmp/askpass.sh GIT_TERMINAL_PROMPT=0
git -c http.version=HTTP/1.1 push gh main
rm -f /tmp/askpass.sh    # 用完删掉
```

### 7.3 **不要从会话记录里 grep 令牌**

历史做法是 `grep -oE "ghp_[A-Za-z0-9]{30,}"` 翻 `.jsonl` 日志——这等于把泄露面越滚越大，而且拿到的多半是已撤销的。**正确做法：直接向用户要一个新的 PAT，并提醒他用完撤销。** 令牌明文进过对话就视为已泄露。

### 7.4 远端与兜底

| remote | 地址 | 用途 |
|---|---|---|
| `gh` | `https://github.com/zjkl0330/ghx.git` | **唯一推送入口** |
| `origin` | `https://gh.zjkl0330.dpdns.org/zjkl0330/ghx.git` | 自建代理，git 端点要认证（401），别用 |
| `legacy` | `https://gh.zjkl0330.dpdns.org/827802685/ghx.git` | 旧的公开镜像记录，别用 |

极端情况（`github.com` 写操作完全不可用）才用 `scripts/push-via-api.py`：它经 Git Data API 提交树，`BASE` 必须是本地存在、且树与远端 main 相同的提交（通常 `HEAD~1`）。副作用是本地与远端 commit hash 分叉（树相同），属于可接受状态。**任何时候都不要 force push。**

---

## 8. 架构地图（别通读 `src/`）

### 8.1 目录

| 位置 | 内容 |
|---|---|
| `src/App.tsx` | 约 3600 行，壳：路由栈、弹层、返回键、启动副作用、账号、镜像 |
| `src/lib/` | 70 个纯逻辑模块，与 UI 解耦，可单测 |
| `src/ui/` | 63 个组件：路由页（`*Page.tsx`）、弹层（`*Sheet.tsx`）、基础件 |
| `src/styles/theme.css` | 6513 行，所有视觉唯一来源，含 CSS 变量与全部响应式 |
| `android/app/src/main/java/dev/zjkl/ghx/` | 原生层：下载、通知、渲染兜底 |
| `scripts/` | 40 个验证/构建脚本 |
| `docs/` | 设计文档 + 截图 + 本文件 + `RULES-SUMMARY.md` / `STYLE.md` + `archive/` |

### 8.2 七个核心机制（细节在 `AGENTS.md` §134 起）

1. **返回键**（`backnav.ts`）：键盘 → 口令面板 → 路由栈 → 弹层 → 多选 → 非首页 Tab → 二次确认退出。**新增页面必须同步改 `backnav.ts` 并补测试**。
2. **缓存**（`cache.ts`）：GET 默认缓存，TTL 按路径；**新增写接口必须扩 `invalidationPrefixes()`**。
3. **翻译**（`translate.ts` + `linkguard.ts`）：Edge → Azure → MyMemory → Google；链接与行内格式用 ⟦⟧ 占位保活；名字不翻。
4. **加速站**（`mirrors.ts`）：`path` 与 `url` 两种拼法，传错就 404；**内置表只有官方直连**，其余由用户自己填；迁移只跑一次（`ghx.mirror.restored`）。
5. **导航**（`routes.ts`）：二级页面一律路由栈；弹层只放「单层、无下钻」。
6. **传输层**（`api.ts`）：分页靠 `Link`，缺失时按满页推断；条件请求必须绕过缓存读、成功仍写回 etag。
7. **下载**（`download.ts` + `ChunkedFetch` / `ResumeState` / `DownloadService`）：必须 206 才分片；`MAX_PARTS=32`、`MIN_PART=256 KiB`；断点账本独立于文件长度；前台服务是唯一能挡 Android 12+ Freezer 的东西。

### 8.3 硬约束（违反就是返工）

1. 只做 Android APK，不做 Web 版，按 **390×844** 触摸尺寸设计。
2. 不引入后端、不做账号体系、不加遥测。
3. **禁止自动 commit / push**——做完只报告改动与未提交状态，等用户发话。*（本文件这次同步到 GitHub 是用户明确要求的，属于授权例外。）*
4. 破坏性操作（删仓库、转私有、批量改可见度、删分支）必须二次确认。
5. 新增纯逻辑必须有单测，**总数只增不减**。
6. 视觉只用 `theme.css` 的 CSS 变量。
7. 版本 patch +1，满 10 进 minor。

---

## 9. v1.1.5 → v1.2.0 踩过的坑（这一段最省时间）

| 症状 | 当时的误判 | 真因 | 修法 |
|---|---|---|---|
| 1.1.2 起「打开闪退」，开屏动画后进程消失 | 依次怀疑旧 WebView → ES2020 语法 → 渲染进程被杀 → 内存不足，**四次都猜错** | `DownloadHub.downloadDir()` 里静态 `app` 为 null → NPE，抛在 `CapacitorPlugins` 线程，进程被系统杀 | `DownloadHub.install(Context)`（Application 与插件 `load()` 各调一次）+ 用处处判空 + 插件方法全部 `try/catch → call.reject` |
| 崩溃栈写进文件却看不到 | 以为处理器没触发 | 处理器写普通日志，回放只认 `[FATAL]` 前缀 | 崩溃单独写 `crash.txt`；崩溃栈从 `ApplicationExitInfo.getTraceInputStream()` 取（进程已死时唯一可用证据） |
| 排查界面混进正式包 | —— | 排查期插的 DOM 面板与流水账没清 | 全部回滚，只留不可见的 `crash.txt` |
| 1.1.3 升级后加速站全没了 | 以为迁移写错 | v1.1.0 的站点表是**包内常量、从未落盘**，`localStorage` 里没有可迁的记录 | 从 `ghx.mirror`（选中站）、`ghx.mirror.speed`（测速快照）、下载历史 URL 里回收地址，带 `guess:true`，一次性键 `ghx.mirror.restored` |
| 底栏「圆角之外也是模糊的」 | 以为 `backdrop-filter` 溢出圆角 | `.glass-backdrop` 是**整屏宽 × 132px 的矩形**，自带 blur 与向上渐隐，胶囊左右 12px、上方 64px 都在糊正文 | 压暗层改成与胶囊同 `inset / 高 / 半径`（`--tabbar-h` `--tabbar-radius` `--tabbar-gap` `--tabbar-inset` 四处共用），悬浮态去掉自身 blur，缓向渐隐只留给贴底通栏 |
| APK 商店是两列 | 以为当前 CSS 是双列 | v1.1.0 确实是 `1fr 1fr` 网格，**v1.1.2 起已改单列**；用户装的是旧包 | 加 `.shop-grid > .shop-card { width: 100% }` 兜底，父级 flex 方向失效也排不出两列 |
| 两套渲染进程兜底互相遮蔽 | —— | `GhxWebViewClient.onRenderProcessGone` 覆盖后没调 `super`，Capacitor Bridge 的监听链（`RendererGuard`）永远收不到 | 先 `super`（记录、清缓存、重载 / 兼容模式），没人处理才退到屏幕提示，两条路都 `return true` |

**方法论教训**（比上面任何一条都重要）：

- 崩溃先问系统要账本（`ApplicationExitInfo`），别从症状反推原因。
- 用户给的截图 / 堆栈是硬证据，优先于任何推断。这次绕了一大圈，最后是用户截图里的 `DownloadHub.downloadDir` 一锤定音。
- 改了三次还没好，就该停下来换取证手段，而不是再猜第四个原因。

---

## 10. 已知边界与未完成

| 项 | 状态 |
|---|---|
| 真机验证缺口 | **没有模拟器 / KVM / adb**。Android 行为只有「静态断言 + JVM 测试 + 用户回执」三种证据。通知外观、`WakeLock`、前台服务在定制 ROM 的表现、安装器流程，**均未在真机验过**，别写成「已验证」 |
| APK 体积 | 约 20.6 MiB，主体是 OPPO Sans 全字重。换 OFL 字体可子集化到 2 MB；**现有字体子集化违反其许可**，别做 |
| 签名密钥 | 只有私有备份与 GitHub Secrets 两处。丢了就永远无法覆盖升级，只能换包名重新发 |
| PAT | 明文出现过多次，一律视为已泄露；每次交接都建议用户撤销重签 |
| ROADMAP 未开工 | Discussions / Projects / pinned 走 GraphQL；`docs/ai-plan.md`、`docs/cross-platform.md` 是已定方案未动手 |
| 加速站恢复的边界 | 若 1.1.10 / 1.1.11 启动后自动测速已把 `ghx.mirror` 与快照覆盖成官方，旧地址**不可恢复**（数据已被覆盖），只能让用户重填 |

---

## 11. 与 2026-11-21 那份交接单的差异

旧单（`docs/archive/handover-2026-11-21-v0.9.3.md`）对应 v0.9.3，以下结论已被推翻或过期，**照它做会走弯路**：

| 旧说法 | 现在 |
|---|---|
| 「`git push` 不可靠，一切走 `api.github.com`」 | 可用，只是要 `-c http.version=HTTP/1.1`；API 退回兜底 |
| 「本地与远端 hash 必然分叉」 | 不再分叉，`main` 与远端同为 `c5b6b75` |
| 「单测 1285」 | **1462** |
| 「验证脚本 16 个」 | 40 个脚本，其中 `verify-*.py` 29 个 |
| 「从会话记录 grep PAT」 | **禁止**，直接向用户要新的 |
| 「原生逻辑 72 条」 | 89 条 |
| 版本 0.9.3 / `latest` 指 v0.8.9 | v1.2.0，`latest` 指 v1.2.0 |

同步现状时，`AGENTS.md` 的「现在到哪一步了」是逐版本流水账，搜关键词比读源码快；但**它不记录 1.1.5 之后的坑**，最新一段在本文 §9。

---

## 12. 第一天 checklist

- [ ] `pnpm install --frozen-lockfile`
- [ ] 恢复 `keystore/ghx-release.jks` + `android/keystore.properties`，`apksigner` 指纹 == `fd6a8ea4…`
- [ ] `npx tsc -b` 无输出；`npx vitest run` == **1462**
- [ ] `pnpm build` 后 `vite preview --port 4173`，`xvfb-run -a python3 scripts/verify-features.py` == **77**
- [ ] 读 `RULES.md`（行为）/ `docs/RULES-SUMMARY.md`（速查）+ `AGENTS.md` §七个核心机制 + §硬约束；动界面前读 `docs/STYLE.md`
- [ ] 向用户要 PAT；确认远端 `main` 与 `v1.2.0` 都在
- [ ] 问清这次要做什么——**不要主动扩大范围**

---

*本文件随版本更新。改完发版时顺带把 §5 的数字与 §6.4 的 `latest` 指向同步一遍，别让它变成第二份过期文档。*
