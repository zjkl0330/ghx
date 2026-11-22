/**
 * 仓库源码压缩包（Codeload ZIP）。
 *
 * GitHub 的 `/archive/refs/heads/<branch>.zip` 本身不产出字节，它只是一个 302，
 * 真正的 zip 在 codeload.github.com 上。这一点决定了地址不能只拼一个：
 *
 * - 自建反代是「透明路径代理」，302 会原样交给浏览器，浏览器接着去连 codeload ——
 *   国内这一步经常连不上，表现就是点了没反应或下到 0 字节；
 * - gh-proxy 这类 url 型反代能把 codeload 整段代理掉
 *   （`{base}/https://codeload.github.com/{owner}/{repo}/zip/...`），这条路最稳。
 *
 * 所以这里产出的是「候选列表」，按最可能通的顺序排列，交给调用方探活，
 * 第一个能通的才真正交给浏览器。
 */
import { githubUrlAt, mirrorDefFor, mirrorKnown, normalizeBase, selfMirrorBase, userProxyBases } from './mirrors'

export const CODELOAD_BASE = 'https://codeload.github.com'

/**
 * 能吃 codeload 的公共反代：**一个都不内置**。
 *
 * v1.1.3 起包里不带加速站地址。历史实测（2026-11）能吃 codeload 的公共反代
 * 很少，其中多数直接 403，所以这里留空、由调用方显式传入；用户自己填的
 * url 型站点会自动进候选（见下面的 def.style 分支）。
 */
export const KNOWN_CODELOAD_PROXIES: string[] = []

/** 分支里的斜杠 GitHub 会转成连字符：feat/x → repo-feat-x.zip */
export function archiveFileName(repo: string, ref: string): string {
  const branch = (ref || 'main').replace(/\//g, '-')
  return `${repo}-${branch}.zip`
}

/** 逐段编码，但保留 ref 里的斜杠（feat/x 是合法分支名） */
function encodePath(s: string): string {
  return s
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

/** github.com 上的 archive 路径，不含域名 */
export function archivePath(owner: string, repo: string, ref: string): string {
  const branch = encodePath(ref || 'main')
  return `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/archive/refs/heads/${branch}.zip`
}

/** codeload 的真实地址：url 型反代直接吃这个 */
export function codeloadPath(owner: string, repo: string, ref: string): string {
  const branch = encodePath(ref || 'main')
  return `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zip/refs/heads/${branch}`
}

/** 经 url 型反代下载（gh-proxy 系） */
export function codeloadViaProxy(proxyBase: string, owner: string, repo: string, ref: string): string {
  const base = normalizeBase(proxyBase)
  return `${base}/${CODELOAD_BASE}/${codeloadPath(owner, repo, ref)}`
}

/** 经当前镜像的 github 路径下载（会 302 到 codeload） */
export function archiveViaMirror(mirror: string, owner: string, repo: string, ref: string): string {
  return githubUrlAt(mirror, archivePath(owner, repo, ref))
}

/**
 * 候选地址，按「最可能通」排序。顺序是踩出来的，不是拍脑袋：
 *
 * 1. 当前镜像能整段代理 codeload（url 型，或旧版本继承来、风格未知）→ 先试这条；
 * 2. 调用方显式传入的 codeload 代理（包里默认不带，用户填了才有）；
 * 3. 用户自己的自建站 —— 和 release 候选同理，不能只在「当前镜像就是它」时
 *    才出现，否则后台自动选最快一切换，用户自己的加速站就从列表里消失了；
 * 4. 当前镜像的 github archive 路径 —— 能通就通，通不了还有下一条；
 * 5. 官方 codeload 兜底（能直连 GitHub 的环境走这条）。
 *
 * 去重，最多五条：探活是一条条等的，再多就要等到用户以为没反应。
 */
export function archiveCandidates(
  mirror: string,
  owner: string,
  repo: string,
  ref: string,
  proxies?: string[],
  selfBase: string = selfMirrorBase(),
): string[] {
  const def = mirrorDefFor(mirror)
  const self = normalizeBase(selfBase)
  // 不传就是用户填过的 url 型站；传空数组表示只要当前站与官方
  const pool = proxies ?? userProxyBases([mirror])
  const out: string[] = []
  // 风格未知（从旧版本继承的地址）时两种拼法都给：猜错不该等于下不动
  const maybeUrl = def.style === 'url' || (!mirrorKnown(mirror) && !!def.base)

  if (maybeUrl) out.push(codeloadViaProxy(def.base, owner, repo, ref))
  for (const base of pool) {
    if (!base) continue
    out.push(codeloadViaProxy(base, owner, repo, ref))
    // 风格未知（从旧版本继承）时补一条 github 路径拼法，猜错也不至于下不动
    if (!mirrorKnown(base)) out.push(archiveViaMirror(base, owner, repo, ref))
  }
  if (self && self !== normalizeBase(def.base)) {
    out.push(archiveViaMirror(self, owner, repo, ref))
  }
  out.push(archiveViaMirror(mirror, owner, repo, ref))
  out.push(`${CODELOAD_BASE}/${codeloadPath(owner, repo, ref)}`)

  const seen = new Set<string>()
  const uniq: string[] = []
  for (const url of out) {
    const key = url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    uniq.push(url)
  }
  return uniq.slice(0, 5)
}

export type ArchiveProbe = (url: string) => Promise<boolean>

/**
 * 逐个探活，返回第一个通的地址。
 *
 * 全都不通也返回第一条 —— 探活本身可能失败（CORS、企业网络拦 HEAD），
 * 这时候让浏览器去试，比直接报「下载失败」更有机会成。
 */
export async function pickArchive(candidates: string[], probe: ArchiveProbe): Promise<string> {
  for (const url of candidates) {
    try {
      if (await probe(url)) return url
    } catch {
      // 探活自身异常当作不通，继续下一个
    }
  }
  return candidates[0]
}
