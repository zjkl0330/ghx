/**
 * 应用内下载的原生桥。
 *
 * WebView 里的 fetch 下不了 APK：一是跨域（加速站基本不给 ACAO 头），
 * 二是就算拿到字节，也没有地方写文件、更调不起安装器。所以这一层交给
 * 同工程里的 DownloaderPlugin（android/app/src/main/java/dev/zjkl/ghx/DownloadPlugin.java）：
 *
 *   下载 → 写到 getExternalFilesDir(DIRECTORY_DOWNLOADS)
 *        → FileProvider 授权 → ACTION_VIEW 拉起系统安装器
 *
 * 进度走插件的 notifyListeners，每 200ms 一帧，不会把 JS 线程刷爆。
 * 网页端（开发调试）没有这个插件，所有调用都直接返回 unsupported，
 * 由上层退回「交给浏览器」。
 */

import { Capacitor, registerPlugin } from '@capacitor/core'
import type { DownloadKind } from './download'
import { parsePendingDownload, type PendingDownload } from './dl-history'

export interface NativeProgress {
  bytes: number
  total: number
  /** 瞬时速度 KB/s，原生侧按最近一秒的滑动窗口算 */
  kbps: number
}

export interface NativeDownloadResult {
  path: string
  bytes: number
  ms: number
}

export interface InstallResult {
  opened: boolean
  /** Android 8+ 没给「安装未知应用」授权时为 true，此时已跳到系统设置页 */
  needPermission?: boolean
}

/**
 * 原生侧的下载快照。
 *
 * `running` 是「现在有没有在跑」，`hasResult` 是「上一次留下了结果」。
 * 两者互斥：跑的时候结果被清空，结束后 running 变 false、结果才出现。
 *
 * 为什么要这个查询：熄屏、切后台、WebView 被系统回收重建之后，
 * 原来那个 `download()` 的 Promise 已经跟着页面一起没了，下载却还在继续。
 * 回来时只能问一句「现在什么情况」。
 */
export interface NativeStatus {
  running: boolean
  hasResult: boolean
  bytes: number
  total: number
  kbps: number
  fileName: string
  /** 成功时才有 */
  path?: string
  /** 失败或取消时的中文原因 */
  error?: string
  /** 成功时才有：耗时毫秒 */
  ms: number
}

interface DownloaderBridge {
  download(o: {
    url: string
    fileName: string
    expectBytes?: number
    /** 需要鉴权的资源（CI 产物）才传；跨域重定向时原生侧会主动丢掉它 */
    headers?: Record<string, string>
    /** 只有下载记录用得上；界面被销毁时靠它把「下过什么」补回来 */
    repo?: string
    kind?: DownloadKind
    tag?: string
  }): Promise<NativeDownloadResult>
  install(o: { path: string }): Promise<InstallResult>
  cancel(): Promise<void>
  status(): Promise<NativeStatus>
  exists(o: { paths: string[] }): Promise<{ exists: Record<string, boolean> }>
  takePending(): Promise<{ raw?: string }>
  addListener(
    event: 'progress',
    cb: (data: NativeProgress) => void,
  ): Promise<{ remove: () => void | Promise<void> }>
}

const Downloader = registerPlugin<DownloaderBridge>('Downloader')

/** 是否跑在原生壳里（网页调试时恒为 false） */
export function nativeDownloadAvailable(): boolean {
  return typeof Capacitor?.isNativePlatform === 'function' && Capacitor.isNativePlatform()
}

/** 把插件抛出来的异常收敛成能贴到界面上的短句 */
function humanError(err: unknown): string {
  const msg = (err as Error)?.message ?? String(err ?? '')
  if (/not implemented|not available/i.test(msg)) return '当前环境不支持应用内下载'
  if (/ENOSPC|No space left/i.test(msg)) return '手机存储空间不足'
  if (/EACCES|Permission denied/i.test(msg)) return '没有写入文件的权限'
  if (/Unable to resolve host|UnknownHost|ECONNREFUSED/i.test(msg)) return '线路连不上'
  if (/timeout|timed out/i.test(msg)) return '下载超时'
  if (/HTTP (\d{3})/.test(msg)) return `线路返回 ${/HTTP (\d{3})/.exec(msg)?.[1] ?? ''}`
  return msg.slice(0, 80) || '下载失败'
}

export interface InnerDownloadOptions {
  url: string
  fileName: string
  expectBytes?: number
  /** 需要鉴权的资源才传（CI 产物）；公开资源留空 */
  headers?: Record<string, string>
  /** 来源仓库，写下载记录用 */
  repo?: string
  kind?: DownloadKind
  tag?: string
  onProgress?: (p: NativeProgress) => void
}

/**
 * 应用内下载。返回落盘路径供随后安装。
 *
 * 不做「先 HEAD 探活」：这一步在原生侧会多一个往返，而下载本身失败时
 * 也会带着状态码回来，上层照样能换线路重试。
 */
export async function innerDownload(o: InnerDownloadOptions): Promise<NativeDownloadResult> {
  if (!nativeDownloadAvailable()) throw new Error('当前环境不支持应用内下载')
  let handle: { remove: () => void | Promise<void> } | null = null
  if (o.onProgress) {
    try {
      handle = await Downloader.addListener('progress', (d) => o.onProgress?.(d))
    } catch {
      // 监听不上不影响下载，只是没有进度条
    }
  }
  try {
    return await Downloader.download({
      url: o.url,
      fileName: o.fileName,
      expectBytes: o.expectBytes,
      ...(o.headers ? { headers: o.headers } : {}),
      ...(o.repo ? { repo: o.repo } : {}),
      ...(o.kind ? { kind: o.kind } : {}),
      ...(o.tag ? { tag: o.tag } : {}),
    })
  } catch (err) {
    throw new Error(humanError(err))
  } finally {
    try {
      await handle?.remove()
    } catch {
      // 忽略
    }
  }
}

/** 调起系统安装器。没有「未知来源」授权时会跳到设置页并返回 needPermission */
export async function installApk(path: string): Promise<InstallResult> {
  if (!nativeDownloadAvailable()) throw new Error('当前环境不支持直接安装')
  try {
    return await Downloader.install({ path })
  } catch (err) {
    throw new Error(humanError(err))
  }
}

/** 取消当前下载（原生侧会关掉连接并删掉 .part） */
export async function cancelInnerDownload(): Promise<void> {
  if (!nativeDownloadAvailable()) return
  try {
    await Downloader.cancel()
  } catch {
    // 取消是尽力而为，失败不打扰用户
  }
}

/**
 * 查询原生下载状态。网页端恒返回「没有在跑」——
 * 那边没有原生通道，也不存在「下载跑到一半页面没了」这种事。
 */
export async function downloadStatus(): Promise<NativeStatus> {
  if (!nativeDownloadAvailable()) {
    return { running: false, hasResult: false, bytes: 0, total: 0, kbps: 0, fileName: '', ms: 0 }
  }
  try {
    return await Downloader.status()
  } catch {
    return { running: false, hasResult: false, bytes: 0, total: 0, kbps: 0, fileName: '', ms: 0 }
  }
}

/**
 * 批量检查文件是否还在。
 *
 * 下载记录只存了路径，用户清过 App 存储、系统清理过缓存之后，路径就指空了。
 * 面板要能区分「还能装」与「只剩一条记录」，不能给一个点了报错的安装按钮。
 */
export async function filesExist(paths: string[]): Promise<Record<string, boolean>> {
  if (paths.length === 0 || !nativeDownloadAvailable()) return {}
  try {
    const r = await Downloader.exists({ paths })
    return r?.exists ?? {}
  } catch {
    return {}
  }
}

/**
 * 认领一条待记录的下载。取走即清空 —— 同一个结果不会被记两次。
 *
 * 正常时序下，下载一结束 DownloadSheet 立刻来取；页面不在了就留到下次启动，
 * 由 App 启动时兜一次。这样「熄屏下载完 → 回来」也能在记录里看到。
 */
export async function takePendingDownload(): Promise<PendingDownload | null> {
  if (!nativeDownloadAvailable()) return null
  try {
    const r = await Downloader.takePending()
    return parsePendingDownload(r?.raw)
  } catch {
    return null
  }
}
