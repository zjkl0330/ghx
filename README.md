# ghx

Android 上的 GitHub 本地控制台。不给网页版当壳，直接调 REST API，所以 **github.com 打不开的时候它照样能用**。

## 为什么有这个东西

国内访问 github.com 网页经常失败，但 `api.github.com` 通常还是通的。网页打不开 → 改不了仓库可见度、管不了令牌。ghx 就是补这个缺口：用一个装在本机的 App，通过 API 完成这些管理动作，不依赖任何后端服务。

## 能做什么

| 能力 | 说明 |
|---|---|
| 令牌保险库 | 多个 PAT 用 AES-256-GCM 加密落盘，明文只在请求瞬间存在内存；默认免密打开即用 |
| 启动验证（可选） | 想加一道门时再开：口令包裹设备密钥，启动才询问；随时可改口令或关掉 |
| 深色 / 浅色 | 跟随系统或手动指定，切换即时生效并记住，状态栏颜色一起变 |
| 令牌体检 | 校验有效性、读取 scopes、按有效期提前提醒、查看 API 配额 |
| 仓库总览 | 分页拉取全部可访问仓库，按公开/私有筛选，按名称与描述搜索 |
| 新建仓库 | 选私有/公开、填描述、可初始化 README，仓库名按 GitHub 规则即时校验 |
| 批量改可见度 | 多选后一次性转公开或转私有，逐条回执，公开转私有强制二次确认 |
| 仓库详情 | Star / 取消 Star、归档 / 取消归档、单条改可见度、复制克隆地址、在浏览器打开 |
| 删除仓库 | 需键入仓库名二次确认，要求令牌具备 `delete_repo` |
| 检查更新 | 版本查询走 API，APK 走加速前缀下载 |
| 固定签名 | 跨机器与跨版本签名一致，覆盖安装不丢本地数据 |
| 审计日志 | 本地留痕，每次改可见度、令牌操作、删仓库都记一条 |

## 明确做不到的事

**App 内无法创建 PAT。** GitHub 对 classic 与 fine-grained 令牌都没有公开的创建端点，只能去网页 `settings/tokens` 生成后粘贴导入。任何宣称能在 App 里生成令牌的工具，都是在网页里塞表单。

**公开转私有有代价。** 会永久丢失 star 与 watcher，搜索排名也会掉。GitHub 官方在 CLI 里为此专门要求 `--accept-visibility-change-consequences`，ghx 同样强制二次确认。组织仓库如果限制了「仅 owner 可改可见度」，非 owner 调用会返回 422。

## 安装

从 [Releases](https://github.com/827802685/ghx/releases) 下载 `ghx-<版本>-debug.apk` 直接安装。要求 Android 6.0+（minSdk 23）。

打开即用，不设口令、不弹解锁页。要加锁的话去「设置 → 安全 → 开启启动验证」，口令至少 8 位，忘了无法找回。

## 检查更新怎么走

两条通道刻意分开：

- **查版本** → `api.github.com/repos/827802685/ghx/releases/latest`，匿名请求，不带你的令牌
- **下安装包** → `https://gh.zjkl0330.dpdns.org/827802685/ghx/releases/download/<tag>/<apk>`

因为 github.com 的下载直连基本不通，必须走加速前缀。前缀可在设置页改，改完立即生效。

更新时用系统浏览器下载，装完覆盖安装，本地令牌与审计日志不会丢。

## 本地构建

```bash
pnpm install
pnpm test                 # 98 项单元测试
pnpm build                # 类型检查 + 打包
pnpm cap:sync             # 同步版本号到 gradle 并 cap sync

cd android && ./gradlew assembleDebug
```

产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。

需要 JDK 21（Capacitor 7 的硬要求）与 Android SDK 35。

版本号只在 `package.json` 维护一处，`scripts/sync-version.mjs` 会把它同步成 gradle 的 `versionName` 与 `versionCode`（`major*10000 + minor*100 + patch`）。

CI 在 `.github/workflows/build-apk.yml`：push 到 main 出 artifact，打 `v*` tag 自动发 Release 并附 APK。

## 版本与发布

每改一次就推进一个补丁位，补丁位满 10 进次版本，每次推进都直接发 Release：

| 当前 | 下一次 | 说明 |
|---|---|---|
| 0.4.0 | 0.4.1 | 补丁位 +1 |
| 0.4.8 | 0.4.9 | 补丁位到 9 |
| 0.4.9 | 0.5.0 | 补丁位满 10，进位归零 |
| 0.9.9 | 1.0.0 | 次版本同样满 10 进主版本 |

```bash
pnpm version:bump                                   # +0.0.1，同时同步 gradle
pnpm test && pnpm build
git add -A && git commit -m "feat: ..."
git tag -a "v$(node -p "require('./package.json').version")" -m "ghx $(node -p "require('./package.json').version")"
git push origin main --tags
```

tag 一推，CI 自动构建 APK、校验签名指纹（不匹配直接失败）、生成 Release 并附安装包。

## 解锁方式与安全边界

密钥和口令是两件事，ghx 把它们拆开了：

| 模式 | 启动体验 | 适用 |
|---|---|---|
| 免密（默认） | 打开直接进主界面 | 一个人用的手机 |
| 启动验证（可选） | 每次启动输口令 | 手机可能被别人拿去 |

两种模式令牌都是 AES-256-GCM 密文落盘。区别只在设备密钥放在哪：免密时它也留在本机，所以能防住「数据文件被单独拷走或上传」，防不住拿到已解锁手机的人；开启启动验证后，设备密钥被口令包裹，才真正需要口令才能解开。

- 旧版本（口令派生密钥）的保险库会在解锁屏或设置页提供一次性迁移，令牌解密后重新加密，原文不变
- 口令只在本机参与解密，不上传、不保存，也没有找回途径
- 没有后端、没有遥测、没有账号体系，所有请求从手机直发你配置的 API 地址
- 手动「锁定保险库」会清空内存中的密钥与明文；免密模式下再点一下就回来，只起遮挡作用
- 审计日志只存本机，可一键清空
- 仓库 URL 一律用 `owner/name` 拼接，不做文件系统操作

## 许可

MIT
