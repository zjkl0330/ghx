/**
 * 键值存储抽象。Android 走原生 Preferences（SharedPreferences），
 * Web 调试走 localStorage。只存密文，不存明文令牌。
 */
export interface KV {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

/** 内存实现，供单元测试与临时会话使用。 */
export function memoryKV(seed: Record<string, string> = {}): KV {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    async get(key) {
      return map.has(key) ? (map.get(key) as string) : null
    },
    async set(key, value) {
      map.set(key, value)
    },
    async remove(key) {
      map.delete(key)
    },
  }
}

function isNative(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return typeof cap?.isNativePlatform === 'function' ? cap.isNativePlatform() : false
}

/**
 * 生产环境使用的 KV。原生端懒加载 @capacitor/preferences，避免 Web 构建时
 * 把原生插件打进首屏 chunk。
 */
export async function createKV(): Promise<KV> {
  if (isNative()) {
    const { Preferences } = await import('@capacitor/preferences')
    return {
      async get(key) {
        const { value } = await Preferences.get({ key })
        return value ?? null
      },
      async set(key, value) {
        await Preferences.set({ key, value })
      },
      async remove(key) {
        await Preferences.remove({ key })
      },
    }
  }

  return {
    async get(key) {
      return globalThis.localStorage?.getItem(key) ?? null
    },
    async set(key, value) {
      globalThis.localStorage?.setItem(key, value)
    },
    async remove(key) {
      globalThis.localStorage?.removeItem(key)
    },
  }
}
