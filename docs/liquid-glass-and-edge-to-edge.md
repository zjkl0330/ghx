# 液态玻璃底栏「不够透」与 Capacitor 7 全屏落地

> 针对本仓库当前实现：`src/styles/theme.css` 的 `.tabbar`、`src/lib/theme.ts` 的 `syncStatusBar()`、
> `android/.../MainActivity.java`、`android/app/src/main/res/values/styles.xml`、
> `android/variables.gradle`（compileSdk/targetSdk 35）、`@capacitor/android` 7.6.10、`@capacitor/status-bar` 7.0.6。
>
> 标注：✅ 有官方/规范来源；⚠️ 二手来源或推断；❓ 未能证实。
>
> 这是 v0.6.2 的设计依据记录：结论已经落到 `theme.css`、`MainActivity.java` 与 `AGENTS.md`，
> 留在这里是为了保住来源链接与推导过程，改参数之前先看这里，别重新猜一遍。

---

## 0. 结论先行

1. 最初的判断基本成立，但归因要修正：不是「底色比背景亮」（只差 4/255），而是三件事叠加——
   **底栏填充与页面底色的对比只有 1.03:1（深色）/ 1:1（浅色）、背后没有可采样的结构、`blur(34px)` 的 σ 已经超过胶囊高度的一半**。
2. 让它「透」的不是更低的不透明度，而是：**背后有内容 + 背后先压一层 scrim + 边缘有镜面环**。
   Apple 对 clear 变体的官方建议就是「背景亮时加 35% 暗化层」——暗化层加在玻璃**背后**，不是加在玻璃上。
3. Android 侧：targetSdk 35 在 Android 15 上**已经强制 edge-to-edge**，缺的不是「开启」，而是「把 insets 喂给 CSS」。
   `StatusBar.setOverlaysWebView` 在 Android 上只动状态栏、且用的全是已废弃 API，不够用。

---

# A. 透明度

## A1. 诊断：「不够透」到底发生在哪一层

按 source-over 算一下（8bit 取整）：

| | 页面底色 | tint 合成结果 | 对比度 |
|---|---|---|---|
| 深色 | `#0D1117` = rgb(13,17,23) | rgb(17,21,28) | **1.03 : 1** |
| 浅色 | `#FFFFFF` | `#FFFFFF`（白色 tint 叠白底） | **1 : 1** |

- 深色：`0.42×22 + 0.58×13 = 16.8`，三个通道分别 +4 / +4 / +5。
- `brightness(1.02)` 作用在 (13,17,23) 上得到 (13.3,17.3,23.5)，**取整后完全不变**。这一层在最常见的场景里是空操作。
- 浅色：`rgba(255,255,255,.46)` 叠在 `#FFF` 上仍是 `#FFF`；`saturate(185%)` 对纯白是恒等；`brightness(1.04)` 被 clip 回 255。**整条滤镜链在数学上等于没有。**

所以两套主题下，底栏的填充色和页面底色**是同一个颜色**。你现在能看见它，靠的是：
1px 边框（合成后 rgb(61,65,69)，对比度 **1.84:1**）、`inset 0 1px 1px rgba(255,255,255,.3)` 那条顶边高光、以及 `0 18px 42px` 的投影。

**这三样恰好都是「实体卡片」的线索，不是「玻璃」的线索。**

再算 blur：MDN 明确 `blur(<length>)` 的参数是高斯核的**标准差**（不是半径）✅。
σ=34px 意味着 3σ≈102px 的采样范围，而胶囊只有 58px 高——**超过一半的采样能量来自胶囊外面**。
背后的任何结构都会被平均成一块色斑；你在有头 Chromium 里看到的「blur(40) 只剩色斑」不是 bug，是 σ 过大的必然结果。

`saturate(200%)` 也不是没用，只是它作用在 `#0d1117` 这种弱蓝灰上，会把 (13,17,23) 推到大约 (9,17,29)——
蓝得更明显。于是底栏看起来像「一块偏蓝的板」。这一层在这里其实在帮倒忙。

### 核实你的四条判断

| 你的判断 | 核实 | 修正 |
|---|---|---|
| 底色比背景亮 | 部分对 | 只亮 4/255，单独不足以造成「实心」感 |
| 大半径模糊把背后抹平 | **对，且是主因** | σ34 vs 高度 58 → 采样范围远大于元素本身 |
| brightness 提亮 = 浅灰板糊在深色背景上 | 方向对，量级不对 | `brightness(1.02)` 在 8bit 下输出不变；发灰来自 tint + 投影 |
| 真正的玻璃需要背后有高对比内容 | **对** | 这是唯一的结构性解法 |
| 所以要「再透一点」就降 alpha | **错** | 降 alpha 只会让底栏更接近隐形，静息状态不会更「玻璃」 |

一句话：

> **alpha 决定的是「背后内容能穿透多少」，不是「静息时看起来多透」。背后没有内容时，alpha 从 0.42 降到 0.1，
> 观感只是从「一块浅灰板」变成「没有板」。**

## A2. 真实产品怎么做的

### Apple Liquid Glass（iOS 26 / WWDC25）

- **核心机制是 lensing（折射），不是 blur。** WWDC25 Session 219 原话：Liquid Glass 「dynamically bends, shapes, and concentrates light in real time」，而「previous materials scattered light」。✅
  这条决定了一件事：**CSS 做不出真折射**，只能做近似，别承诺还原。
- **两个变体**：`regular` 模糊并调整背后内容的亮度以保证可读性，绝大多数系统组件用它；`clear` 永久更透明，只用于媒体背景。✅
- **clear 的可读性靠暗化层**：HIG 明确写「如果背后内容很亮，考虑加一层 35% 不透明度的暗化层」。✅
  → 这是本次最值钱的一条：**把不透明度加在玻璃背后，而不是加在玻璃上。**
- **Scroll Edge Effect**：内容滚到浮动玻璃控件下面时，模糊 + 降低不透明度，既保证可读又保留「下面有东西」。✅
- **尺寸决定厚度**：元素越大，阴影越深、边缘折射越强、散射越宽，模拟更厚的玻璃。✅
- **玻璃只用于导航层，不用于内容层**；不要 glass on glass。✅

> 注意：Apple **不公开** blur 半径、tint 等具体数值，HIG 只给语义。网上任何「iOS 用了 XXpx」都是第三方反推。❓
> 所以下面给的是「按比例推出来的工程值」，不是「复刻 Apple」。

### Windows Fluent Acrylic

官方 recipe 是五层叠加（微软 Learn 的「How we designed acrylic」）：✅

```
背景 → 高斯模糊 → exclusion blend → 颜色 tint → 噪点
```

- 微软 WPF Composition 示例里的具体取值：`GaussianBlur 30`、`Saturation 2.0`、`Exclusion(白 60%)`、`Tint(白 10%)`、`Noise 3%`。⚠️ 不同版本/不同主题会变，**结构比数值重要**。
- WinUI 暴露的语义参数：`TintColor` / `TintOpacity` / `TintLuminosityOpacity` / `FallbackColor`。✅
  → **「亮度混合」是独立于「颜色混合」的一层**，这是 CSS 里最容易漏掉的：CSS 只能同时用一层 `background` 做 tint，没有独立的 luminosity 通道，只能用 `brightness()` 近似。
- 关键行为：省电模式 / 关闭「透明效果」/ 高对比度下**整体退化为纯色**。✅
  → 我们也必须有 fallback（现在 `@supports not` 那段是对的，保留）。

### Material 3 Expressive

- Google 公开的只有方向性描述：给通知栏背景加**轻微模糊**以产生层次。✅
- **没有公开 glass 的 tint / blur / noise 参数规范，也没有对应组件**。❓ 未找到可靠规范，不能当参数依据。
- Android 平台能力是 `RenderEffect`（API 31+）和跨窗口模糊 `Window#setBackgroundBlurRadius`（需设备支持），但 M3 没有给出类似 Acrylic 的配方。
- 唯一可用的旁证：连系统级模糊都只做「轻微」，说明 Android 阵营对「大半径模糊」是保守的。

### 提炼成四条（后面的 CSS 都从这四条来）

1. 玻璃的**存在感**来自边缘（镜面环 + 高光 + 内阴影），不是来自填充色。
2. 可读性靠**背后的 dimming 层**，不靠提高 tint alpha。
3. `blur` 负责抹掉细节，`saturate` 负责保住颜色，两者分工，不要互相替代。
4. 必须有降级路径。

## A3. 可落地改法

### 改动 1（最重要）：先让背后「有东西」

现在是 `.page { padding-bottom: calc(58px + 22px + safe) }`，滚到底时底栏背后是纯色。
三种做法：

| 做法 | 实现 | 取舍 |
|---|---|---|
| **底部环境光 + scrim** | 一个 `position: fixed` 的渐变层，z-index 低于底栏 | 改动最小，同时解决可读性；推荐 |
| **Scroll edge effect** | 滚动容器底部 `mask-image` 渐隐 / 单独一层渐变模糊 | 更像 iOS；mask 会新建 backdrop root，要小心 |
| **内容真穿透** | 去掉 padding-bottom | 最后一项被底栏挡住点不到，不可取 |

推荐做法 1：`.glass-backdrop` 既是 scrim（压暗背后内容，提高可读性），又是「光源」（给 `saturate()` 提供色度）。
它让底栏在**静止时**也能采到一条从下往上的渐变，于是底栏自己会出现明暗过渡——这就是「透明」的证据。

### 改动 2：alpha 往哪个方向调

- 深色：`0.42 → 0.28~0.34`。理由不是「更透」，而是让背后内容的颜色有 66~72% 能穿过来。
- 浅色：**不要用纯白 tint**（数学上等于没有）。改成略冷于页面的 `rgba(240,243,247,.6)`；
  或者更彻底：把页面底色换成 `#F6F8FA`（GitHub 的 canvas 色），让白玻璃有东西可压。
- 不要低于 0.2：低于这个值，标签文字对比度会掉到 3:1 以下，而且投影会显脏。

**「更低 alpha 会不会反而更脏？」**
深色不会，只会更接近隐形。**浅色会**——白 tint 变薄之后，背后黑字被 blur 摊成的灰雾会直接透出来，那才是「脏」。
所以浅色主题的正确方向是：`alpha 不太低 + blur 更小 + scrim 更重`，而不是一路降 alpha。

### 改动 3：blur 与 saturate 的配合

- σ：`34 → 12~16`（约为元素高度的 1/4）。这是「还能看出背后有东西」和「文字不糊」的平衡点。
- `saturate`：`200% → 150~170%`。超过 180% 会把 `#0d1117` 的微弱蓝偏放大成可见色偏。
- `brightness`：**删掉**。深色下是恒等，浅色下会 clip。
- 想要更强的「透」的证据，可以再降到 σ=6~8，但必须同步加重 scrim，否则文字会糊成一片。

### 改动 4：边缘——「玻璃」和「塑料板」的分界线

CSS 能做三件事，第四件做不到：

1. **镜面环**：`conic-gradient` + 双层 `background-clip`，1px 环，亮部在左上 / 右下（光源方向要一致）。
2. **厚度感**：`inset 0 1px 0` 顶部亮线 + `inset 0 -1px 0` 底部暗线 + 极淡内发光。
3. **边缘二次模糊**：在边缘 6~8px 环带叠一层 `backdrop-filter: blur(2px) contrast(1.15)`（需要独立元素 + mask，成本与兼容性都要实测）。
4. **真折射（位移）**：**做不到**。Chromium 的 `backdrop-filter` 实际只支持 filter-function 列表，不接受 `url(#svg)` 引用，没有 displacement 通道 ⚠️。
   网上「用 SVG filter 做液态玻璃」的教程，实际是把 `filter` 加在元素自身上，会把文字一起扭曲，不是 backdrop。

### 改动 5：噪点

- 现在两层 `0.022 + 0.045` 叠加约 6.5%，在 `#0d1117` 上几乎不可见（深色下白噪点只在 OLED 暗环境才看得到）。
- Acrylic 参考值是 2%~4%（单层）。建议**单层 0.035**，浅色 invert 后 0.03。
- 噪点的真正作用是**打散色带**（大半径 blur 在 8bit 下会 banding），不是「质感」。σ 降到 14 后可以更淡。

### 改动 6：性能

- blur 成本 ∝ σ²。34→14 大约省 6 倍。
- **不要在滚动中动画 blur 半径**。想学 iOS 26「滚动时收缩 tab bar」，只动高度/位移，不动 `filter`。
- 低端机降级：`@supports` 之外加一个运行时开关（localStorage）比 `prefers-reduced-transparency` 可靠（后者 Chromium 支持不完整 ❓）。

### 代码：深色 / 浅色两套变量

```css
/* ================= 深色（默认） ================= */
:root {
  --glass-bg: rgba(24, 29, 36, 0.30);
  --glass-filter: blur(14px) saturate(160%);
  --glass-line: rgba(255, 255, 255, 0.16);
  --glass-sheen: rgba(255, 255, 255, 0.36);

  /* 1px 镜面环：亮部在左上与右下，方向必须一致 */
  --glass-rim: conic-gradient(from 205deg at 50% 50%,
      rgba(255, 255, 255, 0.60) 0deg,
      rgba(255, 255, 255, 0.08) 60deg,
      rgba(255, 255, 255, 0.02) 120deg,
      rgba(255, 255, 255, 0.30) 180deg,
      rgba(255, 255, 255, 0.04) 250deg,
      rgba(255, 255, 255, 0.44) 320deg,
      rgba(255, 255, 255, 0.60) 360deg);

  --tab-label-shadow: 0 1px 2px rgba(0, 0, 0, 0.75), 0 0 10px rgba(0, 0, 0, 0.5);
}

/* ================= 浅色 ================= */
:root[data-theme='light'] {
  /* 纯白 tint 叠白底等于不存在，必须比页面略冷、略暗 */
  --glass-bg: rgba(240, 243, 247, 0.60);
  --glass-filter: blur(12px) saturate(150%);
  --glass-line: rgba(31, 35, 40, 0.12);
  --glass-sheen: rgba(255, 255, 255, 0.95);

  --glass-rim: conic-gradient(from 205deg at 50% 50%,
      rgba(255, 255, 255, 1) 0deg,
      rgba(255, 255, 255, 0.55) 60deg,
      rgba(31, 35, 40, 0.05) 140deg,
      rgba(255, 255, 255, 0.80) 200deg,
      rgba(31, 35, 40, 0.04) 270deg,
      rgba(255, 255, 255, 0.92) 330deg,
      rgba(255, 255, 255, 1) 360deg);

  --tab-label-shadow: 0 1px 2px rgba(255, 255, 255, 0.85);
}
```

### 代码：底栏背后的 scrim + 光源

```css
/* 放在 .tabbar 之前、.page 之后；z-index 必须低于底栏(24) */
.glass-backdrop {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: calc(132px + var(--safe-bottom));
  z-index: 23;
  pointer-events: none;
  /* 一层径向色提供色度（给 saturate 吃），一层线性渐变压暗（给可读性） */
  background:
    radial-gradient(64% 120% at 50% 108%, rgba(47, 129, 247, 0.18), transparent 66%),
    linear-gradient(to top,
      rgba(1, 4, 9, 0.62) 0%,
      rgba(1, 4, 9, 0.30) 46%,
      rgba(1, 4, 9, 0) 100%);
}

html[data-theme='light'] .glass-backdrop {
  background:
    radial-gradient(64% 120% at 50% 108%, rgba(9, 105, 218, 0.10), transparent 66%),
    linear-gradient(to top,
      rgba(31, 35, 40, 0.10) 0%,
      rgba(31, 35, 40, 0.04) 46%,
      rgba(31, 35, 40, 0) 100%);
}
```

> 这一层是「加在玻璃背后的 dimming 层」，对应 HIG 里 clear 变体的 35% 暗化建议。
> 好处是：底栏可以做得更薄（alpha 更低），可读性却更好——因为文字是在压暗之后才被采样的。

### 代码：重写 `.tabbar`

```css
.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(10px + var(--safe-bottom));
  margin-inline: auto;              /* 不用 transform 居中，保持现状 */
  width: min(calc(100% - 24px), calc(var(--content-max, 100%) - 24px));
  height: 58px;
  padding: 5px;
  display: flex;
  align-items: stretch;
  gap: 2px;
  border-radius: 27px;

  /* 1px 镜面环：padding-box 铺底色，border-box 只露出那一圈渐变 */
  border: 1px solid transparent;
  background:
    linear-gradient(var(--glass-bg), var(--glass-bg)) padding-box,
    var(--glass-rim) border-box;

  -webkit-backdrop-filter: var(--glass-filter);
  backdrop-filter: var(--glass-filter);

  box-shadow:
    0 10px 26px rgba(0, 0, 0, 0.38),        /* 收紧：18/42 太像悬浮卡片 */
    0 2px 6px rgba(0, 0, 0, 0.28),
    inset 0 1px 0 var(--glass-sheen),        /* 顶部镜面线 */
    inset 0 -1px 0 rgba(0, 0, 0, 0.45),      /* 底部厚度线 */
    inset 0 0 18px rgba(255, 255, 255, 0.035); /* 极淡内发光 */

  z-index: 24;
  overflow: hidden;
}

/* 顶边高光保留，但减弱：现在是它和投影在撑「实体感」 */
.tabbar::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background:
    radial-gradient(120% 80% at 14% -34%, rgba(255, 255, 255, 0.14), transparent 56%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.10), transparent 46%);
}

/* 噪点：单层 0.035，只用来打散 banding */
.tabbar::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E");
}

/* 选中药丸：删掉 backdrop-filter —— 它在带 filter 的父元素里是空操作（原因见 A4） */
.tabbar button.on::before {
  content: '';
  position: absolute;
  inset: 1px 0;
  z-index: -1;
  border-radius: 22px;
  background-color: var(--tab-active-base);
  background-image: linear-gradient(180deg, var(--glass-active-top), var(--glass-active-bottom));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.2),
    inset 0 0 0 1px var(--glass-active-line),
    0 4px 16px var(--glass-active-glow);
}
```

### 落地时必须删掉的旧规则

改完上面的 CSS，下面三条**必须一起删**，否则新写法会被覆盖成原样：

1. `html[data-theme='light'] .tabbar { border-color: rgba(255,255,255,0.92); ... }`
   → 会把 `border: 1px solid transparent` 改成实白边，conic 镜面环直接被盖掉。`box-shadow` 那段可以保留或换成本文的。
2. `html[data-theme='light'] .tabbar::before { ... 白色雾 ... }`
   → 和新的 `::before` 叠加，浅色下会糊成纯白板（你现在「像一块白塑料」的主因之一）。
3. `.tabbar button.on::before` 里的 `backdrop-filter: blur(8px) saturate(140%)`
   → 在带 filter 的父级里是空操作（见 A4），留着只会误导下一个人。

### 验收方法（别靠肉眼「感觉」）

1. 临时把 `.glass-backdrop` 换成一张四色测试图，滚动与静止各截一张：
   底栏里能看出颜色分界 → 滤镜链路是通的；看不出 → 先查 A4 的 backdrop root。
2. `chrome://inspect` 连 WebView，在 DevTools 里把 `blur` 临时设为 0 对比。
3. 取底栏区域像素的标准差：静息时应 > 0（渐变），接近 0 说明仍然没有可采样的结构。

## A4. Android WebView 已知坑与规避清单

| 现象 | 根因 | 规避 | 来源 |
|---|---|---|---|
| 圆角处模糊溢出、出现直角亮边 | `border-radius + overflow:hidden` 裁不住 `backdrop-filter` | 把 `border-radius` 放在带 filter 的**同一个**元素上（现状已对）；给裁剪父层补 `backdrop-filter: blur(0px)`；或改用 `clip-path: inset(0 round 27px)`（需实测） | [crbug 40650402](https://issues.chromium.org/40650402)（WontFix/Obsolete）、[SO 59218666](https://stackoverflow.com/questions/59218666/backdrop-filter-not-working-with-overflow-hidden-on-parent) |
| 滚动时底栏内容镜像、错位、闪一下 | WebView 合成器把无关区域画进滤镜元素 | 不在滚动中改 blur 半径；真机复测；升级 WebView | [crbug 40802107](https://issues.chromium.org/40802107)（M99 修复，OEM WebView 未必） |
| 完全不模糊，只剩半透明色 | 祖先出现 `filter` / `opacity<1` / `mask` / `clip-path` / `mix-blend-mode` / 对应 `will-change` → 新建 **backdrop root**，采样被截断 | 逐级检查祖先；DevTools 的 Layers 面板确认 | [Filter Effects 2 §3](https://drafts.fxtf.org/filter-effects-2/#BackdropRoot) |
| 给底栏加 `transform` 后采样偏移 | 规范上 `transform` **不**建 backdrop root，但 Blink/WebView 历史实现有坐标偏差 | 继续用 `margin-inline:auto` 居中（现状），别为居中加 transform | 规范 §3 + 经验 |
| 选中药丸的 `blur(8px)` 没有效果 | 它在**已经带 `backdrop-filter`** 的 `.tabbar` 里，backdrop root 被父级截断，采样到的是父级自身的半透明填充 | 删掉那行 filter，改用半透明色 + inset 高光 | 同上规范 |
| 整个底栏发灰、像塑料 | 阴影太大太散（18/42）+ 没有镜面环 | 收紧投影，加 1px conic 环与顶部镜面线 | 设计判断 |
| 低端机掉帧、发热 | 每帧重算 blur，成本 ∝ σ² | σ 控制在 16 以内；不做 blur 动画；提供降级开关 | Acrylic 文档明确说 GPU 密集 ✅ |

补充两条：

- **软件渲染会直接失效**。`android:hardwareAccelerated` 默认 true，别关。
- **`isolation: isolate` 不产生 backdrop root**。它只产生 stacking context。
  你在 `theme.css:495` 的注释里写的「它会给元素再造一层 backdrop root」按规范不成立（7 条触发条件里没有 `isolation`）✅。
  删掉它没问题，但**别把这条当成结论写进注释**——当时观测到的失效大概率另有原因（合成层 / 采样坐标），
  按这条归因以后会误判。规范本身是 Editor's Draft 且标注「尚未达成工作组共识」，Blink 实现可能有出入，但没有任何公开资料支持 `isolation` 会切断 backdrop。

---

# B. 全屏（edge-to-edge）

## B1. Android 15 到底强制了什么

targetSdk 35、跑在 Android 15 上：✅

| 区域 | 行为 | API 状态 |
|---|---|---|
| 状态栏 | 默认透明，内容画到栏后面 | `setStatusBarColor` / `R.attr#statusBarColor` **废弃且无任何效果** |
| 手势导航栏 | 默认透明，内容画到栏后面 | `setNavigationBarColor` 对手势导航无效 |
| 三按钮导航栏 | 默认 80% 不透明 scrim，颜色跟随 windowBackground | `setNavigationBarColor` 仍影响三按钮（虽已废弃） |
| 刘海 | 非浮动窗口的 `layoutInDisplayCutoutMode` 一律按 `ALWAYS` 解释 | `SHORT_EDGES/NEVER/DEFAULT` 被当成 `ALWAYS` |
| `Configuration` | `screenWidthDp/screenHeightDp` **不再排除系统栏** | 用 `WindowInsets` / `WindowMetrics` 替代 |
| `setDecorFitsSystemWindows` | 废弃**且停用** | 35 上调用无效 |

**`windowOptOutEdgeToEdgeEnforcement` 的适用条件**：✅
- 只在 `targetSdk = 35` **且**设备是 Android 15 时有效。
- `targetSdk = 36` 时：Android 16 上**被忽略**；Android 15 上仍生效。
- 官方定位是「临时逃生舱」，Android 16 起彻底关闭。**不要用**。

**`setDecorFitsSystemWindows(false)` 与 `enableEdgeToEdge()` 的关系**：
- 前者是底层开关；35 上它已被系统强制为 false 且调用无效（`true` 也设不回去）。
- `androidx.activity.EdgeToEdge.enable(activity)` 做三件事：`decorFits=false`、系统栏透明、按背景亮度设图标明暗；并抹平 API 差异。**推荐用它，不要手写 flag。**
- 两者不是替代关系：`enableEdgeToEdge()` 内部就包含前者。

## B2. Capacitor 7 里的正确姿势

### 先看 `setOverlaysWebView` 到底做了什么（源码）

`@capacitor/status-bar` 7.0.6，`StatusBar.java:93-110`：

```java
public void setOverlaysWebView(Boolean overlays) {
    int uiOptions = decorView.getSystemUiVisibility();
    if (overlays) {
        uiOptions |= View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN;
        decorView.setSystemUiVisibility(uiOptions);
        activity.getWindow().setStatusBarColor(Color.TRANSPARENT);
    } else { /* 反向清除 */ }
}
```

结论：
- **只动状态栏**，完全不碰导航栏（没有 `LAYOUT_HIDE_NAVIGATION`）。这正是「铺不到导航栏下面」的直接原因（API ≤34 时）。
- 用的是 `setSystemUiVisibility` + `SYSTEM_UI_FLAG_*`，**API 30 起已废弃**。
- 在 API 35 上这段基本是冗余的（系统已经强制透明 + 全屏布局）。
- **它不处理 insets**，也不改 WebView 的布局参数。

### 再看 Capacitor 会不会自己加边距

`@capacitor/android` 7.6.10，`CapacitorWebView.java:58-88`：

```java
if (configEdgeToEdge.equals("disable")) return;
...
ViewCompat.setOnApplyWindowInsetsListener(this, (v, windowInsets) -> {
    Insets insets = windowInsets.getInsets(systemBars() | displayCutout());
    mlp.leftMargin = insets.left; mlp.topMargin = insets.top; ...
    return WindowInsetsCompat.CONSUMED;
});
```

`CapConfig.java:57` 默认 `"disable"`；CLI 类型注释写明 **Capacitor 8 会把默认改成 `"auto"`**。

→ 也就是说：**你现在没被加边距，是因为默认值恰好是 disable。** 哪天升级/改了配置成 `auto`，WebView 就会被塞进系统栏之间，全屏直接失效。

### 结论：需要做到什么

| 目标 | 靠谁 |
|---|---|
| 内容铺到栏下 | API 35 系统强制；API ≤34 用 `enableEdgeToEdge()` |
| 不被 Capacitor 加边距 | 保持 `android.adjustMarginsForEdgeToEdge: 'disable'`（当前默认） |
| 状态栏图标明暗 | `StatusBar.setStyle()`（内部是 `WindowInsetsControllerCompat`，未废弃）✅ |
| 把 insets 给 CSS | **必须自己写**（见 B5） |

所以 `MainActivity` 要写，但目的不是「开启全屏」，而是：
① 兼容 API ≤34；② 把 insets 喂给 CSS；③ 沉浸式开关。

## B3. `env(safe-area-inset-*)` 在 Android WebView 可靠吗

- `viewport-fit=cover` 是前提，你已经有。✅
- **Android WebView 并不总是给出正确值**。Capacitor 官方社区插件的 README 写得很直白：
  「Chromium 版本低于 140 的 WebView，`env(safe-area-inset-*)` 会是 0；插件通过给 WebView 加 padding 来兜底」。⚠️
- Capacitor 8 的 `SystemBars` 配置注释同样以 **Chromium 140** 为分界，并会额外注入 `--safe-area-inset-*`。⚠️
- 你的 `theme.ts:68` 注释假设「top 会跟随隐藏变 0」——这在**支持**的设备上成立，在不支持的设备上则**恒为 0**，两种情况的观感完全不同，所以必须实测目标 WebView 版本。

三种兜底，按推荐顺序：

| 方案 | 说明 | 代价 |
|---|---|---|
| **A. 原生注入 CSS 变量**（推荐） | `WindowInsets` → `evaluateJavascript` 写 `--safe-area-inset-*` | 30 行代码，零依赖，见 B5 |
| B. `@capacitor-community/safe-area@^7` | 自动检测 Chromium 版本，低版本给 WebView 加 padding | 多一个依赖；会接管系统栏样式 |
| C. CSS `max(env(), 固定值)` | 简单 | 机型差异大，不推荐 |

CSS 读取顺序必须改成「变量优先、env 兜底」：

```css
--safe-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
--safe-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
--safe-left: var(--safe-area-inset-left, env(safe-area-inset-left, 0px));
--safe-right: var(--safe-area-inset-right, env(safe-area-inset-right, 0px));
```

> 原生注入的是 `<html>` 上的 inline style，优先级高于 `:root` 规则；`env()` 只在变量缺失时生效。

## B4. 沉浸式全屏 vs edge-to-edge

| | edge-to-edge | 沉浸式（immersive） |
|---|---|---|
| 系统栏 | 可见、透明 | **隐藏** |
| 内容 | 铺到栏下 | 占满整屏 |
| insets | 有值 | 变 0（内容会跳） |
| 适用 | 常态 | 看图 / 视频 / 游戏 |

`SYSTEM_UI_FLAG_*` 在 API 30 起废弃，替代品是 `WindowInsetsController`（Compat 版）：✅

```java
WindowInsetsControllerCompat c =
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
c.hide(WindowInsetsCompat.Type.systemBars());   // 同时藏状态栏 + 导航栏
c.show(WindowInsetsCompat.Type.systemBars());   // 恢复
```

`BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`：从边缘滑入时**临时**显示半透明系统栏，超时自动隐藏——这就是「沉浸但可召回」。

**建议**：这个 App 不要常驻沉浸。状态栏图标保留、内容铺到下面即可。
你现在的 `fullscreen` 开关用的是 `StatusBar.hide()`，它只藏状态栏（`Type.statusBars()`），而且**没有设 behavior**，
所以藏起来之后边缘滑入的行为由系统默认决定，体验不统一。要么补 behavior，要么改成上面的写法。

## B5. 代码

> 前置：`EdgeToEdge` 来自 `androidx.activity:activity` 1.8.0+。`variables.gradle` 里已有 `androidxActivityVersion = '1.9.2'`，
> 但 `app/build.gradle` 没有显式依赖它，建议补一行，避免版本被传递依赖压回旧版：
> `implementation "androidx.activity:activity:$androidxActivityVersion"`

### `MainActivity.java`

```java
package dev.zjkl.ghx;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.activity.EdgeToEdge;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

import java.util.Locale;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1) 铺满：35 上系统已强制，这里覆盖 23..34
        EdgeToEdge.enable(this);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            // 35 上这两个 API 已废弃且无效，只在低版本手动设置
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {   // API 29+ 才有
                getWindow().setNavigationBarContrastEnforced(false);
            }
        }

        // 2) 图标明暗：深色主题 -> 浅色图标。运行期仍由 StatusBar.setStyle() 接管
        WindowInsetsControllerCompat c =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setAppearanceLightStatusBars(false);
        c.setAppearanceLightNavigationBars(false);

        // 3) 把真实 insets 送进 CSS（env() 在旧 WebView 上恒为 0）
        forwardInsetsToWebView();

        // 4) 锁死手势缩放（原有逻辑保留）
        WebSettings settings = getBridge().getWebView().getSettings();
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
    }

    private void forwardInsetsToWebView() {
        final WebView webView = getBridge().getWebView();
        final float density = getResources().getDisplayMetrics().density;

        ViewCompat.setOnApplyWindowInsetsListener(webView, (v, windowInsets) -> {
            Insets i = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars()
                            | WindowInsetsCompat.Type.displayCutout());
            String js = String.format(Locale.US,
                    "(()=>{const s=document.documentElement.style;" +
                    "s.setProperty('--safe-area-inset-top','%.2fpx');" +
                    "s.setProperty('--safe-area-inset-right','%.2fpx');" +
                    "s.setProperty('--safe-area-inset-bottom','%.2fpx');" +
                    "s.setProperty('--safe-area-inset-left','%.2fpx');})()",
                    i.top / density, i.right / density, i.bottom / density, i.left / density);
            webView.evaluateJavascript(js, null);
            return windowInsets;      // 注意：不要 CONSUMED
        });

        // 首次分发
        webView.post(() -> ViewCompat.requestApplyInsets(webView));
    }

    /** 沉浸式：需要时调用；behavior = 边缘滑入临时显示 */
    private void enterImmersive() {
        WindowInsetsControllerCompat c =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(WindowInsetsCompat.Type.systemBars());
    }

    private void exitImmersive() {
        WindowInsetsControllerCompat c =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.show(WindowInsetsCompat.Type.systemBars());
    }
}
```

> 返回值必须是 `windowInsets`（或 `ViewCompat.onApplyWindowInsets(v, windowInsets)`）。
> 返回 `CONSUMED` 会把 insets 截断，后续需要它的视图（输入法、系统栏避让）会拿到 0。

### `styles.xml`

```xml
<!-- 运行期主题：Capacitor 在 BridgeActivity.onCreate 里 setTheme 切到它 -->
<style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
    <item name="windowActionBar">false</item>
    <item name="windowNoTitle">true</item>
    <item name="android:background">@null</item>
    <item name="android:windowBackground">@color/window_background</item>

    <!-- 35+ 系统强制透明并忽略这两项；写在这里是为了 23..34 一致 -->
    <item name="android:windowDrawsSystemBarBackgrounds">true</item>
    <item name="android:statusBarColor">@android:color/transparent</item>
    <item name="android:navigationBarColor">@android:color/transparent</item>

    <!-- 非浮动窗口在 35+ 一律按 ALWAYS 处理；28..34 靠这一行铺到刘海下 -->
    <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
</style>
```

启动主题 `AppTheme.NoActionBarLaunch` **不要动**（见 B6）。

### `capacitor.config.ts`

```ts
const config: CapacitorConfig = {
  appId: 'dev.zjkl.ghx',
  appName: 'ghx',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#0d1117',
    // 千万别设成 'auto'/'force'：那会让 Capacitor 给 WebView 加系统栏 margin
    adjustMarginsForEdgeToEdge: 'disable',
  },
  server: { androidScheme: 'https' },
}
```

### `theme.ts` 的 `syncStatusBar`

```ts
// setOverlaysWebView 在 Android 上只动状态栏、且全是废弃 API，API 35 上还是空操作。
// 全屏布局交给 EdgeToEdge，这里只保留「图标明暗 + 显隐」。
if (Capacitor.getPlatform() === 'android') {
  await StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light })
} else {
  await StatusBar.setOverlaysWebView({ overlay: true })
  await StatusBar.setStyle({ style: theme === 'dark' ? Style.Dark : Style.Light })
}
```

## B6. 不要破坏启动屏

- 启动主题是 `AppTheme.NoActionBarLaunch`（`Theme.SplashScreen` + `windowSplashScreenBackground`）。
- Capacitor 在 `BridgeActivity.onCreate` 里执行 `setTheme(R.style.AppTheme_NoActionBar)`（`BridgeActivity.java:25-26`），
  所以**运行期用的是 `AppTheme.NoActionBar`**，改它不影响启动画面。
- Android 15 有个已知坑：非浮动窗口 + 旧版 `core-splashscreen` 可能**启动即崩**。
  官方建议把 `androidx.core:core-splashscreen` 升到 `1.2.0-alpha01+`，或显式设 `layoutInDisplayCutoutMode = always`。
  你现在是 `1.0.1`（`variables.gradle`），如果 35 上遇到启动崩溃，先查这一条。✅
- `windowSplashScreenBackground` 是白色、WebView 首帧是 `#0d1117`，中间会有一次白→深跳变。
  在意的话把 `windowBackground` 也设成同一个白色，或者接受它。

## B7. 验证清单

```bash
# 1. WebView 版本（决定 env() 靠不靠谱）
adb shell dumpsys package com.google.android.webview | grep versionName

# 2. 当前窗口 insets / 是否 edge-to-edge
adb shell dumpsys window | grep -iE "mInsetsState|fitInsets|decorFits"

# 3. 三按钮 vs 手势导航各测一遍（导航栏行为不同）
adb shell cmd overlay list | grep nav
```

人工检查项：
- 深/浅主题下，状态栏图标是否与背景对比足够（浅色主题要深色图标）。
- 开启「隐藏状态栏」后，`.page` 顶部不应留白（insets 变 0 后 `--safe-top` 应跟着变 0）。
- 键盘弹出时，底栏不应被顶起（现在没有 keyboard 插件，若以后加要重新算）。
- 横屏、刘海屏、三按钮导航各看一次。

---

## 附：未能证实的点

1. **iOS 的具体 blur / tint 数值**：Apple 不公开，HIG 只给语义。本文所有数值是工程推导，不是复刻。❓
2. **Material 3 Expressive 的 glass 参数**：没有公开规范，Google 只描述了「轻微模糊通知栏背景」。❓
3. **Chromium 140 这个分界版本**：来自 Capacitor 官方社区文档与 Capacitor 8 配置注释，未在 Chromium 发布说明里逐条核对。⚠️
4. **「fixed + backdrop-filter 滚动不重绘」的具体 bug 号**：只确认了 40802107（镜像绘制）与 40650402（圆角裁剪）；滚动重绘类问题在 Chromium 上分散在多个 issue，编号易变，按现象规避即可。⚠️
