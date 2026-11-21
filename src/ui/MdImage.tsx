import { useEffect, useRef, useState } from 'react'
import { mirrorImage } from '../lib/images'
import type { Block } from '../lib/markdown'

type ImgBlock = Extract<Block, { kind: 'img' }>

/**
 * Markdown 正文里的图片（自述、Issue、发行说明共用）。
 *
 * raw.githubusercontent.com 在国内要么不通、要么十几秒没响应，而 `<img>`
 * 在「还在等」的时候不会触发 onerror —— 界面就是一块空白，用户也不知道
 * 是没图还是没加载出来。所以这里做三件事：
 *
 * 1. 优先走加速前缀，失败或超时（12s）换回原图；
 * 2. 两条都不行才判定失败，失败后给「重试」「不加载」两个动作，
 *    而不是丢一行死文字；
 * 3. 「不加载」把这张图折成一行小字，随时可以点回来 —— 流量紧张时
 *    用户需要的是「别再请求了」，不是「看不见也删不掉」。
 */
export function MdImage({ b, mirror }: { b: ImgBlock; mirror?: string }) {
  const accelerated = mirror ? mirrorImage(b.src, mirror) : null
  const primary = accelerated ?? b.src
  const fallback = accelerated && accelerated !== b.src ? b.src : null

  const [src, setSrc] = useState(primary)
  const [state, setState] = useState<'load' | 'ok' | 'fail'>('load')
  const [skipped, setSkipped] = useState(false)
  /** 重试时换 key 强制重挂 <img>，否则同一个失败地址不会再发请求 */
  const [attempt, setAttempt] = useState(0)
  const tried = useRef(false)

  // 列表复用组件：换了一张图要把失败/重试状态一起重置
  useEffect(() => {
    setSrc(primary)
    setState('load')
    setSkipped(false)
    setAttempt(0)
    tried.current = false
  }, [primary])

  useEffect(() => {
    if (state !== 'load' || !fallback || tried.current) return
    const t = window.setTimeout(() => {
      if (tried.current) return
      tried.current = true
      setSrc(fallback)
    }, 12_000)
    return () => window.clearTimeout(t)
  }, [state, fallback, src])

  function retry() {
    tried.current = false
    setSkipped(false)
    setSrc(primary)
    setState('load')
    setAttempt((n) => n + 1)
  }

  if (skipped) {
    return (
      <span className="md-img-skip">
        已跳过一张图片
        {b.alt ? `（${b.alt}）` : ''}
        <button type="button" className="md-img-linkbtn" onClick={retry}>
          加载
        </button>
      </span>
    )
  }

  // 徽章（shields.io 那类）只是装饰：加载不出来直接不占位，
  // 不然一排 README 顶部会出现十几个「重试/不加载」，比没图还乱
  if (state === 'fail' && b.badge) return null

  if (state === 'fail') {
    return (
      <span className="md-img-fail" title={b.alt || b.src}>
        <span>{b.alt ? `图片没能加载：${b.alt}` : '图片没能加载'}</span>
        <span className="md-img-acts">
          <button type="button" className="md-img-linkbtn" onClick={retry}>
            重试
          </button>
          <button type="button" className="md-img-linkbtn" onClick={() => setSkipped(true)}>
            不加载
          </button>
        </span>
      </span>
    )
  }

  return (
    <img
      key={attempt}
      className={`md-img${b.badge ? ' badge' : ''}${b.inline ? ' inline' : ''}`}
      src={src}
      alt={b.alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      style={
        b.badge
          ? undefined
          : b.height
            ? { height: b.height }
            : b.width
              ? { maxWidth: b.width }
              : undefined
      }
      onLoad={() => setState('ok')}
      onError={() => {
        if (!tried.current && fallback && fallback !== src) {
          tried.current = true
          setSrc(fallback)
          return
        }
        setState('fail')
      }}
    />
  )
}
