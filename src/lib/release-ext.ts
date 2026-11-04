/**
 * 发行版的补全部分：编辑、发布草稿、删除附件。
 *
 * 上传附件**没有**实现在这里：`uploads.github.com` 响应里不带
 * `Access-Control-Allow-Origin`，WebView 的 fetch 发出去也读不回来
 * （curl 带令牌直传是 201，说明端点本身没问题，纯粹是跨域限制）。
 * 详见 `api.ts` 里那段注释。
 */

import type { ApiClient } from './api'
import type { Release } from './types'

export interface ReleasePatch {
  tag_name?: string
  name?: string
  body?: string
  draft?: boolean
  prerelease?: boolean
  target_commitish?: string
}

export async function updateRelease(
  client: ApiClient,
  owner: string,
  repo: string,
  id: number,
  patch: ReleasePatch,
): Promise<Release> {
  const { data } = await client.request<Release>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/${id}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
  )
  return data
}

/** 把草稿正式发布（把 draft 改成 false 就是发布） */
export async function publishRelease(client: ApiClient, owner: string, repo: string, id: number) {
  return updateRelease(client, owner, repo, id, { draft: false })
}

export async function deleteAsset(client: ApiClient, owner: string, repo: string, assetId: number) {
  await client.request<null>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/assets/${assetId}`,
    { method: 'DELETE' },
  )
}

export async function getRelease(client: ApiClient, owner: string, repo: string, id: number) {
  const { data } = await client.request<Release>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/${id}`,
  )
  return data
}

/** 草稿/预发布的中文标记，列表里一眼区分 */
export function releaseBadge(r: Release): { text: string; tone: 'draft' | 'pre' | null } {
  if (r.draft) return { text: '草稿', tone: 'draft' }
  if (r.prerelease) return { text: '预发布', tone: 'pre' }
  return { text: '', tone: null }
}

/** 附件总大小与下载总次数，放在标题下面一行 */
export function assetSummary(r: Release): string {
  const n = r.assets?.length ?? 0
  if (n === 0) return '没有附件'
  const bytes = r.assets.reduce((s, a) => s + (a.size ?? 0), 0)
  const dl = r.assets.reduce((s, a) => s + (a.download_count ?? 0), 0)
  return `${n} 个附件 · ${(bytes / 1024 / 1024).toFixed(1)} MB · 下载 ${dl} 次`
}

/** 发行版正文里的 markdown 段落数，用来决定「展开/收起」 */
export function bodyIsLong(body: string | null): boolean {
  return (body ?? '').length > 400
}
