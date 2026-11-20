/**
 * 一次问多个仓库。
 *
 * 仓库列表上的「有 APK / 有 EXE」标记要靠发行版资产判断，而 REST 的
 * `/user/repos` 不带这个字段，只能逐仓库补一次 `/releases` —— 一页 25 个仓库
 * 就是 25 次请求。这不是「略多」，是把用户的配额按页烧掉：5000/小时的令牌
 * 翻二十页就见底，多账号更糟。
 *
 * GraphQL 允许把多个查询用别名并进一次请求，25 个别名实测仍是 1 次调用、
 * cost 1 点、耗时 0.77s。而且 GraphQL 与 REST 是**两个独立的配额池**
 * （`/rate_limit` 的 `resources.core` 与 `resources.graphql` 各 5000，
 * 实测 core 用了 33 时 graphql 仍是 0），所以这条链路一点都不占 REST 额度。
 * 于是这里只放「批量问资产名」这一件事，别的一概不做：查询形状固定、
 * 结果解析成纯数据、任何异常都退化成「这批没问到」，
 * 由调用方回落到逐条 REST —— 少了标记比多 25 次请求划算。
 */

import type { GitHubClient, GraphQLError } from './api'
import type { Release } from './types'
import { badgesOfAssets, type PkgKind } from './rel-badge'

/**
 * 一批塞几个仓库。
 *
 * 25 已实测通过（0.77s、cost 1）；再往上收益为零 —— 列表一页就是 25 个，
 * 而且别名越多，单个别名出错时被牵连的范围越大。
 */
export const PKG_BATCH = 25

/** 每个仓库看几个发行版：最新那个经常是纯源码 tag，往后多看两个 */
export const PKG_RELEASES = 3

/** 每个发行版看几个资产。够覆盖「安装包不在最后」的常见排布 */
export const PKG_ASSETS = 20

export interface RepoRef {
  owner: string
  name: string
  /** 原样的 `owner/name`，回填结果时用作键 */
  fullName: string
}

/** `owner/name` → 两部分。多段、空段一律不认，免得拼出莫名其妙的查询 */
export function splitFullName(full: string): RepoRef | null {
  const s = (full ?? '').trim()
  const parts = s.split('/')
  if (parts.length !== 2) return null
  const [owner, name] = parts.map((p) => p.trim())
  if (!owner || !name) return null
  return { owner, name, fullName: `${owner}/${name}` }
}

/** 按批切开。空的输入返回空数组，调用方不用特判 */
export function chunkRefs<T>(items: T[], size = PKG_BATCH): T[][] {
  const n = Math.max(1, Math.floor(size))
  const out: T[][] = []
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n))
  return out
}

/**
 * 拼查询。字段名固定，只有 owner / name 是变量 —— 用 `JSON.stringify` 生成
 * 字符串字面量，顺带把引号、反斜杠、换行都转义掉，别自己写拼接。
 */
export function buildPkgQuery(refs: RepoRef[]): string {
  const parts = refs.map(
    (r, i) =>
      `r${i}: repository(owner: ${JSON.stringify(r.owner)}, name: ${JSON.stringify(r.name)}) {` +
      ` releases(first: ${PKG_RELEASES}, orderBy: {field: CREATED_AT, direction: DESC}) {` +
      ` nodes { isDraft releaseAssets(first: ${PKG_ASSETS}) { nodes { name } } } } }`,
  )
  return `query {\n  ${parts.join('\n  ')}\n}`
}

/**
 * 把 `{ releases: { nodes: [...] } }` 归一成 REST 那份形状，
 * 好让徽标判定复用同一个函数（`badgesOfReleases`），不会出现两套规则。
 * 结构不对返回 null —— 当作「没问到」，不当作「没有包」。
 */
function releasesOf(node: unknown): Pick<Release, 'draft' | 'assets'>[] | null {
  const rel = (node as { releases?: { nodes?: unknown } } | null)?.releases
  if (!rel || !Array.isArray(rel.nodes)) return null
  const out: Pick<Release, 'draft' | 'assets'>[] = []
  for (const raw of rel.nodes) {
    const item = raw as { isDraft?: unknown; releaseAssets?: { nodes?: unknown } } | null
    if (!item || typeof item !== 'object') return null
    const assets = item.releaseAssets?.nodes
    if (!Array.isArray(assets)) return null
    const list: Release['assets'] = []
    for (const a of assets) {
      const name = (a as { name?: unknown } | null)?.name
      list.push({ name: typeof name === 'string' ? name : '' } as Release['assets'][number])
    }
    out.push({ draft: item.isDraft === true, assets: list })
  }
  return out
}

export interface PkgBatchResult {
  /** 有结论的（空数组表示「确实没有安装包」），可以直接写缓存 */
  ok: Record<string, PkgKind[]>
  /** 没问到的：网络、限流、结构异常。不写缓存，下一轮再说 */
  failed: string[]
}

/**
 * 解析一批的返回。
 *
 * 单个别名出错时 GitHub 会把它置 `null` 并在 `errors[].path[0]` 指出是哪个：
 * - `NOT_FOUND` 是确定结论（仓库不存在、或这个令牌看不到它），按「没有包」处理；
 * - 其它（FORBIDDEN、RATE_LIMITED、内部错误）是暂时性的，算没问到，
 *   免得把一次抖动记成 24 小时的「这个仓库没有安装包」。
 */
export function parsePkgResponse(
  body: { data?: unknown; errors?: GraphQLError[] } | null | undefined,
  fullNames: string[],
): PkgBatchResult {
  const ok: Record<string, PkgKind[]> = {}
  const failed: string[] = []
  const data = (body?.data ?? {}) as Record<string, unknown>
  const errors = Array.isArray(body?.errors) ? (body?.errors as GraphQLError[]) : []

  fullNames.forEach((full, i) => {
    const alias = `r${i}`
    if (!(alias in data)) {
      failed.push(full)
      return
    }
    const node = data[alias]
    if (node === null || node === undefined) {
      const hit = errors.find((e) => Array.isArray(e.path) && e.path[0] === alias)
      if (!hit || hit.type === 'NOT_FOUND') ok[full] = []
      else failed.push(full)
      return
    }
    const list = releasesOf(node)
    if (!list) {
      failed.push(full)
      return
    }
    ok[full] = badgesOfAssets(
      list.flatMap((r) => (r.draft ? [] : (r.assets ?? []).map((a) => a.name ?? ''))),
    )
  })

  return { ok, failed }
}

/**
 * 批量问「这些仓库有没有安装包」。
 *
 * 调用方不必判断 GraphQL 是否可用 —— 不可用时整批进 `failed`，
 * 它自然会走原来的逐条路径。任何一批抛错也只影响那一批。
 */
export async function queryRepoPkgs(
  client: Pick<GitHubClient, 'graphql' | 'graphqlUrl'>,
  fullNames: string[],
): Promise<PkgBatchResult> {
  const ok: Record<string, PkgKind[]> = {}
  const failed: string[] = []
  if (fullNames.length === 0) return { ok, failed }
  if (!client.graphqlUrl) {
    failed.push(...fullNames)
    return { ok, failed }
  }

  const valid: { full: string; ref: RepoRef }[] = []
  for (const full of fullNames) {
    const ref = splitFullName(full)
    if (ref) valid.push({ full, ref })
    else failed.push(full)
  }

  for (const chunk of chunkRefs(valid, PKG_BATCH)) {
    try {
      const { data, errors } = await client.graphql(buildPkgQuery(chunk.map((c) => c.ref)))
      const part = parsePkgResponse({ data, errors }, chunk.map((c) => c.full))
      Object.assign(ok, part.ok)
      failed.push(...part.failed)
    } catch {
      failed.push(...chunk.map((c) => c.full))
    }
  }

  return { ok, failed }
}
