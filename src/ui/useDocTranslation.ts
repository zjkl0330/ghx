import { useCallback, useEffect, useRef, useState } from 'react'
import { guardInline, unguardInline } from '../lib/linkguard'
import type { Block } from '../lib/markdown'
import {
  translateBlocks,
  type TargetLang,
  type TranslateChannel,
  type TranslationStore,
} from '../lib/translate'

export interface DocTransOptions {
  /** 用户是否勾了这个范围（设置里的「发行版说明」） */
  enabled: boolean
  channel: TranslateChannel
  target: TargetLang
  azureKey: string
  store: TranslationStore | null
}

export interface DocTransState {
  /** 译文块；null 表示还没翻或正在翻第一段 */
  zh: Block[] | null
  busy: boolean
  /** 失败说明；部分段落没翻成也要说清楚，不然用户只会看到「怎么还有英文」 */
  error: string | null
  /** 未翻成功 vs 总共需要翻的段数 */
  failed: { total: number; rest: number } | null
  translate: (blocks: Block[]) => Promise<void>
  reset: () => void
  /** 取消在途结果：切换文档时用，避免上一份的译文糊到当前这份上 */
  cancel: () => void
}

/**
 * 一段 Markdown（发行说明、Issue 正文…）的整块机翻。
 *
 * 和 README 那套是同一个思路，抽出来共用：
 * - 链接用 ⟦标签⟧ 占位保住，译文回来按出现顺序回填 spans，否则整段链接变死字；
 * - 边翻边显示（onBlock），长说明不用干等着；
 * - 每次只翻当前这一份，切换对象前先 cancel，避免串台。
 *
 * 与 README 的区别：不做续翻 / 分批（发行说明通常一屏内），失败就如实报数；
 * 结果只活在内存里，缓存交给 translateBlocks 自己的 store。
 */
export function useDocTranslation(opts: DocTransOptions): DocTransState {
  const [zh, setZh] = useState<Block[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ total: number; rest: number } | null>(null)
  const aliveRef = useRef(true)
  /** 本次翻译的令牌：切换文档后旧任务回来发现令牌不对就不再写状态 */
  const runRef = useRef(0)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const reset = useCallback(() => {
    runRef.current += 1
    setZh(null)
    setBusy(false)
    setError(null)
    setFailed(null)
  }, [])

  const cancel = reset

  const translate = useCallback(
    async (blocks: Block[]) => {
      if (!opts.enabled || !opts.store || blocks.length === 0) return
      const store = opts.store
      const run = ++runRef.current
      const live = () => aliveRef.current && runRef.current === run

      setBusy(true)
      setError(null)
      setFailed(null)
      // 先把原文铺上去：翻好一段替换一段，而不是白屏等全部完成
      setZh(blocks.map((b) => ({ ...b })))

      try {
        // Edge / 微软都能整批吃下；免费通道收着点，免得一上来就被限流
        const bulk = !!opts.azureKey.trim() || opts.channel === 'edge' || opts.channel === 'auto'
        const res = await translateBlocks(blocks, {
          channel: opts.channel,
          store,
          target: opts.target,
          azureKey: opts.azureKey,
          maxBlocks: bulk ? 60 : 20,
          concurrency: bulk ? 6 : 3,
          guard: {
            protect: (b) => {
              if (!('spans' in b)) return null
              const g = guardInline(b.spans)
              return g ? { text: g.text, ctx: g.ctx } : null
            },
            restore: (b, translated, ctx) => {
              const r = unguardInline(translated, ctx)
              if (!r) return null
              return { ...b, text: r.text, spans: r.spans, spansFor: r.text }
            },
          },
          onBlock: (index, block) => {
            if (!live()) return
            setZh((prev) => {
              if (!prev) return prev
              const next = prev.slice()
              next[index] = block
              return next
            })
          },
        })
        if (!live()) return
        setZh(res.blocks)
        if (res.translated === 0) {
          setZh(null)
          setError(res.total > 0 ? '这段没翻成功，网络可能不通，先看原文吧' : null)
        } else if (res.translated < res.total) {
          setFailed({ total: res.total, rest: res.total - res.translated })
          setError(`有 ${res.total - res.translated} 段没翻成（免费通道容易限流），可以点重试`)
        }
      } catch (e) {
        if (!live()) return
        setZh(null)
        setError((e as Error).message || '翻译失败，先看原文吧')
      } finally {
        if (live()) setBusy(false)
      }
    },
    [opts.enabled, opts.store, opts.channel, opts.target, opts.azureKey],
  )

  return { zh, busy, error, failed, translate, reset, cancel }
}
