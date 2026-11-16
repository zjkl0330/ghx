/**
 * Issue / PR 模板。
 *
 * GitHub 认两套模板：
 * - `.github/ISSUE_TEMPLATE/*.md` —— 老式，frontmatter 里写 name/about/labels，正文就是模板正文；
 * - `.github/ISSUE_TEMPLATE/*.yml` —— 表单式，`body` 是一串字段（markdown / input / textarea /
 *   checkboxes / dropdown）。**表单是 GitHub 网页端渲染的，REST 创建 Issue 却只吃 Markdown**，
 *   所以只能把字段拼成一份近似的 Markdown 骨架 —— 这是「能少打字」，不是「和网页一模一样」。
 *
 * PR 模板固定几个候选路径，取第一个存在的。
 *
 * YAML 只支持模板真正会用到的子集：`key: value`、`- ` 列表、两层嵌套、`|` / `>` 块标量。
 * 解析不出来就整份跳过，不让一个写坏的模板把新建流程卡死。
 */

import type { ApiClient, GitHubClient } from './api'
import { getFile, listDir } from './code'

export interface IssueTemplate {
  /** 仓库内路径，做 React key 用 */
  path: string
  name: string
  about: string
  title: string
  labels: string[]
  assignees: string[]
  /** 预填正文 */
  body: string
  /** true 表示界面是表单（已拼成 Markdown），提示语要说清楚 */
  fromForm: boolean
}

/* ---------------- 迷你 YAML ---------------- */

type Yaml = string | number | boolean | null | Yaml[] | { [k: string]: Yaml }

interface Line {
  indent: number
  text: string
  raw: string
}

/** 去掉行尾注释，但不动引号里的 `#` */
export function stripComment(line: string): string {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '#' && (i === 0 || /\s/.test(line[i - 1] ?? ''))) return line.slice(0, i)
  }
  return line
}

export function unquote(raw: string): string {
  const t = raw.trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    const inner = t.slice(1, -1)
    if (t.startsWith('"')) {
      return inner.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    }
    return inner.replace(/''/g, "'")
  }
  return t
}

function scalar(raw: string): Yaml {
  const t = unquote(raw)
  if (t === '' || t === '~' || t.toLowerCase() === 'null') return null
  if (t === 'true') return true
  if (t === 'false') return false
  if (/^-?\d+$/.test(t)) return Number(t)
  if (t.startsWith('[') && t.endsWith(']')) {
    return t
      .slice(1, -1)
      .split(',')
      .map((s) => unquote(s))
      .filter((s) => s !== '')
  }
  return t
}

/** 把行拆成「key: value」；没有冒号返回 null */
function splitKey(text: string): { key: string; rest: string } | null {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ':' && (i === text.length - 1 || /\s/.test(text[i + 1] ?? ''))) {
      return { key: unquote(text.slice(0, i)), rest: text.slice(i + 1).trim() }
    }
  }
  return null
}

/**
 * 解析 YAML 子集。
 *
 * 递归下降：先看当前块是列表还是对象，再按缩进递归。
 * 认不出来的行直接忽略 —— 模板写错了也不该让「新建 Issue」整块挂掉。
 */
export function parseSimpleYaml(text: string): Yaml {
  const src = text.replace(/\r\n?/g, '\n').split('\n')
  const lines: Line[] = []
  for (let i = 0; i < src.length; i += 1) {
    const raw = src[i]
    const noComment = stripComment(raw)
    const body = noComment.replace(/\t/g, '  ')
    if (!body.trim()) continue
    lines.push({ indent: body.length - body.trimStart().length, text: body.trim(), raw })
  }
  if (lines.length === 0) return null

  function blockAt(start: number, indent: number): [Yaml, number] {
    let i = start
    // 集合类型由第一行决定
    const isList = lines[i].text === '-' || lines[i].text.startsWith('- ')
    if (isList) {
      const out: Yaml[] = []
      while (i < lines.length && lines[i].indent === indent && (lines[i].text === '-' || lines[i].text.startsWith('- '))) {
        const content = lines[i].text === '-' ? '' : lines[i].text.slice(2).trim()
        i += 1
        if (!content) {
          // 「-」后面什么都换行了：子块在下一行的更大缩进里
          const [child, next] = i < lines.length && lines[i].indent > indent ? blockAt(i, lines[i].indent) : [null, i]
          out.push(child)
          i = next
          continue
        }
        const kv = splitKey(content)
        if (!kv) {
          out.push(scalar(content))
          continue
        }
        // 「- type: input」：把这一行当成一个缩进更深的映射首行
        const item: { [k: string]: Yaml } = {}
        const itemIndent = indent + 2
        let [value, next] = valueAfter(kv, i, itemIndent, lines[i - 1].indent)
        item[kv.key] = value
        i = next
        // 后续同属这个列表项的行（缩进 == itemIndent）
        while (i < lines.length && lines[i].indent === itemIndent && !lines[i].text.startsWith('- ')) {
          const kv2 = splitKey(lines[i].text)
          if (!kv2) {
            i += 1
            continue
          }
          i += 1
          const [v2, n2] = valueAfter(kv2, i, itemIndent)
          item[kv2.key] = v2
          i = n2
        }
        out.push(item)
      }
      return [out, i]
    }

    const obj: { [k: string]: Yaml } = {}
    while (i < lines.length && lines[i].indent === indent) {
      const kv = splitKey(lines[i].text)
      if (!kv) {
        i += 1
        continue
      }
      i += 1
      const [value, next] = valueAfter(kv, i, indent)
      obj[kv.key] = value
      i = next
    }
    // 缩进更深但父级已经结束：把它们忽略掉，别卡在死循环里
    return [obj, i]
  }

  /**
   * `key:` 之后的值：同行有值就取同行；否则看下一行缩进。
   * `|` / `>` 是块标量，把后续缩进更深的原始行全收进来。
   */
  function valueAfter(kv: { key: string; rest: string }, i: number, indent: number, lineIndent = indent): [Yaml, number] {
    const blockScalar = /^[|>][-+]?\d*$/.test(kv.rest)
    if (blockScalar) {
      const collected: string[] = []
      let base: number | null = null
      while (i < lines.length && lines[i].indent > lineIndent) {
        const l = lines[i]
        if (base === null) base = l.indent
        collected.push(l.raw.slice(Math.min(base, l.raw.length)))
        i += 1
      }
      const text = kv.rest.startsWith('>') ? collected.join(' ').trim() : collected.join('\n')
      return [text, i]
    }
    if (kv.rest) return [scalar(kv.rest), i]
    if (i < lines.length && lines[i].indent > lineIndent) return blockAt(i, lines[i].indent)
    return [null, i]
  }

  const [value] = blockAt(0, lines[0].indent)
  return value
}

/* ---------------- frontmatter ---------------- */

export function parseFrontmatter(text: string): { data: { [k: string]: Yaml }; body: string } {
  const src = text.replace(/\r\n?/g, '\n')
  if (!src.startsWith('---')) return { data: {}, body: text }
  const end = src.indexOf('\n---', 3)
  if (end < 0) return { data: {}, body: text }
  const head = src.slice(3, end)
  const body = src.slice(end + 4).replace(/^\n+/, '')
  const parsed = parseSimpleYaml(head)
  return { data: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as { [k: string]: Yaml }) : {}, body }
}

/** labels / assignees 三种写法都要认：数组、逗号分隔、单个值 */
export function toList(v: Yaml): string[] {
  if (v == null) return []
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/* ---------------- 表单 → Markdown ---------------- */

const str = (v: Yaml): string => (v == null ? '' : String(v))

/**
 * 把 yml 表单拼成 Markdown。
 *
 * 生成的是「骨架」：每个字段一个 `### 标题`，textarea / input 留一行占位提示。
 * 用户提交前可以随便改，这里只负责少打字。
 */
export function renderIssueForm(form: { [k: string]: Yaml }): string {
  const body = Array.isArray(form.body) ? form.body : []
  const out: string[] = []
  for (const raw of body) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const item = raw as { [k: string]: Yaml }
    const type = str(item.type).toLowerCase()
    const attrs = (item.attributes && typeof item.attributes === 'object' && !Array.isArray(item.attributes)
      ? item.attributes
      : {}) as { [k: string]: Yaml }
    const label = str(attrs.label) || str(attrs.description) || ''

    if (type === 'markdown') {
      const v = str(attrs.value).trim()
      // 后面紧跟 `### 字段`，没有空行的话 Markdown 会把标题吞进段落里
      if (v) out.push(v, '')
      continue
    }
    if (type === 'checkboxes') {
      const opts = Array.isArray(attrs.options) ? attrs.options : []
      const lines = opts.map((o) => {
        const t = o && typeof o === 'object' && !Array.isArray(o) ? str((o as { [k: string]: Yaml }).label) : str(o)
        return `- [ ] ${t}`
      })
      out.push(`### ${label}`, '', ...lines, '')
      continue
    }
    if (type === 'dropdown') {
      const opts = Array.isArray(attrs.options) ? attrs.options : []
      out.push(`### ${label}`, '', ...opts.map((o) => `- ${str(o)}`).map((s, idx) => (idx === 0 ? `${s}（选一个，删掉其余）` : s)), '')
      continue
    }
    // input / textarea
    const ph = str(attrs.placeholder)
    out.push(`### ${label}`, '', ph ? `<!-- ${ph} -->` : '', '')
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

function templateFromMarkdown(path: string, text: string): IssueTemplate | null {
  const { data, body } = parseFrontmatter(text)
  const name = str(data.name) || path.split('/').pop() || '模板'
  return {
    path,
    name,
    about: str(data.about) || str(data.description),
    title: str(data.title),
    labels: toList(data.labels),
    assignees: toList(data.assignees),
    body,
    fromForm: false,
  }
}

function templateFromForm(path: string, text: string): IssueTemplate | null {
  const parsed = parseSimpleYaml(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const form = parsed as { [k: string]: Yaml }
  if (!form.name && !form.body) return null
  return {
    path,
    name: str(form.name) || (path.split('/').pop() ?? '模板'),
    about: str(form.description) || str(form.about),
    title: str(form.title),
    labels: toList(form.labels),
    assignees: toList(form.assignees),
    body: renderIssueForm(form),
    fromForm: true,
  }
}

/** config.yml 是模板选择器的配置，不是模板本身 */
export function isTemplateFile(name: string): boolean {
  if (name.toLowerCase() === 'config.yml' || name.toLowerCase() === 'config.yaml') return false
  return /\.(md|ya?ml)$/i.test(name)
}

export function parseIssueTemplate(path: string, text: string): IssueTemplate | null {
  try {
    return /\.ya?ml$/i.test(path) ? templateFromForm(path, text) : templateFromMarkdown(path, text)
  } catch {
    return null
  }
}

/* ---------------- 网络 ---------------- */

/** 模板目录大小写两种写法都有人用，依次试 */
const ISSUE_DIRS = ['.github/ISSUE_TEMPLATE', '.github/issue_template']

/**
 * 读仓库里的 Issue 模板。
 * 目录不存在、令牌没权限、单个模板写坏了 —— 一律降级成「没有模板」，不阻断新建。
 */
export async function listIssueTemplates(
  client: ApiClient,
  owner: string,
  repo: string,
  ref?: string,
): Promise<{ templates: IssueTemplate[]; broken: number }> {
  for (const dir of ISSUE_DIRS) {
    let entries
    try {
      entries = await listDir(client, owner, repo, dir, ref)
    } catch {
      continue
    }
    const files = entries.filter((e) => e.type === 'file' && isTemplateFile(e.name)).slice(0, 12)
    const templates: IssueTemplate[] = []
    let broken = 0
    for (const f of files) {
      try {
        const { text } = await getFile(client as GitHubClient, owner, repo, f.path, ref)
        const t = parseIssueTemplate(f.path, text)
        if (t) templates.push(t)
        else broken += 1
      } catch {
        broken += 1
      }
    }
    // 大写目录存在但一个模板都没解析出来时，再去试小写目录
    if (templates.length === 0 && broken === 0) continue
    return { templates, broken }
  }
  return { templates: [], broken: 0 }
}

/** PR 模板的候选路径，按 GitHub 自己的优先级 */
export const PR_TEMPLATE_PATHS = [
  '.github/pull_request_template.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'pull_request_template.md',
  'PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
  'docs/PULL_REQUEST_TEMPLATE.md',
]

export async function findPrTemplate(
  client: ApiClient,
  owner: string,
  repo: string,
  ref?: string,
): Promise<{ path: string; body: string } | null> {
  for (const path of PR_TEMPLATE_PATHS) {
    try {
      const { text } = await getFile(client as GitHubClient, owner, repo, path, ref)
      if (text.trim()) return { path, body: text }
    } catch {
      /* 不存在就试下一个 */
    }
  }
  return null
}
