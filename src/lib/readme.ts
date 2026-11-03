/**
 * README 拉取与解码。
 *
 * GitHub 的 contents 接口把文件内容按 base64 返回，而且会插入换行。
 * 这里用 TextDecoder 按 UTF-8 解码 —— 直接用 atob 再当 Latin-1 处理，
 * 中文 README 会变成乱码。
 */

export interface ReadmeFile {
  name: string
  path: string
  /** 解码后的纯文本 markdown */
  text: string
  html: string | null
  /** 文件大小（字节） */
  size: number
}

export interface RawReadme {
  name: string
  path: string
  size: number
  content: string
  encoding: string
  html_url?: string | null
}

/** 标准 base64（含换行）转 UTF-8 字符串 */
export function decodeBase64Utf8(b64: string): string {
  const clean = b64.replace(/[\r\n\s]/g, '')
  if (!clean) return ''

  // 浏览器与 Node 都有 atob；万一没有就自己解
  const bin =
    typeof atob === 'function'
      ? atob(clean)
      : (() => {
          const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
          const table = new Map([...chars].map((c, i) => [c, i]))
          let out = ''
          let buf = 0
          let bits = 0
          for (const ch of clean.replace(/=+$/, '')) {
            const v = table.get(ch)
            if (v === undefined) continue
            buf = (buf << 6) | v
            bits += 6
            if (bits >= 8) {
              bits -= 8
              out += String.fromCharCode((buf >> bits) & 0xff)
            }
          }
          return out
        })()

  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

export function normalizeReadme(raw: RawReadme | null): ReadmeFile | null {
  if (!raw || typeof raw.content !== 'string') return null
  if (raw.encoding && raw.encoding !== 'base64') return null
  const text = decodeBase64Utf8(raw.content)
  if (!text) return null
  return {
    name: raw.name,
    path: raw.path,
    text,
    html: raw.html_url ?? null,
    size: raw.size,
  }
}
