/**
 * Gist。
 *
 * 三个坑：
 * 1. 列表接口（`/gists`、`/users/{login}/gists`）里的 `files[].content` **是截断的**，
 *    真要编辑必须先 `GET /gists/{id}` 拿全文；
 * 2. 改文件不是「提交内容」，而是**按文件名下发指令**：给 `content` 是新增或覆盖，
 *    给 `null` 是删除。改名 = 旧名 `null` + 新名 `content`，一次请求搞定；
 * 3. 没有 sha 之类的乐观锁，两个人同时改会**后写覆盖前写**，所以界面上要提醒。
 */

import type { ApiClient } from './api'

export interface GistFile {
  filename: string
  type?: string
  language?: string | null
  raw_url?: string
  size?: number
  content?: string
  truncated?: boolean
}

export interface GistOwner {
  login: string
  avatar_url?: string
}

export interface Gist {
  id: string
  description: string | null
  public: boolean
  owner?: GistOwner | null
  files: Record<string, GistFile | null>
  comments: number
  html_url?: string
  created_at: string
  updated_at: string
  /** 只在详情接口可靠；列表里不返回 */
  starred?: boolean
}

/** 编辑中的一份文件。id 用来跟原始文件对齐，改名不算新文件 */
export interface DraftFile {
  key: string
  name: string
  content: string
  /** 原始文件名；null 表示这次新加的 */
  origin: string | null
}

const enc = (s: string) => encodeURIComponent(s)

/* ---------------- 纯逻辑 ---------------- */

/** 文件按名字排序，但 README 永远第一个 —— 它是人最先看的那份 */
export function gistFiles(g: Pick<Gist, 'files'>): GistFile[] {
  const list = Object.values(g.files ?? {}).filter((f): f is GistFile => !!f && !!f.filename)
  return list.sort((a, b) => {
    const ra = /^readme(\.|$)/i.test(a.filename) ? 0 : 1
    const rb = /^readme(\.|$)/i.test(b.filename) ? 0 : 1
    if (ra !== rb) return ra - rb
    return a.filename.localeCompare(b.filename)
  })
}

/** 标题：有描述用描述，没有就用文件名列表 */
export function gistTitle(g: Pick<Gist, 'description' | 'files'>): string {
  const desc = (g.description ?? '').trim()
  if (desc) return desc
  const names = gistFiles(g).map((f) => f.filename)
  if (names.length === 0) return '（空 Gist）'
  return names.length <= 2 ? names.join(' · ') : `${names[0]} 等 ${names.length} 个文件`
}

/** 语言：取第一个声明了 language 的文件，不是按扩展名猜 */
export function gistLanguage(g: Pick<Gist, 'files'>): string | null {
  for (const f of gistFiles(g)) if (f.language) return f.language
  return null
}

/** 文件总字节数。列表接口给的 size 是截断后的，别拿它当真实体积 */
export function gistBytes(g: Pick<Gist, 'files'>): number {
  return gistFiles(g).reduce((n, f) => n + (f.size ?? 0), 0)
}

/** 从详情转成可编辑草稿 */
export function draftFromGist(g: Gist): DraftFile[] {
  return gistFiles(g).map((f, i) => ({
    key: `f${i}-${f.filename}`,
    name: f.filename,
    content: f.content ?? '',
    origin: f.filename,
  }))
}

export interface DraftProblem {
  kind: 'empty' | 'no-name' | 'dup-name' | 'same'
  text: string
}

/** 提交前的本地校验。文件名重复会被 GitHub 静默合掉一份，必须提前拦 */
export function validateDraft(files: DraftFile[]): DraftProblem | null {
  if (files.length === 0) return { kind: 'empty', text: '至少留一个文件' }
  const seen = new Set<string>()
  for (const f of files) {
    const name = f.name.trim()
    if (!name) return { kind: 'no-name', text: '有文件还没起名字' }
    if (name.includes('/')) return { kind: 'no-name', text: '文件名不能带斜杠，Gist 是平铺的' }
    const k = name.toLowerCase()
    if (seen.has(k)) return { kind: 'dup-name', text: `文件名「${name}」重复了` }
    seen.add(k)
  }
  return null
}

/**
 * 把草稿转成 `PATCH /gists/{id}` 的 files 字段。
 * 只发变化的部分：没动过的文件不发，删掉的给 null，改名的给「旧名 null + 新名 content」。
 */
export function filesPatch(
  original: GistFile[],
  draft: DraftFile[],
): Record<string, { content: string } | null> {
  const patch: Record<string, { content: string } | null> = {}
  const keptOrigins = new Set<string>()

  for (const d of draft) {
    const name = d.name.trim()
    if (d.origin && d.origin === name) {
      keptOrigins.add(d.origin)
      const orig = original.find((f) => f.filename === d.origin)
      // 内容没变就不发，省一次全量覆盖
      if (!orig || (orig.content ?? '') !== d.content) patch[name] = { content: d.content }
      continue
    }
    if (d.origin && d.origin !== name) {
      // 改名：旧名删掉
      patch[d.origin] = null
      keptOrigins.add(d.origin)
    }
    patch[name] = { content: d.content }
  }

  for (const f of original) {
    if (!keptOrigins.has(f.filename) && !draft.some((d) => d.name.trim() === f.filename)) {
      patch[f.filename] = null
    }
  }
  return patch
}

/** 新建时的 files 字段：`{ 文件名: { content } }` */
export function filesCreate(draft: DraftFile[]): Record<string, { content: string }> {
  const out: Record<string, { content: string }> = {}
  for (const d of draft) out[d.name.trim()] = { content: d.content }
  return out
}

export function newDraftFile(seed = 0): DraftFile {
  return { key: `new-${Date.now()}-${seed}`, name: '', content: '', origin: null }
}

/** 判断 PATCH 有没有实际改动，没改动就别发请求 */
export function hasChanges(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).length > 0
}

/* ---------------- 网络 ---------------- */

export async function listGists(
  client: ApiClient,
  login: string | null,
  page = 1,
): Promise<{ list: Gist[]; hasMore: boolean }> {
  const path = login
    ? `/users/${enc(login)}/gists?per_page=30&page=${page}`
    : `/gists?per_page=30&page=${page}`
  const { data } = await client.request<Gist[]>(path)
  const list = Array.isArray(data) ? data : []
  return { list, hasMore: list.length === 30 }
}

export async function getGist(client: ApiClient, id: string): Promise<Gist> {
  const { data } = await client.request<Gist>(`/gists/${enc(id)}`)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('这个 Gist 读不出来')
  return data
}

export async function createGist(
  client: ApiClient,
  input: { description: string; files: DraftFile[]; public: boolean },
): Promise<Gist> {
  const { data } = await client.request<Gist>('/gists', {
    method: 'POST',
    body: JSON.stringify({
      description: input.description,
      public: input.public,
      files: filesCreate(input.files),
    }),
  })
  return data
}

export async function updateGist(
  client: ApiClient,
  id: string,
  input: { description?: string; files?: Record<string, { content: string } | null> },
): Promise<Gist> {
  const payload: Record<string, unknown> = {}
  if (input.description !== undefined) payload.description = input.description
  if (input.files && hasChanges(input.files)) payload.files = input.files
  const { data } = await client.request<Gist>(`/gists/${enc(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  return data
}

export async function deleteGist(client: ApiClient, id: string): Promise<void> {
  await client.request<null>(`/gists/${enc(id)}`, { method: 'DELETE' })
}

/** star 状态：204 已 star，404 未 star。别的状态码说明接口有问题，按未 star 处理 */
export async function isGistStarred(client: ApiClient, id: string): Promise<boolean> {
  try {
    await client.request<null>(`/gists/${enc(id)}/star`)
    return true
  } catch {
    return false
  }
}

export async function starGist(client: ApiClient, id: string, on: boolean): Promise<void> {
  await client.request<null>(`/gists/${enc(id)}/star`, { method: on ? 'PUT' : 'DELETE' })
}
