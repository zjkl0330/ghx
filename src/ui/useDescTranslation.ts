import { useEffect, useRef, useState } from 'react'
import {
  cacheKeyFor,
  hashText,
  needsTranslation,
  translateAzureBatch,
  translateLongText,
  type TargetLang,
  type TranslateChannel,
  type TranslationStore,
} from '../lib/translate'

export interface DescItem {
  key: string
  text: string | null | undefined
}

export interface DescOptions {
  enabled: boolean
  channel: TranslateChannel
  target: TargetLang
  azureKey: string
  store: TranslationStore | null
}

/** 一次最多翻多少条简介。列表滚到底会换一批，不必一次全翻 */
const LIMIT = 30
/** 没有微软密钥时收着点：30 条短句能瞬间把 MyMemory 的免费额度打空 */
const LIMIT_FREE = 12
/** 逐条翻的并发；MyMemory 给 2 就够，微软给 5 */
const WORKERS = 4

/**
 * 仓库简介的机翻缓存。
 *
 * 列表里每行都发一次请求会又慢又费额度，所以：
 * 1. 只翻当前列表前 30 条 + 正在看的详情；
 * 2. 先查本地译文缓存，命中直接显示；
 * 3. 配了微软密钥就批量发（25 条一请求），没有才逐条并发。
 */
export function useDescTranslation(items: DescItem[], opts: DescOptions): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({})
  const itemsRef = useRef(items)
  itemsRef.current = items

  // 用「key + 内容哈希」当签名：列表重排但内容没变不会重复翻
  const sig = items.map((i) => `${i.key}\u0000${hashText(i.text ?? '')}`).join('\u0001')

  useEffect(() => {
    if (!opts.enabled || !opts.store) return
    const store = opts.store
    let alive = true

    void (async () => {
      const hits: Record<string, string> = {}
      const pending: { key: string; text: string; cache: string }[] = []

      const hasAzureKey = !!(opts.azureKey ?? '').trim()
      const limit = hasAzureKey ? LIMIT : LIMIT_FREE
      for (const it of itemsRef.current.slice(0, limit)) {
        const text = (it.text ?? '').trim()
        if (!text || !needsTranslation(text, opts.target)) continue
        const ck = cacheKeyFor({ channel: opts.channel, target: opts.target }, text)
        const hit = await store.get(ck)
        if (hit) hits[it.key] = hit
        else pending.push({ key: it.key, text, cache: ck })
      }
      if (!alive) return
      if (Object.keys(hits).length > 0) setMap((prev) => ({ ...prev, ...hits }))
      if (pending.length === 0) return

      let rest = pending
      const azureKey = (opts.azureKey ?? '').trim()
      if (azureKey && opts.channel !== 'mymemory' && opts.channel !== 'google') {
        const out = await translateAzureBatch(
          pending.map((p) => p.text),
          { target: opts.target, azureKey },
        )
        if (!alive) return
        const add: Record<string, string> = {}
        out.forEach((text, i) => {
          if (!text) return
          add[pending[i].key] = text
          void store.set(pending[i].cache, text)
        })
        if (Object.keys(add).length > 0) setMap((prev) => ({ ...prev, ...add }))
        rest = pending.filter((_, i) => !out[i])
        if (rest.length === 0) return
      }

      let cursor = 0
      const workers = hasAzureKey ? WORKERS : 2
      async function worker() {
        while (cursor < rest.length) {
          const p = rest[cursor]
          cursor += 1
          try {
            const r = await translateLongText(p.text, {
              channel: opts.channel,
              target: opts.target,
              azureKey,
            })
            if (!alive) return
            await store.set(p.cache, r.text)
            setMap((prev) => ({ ...prev, [p.key]: r.text }))
          } catch {
            /* 单条失败就显示原文，不影响其他行 */
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(workers, rest.length) }, worker))
    })()

    return () => {
      alive = false
    }
  }, [sig, opts.enabled, opts.channel, opts.target, opts.azureKey, opts.store])

  return map
}
