import { useEffect, useRef, useState } from 'react'
import { rawRefCandidates } from '../lib/imagebytes'
import { mirrorImage } from '../lib/images'
import type { Block } from '../lib/markdown'
import { useAuthImage } from './AuthImage'

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
 *
 * 私有仓库的图两条都拿不到（raw 对匿名请求回 404），所以在判死之前
 * 再试一次带令牌的通道：取回字节换成 `blob:` 地址。这条路只在前面
 * 全失败后才走，公开图不受影响。
 */
export function MdImage({ b, mirror }: { b: ImgBlock; mirror?: string }) {
  const accelerated = mirror ? mirrorImage(b.src, mirror) : null
  const primary = accelerated ?? b.src
  const fallback = accelerated && accelerated !== b.src ? b.src : null
  const authed = useAuthImage()

  const [src, setSrc] = useState(primary)
  const [state, setState] = useState<'load' | 'ok' | 'fail'>('load')
  const [skipped, setSkipped] = useState(false)
  /** 重试时换 key 强制重挂 <img>，否则同一个失败地址不会再发请求 */
  const [attempt, setAttempt] = useState(0)
  const tried = useRef(false)
  const authTried = useRef(false)

  // 列表复用组件：换了一张图要把失败/重试状态一起重置
  useEffect(() => {
    setSrc(primary)
    setState('load')
    setSkipped(false)
    setAttempt(0)
    tried.current = false
    authTried.current = false
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

  /**
   * 私有仓库的图不会「报错」，它可能一直挂着 —— 国内直连 raw 时常见
   * 十几秒没响应。所以除了 onError，还按时间兜一手：4 秒还没出来就用
   * 令牌通道直接取字节。公开图正常 400ms 内就画完了，走不到这里。
   */
  useEffect(() => {
    if (state !== 'load' || !authed || authTried.current) return
    const target = rawRefCandidates(primary).length > 0 ? primary : fallback && rawRefCandidates(fallback).length > 0 ? fallback : null
    if (!target) return
    const t = window.setTimeout(() => {
      if (authTried.current) return
      authTried.current = true
      void authed(target)
        .then((url) => {
          if (!url) return
          setSrc(url)
          setState('load')
        })
        .catch(() => undefined)
    }, 4_000)
    return () => window.clearTimeout(t)
  }, [state, authed, primary, fallback])

  function retry() {
    tried.current = false
    authTried.current = false
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
        // 最后一道：私有仓库的图。只认 raw 图床，其它域名（图床、徽章）
        // 拿令牌去问也是白问，直接判失败
        if (!authTried.current && authed) {
          const target = rawRefCandidates(src).length > 0 ? src : fallback && rawRefCandidates(fallback).length > 0 ? fallback : null
          if (target) {
            authTried.current = true
            void authed(target)
              .then((url) => {
                if (url) {
                  setSrc(url)
                  setState('load')
                } else {
                  setState('fail')
                }
              })
              .catch(() => setState('fail'))
            return
          }
        }
        setState('fail')
      }}
    />
  )
}
