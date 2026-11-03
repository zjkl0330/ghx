import type { Release, ReleaseAsset } from './types'

/**
 * 发版列表排序：草稿排最前（只有自己看得到，且最需要处理），
 * 其余按发布时间倒序。published_at 为空的用 created_at 兜底。
 */
export function sortReleases(list: Release[]): Release[] {
  return [...list].sort((a, b) => {
    if (a.draft !== b.draft) return a.draft ? -1 : 1
    const ta = Date.parse(a.published_at ?? a.created_at) || 0
    const tb = Date.parse(b.published_at ?? b.created_at) || 0
    return tb - ta
  })
}

export function releaseTitle(r: Pick<Release, 'name' | 'tag_name'>): string {
  const name = (r.name ?? '').trim()
  return name || r.tag_name
}

/** 发版日期，优先发布时间；草稿没有发布时间就用创建时间。 */
export function releaseDate(r: Pick<Release, 'published_at' | 'created_at'>): string {
  const raw = r.published_at ?? r.created_at
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function isPrerelease(r: Pick<Release, 'prerelease'>): boolean {
  return r.prerelease
}

/** 资产类型只用于选图标与排序，不参与下载逻辑。 */
export function assetKind(name: string): 'apk' | 'archive' | 'other' {
  const lower = name.toLowerCase()
  if (lower.endsWith('.apk')) return 'apk'
  if (/\.(zip|tar\.gz|tgz|tar|7z)$/.test(lower)) return 'archive'
  return 'other'
}

/**
 * 主资产：优先 APK，其次压缩包，再次体积最大的那个。
 * 用来在列表里直接给一个「下载」按钮，而不是让用户自己挑。
 */
export function pickAsset(assets: ReleaseAsset[]): ReleaseAsset | null {
  if (assets.length === 0) return null
  const apk = assets.find((a) => assetKind(a.name) === 'apk')
  if (apk) return apk
  const archive = assets.find((a) => assetKind(a.name) === 'archive')
  if (archive) return archive
  return [...assets].sort((a, b) => b.size - a.size)[0]
}

export function totalDownloads(assets: ReleaseAsset[]): number {
  return assets.reduce((sum, a) => sum + (a.download_count || 0), 0)
}

/**
 * 标签名校验。GitHub 允许的字符很宽，但空格、``..``、开头斜杠一定会失败，
 * 与其等 422 不如在输入时就拦住。
 */
export function validateTag(tag: string): string | null {
  const t = tag.trim()
  if (!t) return '标签不能为空'
  if (/\s/.test(t)) return '标签不能包含空格'
  if (t.startsWith('/') || t.endsWith('/') || t.endsWith('.lock')) return '标签格式不合法'
  if (t.includes('..') || t.includes('~') || t.includes('^') || t.includes(':')) {
    return '标签不能包含 .. ~ ^ : 等字符'
  }
  if (t.length > 120) return '标签过长'
  return null
}

/** 正文折叠用：只取前 n 字，保留原始换行。 */
export function excerpt(body: string | null | undefined, n = 120): string {
  const text = (body ?? '').trim()
  if (text.length <= n) return text
  return `${text.slice(0, n).trimEnd()}…`
}

/**
 * 把 github.com 的资产地址换成加速前缀。前缀只替换域名部分，
 * 路径原样保留，和 App 自身更新走的是同一条通道。
 */
export function mirrorDownloadUrl(url: string, mirror: string): string {
  const base = mirror.replace(/\/+$/, '')
  if (!base) return url
  const m = url.match(/^https?:\/\/(?:www\.)?github\.com(\/.*)$/)
  if (!m) return url
  return `${base}${m[1]}`
}
