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
