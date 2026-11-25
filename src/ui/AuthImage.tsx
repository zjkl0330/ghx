import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { GitHubClient } from '../lib/api'
import { contentsApiPath, LruCache, rawRefCandidates } from '../lib/imagebytes'

/**
 * 私有仓库正文图片的「带令牌加载」能力。
 *
 * 只在图片自身加载失败后才会被调用（见 `MdImage`），所以公开仓库、
 * 公开图床的图完全不经过这里 —— 不多花一次请求，也不占 API 配额。
 */
export type AuthedImageLoader = (src: string) => Promise<string | null>

const Ctx = createContext<AuthedImageLoader | null>(null)

/** 存 24 张已经解码的图；超出按最久未用淘汰并 revoke */
const MAX_CACHED = 24
/** 同时最多 3 个请求：一屏十几张私有图时不至于把 iOS 的连接池占满 */
const MAX_PARALLEL = 3

export function useAuthImage(): AuthedImageLoader | null {
  return useContext(Ctx)
}

export function AuthImageProvider({ client, children }: { client: GitHubClient | null; children: ReactNode }) {
  const blobUrls = useRef<LruCache<string> | null>(null)
  const inflight = useRef(new Map<string, Promise<string | null>>())
  const running = useRef(0)
  const waiting = useRef<(() => void)[]>([])

  if (blobUrls.current === null && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    blobUrls.current = new LruCache<string>(MAX_CACHED, (_key, url) => URL.revokeObjectURL(url))
  }

  // 卸载（退出登录 / 换账号）时把 blob 全部回收，别让它们跟着页面走
  useEffect(() => {
    const cache = blobUrls.current
    return () => {
      cache?.clear()
      inflight.current.clear()
    }
  }, [])

  const loader = useMemo<AuthedImageLoader | null>(() => {
    const cache = blobUrls.current
    // 匿名客户端没有令牌，走了也是 404；不如让界面直接给失败的提示
    if (!client || client.anonymous || !cache) return null
    // 收窄成非空常量：下面的闭包里 TS 不再跟着外层判断走
    const api = client
    const store = cache

    function acquire(): Promise<void> {
      if (running.current < MAX_PARALLEL) {
        running.current += 1
        return Promise.resolve()
      }
      return new Promise((resolve) => waiting.current.push(() => {
        running.current += 1
        resolve()
      }))
    }

    function release(): void {
      running.current -= 1
      const next = waiting.current.shift()
      if (next) next()
    }

    async function fetchOne(src: string): Promise<string | null> {
      // github.com/{o}/{r}/raw|blob 与 raw 图床同构，两种都要认
      const candidates = rawRefCandidates(src)
      if (candidates.length === 0) return null
      const hit = store.get(src)
      if (hit) return hit
      const pending = inflight.current.get(src)
      if (pending) return pending

      const job = (async () => {
        await acquire()
        try {
          for (const ref of candidates) {
            try {
              const blob = await api.rawBlob(contentsApiPath(ref))
              const url = URL.createObjectURL(blob)
              store.set(src, url)
              return url
            } catch (err) {
              // 403/404 多半是「分支名里带斜杠」猜错了，换下一个候选；
              // 网络错误则不必再试三条，交给调用方显示失败
              if ((err as { status?: number }).status === 0) return null
            }
          }
          return null
        } finally {
          release()
        }
      })()
      inflight.current.set(src, job)
      try {
        return await job
      } finally {
        inflight.current.delete(src)
      }
    }

    return (src: string) => fetchOne(src)
  }, [client])

  return <Ctx.Provider value={loader}>{children}</Ctx.Provider>
}
