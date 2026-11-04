/**
 * 请求缓存。
 *
 * 目的是让切页签、回退、重进详情不再每次都打网络，同时保证"改完立刻能看见"：
 * 读命中就直接返回，写操作成功后按前缀把受影响的缓存清掉。
 *
 * TTL 按数据的变化频率分档，不搞一刀切 —— 运行状态十几秒就变，
 * 发行版和仓库基本信息几分钟不变，搜索结果的配额最贵。
 */

export interface CacheEntry<T> {
  value: T
  /** 写入时间（毫秒时间戳） */
  at: number
  /** 服务端 ETag，用于条件请求（通知这类高频轮询省配额） */
  etag?: string
}

/** 默认 30 秒：既能让反复切换不重复请求，也不至于看到太久以前的数据 */
export const DEFAULT_TTL = 30_000

/** 条目上限，防止长时间使用后内存无限增长 */
export const MAX_ENTRIES = 240

/**
 * 按请求路径给出缓存时长。
 * 只按 path 判断，忽略 query —— 同一路径下的分页各自成键，但共用一档 TTL。
 */
export function ttlFor(path: string): number {
  const p = path.split('?')[0]

  // 搜索接口配额最低（认证后 30 次/分钟），缓存久一点
  if (p.startsWith('/search/')) return 5 * 60_000
  // 单个仓库的 star 状态：为了打开详情时那个星标图标不至于闪
  if (p.startsWith('/user/starred/')) return 30_000
  if (p === '/user/starred') return 60_000
  if (p === '/user/repos') return 60_000
  // 运行详情里步骤状态变化快
  if (p.endsWith('/jobs')) return 20_000
  if (p.endsWith('/actions/runs')) return 15_000
  if (p.endsWith('/actions/workflows')) return 30_000
  // 通知未读数分钟就变，但不能太短，否则每次切页签都打一次网络
  if (p.startsWith('/notifications')) return 45_000
  // 目录列表跟着提交走，但短时间内反复进出很常见
  if (p.includes('/contents')) return 45_000
  // 分支与标签变动更慢
  if (p.endsWith('/branches') || p.endsWith('/tags')) return 2 * 60_000
  // PR 的 diff 一旦打开很少变，翻来覆去看同一份别重复拉
  if (p.includes('/pulls/') && (p.endsWith('/files') || p.endsWith('/commits'))) return 3 * 60_000
  if (p.endsWith('/issues') || p.endsWith('/pulls') || p.includes('/issues/') || p.includes('/pulls/')) {
    return 45_000
  }
  if (p.includes('/commits')) return 60_000
  if (p.endsWith('/releases')) return 2 * 60_000
  if (p.endsWith('/forks')) return 2 * 60_000
  if (p === '/user') return 10 * 60_000
  if (p.startsWith('/repos/')) return 60_000
  return DEFAULT_TTL
}

/** 是否还在有效期内。时间回拨（age < 0）一律视为失效，宁可重拉 */
export function isFresh(at: number, now: number, ttl: number): boolean {
  if (ttl <= 0) return false
  const age = now - at
  return age >= 0 && age < ttl
}

/**
 * 写操作成功后需要清理的缓存前缀。
 * 返回 'all' 表示无法精确定位，整库清掉。
 */
export function invalidationPrefixes(method: string, path: string): string[] | 'all' {
  const m = method.toUpperCase()
  if (m === 'GET' || m === 'HEAD') return []
  const p = path.split('?')[0]

  // 新建仓库：仓库列表和搜索结果都会变
  if (m === 'POST' && p === '/user/repos') return ['/user/repos', '/search/']

  // star / 取消 star：星标列表、仓库列表里的计数、搜索结果都要刷
  if (p.startsWith('/user/starred/')) {
    return ['/user/starred', '/user/repos', '/search/', p]
  }

  // 工作流相关：运行记录与工作流状态
  if (p.includes('/actions/')) {
    const repoPrefix = p.slice(0, p.indexOf('/actions/'))
    return [`${repoPrefix}/actions/`]
  }

  // 改文件：目录列表、提交历史、分支都要重新拉；仓库本身的 pushed_at 也变了
  if (p.includes('/contents')) {
    const repoPrefix = p.slice(0, p.indexOf('/contents'))
    return [`${repoPrefix}/contents`, `${repoPrefix}/commits`, `${repoPrefix}/branches`, repoPrefix]
  }

  // Issue / PR 的写操作：列表、详情、搜索一起清
  if (p.includes('/issues')) {
    const repoPrefix = p.slice(0, p.indexOf('/issues'))
    return [`${repoPrefix}/issues`, `${repoPrefix}/pulls`, repoPrefix, '/search/issues', '/notifications']
  }

  // PR 合并/关闭会改变提交历史
  if (p.includes('/pulls')) {
    const repoPrefix = p.slice(0, p.indexOf('/pulls'))
    return [`${repoPrefix}/pulls`, `${repoPrefix}/issues`, `${repoPrefix}/commits`, repoPrefix, '/search/issues']
  }

  // 分支与标签：建/删/改名都走 git refs
  if (p.includes('/git/refs') || p.includes('/branches') || p.includes('/tags')) {
    const repoPrefix = p.slice(0, p.search(/\/(git\/refs|branches|tags)/))
    return [`${repoPrefix}/branches`, `${repoPrefix}/tags`, `${repoPrefix}/commits`, repoPrefix]
  }

  if (p.startsWith('/notifications')) return ['/notifications', '/repos/']
  if (p.startsWith('/user/following')) return ['/user/following', '/users/']
  if (p.startsWith('/user/subscriptions')) return ['/user/subscriptions', '/repos/']

  // 发行版
  if (p.includes('/releases')) {
    const repoPrefix = p.slice(0, p.indexOf('/releases'))
    return [`${repoPrefix}/releases`]
  }

  // 复刻
  if (p.endsWith('/forks')) {
    const repoPrefix = p.slice(0, -'/forks'.length)
    return [`${repoPrefix}/forks`]
  }

  // 仓库本身（改可见度、归档、删除）：连同列表与搜索结果一起清
  if (p.startsWith('/repos/')) {
    return [p, '/user/repos', '/search/']
  }

  return 'all'
}

export class ResponseCache {
  private readonly map = new Map<string, CacheEntry<unknown>>()

  constructor(private readonly max: number = MAX_ENTRIES) {}

  get size(): number {
    return this.map.size
  }

  /** 命中且未过期才返回，过期的顺手删掉 */
  getEntry<T>(key: string, ttl: number, now: number = Date.now()): CacheEntry<T> | null {
    const hit = this.map.get(key)
    if (!hit) return null
    if (!isFresh(hit.at, now, ttl)) {
      this.map.delete(key)
      return null
    }
    return hit as CacheEntry<T>
  }

  /** 只取值。注意缓存本身存的就是 null 时这里也返回 null，需要区分请用 getEntry */
  get<T>(key: string, ttl: number, now: number = Date.now()): T | null {
    return this.getEntry<T>(key, ttl, now)?.value ?? null
  }

  set<T>(key: string, value: T, now: number = Date.now(), etag?: string): void {
    // 重新插入以刷新 LRU 顺序
    this.map.delete(key)
    this.map.set(key, { value, at: now, ...(etag ? { etag } : {}) })
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next()
      if (oldest.done) break
      this.map.delete(oldest.value)
    }
  }

  /** 不带 TTL 判断的读取，仅供调试与测试 */
  peek<T>(key: string): CacheEntry<T> | null {
    return (this.map.get(key) as CacheEntry<T> | undefined) ?? null
  }

  /** 传前缀只清这一类，不传清全部 */
  invalidate(prefix?: string): void {
    if (!prefix) {
      this.map.clear()
      return
    }
    for (const key of [...this.map.keys()]) {
      if (key.startsWith(prefix)) this.map.delete(key)
    }
  }

  /** 按 invalidationPrefixes 的结果批量清理 */
  applyInvalidation(method: string, path: string): void {
    const targets = invalidationPrefixes(method, path)
    if (targets === 'all') {
      this.map.clear()
      return
    }
    for (const prefix of targets) this.invalidate(prefix)
  }
}
