/**
 * 分支与标签。
 *
 * 两个坑：
 * - 分支名里可以有 `/`（`feature/login`）。`DELETE /git/refs/heads/x` 直接拼没问题，
 *   但 `POST /branches/{branch}/rename` 是**单个路径参数**，斜杠必须编码成 %2F，
 *   否则会被当成多级路径而 404。
 * - `POST /git/refs` 建出来的是轻量标签；要带说明（annotated）得先
 *   `POST /git/tags` 拿 tag sha，再拿它建 ref。
 */

import type { ApiClient } from './api'

export interface Branch {
  name: string
  commit: { sha: string }
  protected?: boolean
}

export interface Tag {
  name: string
  commit: { sha: string }
  /** annotated tag 才有 */
  zipball_url?: string
}

/** 分支名合法性。规则来自 git check-ref-format，提前拦比让服务端 422 好 */
export function branchNameError(name: string): string | null {
  const s = (name ?? '').trim()
  if (!s) return '分支名不能为空'
  if (/\s/.test(s)) return '分支名不能包含空格'
  if (s.startsWith('/') || s.endsWith('/')) return '分支名不能以斜杠开头或结尾'
  if (s.includes('//')) return '分支名不能有连续斜杠'
  if (s.endsWith('.')) return '分支名不能以点结尾'
  if (s.endsWith('.lock')) return '分支名不能以 .lock 结尾'
  if (/[~^:?*[\\]/.test(s)) return '分支名不能包含 ~ ^ : ? * [ \\ 这些字符'
  if (s.includes('..')) return '分支名不能包含 ..'
  if (s.includes('@{')) return '分支名不能包含 @{'
  if (s === '@') return '分支名不能是 @'
  if (s.startsWith('-')) return '分支名不能以 - 开头'
  return null
}

/** 标签名沿用分支规则，但允许更宽松一点（不强制禁止 .lock） */
export function tagNameError(name: string): string | null {
  const err = branchNameError(name)
  if (err === '分支名不能以 .lock 结尾') return null
  return err ? err.replace('分支名', '标签名') : null
}

/** 分支列表：默认分支排最前，其余按名字 */
export function sortBranches(list: Branch[], defaultBranch: string): Branch[] {
  return [...list].sort((a, b) => {
    if (a.name === defaultBranch) return -1
    if (b.name === defaultBranch) return 1
    return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
  })
}

/** 短 sha，列表里显示七位就够了 */
export function shortSha(sha: string): string {
  return (sha ?? '').slice(0, 7)
}

/** 分支名过长时中间省略，保留前缀与最后一段 */
export function elideBranch(name: string, max = 28): string {
  if (name.length <= max) return name
  const segs = name.split('/')
  if (segs.length > 1) {
    const last = segs[segs.length - 1]
    if (last.length < max - 4) return `…/${last}`
  }
  return `${name.slice(0, max - 1)}…`
}

/** 从分支名里猜一个「短名」，用作新建分支时的默认值 */
export function suggestBranch(prefix = 'feature/'): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${prefix}${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/* ---------------- 网络 ---------------- */

const enc = encodeURIComponent

export async function listBranches(
  client: ApiClient,
  owner: string,
  repo: string,
  fresh = false,
): Promise<Branch[]> {
  const { data } = await client.request<Branch[]>(
    `/repos/${enc(owner)}/${enc(repo)}/branches?per_page=100`,
    {},
    { fresh },
  )
  return data ?? []
}

export async function listTags(client: ApiClient, owner: string, repo: string, fresh = false): Promise<Tag[]> {
  const { data } = await client.request<Tag[]>(
    `/repos/${enc(owner)}/${enc(repo)}/tags?per_page=100`,
    {},
    { fresh },
  )
  return data ?? []
}

/** 从某个 ref 建新分支。sha 传分支名或提交 sha 都行，服务端会解析 */
export async function createBranch(
  client: ApiClient,
  owner: string,
  repo: string,
  input: { name: string; sha: string },
) {
  const { data } = await client.request<{ ref: string; object: { sha: string } }>(
    `/repos/${enc(owner)}/${enc(repo)}/git/refs`,
    { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${input.name}`, sha: input.sha }) },
  )
  return data
}

export async function deleteBranch(client: ApiClient, owner: string, repo: string, name: string) {
  await client.request<null>(`/repos/${enc(owner)}/${enc(repo)}/git/refs/heads/${name}`, {
    method: 'DELETE',
  })
}

/** 改名。这个端点的 branch 是单参数，斜杠必须整段编码 */
export async function renameBranch(
  client: ApiClient,
  owner: string,
  repo: string,
  from: string,
  to: string,
) {
  const { data } = await client.request<{ name: string }>(
    `/repos/${enc(owner)}/${enc(repo)}/branches/${enc(from)}/rename`,
    { method: 'POST', body: JSON.stringify({ new_name: to }) },
  )
  return data
}

/**
 * 建标签。lightweight=true 是轻量标签；否则先建 tag 对象再指过去，
 * 这样 `git describe` 才有信息。
 */
export async function createTag(
  client: ApiClient,
  owner: string,
  repo: string,
  input: { name: string; sha: string; message?: string; lightweight?: boolean },
) {
  if (input.lightweight !== false && !input.message) {
    const { data } = await client.request<{ ref: string }>(`/repos/${enc(owner)}/${enc(repo)}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/tags/${input.name}`, sha: input.sha }),
    })
    return data
  }

  const tag = await client.request<{ sha: string }>(`/repos/${enc(owner)}/${enc(repo)}/git/tags`, {
    method: 'POST',
    body: JSON.stringify({
      tag: input.name,
      message: input.message || input.name,
      object: input.sha,
      type: 'commit',
    }),
  })
  const { data } = await client.request<{ ref: string }>(`/repos/${enc(owner)}/${enc(repo)}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/tags/${input.name}`, sha: tag.data.sha }),
  })
  return data
}

export async function deleteTag(client: ApiClient, owner: string, repo: string, name: string) {
  await client.request<null>(`/repos/${enc(owner)}/${enc(repo)}/git/refs/tags/${name}`, {
    method: 'DELETE',
  })
}
