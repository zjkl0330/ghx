/**
 * 展示用的格式化。全是纯函数，方便单测。
 */

/** 相对时间：刚刚 / 12 分钟前 / 3 天前 / 2024-05 */
export function relTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const diff = now - t
  // 未来时间（时区/时钟漂移）不显示「-3 分钟前」这种怪话
  if (diff < 0) return '刚刚'
  const m = Math.floor(diff / 60_000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo} 个月前`
  return `${Math.floor(mo / 12)} 年前`
}

/** 绝对日期，用于提交历史这种需要精确的地方 */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 文件大小：890 B / 12.4 KB / 3.1 MB */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 大数字：1234 → 1.2k，1200000 → 1.2M */
export function compactNumber(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** 路径的最后一段 */
export function baseName(path: string): string {
  if (!path) return ''
  const i = path.lastIndexOf('/')
  return i < 0 ? path : path.slice(i + 1)
}

/** 路径的父目录，根目录返回空串 */
export function dirName(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/** 把仓库相对路径切成面包屑，根返回空数组 */
export function pathSegments(path: string): string[] {
  return path.split('/').filter(Boolean)
}
