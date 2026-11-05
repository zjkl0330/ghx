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
import { githubUrlAt, mirrorDefFor, normalizeBase } from './mirrors'

export const CODELOAD_BASE = 'https://codeload.github.com'

/**
 * 实测（2026-11）能吃 codeload 的反代只有 gh-proxy.com：
 * ghfast.top / ghproxy.net 直接 403，ghproxy.imciel.com 404，
 * 自建站只代理 github.com，302 出去还是让浏览器连 codeload。
 * 所以它要排在「当前镜像」后面单独占一位，不能指望运气。
 */
export const KNOWN_CODELOAD_PROXIES = ['https://gh-proxy.com']

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
 * 1. 当前镜像是 url 型 → 先让它试 codeload（成了最快，一步到位）；
 * 2. 已知能吃 codeload 的反代（gh-proxy.com）—— 自建站 302 出去连不上时全靠它；
 * 3. 当前镜像的 github archive 路径 —— 它只是个 302，能否成功取决于浏览器能不能直连 codeload；
 * 4. 官方 codeload 兜底（能直连 GitHub 的环境走这条）。
 *
 * 去重，最多四条：探活是一条条等的，再多就要等到用户以为没反应。
 */
export function archiveCandidates(
  mirror: string,
  owner: string,
  repo: string,
  ref: string,
  proxies: string[] = KNOWN_CODELOAD_PROXIES,
): string[] {
  const def = mirrorDefFor(mirror)
  const out: string[] = []

  if (def.base && def.style === 'url') out.push(codeloadViaProxy(def.base, owner, repo, ref))
  for (const base of proxies) {
    if (base) out.push(codeloadViaProxy(base, owner, repo, ref))
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
  return uniq.slice(0, 4)
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
