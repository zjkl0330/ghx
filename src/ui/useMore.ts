/**
 * 列表「加载更多」。
 *
 * 首屏仍由 `useLoad` 负责（它管缓存、重试、错误态），这里只处理后续页：
 * 给页码、拿一页、累加、判断到底。
 *
 * 三个细节：
 * 1. **筛选一变就清空**。否则「只看关闭」的列表里会混着上一轮「全部」的第二页。
 * 2. **用 ref 记页码与在途状态**。闭包里的 state 是旧的，连点两次会拉同一页。
 * 3. **不满一页就判定到底**。比数 `Link` 头稳，镜像站经常把响应头吃掉。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface MoreState<T> {
  /** 后续页累积下来的条目（不含首屏） */
  items: T[]
  loading: boolean
  done: boolean
  loadMore: () => void
  error: string | null
}

export function useMore<T>(
  fetchPage: (page: number) => Promise<T[]>,
  pageSize: number,
  deps: unknown[],
): MoreState<T> {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const page = useRef(2)
  const busy = useRef(false)
  const ended = useRef(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    page.current = 2
    busy.current = false
    ended.current = false
    setItems([])
    setDone(false)
    setError(null)
    // deps 由调用方给出：筛选条件、搜索词、仓库
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  const loadMore = useCallback(() => {
    if (busy.current || ended.current) return
    busy.current = true
    setLoading(true)
    setError(null)
    void fetchPage(page.current)
      .then((got) => {
        if (!alive.current) return
        page.current += 1
        setItems((prev) => [...prev, ...got])
        if (got.length < pageSize) {
          ended.current = true
          setDone(true)
        }
      })
      .catch((err: unknown) => {
        if (!alive.current) return
        // 停在这一页，页码不前进 —— 用户再点一次就是重试
        setError((err as Error).message || '加载失败')
      })
      .finally(() => {
        busy.current = false
        if (alive.current) setLoading(false)
      })
  }, [fetchPage, pageSize])

  return { items, loading, done, loadMore, error }
}
