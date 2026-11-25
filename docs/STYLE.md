# ghx 项目样式

> 所有视觉只从 `src/styles/theme.css` 出发。改样式前读这一份，改完用 §11 的脚本验收。
> 守则见 [`RULES-SUMMARY.md`](./RULES-SUMMARY.md)，机制细节见 [`../AGENTS.md`](../AGENTS.md)。

---

## 1. 基调

**GitHub Primer**。深色为默认，浅色是**等价配色**，不是把深色反色——同一个元素在两种主题下的对比度都单独算过。

风格关键词：**克制、密实、低饱和**。没有大圆角卡片、没有渐变按钮、没有阴影堆叠。层次靠 1px 描边 + 底色差，动效只用于确认「点到了」。

---

## 2. 画布与布局

| 项 | 值 | 说明 |
|---|---|---|
| 设计尺寸 | 390 × 844 | 唯一目标，触摸优先 |
| 根字号 | `body { font-size: 14px }` | 其余字号全部围绕它 |
| 内容宽 | `--content-max: 620px`（≥640）、`760px`（≥1024） | 平板/桌面居中，不拉满 |
| 安全区 | `--safe-top/bottom/left/right` | `max(env(...), --inset-*)`，两边都有值也不叠加 |
| 页面滚动 | `.page` 独立滚动 | 顶栏与底栏不跟着走 |
| 底部让位 | `--tabbar-h` 由底栏高度驱动 | 改高度时页面让位自动跟随 |

`.app` 是 `flex column`：顶栏 `flex:none` → `.page` `flex:1` → 底栏 `fixed`。

---

## 3. 颜色（只用变量）

### 语义层

| 变量 | 深色 | 浅色 | 用途 |
|---|---|---|---|
| `--bg` | `#0d1117` | `#ffffff` | 页面底 |
| `--bg-deep` | `#010409` | `#ffffff` | 凹陷区（seg 槽、代码块底） |
| `--surface` | `#161b22` | `#f6f8fa` | 卡片、弹层 |
| `--surface-2` | `#21262d` | `#eaeef2` | 二级块、幽灵按钮 |
| `--surface-3` | `#2b313a` | `#dfe3e8` | 三级块 |
| `--line` | `#30363d` | `#d0d7de` | 所有 1px 分隔 |
| `--text` | `#e6edf3` | `#191c20` | 主文字 |
| `--text-2` / `--text-3` | `#c9d1d9` / `#b6c2cf` | `#353b42` / `#464d55` | 正文次级 |
| `--text-dim` | `#7d8590` | `#51575e` | 说明、元信息 |
| `--icon-dim` | `#8b949e` | `#585f67` | 弱化图标 |

### 状态色

| 语义 | 变量组 | 深色 | 浅色 |
|---|---|---|---|
| 成功 / 开放 | `--green` `--green-bg` `--green-line` | `#3fb950` | `#1a7f37` |
| 警告 / 进行中 | `--amber` `--amber-bg` `--amber-line` | `#d29922` | `#9a6700` |
| 危险 / 失败 | `--red` `--red-bg` `--red-line` | `#f85149` | `#cf222e` |
| 主操作按钮 | `--btn-green` | `#238636` | `#1f883d` |

图表三色：`--accent-rgb`（提交）、`--chart-issue-rgb`、`--chart-pull-rgb`，深浅各调过对比度。

### 强调色（六档）

只换 `--accent-rgb` / `--accent-fg-rgb` 两组 RGB，派生色全部自动跟随——**不要新增 `--blue-xxx` 之外的手写 rgba**。

| key | 名称 | 深色 | 浅色 |
|---|---|---|---|
| `blue` | 天蓝（默认） | `#2f81f7` | `#0969da` |
| `violet` | 紫罗兰 | `#a371f7` | `#8250df` |
| `teal` | 青碧 | `#39c5cf` | `#0e7c86` |
| `green` | 松绿 | `#3fb950` | `#1a7f37` |
| `amber` | 琥珀 | `#d29922` | `#9a6700` |
| `rose` | 洋红 | `#f778ba` | `#bf3989` |

命名遗留：变量仍叫 `--blue`，但值是跟随强调色的。已经被 60 多处引用，不改名。

---

## 4. 字体

```css
--font-ui: 'OPPO Sans', -apple-system, 'Noto Sans CJK SC', 'PingFang SC',
  'Microsoft YaHei', system-ui, sans-serif;
```

- 随包内置 OPPO Sans **400 单字重**，标题的 600 由浏览器合成加粗。再塞一份 Bold 要多 20 MB，不划算。
- 字体**不许子集化**：OPPO Sans 授权允许原样再分发、禁止修改，删字符属于修改。体积换合规，这条不让步。
- `font-display: swap`：系统字体先顶上，首屏不等字体。
- 设置里可切「系统字体」：**只换字体族，字号行高一个字不动**，否则切换瞬间会重排、滚动位置跳。

### 字号阶梯

| 用途 | 字号 |
|---|---|
| 页面大标题 | 22px |
| 弹层标题 / 区块标题 | 15.5px / 16px |
| 正文、列表主行 | 14px / 13px |
| 按钮、次级 | 12.5px |
| 元信息、说明 | 11.5px / 11px |
| 密集标签、角标 | 10.5px / 10px |
| 底栏文字 | 10px，`letter-spacing: 0.2px` |

行高默认 1.5–1.7；`text-overflow: ellipsis` 的地方一律配 `overflow: hidden` + `white-space: nowrap`。

---

## 5. 圆角与间距

| 层级 | 圆角 |
|---|---|
| 通用卡片（`--radius`） | **10px** |
| 按钮、分段控件、输入框 | 8px |
| 小标签、行内块 | 6px / 4px |
| 胶囊（chip、药丸） | 999px |
| 底栏胶囊（`--tabbar-radius`） | 27px |
| 弹层顶部 | 18px |
| 通栏底栏 | 20px 20px 0 0 |

间距节奏以 **4 的倍数 + 16 侧边**为准：

| 位置 | padding |
|---|---|
| 顶栏 `.topbar` | `10px 16px 8px` |
| 列表行 `.row` | `11px 16px` |
| 弹层 `.sheet` | `14px 16px calc(20px + safe-bottom)` |
| 卡片 `.panel` | `12px 13px 13px` |
| 按钮 `.btn` | 高 38px，左右 14px |
| 底栏内衬 | `5px`，按钮间距 2px |

行间距用 `gap`（4 / 6 / 8 / 9 / 12），不要用 margin 叠。

---

## 6. 液态玻璃（底栏）

底栏是唯一使用玻璃的组件。参数拆成四项，设置里的三档只改 `alpha` 与 `blur`：

```css
--glass-tint: 255, 255, 255;   /* 必须是白，不能是页面底色 */
--glass-alpha: 0.075;          /* 深色标准档 */
--glass-blur: 12px;            /* 严格 10–16 */
--glass-sat: 190%;
--glass-bg: linear-gradient(to bottom, α×0.22 → α×0.62 @44% → α 100%);
--glass-rim: linear-gradient(to bottom, 白0.22 → 0 @58%);
```

| 档位 | 深色 alpha / blur | 浅色 alpha / blur |
|---|---|---|
| 通透 `clear` | 0.05 / 10px | 0.06 / 10px |
| 标准 `normal` | 0.075 / 12px | 0.10 / 12px |
| 厚实 `thick` | 0.18 / 16px（sat 170%） | 0.24 / 16px（sat 175%） |

**四条用血换来的规则，别推翻：**

1. **tint 必须白。** 用页面底色时，玻璃叠在 `#0D1117` 上得 `rgb(17,21,28)`，和底色对比度 1.03:1——眼睛判定「这里没东西」，再调 alpha 也没用。
2. **blur 不许超过 16px。** CSS 的 `blur(σ)` 是高斯核标准差，3σ 一旦超过栏高（58px），背后文字被平均成一整片色斑，透是透了，什么也看不见。
3. **不要整圈 1px 描边。** 小尺寸下它读起来就是一条分割线，正是玻璃要去掉的硬边。边界交给上缘渐隐高光 + 投影。
4. **压暗层必须与胶囊同形。** `.glass-backdrop` 的 `inset / 高度 / 圆角` 与 `.tabbar` 共用 `--tabbar-*` 变量；超出圆角就变成「模糊的方框里放一枚胶囊」（v1.2.0 修的就是这个）。

浅色主题的特殊性：白叠白等于没有，**浅色的「有玻璃」全靠 blur 抹开滚过的文字 + 上缘高光**，所以浅色 blur 也保持 12px。

### 底栏几何

| 形态 | 尺寸 |
|---|---|
| 悬浮 `float` | 高 58px，左右 inset 12px，离底 10px，圆角 27px |
| 通栏 `dock` | 高度加 `safe-bottom`，圆角只留顶部 20px，投影朝上，背后压暗层高 160px |
| 只留图标 `tablabel=icon` | 高收窄到 50px |

居中**不能用** `left:50% + translateX(-50%)`：自身带 `transform` 的元素在部分 WebView 上会让 `backdrop-filter` 采样失准，玻璃退化成纯半透明，正文直接透出来。用 `margin-inline: auto`。

---

## 7. 图标

```tsx
<svg width={18} height={18} viewBox="0 0 24 24" fill="none"
     stroke="currentColor" strokeWidth={1.9}
     strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" />
```

- 全部内联在 `src/ui/icons.tsx`，**不引图标库**（体积 + 风格统一）。
- 24 网格、描边 1.9、`currentColor` 继承文字色，默认 18px；底栏 22px、行内 14–16px。
- 只用描边不用填充；需要强调时加 `drop-shadow`，不加第二层图形。
- `aria-hidden="true"`：图标是装饰，语义交给 `aria-label` 或文字。

---

## 8. 动效

- 时长 **0.12–0.2s**，缓动 `ease`；按压反馈用 `transform: scale(0.94–0.97)`。
- 只做「确认操作」的动效：弹层升起、药丸滑动、色块选中。不做装饰性动画。
- 精简模式（`data-motion="calm"`）把所有 `animation/transition` 压到 `0.01ms`——**不删规则**，删掉会让依赖 `transitionend` 的交互卡住。
- 兼容模式（渲染进程崩过）强制精简，用户偏好保留在本地，退出兼容后恢复。
- 尊重 `prefers-reduced-motion`。

---

## 9. 组件约定

| 组件 | 约定 |
|---|---|
| `.topbar` | 标题左、动作右；高度由 `padding: 10px 16px 8px` 与内容决定；分隔靠 `border-bottom` |
| `.row` | 整行可点，`border-bottom` 分隔，**不用卡片阴影**；选中态 `--blue-soft` |
| `.seg` | 分段控件，2px 内衬 + 8px 圆角，选中项 `--surface-2` + 600 字重 |
| `.chip` | 胶囊 999px，高约 24px，横向滚动不换行，选中 `--blue-soft` |
| `.btn` | 高 38px；`primary` 绿、`blue` 强调、`ghost` 描边；一屏最多一个 primary |
| `.sheet` | 底部弹层，顶圆角 18px，`max-height: 86vh`，自带滚动，遮罩 `--mask` |
| `.panel` | 卡片：`--surface` + 1px `--line` + `--radius` |
| `.actionbar` | 批量操作条，固定在底栏上方 80px，通栏模式改 64px |
| 空态 | 一句话说明 + 一个动作，不用插画 |

文字层级靠「字号 + `--text-dim`」，不靠加粗堆叠；一屏内加粗不超过两处。

---

## 10. 响应式与主题开关

全部由 `<html>` 上的 `data-*` 驱动，**不在 JS 里拼内联样式**（首屏内联脚本与运行时会漂移）：

| 属性 | 取值 |
|---|---|
| `data-theme` | 缺省（深色）/ `light` |
| `data-accent` | `blue` `violet` `teal` `green` `amber` `rose` |
| `data-tabbar` | `float` / `dock` |
| `data-tablabel` | `both` / `icon` |
| `data-bg` | `plain` / `glow` |
| `data-glass` | `clear` / `normal` / `thick` |
| `data-motion` | `full` / `calm` |
| `data-font` | 缺省（OPPO Sans）/ `system` |
| `data-safe` | `1` 时进入兼容模式 |

断点：

| 条件 | 变化 |
|---|---|
| `max-width: 359px` | 顶栏与列表左右边距收到 12px |
| `min-width: 640px` | 内容宽 620px 居中 |
| `min-width: 1024px` | 内容宽 760px |
| 横屏 | 底栏收窄到 460px，避免拉成一根横杠 |
| 横屏且 `max-height: 620px` | 底栏 46px / 圆角 21px / 字号 9px |

---

## 11. 改视觉后的验收

```bash
pnpm build
npx vite preview --port 4173
xvfb-run -a python3 scripts/verify-glass.py     # 玻璃四项指标 + 像素方差
xvfb-run -a python3 scripts/verify-apkstore.py  # 列表布局 / 单列 / 头像回退
```

`verify-glass.py` 断言的是**计算样式**（背景为渐变、`blur` 在区间内、`border` 为 0、有 `text-shadow`）加上**截图像素方差**（背景内容真的被糊开，而不是一块纯色）。

人工复核至少要覆盖四态：`深色/浅色 × 悬浮/通栏`，各看三件事——圆角外是否干净、胶囊内文字是否清晰、滚动内容穿过边界时有没有硬边。

---

## 12. 反模式（见到就改）

| 反模式 | 为什么 |
|---|---|
| 组件里写 `#2f81f7`、`rgba(...)` | 强调色一换就漏，暗/浅各一套必漏一处 |
| 玻璃加整圈 1px `border` | 读起来是分割线，破坏「一整块玻璃」 |
| `blur(20px+)` | 3σ 超过栏高，背后内容被抹平 |
| `left:50% + translateX(-50%)` 配 `backdrop-filter` | 采样失准，玻璃变半透明 |
| 压暗层比胶囊大一圈 | 圆角外一片模糊，像「模糊方框套胶囊」 |
| 限高滚动列表的子项不写 `flex: none` | `overflow` 非 `visible` 时 `min-height:auto` 失效，条目被压成 14px 一条 |
| 浅色主题拿深色反色 | 对比度全崩；两套是分别算过的 |
| 用底色表达白玻璃 | 白叠白不存在，只能靠 blur + 上缘高光 |
| 调字号切字体 | 切换瞬间重排、滚动位置跳 |
| 用 `margin` 叠行间距 | 与 `gap` 混用会双倍间距 |
