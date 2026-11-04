/**
 * 代码浏览与单文件编辑。
 *
 * 坑（都踩过或写在文档里）：
 * - `/contents/{path}` 目录返回数组、文件返回对象，形状不一样；
 * - base64 带换行，解码前要清掉；
 * - 超过 1MB 的文件 `content` 是空的，得用 raw 媒体类型重新取；
 * - 更新/删除必须带 `sha`，否则 409 —— 这是防覆盖别人提交的乐观锁；
 * - UTF-8 中文不能直接 `btoa`，会抛 InvalidCharacterError；
 * - 写 `.github/workflows/*` 需要额外的 `workflow` scope，缺 scope 有时返回 404 而不是 403。
 */

import type { ApiClient, GitHubClient } from './api'

export type ContentType = 'file' | 'dir' | 'symlink' | 'submodule'

export interface ContentItem {
  type: ContentType
  name: string
  path: string
  sha: string
  size: number
  download_url?: string | null
  html_url?: string | null
  /** 只在单文件请求里出现 */
  content?: string
  encoding?: string
  target?: string
}

export interface CommitAuthor {
  name: string
  date: string
}

export interface CommitItem {
  sha: string
  commit: { message: string; author: CommitAuthor | null; committer?: CommitAuthor | null }
  author: { login: string; avatar_url?: string } | null
  html_url?: string
}

/** 从 base64 里取 UTF-8 文本。GitHub 会塞换行，必须清掉 */
export function decodeBase64Utf8(b64: string): string {
  const clean = (b64 ?? '').replace(/[\r\n\s]/g, '')
  if (!clean) return ''
  const bin = atob(clean)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** UTF-8 文本转 base64。裸 btoa 遇到中文会抛错，必须按字节走 */
export function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  // 分块，避免大文件时 String.fromCharCode 参数过多爆栈
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i
const BINARY_EXT =
  /\.(zip|gz|tgz|bz2|xz|7z|rar|pdf|docx?|xlsx?|pptx?|jar|apk|aar|exe|dll|so|dylib|a|o|class|wasm|mp3|mp4|mov|avi|mkv|ttf|otf|woff2?|psd|sketch|bin|dat)$/i

export function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path)
}

/** 二进制文件不给看文本视图，直接提示「下载/用外部应用打开」 */
export function isBinaryPath(path: string): boolean {
  return BINARY_EXT.test(path) && !isImagePath(path)
}

/** 语言名，用于代码块标题与着色提示 */
export function languageOf(path: string): string {
  const ext = (path.split('.').pop() ?? '').toLowerCase()
  const map: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TSX',
    js: 'JavaScript',
    jsx: 'JSX',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    py: 'Python',
    go: 'Go',
    rs: 'Rust',
    java: 'Java',
    kt: 'Kotlin',
    swift: 'Swift',
    c: 'C',
    h: 'C',
    cpp: 'C++',
    cc: 'C++',
    cs: 'C#',
    rb: 'Ruby',
    php: 'PHP',
    sh: 'Shell',
    bash: 'Shell',
    zsh: 'Shell',
    ps1: 'PowerShell',
    sql: 'SQL',
    json: 'JSON',
    yml: 'YAML',
    yaml: 'YAML',
    toml: 'TOML',
    md: 'Markdown',
    css: 'CSS',
    scss: 'SCSS',
    html: 'HTML',
    xml: 'XML',
    gradle: 'Gradle',
    dockerfile: 'Dockerfile',
    vue: 'Vue',
    svelte: 'Svelte',
    lua: 'Lua',
    dart: 'Dart',
  }
  if (/^dockerfile$/i.test(path.split('/').pop() ?? '')) return 'Dockerfile'
  if (/^makefile$/i.test(path.split('/').pop() ?? '')) return 'Makefile'
  // 没有扩展名的（LICENSE、CODEOWNERS）当普通文本，别把文件名当语言
  if (!(path.split('/').pop() ?? '').includes('.')) return '文本'
  return map[ext] ?? (ext ? ext.toUpperCase() : '文本')
}

/** 目录在前、文件在后，各自按名字排；大小写不敏感 */
export function sortEntries(items: ContentItem[]): ContentItem[] {
  return [...items].sort((a, b) => {
    const ad = a.type === 'dir' ? 0 : 1
    const bd = b.type === 'dir' ? 0 : 1
    if (ad !== bd) return ad - bd
    return a.name.localeCompare(b.name, 'zh-Hans-CN', { sensitivity: 'base' })
  })
}

/** 目录项按扩展名分组计数，给「这个目录里都是什么」一行摘要 */
export function summarizeDir(items: ContentItem[]): string {
  const dirs = items.filter((i) => i.type === 'dir').length
  const files = items.length - dirs
  const langs = new Map<string, number>()
  for (const f of items) {
    if (f.type !== 'file') continue
    const lang = languageOf(f.path)
    langs.set(lang, (langs.get(lang) ?? 0) + 1)
  }
  const top = [...langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const parts = [`${dirs} 个目录`, `${files} 个文件`]
  if (top.length > 0) parts.push(top.map(([k, v]) => `${k}×${v}`).join('、'))
  return parts.join(' · ')
}

/** 行号视图：把文本切成行，附带行号 */
export function withLineNumbers(text: string): { no: number; text: string }[] {
  return text.split('\n').map((line, i) => ({ no: i + 1, text: line }))
}

/** 单文件内容体积上限：再大就不在手机上打开了 */
export const MAX_VIEW_BYTES = 600_000

/* ---------------- 网络 ---------------- */

const encPath = (path: string) => path.split('/').filter(Boolean).map(encodeURIComponent).join('/')

/** 列目录。path 为空表示根 */
export async function listDir(
  client: ApiClient,
  owner: string,
  repo: string,
  path = '',
  ref?: string,
): Promise<ContentItem[]> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : ''
  const tail = encPath(path)
  const { data } = await client.request<ContentItem[] | ContentItem>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${tail ? `/${tail}` : ''}${q}`,
  )
  if (Array.isArray(data)) return sortEntries(data)
  throw new Error('这个路径不是目录')
}

/**
 * 读单个文件。返回文本内容与 sha。
 * 大文件（>1MB）API 不给 content，改用 raw 媒体类型重取一次。
 */
export async function getFile(
  client: GitHubClient,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<{ item: ContentItem; text: string; truncated: boolean }> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : ''
  const tail = encPath(path)
  const { data: item } = await client.request<ContentItem>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${tail}${q}`,
  )
  if (Array.isArray(item as unknown)) throw new Error('这个路径是目录')

  if (item.encoding === 'base64' && item.content) {
    const text = decodeBase64Utf8(item.content)
    return { item, text, truncated: false }
  }
  // 大文件：content 为空，走 raw
  const raw = await client.rawText(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${tail}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`,
    { accept: 'application/vnd.github.raw' },
  )
  return { item, text: raw.text, truncated: raw.truncated }
}

/**
 * 读路径元信息。
 * 目录返回数组、文件返回对象，调用方必须判断形状 —— 这是 GitHub 的历史设计。
 */
export async function getMeta(
  client: ApiClient,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<ContentItem | ContentItem[]> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : ''
  const { data } = await client.request<ContentItem | ContentItem[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encPath(path)}${q}`,
  )
  return data
}

/**
 * 新建或更新文件。
 * `sha` 是已存在文件的乐观锁：不传就是新建，传了就是覆盖；
 * 远端在这期间变过会 409，提示用户重新打开。
 */
export async function putFile(
  client: ApiClient,
  owner: string,
  repo: string,
  input: { path: string; content: string; message: string; sha?: string; branch?: string },
) {
  const body: Record<string, unknown> = {
    message: input.message,
    content: encodeBase64Utf8(input.content),
  }
  if (input.sha) body.sha = input.sha
  if (input.branch) body.branch = input.branch
  const { data } = await client.request<{ content: ContentItem; commit: { sha: string } }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encPath(input.path)}`,
    { method: 'PUT', body: JSON.stringify(body) },
  )
  return data
}

export async function deleteFile(
  client: ApiClient,
  owner: string,
  repo: string,
  input: { path: string; message: string; sha: string; branch?: string },
) {
  const body: Record<string, unknown> = { message: input.message, sha: input.sha }
  if (input.branch) body.branch = input.branch
  await client.request<null>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encPath(input.path)}`,
    { method: 'DELETE', body: JSON.stringify(body) },
  )
}

/** 提交历史。传 path 就只看这个文件的历史 */
export async function listCommits(
  client: ApiClient,
  owner: string,
  repo: string,
  opts: { path?: string; ref?: string; page?: number; perPage?: number; fresh?: boolean } = {},
): Promise<CommitItem[]> {
  const query = new URLSearchParams({
    per_page: String(opts.perPage ?? 30),
    page: String(opts.page ?? 1),
  })
  if (opts.path) query.set('path', opts.path)
  if (opts.ref) query.set('sha', opts.ref)
  const { data } = await client.request<CommitItem[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?${query.toString()}`,
    {},
    { fresh: opts.fresh },
  )
  return data ?? []
}

export interface CommitDetail extends CommitItem {
  stats?: { additions: number; deletions: number; total: number }
  files?: { filename: string; status: string; additions: number; deletions: number; patch?: string }[]
}

export async function getCommit(
  client: ApiClient,
  owner: string,
  repo: string,
  sha: string,
): Promise<CommitDetail> {
  const { data } = await client.request<CommitDetail>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}`,
  )
  return data
}

/** 单次提交的完整 diff（纯文本），用于「这次提交改了什么」 */
export async function commitDiff(client: GitHubClient, owner: string, repo: string, sha: string) {
  return client.rawText(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}`,
    { accept: 'application/vnd.github.diff', maxBytes: 400_000 },
  )
}

/** 提交信息的第一行，列表里只显示这个 */
export function commitTitle(message: string): string {
  return (message ?? '').split('\n')[0].trim() || '(无提交信息)'
}

/** 统一的错误提示：写工作流文件缺 scope 时 GitHub 会给 404，得单独解释 */
export function writeErrorHint(path: string, status: number): string | null {
  if (status === 409) return '远端在你编辑期间有新提交，请关掉重开再改'
  if (status === 404 && /^\.github\/workflows\//.test(path)) {
    return '写工作流文件需要令牌带 workflow 权限，缺权限时 GitHub 返回的是 404'
  }
  return null
}
