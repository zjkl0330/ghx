/**
 * 私有仓库正文里的图片。
 *
 * 公开仓库的图片直接 `raw.githubusercontent.com` 就能看；私有仓库不行 ——
 * `raw` 对匿名请求一律按「仓库不存在」回 404，而 `<img>` 又带不了
 * `Authorization` 头（`raw` 的预检还回 403，连 CORS 都过不去）。
 *
 * 唯一可行的通道是 API：`GET /repos/{o}/{r}/contents/{path}?ref={ref}`，
 * 带令牌、`Accept: application/vnd.github.raw` 拿二进制，再换成 `blob:`
 * 地址塞给 `<img>`。这条路只在**图片加载失败之后**才走 —— 公开图走镜像
 * 更快，也不该为每张图花一次 API 配额。
 *
 * 这里只放纯函数（地址解析、API 路径拼装、LRU），网络与 DOM 在调用方，
 * 方便单测。
 */

export interface RawRef {
  owner: string
  repo: string
  /** 分支 / tag / commit，raw 地址里的第一段 */
  ref: string
  /** 仓库内路径，未编码，保留原始斜杠 */
  path: string
}

const RAW_HOST_RE = /^https?:\/\/raw\.githubusercontent\.com\//i
/** github.com/{o}/{r}/(blob|raw)/{ref}/{path} */
const GITHUB_FILE_RE = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/i
const RAW_RE = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(.+)$/i

function decodeSeg(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** 去掉 query / hash，保留路径本身 */
function stripTail(s: string): string {
  return s.replace(/[?#].*$/, '')
}

/**
 * 这张图能不能走「带令牌取字节」那条路。返回值是按可信度排好的候选。
 *
 * 为什么要多个候选：分支名可以带斜杠（`feature/x`），而 raw 地址里
 * 分支与路径之间没有分隔符 —— `raw/o/r/feature/x/a.png` 既可能是
 * 分支 `feature` 下的 `x/a.png`，也可能是分支 `feature/x` 下的 `a.png`。
 * 先按「第一段是分支」试，404 再逐段放宽，最多三段（再长的分支名极少见）。
 */
export function rawRefCandidates(src: string): RawRef[] {
  const s = stripTail(src.trim())
  const m = RAW_RE.exec(s) ?? GITHUB_FILE_RE.exec(s)
  if (!m) return []
  const owner = decodeSeg(m[1])
  const repo = decodeSeg(m[2])
  // m[3] 是「ref/path」整段 —— 分支名可以带斜杠，只有逐段试才知道切在哪
  const tail = m[3].split('/').filter(Boolean)
  if (!owner || !repo || tail.length < 2) return []

  const out: RawRef[] = []
  for (let n = 1; n <= Math.min(3, tail.length - 1); n += 1) {
    const ref = tail.slice(0, n).map(decodeSeg).join('/')
    const path = tail.slice(n).map(decodeSeg).join('/')
    if (ref && path) out.push({ owner, repo, ref, path })
  }
  return out
}

/** 这张图是不是 raw 图床（只有它才需要令牌通道） */
export function isRawImage(src: string): boolean {
  return RAW_HOST_RE.test(src.trim())
}

/** 路径按段编码：`docs/图 1.png` → `docs/%E5%9B%BE%201.png`，斜杠保留 */
export function encodeContentPath(path: string): string {
  return path
    .split('/')
    .filter((seg) => seg.length > 0)
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

/** contents 接口的路径（不含 baseUrl） */
export function contentsApiPath(r: RawRef): string {
  return `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.repo)}/contents/${encodeContentPath(r.path)}?ref=${encodeURIComponent(r.ref)}`
}

/**
 * 简单的 LRU：图片字节换来的 `blob:` 地址必须有人负责回收，
 * 不然滑过几十张图就把内存钉住了。淘汰时回调 revoke。
 */
export class LruCache<V> {
  private map = new Map<string, V>()

  constructor(
    readonly max: number,
    private readonly onEvict?: (key: string, value: V) => void,
  ) {
    if (max < 1) throw new Error('LruCache: max 至少为 1')
  }

  get size(): number {
    return this.map.size
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  /** 取一次就算「用过」：提到队尾 */
  get(key: string): V | undefined {
    if (!this.map.has(key)) return undefined
    const v = this.map.get(key) as V
    this.map.delete(key)
    this.map.set(key, v)
    return v
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next()
      if (oldest.done) break
      const k = oldest.value
      const v = this.map.get(k) as V
      this.map.delete(k)
      this.onEvict?.(k, v)
    }
  }

  delete(key: string): void {
    const v = this.map.get(key)
    if (v === undefined) return
    this.map.delete(key)
    this.onEvict?.(key, v)
  }

  clear(): void {
    for (const [k, v] of this.map) this.onEvict?.(k, v)
    this.map.clear()
  }
}
