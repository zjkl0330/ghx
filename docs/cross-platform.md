# 跨平台方案：平台决策、兼容性摸排与实施计划

> 状态：**方案待确认**（2026-11-14）。确认后按 P0 → P4 顺序推进，每阶段一个版本。
> 范围：除 Web 以外的原生端。Web 构建仍然保留（它是所有原生壳的产物来源，也是截图与单测的运行环境），但不作为交付形态。

---

## 一、结论先说

**做 4 个平台，第 5 个跟着出但不承诺。**

| 平台 | 形态 | 优先级 | 壳 | 能否由你亲自验证 |
|---|---|---|---|---|
| Android | APK（已有） | 保持 | Capacitor 7 | ✅ 有设备 |
| iOS / iPadOS | IPA（未签名，自签安装） | **P1** | Capacitor 7 iOS | ⚠️ 只能在 iPhone 上冒烟 |
| Windows 10/11 | NSIS + MSI | **P2** | Tauri 2 | ✅ 你的主力系统 |
| macOS 12+ | dmg | P3 | Tauri 2（同一份壳） | ❌ 无机器 |
| Linux | AppImage + deb | P4（实验） | Tauri 2（同一份壳） | ❌ 无机器 |

**不做的**：Web/PWA 交付、Windows 7/8（WebView2 需手工装，Tauri 实际底线是 Win10 1803）、iOS 15.4 以下、macOS 12 以下、Android 6 以下（现有 minSdk 23）。

> 两个最低版本不是随手定的：**iOS 15.4 / macOS 12 正好是 `mask-composite` 进 Safari 的版本**（MDN BCD 8.1.9：Safari 15.4、iOS 15.4）。低于它就得为镜面环写一套 `-webkit-mask-composite: xor` 的旁路。iPhone 6s/7 能升到 iOS 15.8，所以设 15.4 几乎不损失设备，却省掉一整个兼容分支。

三个判断依据：

1. **iOS 用 Capacitor，桌面用 Tauri**。Capacitor 官方只有 Android / iOS / Web 三个目标（[官方环境要求](https://capacitorjs.com/docs/getting-started/environment-setup)），没有任何桌面平台；社区的 `@capacitor-community/electron` 停在 Cap 5/6，Cap 7 不兼容。所以桌面必须换壳。
2. **桌面选 Tauri 而不是 Electron**。现在 APK 4.3 MB，Electron 壳起步 90 MB，比例上说不通；Tauri 同功能约 6–9 MB，且 Windows 用系统自带 WebView2。代价是三端内核不统一（见下表），但这笔账 iOS 已经要付一次。
3. **Linux 只出包不验收**。它和 macOS 共用同一套 Rust 壳，边际成本近乎为零，但 WebKitGTK 的合成器行为在无 GPU 的桌面环境里和 WKWebView 差得最远，我又无法验证 —— 所以标注 experimental，不写进"支持"列表。

---

## 二、技术路线

```
             ┌──────────────┐
             │  src/ (TS)   │  唯一业务代码
             │  styles/     │
             └──────┬───────┘
                    │ vite build
                 dist/
        ┌───────────┼───────────┬──────────────┐
   Capacitor    Capacitor     Tauri        (Web，仅调试)
   Android       iOS         Win/Mac/Linux
```

**关键前提：`dist/` 必须保持纯静态、零 Node API 依赖。** 现在已经是（`fflate` 解压、`TextDecoder` 解码、全部手写），没有 `fs` / `path` / `process` 引用，可以直接被三个容器消费。这一条要在 P0 用脚本守住。

### 为什么桌面不用 Capacitor 的替代品

| 方案 | 体积 | 内核一致性 | 迁移成本 | 结论 |
|---|---|---|---|---|
| Tauri 2 | ~7 MB | 三端不同（WebView2 / WKWebView / WebKitGTK） | 中：写 Rust 壳 + 5 个插件映射 | **选它** |
| Electron | ~95 MB | 三端同 Chromium | 中：主进程 + preload + IPC | 备选，只在 Tauri 卡死时启用 |
| @capacitor-community/electron | ~95 MB | 同上 | 低 | ✗ 停更，Cap 7 不兼容 |
| PWABuilder / MSIX | ~2 MB | Edge WebView2 | 低 | ✗ 本质仍是 Web，违反需求 |

---

## 三、兼容性摸排

摸排方式是扫真实代码，不是凭印象。下面每一条都标了文件与行号。

### 3.1 平台 API 耦合点（全部 8 处，必须收敛）

| # | 位置 | 现在做什么 | iOS | 桌面 |
|---|---|---|---|---|
| 1 | `src/lib/storage.ts:27-38` | `@capacitor/preferences` 读写 | ✅ 同一插件 | ➜ Tauri `store` 插件 |
| 2 | `src/lib/update.ts:219-222` | `Browser.open` 打开外链 | ✅ | ➜ `opener` 插件 |
| 3 | `src/lib/update.ts:245-255` | `CapacitorHttp` HEAD 探活 | ✅ | ➜ `plugin-http` |
| 4 | `src/lib/theme.ts:68-71` | `StatusBar.setStyle` | ✅（表现不同，见 3.4） | ➜ 无此概念，直接跳过 |
| 5 | `src/lib/mirrors.ts:441-455` | `CapacitorHttp` 测速 | ✅ | ➜ `plugin-http` |
| 6 | `src/lib/actions-ext.ts:137-150` | `CapacitorHttp` 拉日志 zip | ✅ | ➜ `plugin-http` |
| 7 | `src/lib/immersive.ts:8-18` | 自写 `Immersive` 插件藏系统栏 | ➜ 要写 Swift 版，或退回 `StatusBar.hide()` | ➜ `window.setFullscreen` |
| 8 | `src/App.tsx:2-3,342,408,1606` | `CapacitorApp` 返回键 / 退出 / 前后台 | ➜ 无物理返回键，改手势 + 顶部返回 | ➜ 快捷键 `Alt+←` / `Cmd+[` |

这 8 处就是 P0 的全部工作量。收敛成一个 `src/lib/platform/` 门面之后，三个壳的差异被关在门面里，UI 层不再出现 `Capacitor.isNativePlatform()`。

### 3.2 WebView 内核矩阵

| 能力 | Android WebView | iOS WKWebView | WebView2 (Win) | WKWebView (mac) | WebKitGTK (Linux) |
|---|---|---|---|---|---|
| 内核 | Chromium（随 Play 更新） | WebKit | Chromium | WebKit | WebKit |
| `mask-composite` | **120+** | **15.4+** | 120+ | **15.4+**（=macOS 12） | 2.40+ |
| `backdrop-filter`（无前缀） | 76+ | 18+（更早用 `-webkit-`） | 79+ | 同左 | ✅ |
| `backdrop-filter`（`-webkit-`） | ✅ | 9+ | ✅ | ✅ | ✅ |
| `crypto.subtle` | ✅ | ✅（见 3.3） | ✅ | ✅ | ✅ |
| `env(safe-area-inset-*)` | ⚠️ 多数机型恒 0，靠原生注入 | ✅ 真实值 | — 无 | — 无 | — 无 |
| `overscroll-behavior` | ✅ | **16+** | ✅ | **16+** | ✅ |
| `scrollbar-width` | 121+ | **18.2+** | ✅ | **18.2+** | ✅ |
| `100vh` | 正常 | 含地址栏误差（本项目未用，见 3.5） | 正常 | 正常 | 正常 |

> 版本号来自 MDN `@mdn/browser-compat-data@8.1.9`，不是记忆。
> **已有基础**：`-webkit-backdrop-filter` 早在 v0.5.5 就写了两遍（`theme.css:818-819`），iOS 直接可用。
> **基线抬高后唯一要补的**：`theme.css:905` 的 `@supports (mask-composite: exclude)` 在 iOS 15.4+ 恒为真，镜面环不需要旁路。若日后把 deployment target 降回 15.0，就必须补 `-webkit-mask` + `-webkit-mask-composite: xor` 分支。

### 3.3 iOS 安全上下文（最容易被误判的一条）

网上流传"iOS 上要把 `iosScheme` 改成 `https` 才能用 `crypto.subtle`"——**这是错的，而且改了会炸**。

- Capacitor 的 `CAPInstanceDescriptor.normalize()` 会检查 `WKWebView.handlesURLScheme(scheme)`，`http`/`https` 被 WebKit 保留，配置会被重置回 `capacitor`。所以那行配置是 no-op。
- `capacitor://localhost` 的 host 是 `localhost`，按 Secure Contexts 规范属于 potentially trustworthy，**`isSecureContext === true`，`crypto.subtle` 可用**。同理 `navigator.clipboard.writeText` 也可用（仍需用户手势）。
- 因此 `vault.ts` 的 AES-256-GCM 不需要任何改动，也不需要降级到 JS 实现。

这一条要在 iOS 首包上做**第一项冒烟**：打开 App → 建保险库 → 重启 → 自动解锁成功。失败就说明假设错了，得立刻改方案（改走 Keychain 插件）。

### 3.4 交互差异（不是 CSS，但用户感知最强）

| 交互 | Android | iOS | 桌面 |
|---|---|---|---|
| 返回 | 物理/手势返回键 → `backnav.resolveBack` | 边缘侧滑（WKWebView 默认），**App 内需要自己的返回箭头** | `Alt+←`、`Cmd+[`、鼠标侧键 |
| 退出 | 首页再按返回 → `exitApp` | 不存在"退出" | 关窗，需 `beforeClose` 确认 |
| 键盘避让 | `--inset-ime` 注入 + `data-ime` 属性 | `env(keyboard-inset-height)` 支持不稳，靠 `focus` + `scrollIntoView` | 无需处理 |
| 悬停 | 无 | 无 | **必须有**（现在 `theme.css` 里 `:hover` 数量为 0） |
| 右键 | 长按 → 系统菜单 | 长按 → 系统菜单 | 需要自定义菜单，否则是 WebView 默认菜单 |
| 滚动条 | 隐藏 | 隐藏 | 需要细滚动条，否则鼠标用户不知道能滚 |
| 文本选择 | 普遍禁用 | 普遍禁用 | 代码/日志页应允许选中复制 |

### 3.5 已经踩过、跨平台会再踩的坑

- **`100vh` 在 iOS WKWebView 里大于可视区**（地址栏收起时）。本项目 `theme.css` 全文只有一处 `94vh`（弹层 max-height），实际影响为零 —— 但桌面端如果把 `.app` 改成 `height: 100vh` 就会踩到，别改。
- **`-webkit-overflow-scrolling: touch`**（`theme.css:447,1486`）在 iOS 15+ 已是默认行为，保留无害；在桌面 WebKitGTK 上会被忽略。
- **`touch-action: pan-x pan-y`**（`theme.css:399`）会让桌面鼠标拖拽滚动失效，桌面需要 `@media (hover: hover)` 覆盖回 `auto`。
- **`-webkit-tap-highlight-color: transparent`**（`theme.css:380`）在桌面无影响。

### 3.6 自更新：四个平台四种命

这是差异最大的一块，`update.ts` 现在只会找 `.apk`（`pickApk`，`update.ts:95`）。

| 平台 | 能不能自更新 | 做法 |
|---|---|---|
| Android | ✅ | 现有：选线路 → HEAD 探活 → 交给浏览器装 APK |
| iOS | ❌ | 系统不允许。只能提示「有新版本」并跳 Release 页；自签用户要重新签名 |
| Windows | ✅ | Tauri updater：下载 `.nsis.zip` + `.sig`，静默替换后重启 |
| macOS | ✅ | 同上，但**必须**签名，否则替换后 Gatekeeper 拦 |
| Linux | ⚠️ | AppImage 支持原地替换；deb 只能提示 |

`ReleaseInfo` 需要从「一个 asset」改成「按平台选 asset」，判定函数改成 `pickAsset(assets, platform)`，并保留旧的 `pickApk` 导出（测试依赖它）。

### 3.7 实测记录：两个内核到底差多少

光看兼容表不够，直接拿真内核跑了一遍。

**方法**：取构建产物里的 `theme.css`，套在一段固定 DOM 上（`.app` + `.glass-backdrop` + `.tabbar`，背后铺黑白条纹），用 Playwright 的有头模式分别跑 Chromium 与 WebKit 26.0，`xvfb` 虚拟显示，`scrollY` 固定 0，`device_scale_factor=1`。

| 检查项 | Chromium 145 | WebKit 26 | 结论 |
|---|---|---|---|
| `backdrop-filter` 计算值 | `blur(12px) saturate(1.85)` | 同 | 一致 |
| `::after` 的 `mask-image` | 两层 `linear-gradient` | 同 | 一致 |
| `mask-composite` 计算值 | `exclude, exclude` | 同 | 一致 |
| 镜面环像素（红底探针，顶/底/左） | `(254,120,120)` / `(201,137,137)` / `(244,28,33)` | `(253,120,120)` / `(201,136,136)` / `(245,29,34)` | **逐点差 ≤2** |
| 底栏空白区均值（左中右三块） | `(20,30,44)` / `(20,27,36)` | `(23,29,37)` / `(21,26,31)` | **Δ ≤ 6.6**，蓝通道 WebKit 略低 |
| 底栏上方背景（未模糊区） | `(11,15,21)` | `(11,16,22)` | Δ 0.2，同一张纸 |
| 条纹是否被抹平（相邻 8px 亮度差） | 0.9 | 0.9 | blur 在两个引擎都生效 |

**结论：现代 WebKit 与 Chromium 在底栏玻璃上等价，不需要为 iOS 单独调一套参数。**

这条很关键 —— 它推翻了一个常见预期（"WKWebView 的 backdrop-filter 一定更弱，得把 tint 加厚"）。真按那个思路调，iOS 上会变成一块实心板。

**唯一看得见的差异是文字，不是玻璃**：WebKit 的字重抗锯齿明显更粗，单像素最大差能到 70（Chromium `(35,65,106)` vs WebKit `(108,129,158)`，都落在"仓库"两个字上）。这不影响功能，但会让同一段 CSS 在两个平台上的截图观感不同 —— 所以判定阈值用的是**区域均值**（≤8），不是单像素。`scripts/probe-webkit.py` 现在就按这个口径跑。

**这次测试踩的坑，记下来免得再犯**：第一次跑的时候两边亮度差了 50 个单位，看起来像"WebKit 采样不到压暗层"。实际原因是那段探针 DOM 里的条纹总高 840px + 顶栏，超出了 844 的视口，**两个引擎的初始滚动位置不一样**，底栏背后压着的内容根本不同。把条纹改成 `position: fixed` 铺满、`scrollY` 固定 0 之后，差异消失。凡是拿像素比内核，先把滚动位置钉死。

**这个测试证明不了什么**：WebKit 26 是 2026 年的版本，不能代表 iOS 15.4 的行为。旧版本差异只能靠 MDN BCD 的版本号推断（3.2 那张表）。真正需要真机验证的是安全区与键盘 —— 那两块在两个平台上的**实现路径**不同（Android 靠原生注入 CSS 变量，iOS 靠 `env()`），不是同一个机制的两套参数。

---

## 四、要改的代码清单

### 4.1 新增

| 文件 | 内容 |
|---|---|
| `src/lib/platform/index.ts` | `PlatformKind = 'android' \| 'ios' \| 'windows' \| 'macos' \| 'linux' \| 'web'`；`detect()`；`capabilities()` 能力表（`blur` / `rimMask` / `safeArea` / `haptics` / `selfUpdate` / `physicalBack`） |
| `src/lib/platform/kv.ts` | `StorageAdapter` 接口；Capacitor Preferences / Tauri store / localStorage 三个实现 |
| `src/lib/platform/http.ts` | `nativeRequest()`：CapacitorHttp / Tauri plugin-http / fetch 三选一；保留「Web 端探活直接返回 true」的旧语义 |
| `src/lib/platform/shell.ts` | `openExternal` / `copyText`（含 `execCommand` 兜底）/ `saveFile` |
| `src/lib/platform/chrome.ts` | `setStatusBar` / `setImmersive` / `applySafeArea` |
| `src/lib/platform/lifecycle.ts` | `onBack` / `onExit` / `onForeground` / `onWindowClose` |
| `src-tauri/` | Rust 壳：`main.rs`、`tauri.conf.json`、`capabilities/*.json`、图标、NSIS 配置 |
| `ios/` | `npx cap add ios` 产物 + `Info.plist` / 启动屏 / 图标 / `ImmersivePlugin.swift` |
| `.github/workflows/ios.yml` | macOS runner 出未签名 IPA |
| `.github/workflows/desktop.yml` | matrix：windows / macos / ubuntu |

### 4.2 改写（8 处直连 → 门面）

`storage.ts` · `update.ts` · `theme.ts` · `mirrors.ts` · `actions-ext.ts` · `immersive.ts` · `App.tsx`。改完 `grep -r "isNativePlatform" src/` 只允许命中 `platform/` 目录。

### 4.3 样式

| 位置 | 改动 |
|---|---|
| `theme.css:905` | **基线 15.4 后不用改**。若日后要降到 15.0，才补 `-webkit-mask` + `-webkit-mask-composite: xor` |
| 新增 `@media (hover: hover)` 段 | 列表行、按钮、chip、tab 的悬停态；不许用颜色变量以外的新色 |
| 新增桌面滚动条 | `::-webkit-scrollbar` 8px，颜色取 `--line` |
| `theme.css:4214-4223` | 桌面断点 `--content-max` 提到 860 / 960（现在 620 / 760 在 1440 屏上浪费三分之一） |
| `theme.css:399` | 桌面覆盖 `touch-action: auto` |

### 4.4 测试

跨平台纯逻辑必须进 `vitest`：`detect()`（各 UA/平台串）、`capabilities()`、`pickAsset()`（五个平台 × 无资产）、`nativeRequest` 的选择分支（注入 mock adapter）。目标：709 → 760+，只增不减。

---

## 五、分阶段计划

每阶段独立可交付、可回滚；做完一个发一个版本。

### P0 · 平台抽象（v0.7.0）

**目标**：Android 行为零变化，但所有平台调用走门面。

1. 建 `src/lib/platform/` 六个文件
2. 替换 8 处直连
3. 补单测（目标 +40）
4. 加一条 CI 守卫：`grep -r "isNativePlatform" src/ --exclude-dir=platform` 必须为空

**验收**：`pnpm test` 全绿；Android APK 与 0.6.7 逐页对比无差异（截图 diff）；APK 体积变化 < 20 KB。

### P1 · iOS（v0.8.0）

1. `npx cap add ios` + `pod install`（Cap 7 仍用 CocoaPods）
2. `IPHONEOS_DEPLOYMENT_TARGET = 15.4`（见第一节的版本理由），`TARGETED_DEVICE_FAMILY = 1,2`（iPhone + iPad）
3. `Info.plist`：`UISupportedInterfaceOrientations`（竖屏 + 横屏）、`UIViewControllerBasedStatusBarAppearance`、`LSApplicationCategoryType`
4. Swift 侧 `ImmersivePlugin`（`prefersStatusBarHidden` + `setNeedsStatusBarAppearanceUpdate`）
5. 启动屏：`LaunchScreen.storyboard` 与现有 SVG 图标对齐（复用 Android 的 192pt 画布口径）
6. 图标：`Assets.xcassets` 全尺寸（从 `assets/icon/*.svg` 生成）
7. 键盘避让：`focus` → `scrollIntoView({block:'center'})`
8. `ios.yml`：`macos-15` + `xcodebuild -sdk iphoneos CODE_SIGNING_ALLOWED=NO` → `Payload/` 打包成 ipa

**验收**：CI 出 ipa；iPhone 上自签安装后，登录 → 列表 → 仓库页 → README → 热门 → 缓存命中，六条主路径通；保险库重启后能自动解锁（验证 3.3）。

### P2 · 桌面壳（v0.9.0）

1. `src-tauri/` 初始化，`frontendDist: "../dist"`，窗口 1200×820，最小 900×600
2. 插件：`http`（**capability 里 scope 必须显式放开 `https://**`**，默认只允许 localhost）、`store`、`opener`、`dialog`、`updater`、`clipboard-manager`、`single-instance`、`window-state`
3. 菜单栏：文件（检查更新 / 退出）、编辑（复制粘贴）、视图（重载 / 缩放 / 全屏）、帮助（Release 页）
4. 快捷键：`Ctrl/⌘+K` 搜索、`Ctrl/⌘+R` 刷新、`Alt+←` 返回、`Esc` 关弹层
5. `beforeClose` 钩子：多选/编辑中弹确认
6. `desktop.yml`：windows-latest 出 NSIS + MSI；macos-15 出 dmg；ubuntu-24.04 出 AppImage + deb

**验收**：Windows 上安装后，同样六条主路径通；`%APPDATA%/dev.zjkl.ghx/` 里能看到 store 落盘；关窗重开保留登录态；下载 zip 能唤起系统浏览器。

### P3 · 桌面布局（v0.9.1）

1. ≥1024px 切侧边栏导航（仓库 / 星标 / 热门 / 通知 / 我的），底栏在桌面隐藏
2. `--content-max` 860 / 960
3. 悬停态、滚动条、右键菜单（代码页：复制 / 全选）
4. 代码页、日志页允许 `user-select: text`

**验收**：1440×900、1280×800、1024×768 三档截图，无横向滚动、无重叠。

### P4 · macOS + Linux 打磨（v0.9.2）

1. macOS：`LSMinimumSystemVersion 12.0`、`NSHumanReadableCopyright`、dmg 背景与布局
2. Linux：`webkit2gtk-4.1`、AppImage 图标、`.desktop` 文件、deb 依赖声明
3. 文档：Gatekeeper 绕过（`xattr -dr com.apple.quarantine`）、SmartScreen 提示、自签 7 天说明

**验收**：CI 三端产物齐全；Release 附件命名规范（见下）；至少一位 Mac 用户实际安装成功。

### 发布资产命名

```
ghx-0.9.2-debug.apk
ghx-0.9.2-unsigned.ipa
ghx_0.9.2_x64-setup.exe        ghx_0.9.2_aarch64-setup.exe
ghx_0.9.2_x64.dmg              ghx_0.9.2_aarch64.dmg
ghx_0.9.2_amd64.AppImage       ghx_0.9.2_amd64.deb
```

`update.ts` 的 `pickAsset` 按 `platform()` + `arch` 选；找不到就退回「打开 Release 页」。

---

## 六、签名与分发的现实（这一节决定能不能真的用起来）

| 平台 | 无签名会怎样 | 解决成本 |
|---|---|---|
| Android | 已用固定 keystore，指纹 `FD:6A:…:DE` | 0 |
| iOS | **装不上**。必须先自签 | 免费 Apple ID + Sideloadly/AltStore：**7 天有效，最多 3 个 App，需每 7 天重签**；$99/年开发者账号：1 年有效，可 TestFlight/Ad Hoc（100 台设备） |
| Windows | SmartScreen「未知发布者」，需点「仍要运行」 | 0；Azure Trusted Signing 约 $10/月，个人可申请 |
| macOS | Gatekeeper 直接拦，需右键打开或 `xattr -dr com.apple.quarantine` | 0；公证需同一个 $99 账号 |
| Linux | 无签名机制 | 0 |

**必须提前说清的两件事**：

1. **没有 Mac 就没有 iOS 真机调试**。CI 能出包，但闪退只能靠日志猜。可选的补救是用 `ios_webkit_debug_proxy`（Linux/Windows 都能跑）通过 USB 连 WebView 控制台 —— 但需要设备已信任、且构建带 `get-task-allow`。
2. **macOS / Linux 我无法验证**。我能保证"CI 构建通过、产物结构正确"，不能保证"在你的机器上不崩"。这两个平台在 README 里会明确标 `未实测`。

---

## 七、时间与风险

按我的实际产出速度：

| 阶段 | 内容 | 预计 |
|---|---|---|
| P0 | 平台抽象 + 单测 + Android 回归 | 1 轮 |
| P1 | iOS 壳 + CI + 首包 | 1–2 轮 |
| P2 | Tauri 壳 + 三平台打包 | 2 轮 |
| P3 | 桌面布局 | 1 轮 |
| P4 | macOS / Linux 打磨 + 文档 | 1 轮 |

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| iOS 无真机调试，问题只能猜 | 高 | 中 | 首包先跑六条主路径冒烟；用 `ios_webkit_debug_proxy` 兜底 |
| 用户设备停在 iOS 15.3 及以下 | 低 | 低 | 基线设 15.4，App Store 页面写明；真遇到就补 `-webkit-mask-composite: xor` |
| Tauri `http` 插件默认 scope 只允许 localhost | 高 | 高 | capability 显式写 `{"url": "https://**"}`，并在 CI 加一条 curl 冒烟 |
| WebKitGTK 无合成器时玻璃失效 | 中 | 低 | 已 `@supports` 降级到 0.96 实色 |
| macOS 未公证被拦 | 高 | 中 | 文档写清 `xattr` 绕行；不做"双击即开"的虚假承诺 |
| Capacitor 7 → 8 迁移 | 中 | 中 | **本次不动**。8 要求 Xcode 26 / iOS 15+、Android Studio 2025.2.1，等跨平台稳定后再单独评估 |
| 桌面宽屏 UI 重做超范围 | 中 | 中 | P3 只做侧边栏 + 间距，不重写页面结构 |

---

## 八、明确不做

- 不做 Web/PWA 交付形态
- 不做 Windows 7/8、iOS 15.4 以下、macOS 12 以下、Android 6 以下
- 不做 App Store / Microsoft Store 上架（需要账号与审核，不在本次范围；架构上留好口子）
- 不做后台推送、不做多窗口、不做系统级分享接收
- 不用 Electron（除非 Tauri 在 Windows 上出现无法绕过的死锁）
- 不在本次升级 Capacitor 大版本
