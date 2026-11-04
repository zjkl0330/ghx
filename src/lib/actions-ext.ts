/**
 * Actions 的补全部分：日志、Artifacts、删除运行、只重跑失败的作业。
 *
 * 日志接口很别扭：`GET /actions/runs/{id}/logs` 是 302 到预签名地址，
 * 拿到的是 **zip**，里面一堆 `.txt`。所以要解压、按文件名里的序号排序。
 * WebView 里如果 CORS 挡住这条链路，只能退化成「用浏览器打开」。
 */

import { unzipSync, strFromU8 } from 'fflate'
import type { ApiClient, GitHubClient } from './api'

export interface Artifact {
  id: number
  name: string
  size_in_bytes: number
  expired: boolean
  created_at: string
  archive_download_url: string
}

export interface LogFile {
  name: string
  text: string
}

export async function listArtifacts(
  client: ApiClient,
  owner: string,
  repo: string,
  runId: number,
  fresh = false,
): Promise<Artifact[]> {
  const { data } = await client.request<{ artifacts: Artifact[] }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}/artifacts?per_page=100`,
    {},
    { fresh },
  )
  return data?.artifacts ?? []
}

export async function deleteArtifact(client: ApiClient, owner: string, repo: string, id: number) {
  await client.request<null>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/artifacts/${id}`,
    { method: 'DELETE' },
  )
}

/** 删除一次运行记录本身（不是只取消） */
export async function deleteRun(client: ApiClient, owner: string, repo: string, runId: number) {
  await client.request<null>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}`,
    { method: 'DELETE' },
  )
}

/** 只重跑失败的作业，成功的跳过 —— 比整轮重跑省一半时间 */
export async function rerunFailedJobs(
  client: ApiClient,
  owner: string,
  repo: string,
  runId: number,
) {
  await client.request<null>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}/rerun-failed-jobs`,
    { method: 'POST' },
  )
}

export async function rerunJob(client: ApiClient, owner: string, repo: string, jobId: number) {
  await client.request<null>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/jobs/${jobId}/rerun`,
    { method: 'POST' },
  )
}

/** 日志文件名通常形如 `3_build.txt`，按前缀数字排，没有数字就按字典序 */
export function sortLogFiles(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const na = Number(/^(\d+)/.exec(a)?.[1] ?? Number.MAX_SAFE_INTEGER)
    const nb = Number(/^(\d+)/.exec(b)?.[1] ?? Number.MAX_SAFE_INTEGER)
    if (na !== nb) return na - nb
    return a.localeCompare(b)
  })
}

/** 单文件与总体的体积上限，避免一次解出几百兆把内存打爆 */
export const LOG_MAX_BYTES = 8 * 1024 * 1024

/** 解压日志 zip。核心逻辑抽出来，方便用假数据测 */
export function unzipLogs(bytes: Uint8Array): LogFile[] {
  const files = unzipSync(bytes)
  const names = sortLogFiles(Object.keys(files))
  const out: LogFile[] = []
  let total = 0
  for (const name of names) {
    // 目录项跳过
    if (name.endsWith('/')) continue
    if (!/\.(txt|log)$/i.test(name)) continue
    const u8 = files[name]
    if (!u8) continue
    total += u8.byteLength
    if (total > LOG_MAX_BYTES) break
    out.push({ name, text: strFromU8(u8) })
  }
  return out
}

/** CapacitorHttp 在不同平台可能回 ArrayBuffer、base64 字符串或数字数组，统一成字节 */
export function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return new Uint8Array(data as number[])
  if (typeof data === 'string') {
    const bin = atob(data)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
    return out
  }
  return new Uint8Array(0)
}

/**
 * 拉一次运行的完整日志。
 *
 * 日志接口先 302 到预签名地址（Azure Blob），那个地址不带 CORS 头，
 * 所以浏览器 fetch 必挂。真机走 CapacitorHttp，绕开 WebView 的跨域限制。
 */
export async function fetchRunLogs(
  client: GitHubClient,
  owner: string,
  repo: string,
  runId: number,
): Promise<LogFile[]> {
  const url = `${client.baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${runId}/logs`
  const headers = { Authorization: `Bearer ${client.authToken}`, Accept: 'application/vnd.github+json' }

  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  const native = typeof cap?.isNativePlatform === 'function' && cap.isNativePlatform()

  let buf: Uint8Array
  if (native) {
    const { CapacitorHttp } = await import('@capacitor/core')
    const res = await CapacitorHttp.request({
      url,
      method: 'GET',
      headers,
      // 原生层把整个响应体缓冲下来，CORS 不参与
      responseType: 'arraybuffer',
      connectTimeout: 20_000,
      readTimeout: 60_000,
    })
    if (res.status >= 400) throw new Error(`日志下载失败 (${res.status})`)
    buf = toBytes(res.data)
  } else {
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`日志下载失败 (${res.status})`)
    buf = new Uint8Array(await res.arrayBuffer())
  }

  // 有些代理会直接把 zip 返回成 JSON 错误体，这里兜一下
  if (buf[0] === 0x7b && buf[1] === 0x22) {
    throw new Error('日志接口返回的是 JSON 而不是压缩包，可能被代理拦截了')
  }
  if (buf.length === 0) throw new Error('日志是空的')
  return unzipLogs(buf)
}

/* ---------------- workflow_dispatch 的输入项 ---------------- */

export interface DispatchInput {
  name: string
  description: string
  required: boolean
  default: string
  type: 'string' | 'boolean' | 'choice' | 'environment' | 'number'
  options?: string[]
}

/**
 * 从 workflow YAML 里抠出 `on.workflow_dispatch.inputs`。
 *
 * 为什么手写而不用 YAML 库：只为这一小块引 40KB 解析器不划算，
 * 而且我们不需要完整语义 —— 缩进层级、`- ` 选项、`key: value` 就够。
 * 解析不出来时返回空数组，界面退化成「只填 ref」。
 */
export function parseDispatchInputs(yaml: string): DispatchInput[] {
  if (!yaml) return []
  const lines = yaml.replace(/\r\n?/g, '\n').split('\n')

  // 找到 workflow_dispatch 那一行
  let base = -1
  let baseIndent = 0
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)workflow_dispatch\s*:/.exec(lines[i])
    if (m) {
      base = i
      baseIndent = m[1].length
      break
    }
  }
  if (base < 0) return []

  // 再找它下面的 inputs:
  let start = -1
  let inputIndent = 0
  for (let i = base + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    if (indent <= baseIndent) break
    const m = /^(\s*)inputs\s*:\s*$/.exec(line)
    if (m) {
      start = i
      inputIndent = m[1].length
      break
    }
  }
  if (start < 0) return []

  // 收集 inputs 块：缩进比 inputIndent 深的都算
  const block: string[] = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.trim()) continue
    const indent = line.length - line.trimStart().length
    if (indent <= inputIndent) break
    block.push(line)
  }

  const out: DispatchInput[] = []
  let cur: DispatchInput | null = null
  let curIndent = 0
  let inOptions = false

  const flush = () => {
    if (cur) out.push(cur)
    cur = null
    inOptions = false
  }

  for (const line of block) {
    const indent = line.length - line.trimStart().length
    const body = line.trim()

    // 顶层键：输入项名字
    if (cur === null || indent === curIndent) {
      const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(body)
      if (m) {
        flush()
        curIndent = indent
        if (/^[A-Za-z0-9_-]+$/.test(m[1])) {
          cur = { name: m[1], description: '', required: false, default: '', type: 'string' }
        }
        continue
      }
    }
    if (!cur) continue

    if (inOptions) {
      const opt = /^-\s*(.+)$/.exec(body)
      if (opt) {
        cur.options = [...(cur.options ?? []), unquote(opt[1])]
        continue
      }
      inOptions = false
    }

    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(body)
    if (!m) continue
    const key = m[1]
    const val = m[2]
    if (key === 'description') cur.description = unquote(val)
    else if (key === 'required') cur.required = /^true$/i.test(val.trim())
    else if (key === 'default') cur.default = unquote(val)
    else if (key === 'type') {
      const t = val.trim().replace(/['"]/g, '')
      if (t === 'boolean' || t === 'choice' || t === 'environment' || t === 'number') cur.type = t
      else cur.type = 'string'
    } else if (key === 'options') {
      // options 可能是行内数组，也可能下面跟一串 `- xxx`
      const inline = /^\[(.*)\]$/.exec(val.trim())
      if (inline) {
        cur.options = inline[1]
          .split(',')
          .map((s) => unquote(s.trim()))
          .filter(Boolean)
      } else {
        inOptions = true
      }
    }
  }
  flush()

  return out.filter((i) => /^[A-Za-z0-9_-]+$/.test(i.name))
}

function unquote(s: string): string {
  const t = s.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

/** 触发时把表单值转成 API 要的 strings 映射；空值不传，交给工作流默认值 */
export function buildDispatchInputs(
  defs: DispatchInput[],
  values: Record<string, string>,
): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const d of defs) {
    const v = values[d.name]
    if (v === undefined || v === '') continue
    out[d.name] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** 校验必填项，返回第一条人话错误 */
export function validateInputs(defs: DispatchInput[], values: Record<string, string>): string | null {
  for (const d of defs) {
    if (d.required && !(values[d.name] ?? '').trim()) {
      return `「${d.description || d.name}」是必填项`
    }
  }
  return null
}
