/**
 * RFC 4122 v4 UUID。
 *
 * 为什么不直接用 `crypto.randomUUID()`：那是 Chrome 92 才有的。
 * 没有 Google Play 的安卓机，WebView 常年停在 80 出头（系统只跟着厂商 OTA 走），
 * 在那里调用它拿到的是 `TypeError: crypto.randomUUID is not a function`。
 * 这个调用恰好落在「解锁后写一条审计」上 —— 也就是每次启动必经的路上，
 * 一出错整页就停在启动图后面，看起来就是「打开就闪退」。
 *
 * `crypto.getRandomValues` 从 Chrome 11 就有了，拿它拼一个 v4 与原生实现等价：
 * 第 7 字节高 4 位写 0100（版本 4），第 9 字节高 2 位写 10（RFC 变体）。
 */
export function uuidV4(cryptoImpl?: Crypto | null): string {
  const c = (cryptoImpl ?? globalThis.crypto) as
    | (Crypto & { randomUUID?: () => string })
    | undefined

  const fast = c?.randomUUID
  if (typeof fast === 'function') {
    try {
      // 有些 WebView 的 randomUUID 脱离 crypto 调用会报 Illegal invocation
      return fast.call(c)
    } catch {
      // 落到下面自己拼，绝不因为「有但坏了」再次抛出去
    }
  }

  const buf = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(buf)
  } else {
    // 连 getRandomValues 都没有（理论上不存在）：至少保证格式正确、不重复到离谱
    for (let i = 0; i < 16; i += 1) buf[i] = Math.floor(Math.random() * 256)
  }
  buf[6] = (buf[6] & 0x0f) | 0x40
  buf[8] = (buf[8] & 0x3f) | 0x80

  const h = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
