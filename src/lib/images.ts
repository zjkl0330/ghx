/**
 * README 里的图片地址解析。
 *
 * README 中的图片绝大多数是相对路径（`./docs/logo.png`），
 * 而 github.com 的 blob 页面不能直接当图片用。这里统一换成
 * raw.githubusercontent.com，并给出镜像降级地址 —— 国内直连 raw 常失败。
 */

import { rawUrlAt } from './mirrors'

const RAW_HOST = 'raw.githubusercontent.com'

/** 把 README 的相对路径基准拼成绝对前缀 */
export function rawBase(owner: string, repo: string, branch: string, readmePath: string): string {
  const dir = readmePath.includes('/') ? readmePath.slice(0, readmePath.lastIndexOf('/') + 1) : ''
  return `https://${RAW_HOST}/${owner}/${repo}/${branch || 'main'}/${dir}`
}

/** github.com/{o}/{r}/blob|raw/{b}/{p} → raw.githubusercontent.com */
export function normalizeGithubImage(src: string): string {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+)$/i.exec(
    src,
  )
  if (!m) return src
  const path = m[4].replace(/\?.*$/, '')
  return `https://${RAW_HOST}/${m[1]}/${m[2]}/${m[3]}/${path}`
}

/**
 * 图片地址归一化。返回 null 表示这条不该渲染
 * （空地址、内联 data、mailto 之类）。
 */
export function resolveImageSrc(src: string, base: string): string | null {
  const s = src.trim().replace(/^<|>$/g, '')
  if (!s) return null
  if (/^(data|blob|javascript|mailto|tel):/i.test(s)) return null
  if (s.startsWith('//')) return `https:${s}`
  if (/^https?:\/\//i.test(s)) return normalizeGithubImage(s)
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null
  if (!base) return null
  try {
    return new URL(s, base).toString()
  } catch {
    return null
  }
}

/**
 * raw 地址换成加速前缀。只处理 raw.githubusercontent.com，
 * shields.io 这类第三方图床照旧。
 *
 * 加速站有两种路径风格（path / url），由 mirrors.ts 判断，这里只负责拆路径。
 */
export function mirrorImage(src: string, mirror: string): string | null {
  const prefix = `https://${RAW_HOST}/`
  if (!src.startsWith(prefix)) return null
  const rest = src.slice(prefix.length)
  const [owner, repo, branch, ...path] = rest.split('/')
  if (!owner || !repo || !branch || path.length === 0) return null
  if (!mirror.trim()) return null
  return rawUrlAt(mirror, owner, repo, branch, path.join('/'))
}
