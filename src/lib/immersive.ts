/**
 * 沉浸式全屏的原生通道。
 *
 * 只做一件事：告诉 MainActivity 里的 ImmersivePlugin 藏掉 / 显示系统栏。
 * 不用 @capacitor/status-bar 的 hide()：它只藏状态栏，也不设 systemBarsBehavior，
 * 边缘滑入的行为在不同机型上不一致（细节见 ImmersivePlugin.java）。
 */
import { Capacitor, registerPlugin } from '@capacitor/core'

interface ImmersiveBridge {
  setEnabled(options: { enabled: boolean }): Promise<{ enabled: boolean }>
  syncInsets(): Promise<{ ok: boolean }>
}

const Immersive = registerPlugin<ImmersiveBridge>('Immersive')

/** Web 端与插件缺失时静默跳过 —— 全屏只是外观，不该阻塞任何操作。 */
export async function setImmersive(on: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await Immersive.setEnabled({ enabled: on })
  } catch {
    /* 老版本壳里没有这个插件，退化成普通铺满 */
  }
}

/**
 * 让原生把当前的 WindowInsets 再写一遍 `--inset-*`。
 *
 * 原生侧在启动后 300/900/2000/4000ms 各推一次，但页面真正挂载完可能更晚
 * （保险库解密慢、低端机、或进程被杀后重建）。变量为空时顶栏会钻到状态栏底下，
 * 所以等页面自己认为就绪了，再要一次 —— 这次一定能写进已加载的文档里。
 */
export async function syncInsets(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await Immersive.syncInsets()
  } catch {
    /* 老版本壳里没有这个方法，忽略：原生那四次补推通常已经够用 */
  }
}
