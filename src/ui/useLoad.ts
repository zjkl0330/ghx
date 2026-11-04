import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 页面级数据加载。
 *
 * 每个页面都要「加载中 / 出错 / 重试 / 静默刷新」这一套，
 * 写 14 遍不如抽一个。`fn` 返回 null 表示条件不满足（比如还没选仓库），
 * 此时不请求也不报错。
 */
export function useLoad<T>(fn: () => Promise<T> | null, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const run = useCallback(async (silent = false) => {
    const p = fnRef.current()
    if (!p) {
      setLoading(false)
      return
    }
    if (!silent) setLoading(true)
    setError(null)
    try {
      const v = await p
      if (alive.current) setData(v)
    } catch (err) {
      if (alive.current) setError((err as Error).message)
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void run()
    // deps 由调用方给出，长度必须稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, setData, loading, error, reload: run }
}
