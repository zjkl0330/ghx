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

interface DownloaderBridge {
  download(o: {
    url: string
    fileName: string
    expectBytes?: number
    /** 需要鉴权的资源（CI 产物）才传；跨域重定向时原生侧会主动丢掉它 */
    headers?: Record<string, string>
  }): Promise<NativeDownloadResult>
  install(o: { path: string }): Promise<InstallResult>
  cancel(): Promise<void>
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
