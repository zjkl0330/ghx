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

const CJK = /[\u3400-\u9fff]/

/** 是否含中日韩统一表意文字 —— 用来判断「这份 README 已经是中文」 */
export function hasCjk(s: string): boolean {
  return CJK.test(s)
}

/**
 * 粗略判断一段文字是否为中文正文。
 *
 * 不能只看前几个字：很多中文 README 开头是一大段 `<p align="center">`
 * 加徽章，纯文本占比很低；也不能只数汉字，「English | 简体中文」这种
 * 语言切换只夹了四个汉字。所以先剥掉标签、链接与 URL，再看占比。
 */
export function looksChinese(s: string): boolean {
  const sample = s
    .slice(0, 4000)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, '')
  if (!sample) return false
  const cjk = (sample.match(/[\u3400-\u9fff]/g) ?? []).length
  return cjk >= 10 && cjk / sample.length >= 0.12
}

/** README 所在目录，末尾带斜杠；根目录返回空串 */
export function readmeDir(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i + 1)
}

/** 相对路径按 README 所在目录归一化，处理 ./ 与 ../ */
export function joinRepoPath(dir: string, rel: string): string {
  const out = dir ? dir.split('/').filter(Boolean) : []
  for (const part of rel.replace(/^\.\//, '').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

/**
 * 从 README 顶部找「English | 简体中文」这类语言切换链接。
 * 这是最可靠的信号：作者自己指定了中文版文件在哪。
 */
export function findChineseReadmeLink(md: string, readmePath: string): string | null {
  const head = md.split('\n').slice(0, 80).join('\n')
  const dir = readmeDir(readmePath)
  const isZhText = (t: string) => /(简体中文|繁体中文|中文|chinese|zh[-_]?(cn|hans|hant)?)/i.test(t)
  const usable = (target: string) => {
    if (!target || /^(https?:|mailto:|#|\/\/)/i.test(target)) return null
    const path = target.replace(/[?#].*$/, '')
    if (!/\.md$/i.test(path)) return null
    if (/^\/readme/i.test(path)) return path.slice(1)
    return joinRepoPath(dir, path)
  }

  for (const m of head.matchAll(/\[([^\]\n]{1,24})\]\(\s*<?([^)\s>]+)>?\s*\)/g)) {
    if (!isZhText(m[1])) continue
    const path = usable(m[2])
    if (path) return path
  }

  // 用图片当语言切换按钮：[![中文](zh.svg)](README.zh.md)
  for (const m of head.matchAll(/\[!\[([^\]\n]{1,24})\]\([^)]*\)\]\(\s*<?([^)\s>]+)>?\s*\)/g)) {
    if (!isZhText(m[1])) continue
    const path = usable(m[2])
    if (path) return path
  }

  // HTML 写法的语言切换：文字链接，或 <a><img alt="中文"></a>
  for (const m of head.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi)) {
    const inner = m[2] ?? ''
    const alts = [...inner.matchAll(/alt\s*=\s*["']([^"']*)["']/gi)].map((a) => a[1]).join(' ')
    const text = inner.replace(/<[^>]+>/g, ' ')
    if (!isZhText(`${text} ${alts}`)) continue
    const path = usable(m[1])
    if (path) return path
  }
  return null
}

export interface ContentEntry {
  name: string
  path: string
  type: string
}

const ZH_README_NAME = /^readme[._-]?(zh|cn|chs|cht|hans|hant)[^/]*\.md$/i

/**
 * 在目录列表里挑中文版 README。
 * 常见命名：README.zh-CN.md / README_zh_CN.md / README.zh.md / README_CN.md。
 */
export function pickChineseReadmeFile(entries: ContentEntry[], readmePath: string): string | null {
  const files = entries.filter(
    (e) => e.type === 'file' && /\.md$/i.test(e.name) && e.path !== readmePath,
  )
  const strict = files.find((f) => ZH_README_NAME.test(f.name))
  if (strict) return strict.path
  // 名字不规范的（如 readme-chinese.md）兜一层
  const loose = files.find(
    (f) => /readme/i.test(f.name) && /(zh|cn|chinese|hans|中文)/i.test(f.name),
  )
  return loose?.path ?? null
}
