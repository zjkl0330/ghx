/**
 * 主密钥的查看密码。
 *
 * 副密钥按需求「可以直接展示」，主密钥必须过了这一关才显示。
 * 它是一道**界面闸门**，不是第二套加密：主密钥本身仍由保险库密钥加密，
 * 这里只负责判断「现在这个人有没有资格把它解出来看」。
 *
 * 为什么不直接复用启动验证口令：
 * - 免密保险库根本没有口令（钥匙在本机），拿不出可验证的东西；
 * - 开了启动验证的用户，界面会直接让他输启动口令，不必再记一个。
 *
 * 所以这条密码只在「免密 + 想看主密钥」时用得上，属于可选设置。
 * 忘了怎么办：清掉记录重新设一个即可 —— 令牌不会因此丢，只是这道闸门重来。
 */

import type { KV } from './storage'

export const REVEAL_KEY = 'ghx.reveal.v1'
/** 比启动口令松：它挡的是「别人拿起已解锁的手机」，不必扛离线爆破 */
export const REVEAL_MIN = 6
const ITERATIONS = 210_000
const SALT_BYTES = 16

interface RevealFile {
  v: 1
  iter: number
  salt: string
  hash: string
}

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(s: string): Uint8Array {
  const raw = atob(s)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

async function hashPass(
  pass: string,
  salt: Uint8Array,
  iter: number,
  cryptoImpl: Crypto,
): Promise<string> {
  const base = await cryptoImpl.subtle.importKey(
    'raw',
    new TextEncoder().encode(pass),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await cryptoImpl.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: iter, hash: 'SHA-256' },
    base,
    256,
  )
  return toB64(new Uint8Array(bits))
}

/** 定长比较：时间差泄漏在这类本机校验里不致命，但顺手做掉不花成本 */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function parse(raw: string | null): RevealFile | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Partial<RevealFile>
    if (o.v !== 1) return null
    if (typeof o.salt !== 'string' || typeof o.hash !== 'string') return null
    const iter = typeof o.iter === 'number' && o.iter >= 1000 ? Math.floor(o.iter) : ITERATIONS
    return { v: 1, iter, salt: o.salt, hash: o.hash }
  } catch {
    return null
  }
}

export async function hasRevealPass(kv: KV | null): Promise<boolean> {
  if (!kv) return false
  try {
    return parse(await kv.get(REVEAL_KEY)) !== null
  } catch {
    return false
  }
}

export async function setRevealPass(
  kv: KV | null,
  pass: string,
  cryptoImpl: Crypto = globalThis.crypto,
): Promise<void> {
  if (!kv) throw new Error('本机存储不可用')
  if (pass.length < REVEAL_MIN) throw new Error(`查看密码至少 ${REVEAL_MIN} 位`)
  const salt = cryptoImpl.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await hashPass(pass, salt, ITERATIONS, cryptoImpl)
  const file: RevealFile = { v: 1, iter: ITERATIONS, salt: toB64(salt), hash }
  await kv.set(REVEAL_KEY, JSON.stringify(file))
}

export async function checkRevealPass(
  kv: KV | null,
  pass: string,
  cryptoImpl: Crypto = globalThis.crypto,
): Promise<boolean> {
  if (!kv || !pass) return false
  let file: RevealFile | null = null
  try {
    file = parse(await kv.get(REVEAL_KEY))
  } catch {
    return false
  }
  if (!file) return false
  try {
    const hash = await hashPass(pass, fromB64(file.salt), file.iter, cryptoImpl)
    return sameHash(hash, file.hash)
  } catch {
    return false
  }
}

/** 忘记密码的出口：清掉闸门，下次重新设。令牌不受影响 */
export async function clearRevealPass(kv: KV | null): Promise<void> {
  if (!kv) return
  try {
    await kv.remove(REVEAL_KEY)
  } catch {
    /* 删不掉就留着，下次设置会覆盖 */
  }
}
