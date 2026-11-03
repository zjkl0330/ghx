import { useEffect, useRef, useState } from 'react'
import {
  cacheKeyFor,
  hashText,
  needsTranslation,
  translateAzureBatch,
  translateEdgeBatch,
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

/** 能批量发的时候一次翻这么多条：Edge / Azure 都是数组接口，一请求顶几十条 */
const LIMIT_BATCH = 60
/** 只能逐条翻的时候收着点：MyMemory 的免费额度经不起 60 条短句瞬间打空 */
const LIMIT_FREE = 12
/** 逐条翻的并发；MyMemory 给 2 就够，Edge / 微软给 6 */
const WORKERS = 6

/**
 * 仓库简介的机翻缓存。
 *
 * 列表里每行都发一次请求会又慢又费额度，所以：
 * 1. 只翻当前列表前 N 条 + 正在看的详情；
 * 2. 先查本地译文缓存，命中直接显示；
 * 3. Edge / 微软都支持数组批量，优先一次发一整批（Edge 40 条/请求），
 *    失败的部分才退回逐条 —— 这是「翻译慢」的主要来源，已按通道分开处理。
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
      const azureKey = (opts.azureKey ?? '').trim()

      // 通道路由：显式选了谁就只认谁；自动模式 Edge 优先（免密钥、批量、国内可达）
      const batchKind: 'edge' | 'azure' | null =
        opts.channel === 'edge'
          ? 'edge'
          : opts.channel === 'azure'
            ? azureKey
              ? 'azure'
              : null
            : opts.channel === 'mymemory' || opts.channel === 'google'
              ? null
              : azureKey
                ? 'azure'
                : 'edge'

      const limit = batchKind ? LIMIT_BATCH : LIMIT_FREE
      const hits: Record<string, string> = {}
      const pending: { key: string; text: string; cache: string }[] = []

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

      /** 用某个批量通道发一批，返回没翻成的部分 */
      async function runBatch(kind: 'edge' | 'azure'): Promise<typeof pending> {
        const texts = rest.map((p) => p.text)
        const out =
          kind === 'edge'
            ? await translateEdgeBatch(texts, { target: opts.target })
            : await translateAzureBatch(texts, { target: opts.target, azureKey })
        if (!alive) return []
        const add: Record<string, string> = {}
        out.forEach((text, i) => {
          if (!text) return
          add[rest[i].key] = text
          void store.set(rest[i].cache, text)
        })
        if (Object.keys(add).length > 0) setMap((prev) => ({ ...prev, ...add }))
        return rest.filter((_, i) => !out[i])
      }

      if (batchKind === 'edge') {
        rest = await runBatch('edge')
        // Edge 整批失败（被墙 / 接口下线）时，有微软密钥就再试一次批量
        if (rest.length === pending.length && azureKey) rest = await runBatch('azure')
      } else if (batchKind === 'azure') {
        rest = await runBatch('azure')
      }
      if (!alive || rest.length === 0) return

      // 剩下逐条走完整降级链（Edge → 微软 → MyMemory → Google）
      let cursor = 0
      const workers = batchKind ? WORKERS : 2
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
