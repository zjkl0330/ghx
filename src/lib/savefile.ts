/**
 * 把一段文本存成文件 / 从文件里读回文本。
 *
 * 两条通道：
 *
 * - **原生**：走同工程的 ExporterPlugin（android/app/src/main/java/dev/zjkl/ghx/ExporterPlugin.java）。
 *   保存用 `ACTION_CREATE_DOCUMENT`，弹的是系统「保存到」面板 —— 里面能选
 *   **Google 云端硬盘**、下载目录、OneDrive 等任何 DocumentsProvider，选完直接写进去，
 *   不需要 Drive SDK、也不需要账号授权。读取用 `ACTION_OPEN_DOCUMENT`，同样由系统选择器
 *   把文件读成文本回传。
 * - **网页**：`<a download>` 触发浏览器下载，`<input type=file>` 选文件。
 *   开发调试与 Web 版都走这条，行为和普通网页一致。
 *
 * 为什么不用 @capacitor/filesystem + @capacitor/share：那套需要额外两个原生依赖，
 * 而「保存到云盘」在 share 面板里并不可靠（Drive 不一定注册 SEND）。系统保存面板
 * 才是 Android 上真正意义上的「另存为到云盘」。
 */

import { Capacitor, registerPlugin } from '@capacitor/core'

export interface SaveOutcome {
  ok: boolean
  /** 保存到哪儿；取消时没有 */
  via?: 'native' | 'web'
  name?: string
  cancelled?: boolean
  error?: string
}

export interface PickedFile {
  name: string
  text: string
}

interface ExporterBridge {
  saveFile(o: { fileName: string; mime: string; text: string }): Promise<{ saved?: boolean; name?: string }>
  pickFile(o: { mime: string }): Promise<{ cancelled?: boolean; name?: string; text?: string }>
}

const Exporter = registerPlugin<ExporterBridge>('Exporter')

function isNative(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return typeof cap?.isNativePlatform === 'function' ? cap.isNativePlatform() : Capacitor.isNativePlatform()
}

function revokeLater(url: string): void {
  // 立刻 revoke 会让部分 WebView 的下载还没开始就 404，给足一拍
  globalThis.setTimeout(() => {
    try {
      URL.revokeObjectURL(url)
    } catch {
      /* 已被回收 */
    }
  }, 60_000)
}

/** 网页通道的保存：Blob + 隐藏 <a download> */
function saveViaBrowser(fileName: string, text: string, mime: string): SaveOutcome {
  try {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    revokeLater(url)
    return { ok: true, via: 'web', name: fileName }
  } catch (err) {
    return { ok: false, error: (err as Error).message || '浏览器不允许下载' }
  }
}

/**
 * 保存文本。
 *
 * 原生端失败（插件缺失、用户取消、写入异常）时不再偷偷退回浏览器下载 ——
 * 那会在 WebView 里什么也不发生，用户以为存好了。直接把原因带回去。
 */
export async function saveTextFile(o: {
  fileName: string
  text: string
  mime?: string
  /** 系统面板标题；不传用文件名 */
  title?: string
}): Promise<SaveOutcome> {
  const mime = o.mime ?? 'application/json'
  if (!isNative()) return saveViaBrowser(o.fileName, o.text, mime)

  try {
    const r = await Exporter.saveFile({
      fileName: o.title || o.fileName,
      mime,
      text: o.text,
    })
    if (r?.saved === false) return { ok: false, cancelled: true }
    return { ok: true, via: 'native', name: o.fileName }
  } catch (err) {
    const msg = (err as Error).message || ''
    // 用户按返回键时部分机型会走到这里，别当成错误弹红字
    if (/cancel/i.test(msg)) return { ok: false, cancelled: true }
    return { ok: false, error: msg || '系统保存面板打不开' }
  }
}

/** 网页通道的选文件：input 必须由用户手势触发，所以这里同步创建并点击 */
function pickViaBrowser(mime: string): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = mime === '*/*' ? '.json,.txt,application/json,text/plain' : mime
    input.style.display = 'none'
    let done = false
    const finish = (v: PickedFile | null) => {
      if (done) return
      done = true
      input.remove()
      resolve(v)
    }
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        finish(null)
        return
      }
      const reader = new FileReader()
      reader.onload = () => finish({ name: file.name, text: String(reader.result ?? '') })
      reader.onerror = () => finish(null)
      reader.readAsText(file)
    }
    // 用户点了取消：change 不触发，靠窗口重新获得焦点兜底（只等一次）
    globalThis.addEventListener(
      'focus',
      () => {
        globalThis.setTimeout(() => {
          if (!input.files || input.files.length === 0) finish(null)
        }, 800)
      },
      { once: true },
    )
    document.body.appendChild(input)
    input.click()
  })
}

/** 选一个备份文件并读成文本。取消返回 null */
export async function pickTextFile(mime = 'application/json'): Promise<PickedFile | null> {
  if (!isNative()) return pickViaBrowser(mime)
  const r = await Exporter.pickFile({ mime })
  if (!r || r.cancelled || typeof r.text !== 'string') return null
  return { name: r.name || 'backup.json', text: r.text }
}

/** 备份面板上给按钮写文案用：原生端是系统面板（含云盘），网页端就是下载 */
export function saveTargetLabel(): string {
  return isNative() ? '保存到文件 / 云盘' : '下载备份文件'
}
