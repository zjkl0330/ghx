# ghx

Android 上的 GitHub 本地控制台。不给网页版当壳，直接调 REST API，所以 **github.com 打不开的时候它照样能用**。

## 为什么有这个东西

国内访问 github.com 网页经常失败，但 `api.github.com` 通常还是通的。网页打不开 → 改不了仓库可见度、管不了令牌。ghx 就是补这个缺口：用一个装在本机的 App，通过 API 完成这些管理动作，不依赖任何后端服务。

## 能做什么

| 能力 | 说明 |
|---|---|
| 令牌保险库 | 多个 PAT 加密存储，PBKDF2 派生密钥 + AES-256-GCM，密文落盘，明文只在请求瞬间存在内存 |
| 令牌体检 | 校验有效性、读取 scopes、按有效期提前提醒、查看 API 配额 |
| 仓库总览 | 分页拉取全部可访问仓库，按公开/私有筛选，按名称与描述搜索 |
| 批量改可见度 | 多选后一次性转公开或转私有，逐条回执，公开转私有强制二次确认 |
| 仓库详情 | Star / 取消 Star、归档 / 取消归档、单条改可见度、复制克隆地址、在浏览器打开 |
| 删除仓库 | 需键入仓库名二次确认，要求令牌具备 `delete_repo` |
| 检查更新 | 版本查询走 API，APK 走加速前缀下载 |
| 审计日志 | 本地留痕，每次改可见度、令牌操作、删仓库都记一条 |

## 明确做不到的事

**App 内无法创建 PAT。** GitHub 对 classic 与 fine-grained 令牌都没有公开的创建端点，只能去网页 `settings/tokens` 生成后粘贴导入。任何宣称能在 App 里生成令牌的工具，都是在网页里塞表单。

**公开转私有有代价。** 会永久丢失 star 与 watcher，搜索排名也会掉。GitHub 官方在 CLI 里为此专门要求 `--accept-visibility-change-consequences`，ghx 同样强制二次确认。组织仓库如果限制了「仅 owner 可改可见度」，非 owner 调用会返回 422。

## 安装

从 [Releases](https://github.com/827802685/ghx/releases) 下载 `ghx-<版本>-debug.apk` 直接安装。要求 Android 6.0+（minSdk 23）。

首次打开先设一个本地口令（至少 8 位），再粘贴 PAT。口令丢了等于令牌丢了，没有找回途径。

## 检查更新怎么走

两条通道刻意分开：

- **查版本** → `api.github.com/repos/827802685/ghx/releases/latest`，匿名请求，不带你的令牌
- **下安装包** → `https://gh.zjkl0330.dpdns.org/827802685/ghx/releases/download/<tag>/<apk>`

因为 github.com 的下载直连基本不通，必须走加速前缀。前缀可在设置页改，改完立即生效。

更新时用系统浏览器下载，装完覆盖安装，本地令牌与审计日志不会丢。

## 本地构建

```bash
pnpm install
pnpm test                 # 75 项单元测试
pnpm build                # 类型检查 + 打包
pnpm cap:sync             # 同步版本号到 gradle 并 cap sync

cd android && ./gradlew assembleDebug
```

产物在 `android/app/build/outputs/apk/debug/app-debug.apk`。

需要 JDK 21（Capacitor 7 的硬要求）与 Android SDK 35。

版本号只在 `package.json` 维护一处，`scripts/sync-version.mjs` 会把它同步成 gradle 的 `versionName` 与 `versionCode`（`major*10000 + minor*100 + patch`）。

CI 在 `.github/workflows/build-apk.yml`：push 到 main 出 artifact，打 `v*` tag 自动发 Release 并附 APK。

## 安全边界

- 没有后端、没有遥测、没有账号体系，所有请求从手机直发你配置的 API 地址
- 令牌只在保险库解锁后解密，锁屏回到解锁页即清空内存中的明文
- 审计日志只存本机，可一键清空
- 仓库 URL 一律用 `owner/name` 拼接，不做文件系统操作

## 许可

MIT
