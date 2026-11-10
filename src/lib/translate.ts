/**
 * README 与简介机翻。
 *
 * 约束来自真实的免费通道：
 * - MyMemory 单次请求上限 500 字节，超了直接返回警告串，所以必须切段；
 * - Google 的 gtx 端点没有官方承诺，国内常常连不通，只能当备选；
 * - 微软（Azure Translator）质量和速度最好，但需要一个免费 F0 密钥；
 * - Edge 浏览器自带翻译的端点（translatetext）免密钥、单次可吞 5 万字符、
 *   CORS 全开、国内可直连，2026-11 实测可用，因此作为默认首选；
 * - 各通道都会把换行转成 `&#10;`，要反转义回来。
 *
 * 关于 Edge 通道的来龙去脉（重要，别再走回头路）：
 * 老办法是 GET edge.microsoft.com/translate/auth 取 token 再调 api-edge，
 * 该接口 2026-07-30 下线，现在固定 404。新的 translatetext 不需要 token，
 * 但它是 Edge 客户端内部接口，没有 SLA，随时可能一起没。所以必须：
 *   1) 做成可选通道，用户能手动切走；
 *   2) 失败时自动降级到 MyMemory / Google，不能让整篇留在英文；
 *   3) 请求里不带 from 参数，交给它自动识别 —— 实测已中标的句子会原样返回，
 *      带 from=en 反而可能把中文改坏。
 *
 * 因此这里做四件事：按通道上限切分、按通道顺序降级、长段落分段后再拼回、
 * 译文按「通道 + 目标语言 + 内容哈希」缓存。
 *
 * 早期的坑：一个段落整块丢给 MyMemory，超过 500 字节直接被拒，
 * 于是长段落静悄悄留在英文 —— 现在先在块内切分再翻，不会再漏。
 */
import type { KV } from './storage'

export type TranslateChannel = 'auto' | 'edge' | 'azure' | 'google' | 'mymemory'

export const TRANSLATE_CHANNELS: { key: TranslateChannel; label: string; hint: string }[] = [
  {
    key: 'auto',
    label: '自动',
    hint: '优先 Edge 免密钥通道（单次能翻整篇），失败再退微软密钥 / MyMemory / Google',
  },
  {
    key: 'edge',
    label: 'Edge',
    hint: '不用密钥，单次 5 万字符，国内可直连。微软 Edge 的内部接口，可能随时下线',
  },
  { key: 'azure', label: '微软', hint: '需要免费的 Azure 翻译密钥，官方接口最稳，单次 4 千字节' },
  { key: 'mymemory', label: 'MyMemory', hint: '不用密钥，国内可达，但单段 450 字节要切很多次' },
  { key: 'google', label: 'Google', hint: '质量不错，但国内常常连不上' },
]

/** 可选的译文语言。默认简体中文。 */
export type TargetLang = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko'

export const TARGET_LANGS: { key: TargetLang; label: string }[] = [
  { key: 'zh-CN', label: '简体中文' },
  { key: 'zh-TW', label: '繁體中文' },
  { key: 'en', label: 'English' },
  { key: 'ja', label: '日本語' },
  { key: 'ko', label: '한국어' },
]

export const DEFAULT_TARGET: TargetLang = 'zh-CN'

/** 哪些内容需要翻。设置页三个开关直接映射到这里。 */
export interface TranslateScope {
  /** 项目自述 */
  readme: boolean
  /** 仓库简介 */
  desc: boolean
  /** 发行版说明 */
  release: boolean
}

export const DEFAULT_SCOPE: TranslateScope = { readme: true, desc: true, release: false }

export function normalizeTarget(raw: string | null | undefined): TargetLang {
  const v = (raw ?? '').trim()
  const hit = TARGET_LANGS.find((t) => t.key.toLowerCase() === v.toLowerCase())
  return hit?.key ?? DEFAULT_TARGET
}

export function targetLabel(t: TargetLang): string {
  return TARGET_LANGS.find((x) => x.key === t)?.label ?? t
}

/** 翻译范围存成 JSON；缺字段或脏数据按默认补全，不会因为一半坏掉就全关 */
export function parseScope(raw: string | null | undefined): TranslateScope {
  if (!raw) return { ...DEFAULT_SCOPE }
  try {
    const obj = JSON.parse(raw) as Partial<TranslateScope>
    return {
      readme: typeof obj.readme === 'boolean' ? obj.readme : DEFAULT_SCOPE.readme,
      desc: typeof obj.desc === 'boolean' ? obj.desc : DEFAULT_SCOPE.desc,
      release: typeof obj.release === 'boolean' ? obj.release : DEFAULT_SCOPE.release,
    }
  } catch {
    return { ...DEFAULT_SCOPE }
  }
}

/** MyMemory 免费额度按字符算，单段留点余量 */
export const MYMEMORY_MAX_BYTES = 450
/** Google 走 URL 传参，太长会被截断 */
export const GOOGLE_MAX_BYTES = 1400
/** 微软单次可到 5 万字符；分段只是为了失败时不整段丢，4000 足够稳 */
export const AZURE_MAX_BYTES = 4000
/**
 * Edge 实测 5 万字符以内正常、6 万报错；这里按 UTF-8 字节保守取 48KB。
 * 中文 3 字节/字，折合约 1.6 万字，普通 README 的整段远达不到。
 */
export const EDGE_MAX_BYTES = 48_000
/** Edge 支持数组批量，一次 40 条短句（简介场景）刚好，太多怕被截断 */
export const EDGE_BATCH = 40

/** 默认走自动降级；国内网络下这是成功率最高的组合 */
export const DEFAULT_CHANNEL: TranslateChannel = 'auto'
/** 打开自述时默认自动翻，用户可以在设置里关掉 */
export const DEFAULT_AUTO_TRANSLATE = true

/** 存进本地的通道值可能是旧版本、空白或脏数据，一律归一到合法值 */
export function normalizeChannel(raw: string | null | undefined): TranslateChannel {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === 'google' || v === 'mymemory' || v === 'azure' || v === 'edge' || v === 'auto') return v
  return DEFAULT_CHANNEL
}

/** 「开 / 关」在本地存的是字符串，只有明确的 off/0/false 才算关 */
export function normalizeAutoTranslate(raw: string | null | undefined): boolean {
  if (raw == null || raw === '') return DEFAULT_AUTO_TRANSLATE
  const v = raw.trim().toLowerCase()
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return false
  if (v === 'on' || v === '1' || v === 'true' || v === 'yes') return true
  return DEFAULT_AUTO_TRANSLATE
}


export interface TranslateOptions {
  channel?: TranslateChannel
  fetchImpl?: typeof fetch
  /** 单次请求超时（毫秒） */
  timeout?: number
  /** 一段原文最多切成几段，防止超长段落发出几十个请求 */
  maxChunks?: number
  /** 译文语言，默认简体中文 */
  target?: TargetLang
  /** 微软翻译密钥（Azure Translator 的 Ocp-Apim-Subscription-Key） */
  azureKey?: string
  /** 微软翻译区域；多区域资源才需要，留空走 global */
  azureRegion?: string
  /** 覆盖单次请求的字节上限；默认按通道取 */
  maxBytes?: number
}

export class TranslateError extends Error {
  constructor(
    message: string,
    readonly channel: string,
  ) {
    super(message)
    this.name = 'TranslateError'
  }
}

const encoder = new TextEncoder()

export function byteLength(s: string): number {
  return encoder.encode(s).length
}

/** 已经是中文的段落不必再翻，省额度也省时间 */
export function hasChinese(text: string): boolean {
  const han = text.match(/[\u4e00-\u9fa5]/g)?.length ?? 0
  const letters = text.replace(/\s/g, '').length || 1
  return han / letters > 0.15
}

/*
 * 拼音音节表（不带声调）。只用来判断「这串字母是不是拼音」，
 * 不做注音转换 —— 转换要词典，离线做不了，做出来也是错的。
 * 覆盖《汉语拼音方案》全部 400 多个音节，含 lv/nv 这类 v 写法。
 */
const PINYIN = new Set(
  (
    'a ai an ang ao ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu ' +
    'ca cai can cang cao ce cei cen ceng cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo ' +
    'da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo ' +
    'e ei en eng er fa fan fang fei fen feng fo fou fu ' +
    'ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo ' +
    'ha hai han hang hao he hei hen heng hong hou hu hua huai huan huang hui hun huo ' +
    'ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun ' +
    'ka kai kan kang kao ke ken keng kong kou ku kua kuai kuan kuang kui kun kuo ' +
    'la lai lan lang lao le lei leng li lia lian liang liao lie lin ling liu lo long lou lu luan lun luo lv lve ' +
    'ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu ' +
    'na nai nan nang nao ne nei nen neng ni nian niang niao nie nin ning niu nong nou nu nuan nuo nv nve ' +
    'o ou pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu ' +
    'qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun ' +
    'ran rang rao re ren reng ri rong rou ru rua ruan rui run ruo ' +
    'sa sai san sang sao se sen seng sha shai shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang shui shun shuo si song sou su suan sui sun suo ' +
    'ta tai tan tang tao te teng ti tian tiao tie ting tong tou tu tuan tui tun tuo ' +
    'wa wai wan wang wei wen weng wo wu ' +
    'xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun ' +
    'ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun ' +
    'za zai zan zang zao ze zei zen zeng zha zhai zhan zhang zhao zhe zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong zou zu zuan zui zun zuo'
  ).split(' '),
)

/**
 * 这串字母能不能整段切成拼音音节（至少两个音节）。
 *
 * 为什么要判：机翻通道拿到纯拼音会当外语硬翻，
 * 「MiyoQian」被音译成「美代倩」—— 用户看到的是一句根本不存在的译文。
 * 这里用动态规划逐段切，比正则可靠：拼音没有词边界，只能穷举。
 *
 * 会有误伤（case = ca+se、awesome = a+we+so+me 都切得通），
 * 但只在「整段简介就一个词」时才用得上，代价只是少一次没必要的翻译。
 */
export function looksLikePinyin(text: string): boolean {
  const s = text.toLowerCase().replace(/[^a-z]/g, '')
  if (s.length < 4 || s.length > 40) return false
  const ok = new Array<boolean>(s.length + 1).fill(false)
  const syllables = new Array<number>(s.length + 1).fill(0)
  ok[0] = true
  for (let i = 1; i <= s.length; i += 1) {
    for (let len = 1; len <= 6 && len <= i; len += 1) {
      if (!ok[i - len] || !PINYIN.has(s.slice(i - len, i))) continue
      ok[i] = true
      syllables[i] = Math.max(syllables[i], syllables[i - len] + 1)
    }
  }
  return ok[s.length] && syllables[s.length] >= 2
}

/**
 * 这段文字是不是「名字」而不是「句子」。
 *
 * 典型形态：仓库名、账号、项目名 —— miyouqian / MiyoQian / ghx / esp32-wol。
 * 这类文本没有语法可翻，机器只能按音硬凑，所以宁可不翻，让原文原样显示。
 * 判定保守：带空格的（多词）、带连字符的（多半是短语，如 self-hosted）都交给人翻。
 */
export function isNameLike(text: string): boolean {
  const t = text.trim()
  if (!t || /\s/.test(t)) return false
  if (!/^[A-Za-z][A-Za-z0-9_.]*$/.test(t)) return false
  if (/[A-Z]/.test(t.slice(1))) return true // camelCase 与 PascalCase，几乎都是名字
  if (/[0-9_.]/.test(t)) return true // v2 / esp32 / my_repo
  // 三个字母以内又没有元音：只可能是缩写或代号（ghx、sdk 之类），不是能翻的词
  if (t.length <= 3 && !/[aeiouy]/i.test(t)) return true
  return looksLikePinyin(t)
}

/**
 * 这段文字对目标语言来说还需不需要翻。
 *
 * 不能用 hasChinese 一刀切：一句中文里夹了一串英文术语（很常见），
 * 中文占比就过线，结果整段被跳过 —— 这正是「明明有英文却没翻」的另一个来源。
 * 这里按「非目标语言字符占比」判断，中文目标下只要还有成片的英文就翻。
 */
export function needsTranslation(text: string, target: TargetLang = DEFAULT_TARGET): boolean {
  // 名字先排除：不管目标语言是什么，翻一个名字都只会得到音译垃圾
  if (isNameLike(text)) return false
  const visible = text.replace(/\s/g, '').length || 1
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length
  const latin = (text.match(/[A-Za-z\u00c0-\u024f]/g) ?? []).length

  if (target.startsWith('zh')) {
    // 中文已经占了大头，偶尔几个英文单词（API、Docker）不值得再翻一遍
    if (cjk / visible >= 0.35) return false
    return latin >= 2
  }
  if (target === 'ja' || target === 'ko') {
    // 日文汉字与中文重叠，只有假名/谚文才算「已经是目标语言」
    if (target === 'ja' && (text.match(/[\u3040-\u30ff]/g) ?? []).length > 0) return false
    if (target === 'ko' && (text.match(/[\uac00-\ud7af]/g) ?? []).length > 0) return false
    return latin >= 2
  }
  // 目标英文：拉丁字母占比够高就认为已经是英文
  return latin / visible < 0.6
}

/** 通道返回里常见的 HTML 实体 */
export function unescapeHtml(s: string): string {
  return (
    s
      // 数字实体统一解：通道偶尔会写成「&# 39；」（插空格、全角分号），
      // 只认固定几条规则会漏，所以在这里一次兜住。
      .replace(/&#\s*(\d{1,6})\s*[;；]/g, (m, d) => {
        const code = Number(d)
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m
        return String.fromCodePoint(code)
      })
      .replace(/&#x\s*([0-9a-f]{1,6})\s*[;；]/gi, (m, h) => {
        const code = parseInt(h, 16)
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m
        return String.fromCodePoint(code)
      })
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
  )
}

/** FNV-1a，够用且不用引依赖；只用于缓存键，不做安全用途 */
export function hashText(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

function splitSentences(s: string): string[] {
  const out: string[] = []
  let buf = ''
  for (const ch of s) {
    buf += ch
    if ('.!?。！？；;'.includes(ch)) {
      out.push(buf)
      buf = ''
    }
  }
  if (buf) out.push(buf)
  return out.filter((x) => x.trim())
}

/** 硬切：逐字符累加，字节数到顶就断开 */
function hardSplit(s: string, maxBytes: number): string[] {
  const out: string[] = []
  let buf = ''
  for (const ch of s) {
    if (byteLength(buf + ch) > maxBytes) {
      if (buf) out.push(buf)
      buf = ch
    } else {
      buf += ch
    }
  }
  if (buf) out.push(buf)
  return out
}

/**
 * 按字节上限切分。顺序是：段落 → 句子 → 硬切。
 * 先按段落切能保证语义完整，句子是退让，硬切只在极端长句时兜底。
 */
export function splitByBytes(text: string, maxBytes = MYMEMORY_MAX_BYTES): string[] {
  const out: string[] = []
  const paras = text.split(/\n{2,}/)

  for (const para of paras) {
    const p = para.trim()
    if (!p) continue
    if (byteLength(p) <= maxBytes) {
      out.push(p)
      continue
    }

    let buf = ''
    for (const sentence of splitSentences(p)) {
      if (byteLength(sentence) > maxBytes) {
        if (buf) {
          out.push(buf.trim())
          buf = ''
        }
        out.push(...hardSplit(sentence, maxBytes))
        continue
      }
      if (byteLength(buf + sentence) > maxBytes) {
        if (buf) out.push(buf.trim())
        buf = sentence
      } else {
        buf += sentence
      }
    }
    if (buf.trim()) out.push(buf.trim())
  }

  return out.filter((s) => s.trim())
}

function withTimeout(fetchImpl: typeof fetch, ms: number): typeof fetch {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), ms)
    try {
      return await fetchImpl(input, { ...init, signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function viaMyMemory(text: string, f: typeof fetch, target: TargetLang): Promise<string> {
  // 源语言尽量留 auto：README 不一定是英文，写死 en 会把日文仓库翻成乱码
  const source = (text.match(/[A-Za-z]/g) ?? []).length >= text.replace(/\s/g, '').length / 2 ? 'en' : 'Autodetect'
  const url =
    'https://api.mymemory.translated.net/get?q=' +
    encodeURIComponent(text) +
    `&langpair=${encodeURIComponent(source)}|${encodeURIComponent(target)}`

  // 免费额度很容易撞 429。撞上就退让一下再试，别一条 429 就判整段失败 ——
  // 用户看到的就是「明明有英文却没翻」。
  let res = await f(url)
  for (let attempt = 0; attempt < 2 && !res.ok && (res.status === 429 || res.status >= 500); attempt += 1) {
    await sleep(700 * (attempt + 1))
    res = await f(url)
  }
  if (!res.ok) {
    throw new TranslateError(
      res.status === 429 ? 'MyMemory 免费额度用完了，换微软通道会快很多' : `MyMemory 返回 ${res.status}`,
      'mymemory',
    )
  }
  const body = (await res.json()) as {
    responseData?: { translatedText?: string }
    responseStatus?: number | string
    responseDetails?: string
  }
  const out = body.responseData?.translatedText ?? ''
  const detail = String(body.responseDetails ?? '')
  if (!out || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(out) || /LIMIT/i.test(detail)) {
    throw new TranslateError(detail || 'MyMemory 未返回译文', 'mymemory')
  }
  return unescapeHtml(out)
}

/** Edge 翻译端点。不带 from，让服务端自动识别语言 */
export const EDGE_ENDPOINT = 'https://edge.microsoft.com/translate/translatetext'

interface EdgeItem {
  translations?: { text?: string; to?: string }[]
}

function parseEdgeBody(raw: string): EdgeItem[] {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    throw new TranslateError('Edge 返回的不是 JSON', 'edge')
  }
  if (!Array.isArray(body)) throw new TranslateError('Edge 返回结构异常', 'edge')
  return body as EdgeItem[]
}

/**
 * 微软 Edge 浏览器自带的翻译通道，免密钥。
 *
 * 两个必须踩准的点：
 * 1. 不能带 `from`。带了 from=en 会把中文句子也当英文改写；不带则服务端自动识别，
 *    已经是目标语言的段落原样返回 —— 这让我们可以把整段甚至整篇丢进去。
 * 2. 必须带浏览器 UA（WebView 天然满足）；裸 curl 不带 UA 会 400。
 */
async function viaEdge(text: string, f: typeof fetch, target: TargetLang): Promise<string> {
  const res = await f(`${EDGE_ENDPOINT}?to=${encodeURIComponent(target)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([text]),
  })
  if (!res.ok) {
    throw new TranslateError(
      res.status === 400 ? 'Edge 拒绝了这段（可能超长）' : `Edge 返回 ${res.status}`,
      'edge',
    )
  }
  const items = parseEdgeBody(await res.text())
  const out = (items[0]?.translations?.[0]?.text ?? '').trim()
  if (!out) throw new TranslateError('Edge 未返回译文', 'edge')
  return unescapeHtml(out)
}

/**
 * Edge 批量翻译：接口原生支持数组，一次请求按顺序返回。
 * 简介这种「几十条短句」的场景用它，比逐条发快一个数量级。
 * 失败的批次留 null，调用方可以退回逐条翻译。
 */
export async function translateEdgeBatch(
  texts: string[],
  opts: TranslateOptions = {},
): Promise<(string | null)[]> {
  const f = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const timed = withTimeout(f, opts.timeout ?? 20_000)
  const target = opts.target ?? DEFAULT_TARGET
  const out: (string | null)[] = new Array(texts.length).fill(null)
  if (texts.length === 0) return out

  for (let start = 0; start < texts.length; start += EDGE_BATCH) {
    const slice = texts.slice(start, start + EDGE_BATCH)
    try {
      const res = await timed(`${EDGE_ENDPOINT}?to=${encodeURIComponent(target)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slice),
      })
      if (!res.ok) continue
      const items = parseEdgeBody(await res.text())
      if (items.length !== slice.length) continue
      items.forEach((item, i) => {
        const text = item.translations?.[0]?.text
        if (text) out[start + i] = unescapeHtml(text)
      })
    } catch {
      /* 这一批失败，留 null 交给逐条兜底 */
    }
  }
  return out
}

/**
 * 微软翻译（Azure Translator）。
 *
 * 需要用户自己在 Azure 建一个「翻译」资源，免费 F0 档每月 200 万字符。
 * 好处是单次能吞下整段（我们切到 4000 字节只是为了失败时少丢内容），
 * 长 README 的请求数比 MyMemory 少一个数量级，速度和排版连贯性都更好。
 */async function viaAzure(
  text: string,
  f: typeof fetch,
  opts: TranslateOptions,
): Promise<string> {
  const key = (opts.azureKey ?? '').trim()
  if (!key) throw new TranslateError('还没填微软翻译密钥', 'azure')
  const target = opts.target ?? DEFAULT_TARGET
  const region = (opts.azureRegion ?? '').trim()
  const res = await f(
    `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${encodeURIComponent(target)}`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        ...(region ? { 'Ocp-Apim-Subscription-Region': region } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ Text: text }]),
    },
  )
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new TranslateError('微软密钥无效或额度用尽', 'azure')
    }
    if (res.status === 429) throw new TranslateError('微软翻译额度已用完', 'azure')
    throw new TranslateError(`微软返回 ${res.status}`, 'azure')
  }
  const body = (await res.json()) as unknown
  if (!Array.isArray(body) || !Array.isArray(body[0]?.translations)) {
    throw new TranslateError('微软返回结构异常', 'azure')
  }
  const out = (body[0].translations as { text?: string }[])
    .map((t) => t.text ?? '')
    .join('')
    .trim()
  if (!out) throw new TranslateError('微软未返回译文', 'azure')
  return unescapeHtml(out)
}

async function viaGoogle(text: string, f: typeof fetch, target: TargetLang): Promise<string> {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
    encodeURIComponent(target) +
    '&dt=t&q=' +
    encodeURIComponent(text)
  const res = await f(url)
  if (!res.ok) throw new TranslateError(`Google 返回 ${res.status}`, 'google')
  const body = (await res.json()) as unknown
  if (!Array.isArray(body) || !Array.isArray(body[0])) {
    throw new TranslateError('Google 返回结构异常', 'google')
  }
  const pieces = (body[0] as unknown[])
    .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
    .join('')
  if (!pieces.trim()) throw new TranslateError('Google 未返回译文', 'google')
  return unescapeHtml(pieces)
}

/** 按通道顺序逐个尝试，全失败才抛错 */
export async function translateChunk(
  text: string,
  opts: TranslateOptions = {},
): Promise<{ text: string; channel: Exclude<TranslateChannel, 'auto'> }> {
  const f = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const timed = withTimeout(f, opts.timeout ?? 12_000)
  const hasAzure = !!(opts.azureKey ?? '').trim()
  const order: Exclude<TranslateChannel, 'auto'>[] =
    opts.channel === 'google'
      ? ['google']
      : opts.channel === 'mymemory'
        ? ['mymemory']
        : opts.channel === 'azure'
          ? ['azure']
          : opts.channel === 'edge'
            ? ['edge']
            : // 自动：Edge 免密钥且单次能吞整篇，成功率和速度都最好，放最前；
              // 它挂了再退 Azure（如果填了密钥）、MyMemory、Google。
              hasAzure
              ? ['edge', 'azure', 'mymemory', 'google']
              : ['edge', 'mymemory', 'google']

  const errors: string[] = []
  for (const ch of order) {
    try {
      const out = await viaChannel(ch, text, timed, opts)
      return { text: out, channel: ch }
    } catch (err) {
      errors.push(`${ch}: ${(err as Error).message}`)
    }
  }
  throw new TranslateError(errors.join(' | ') || '翻译失败', order.join('+'))
}

const joinGlue = (target: TargetLang) => (target.match(/^(zh|ja|ko)/) ? '' : ' ')

/**
 * 走某个通道。手上有的是「整段」文字，但各通道各有上限：
 * 自动模式用微软的 4000 字节上限切好、结果微软挂了退回 MyMemory 时，
 * 这一整段仍然超 450 字节。所以这里对超限的段落就地再切一次，
 * 保证「换通道降级」不会因为长度直接判死。
 */
async function viaChannel(
  ch: Exclude<TranslateChannel, 'auto'>,
  text: string,
  f: typeof fetch,
  opts: TranslateOptions,
): Promise<string> {
  const target = opts.target ?? DEFAULT_TARGET
  const cap =
    ch === 'edge'
      ? EDGE_MAX_BYTES
      : ch === 'azure'
        ? AZURE_MAX_BYTES
        : ch === 'google'
          ? GOOGLE_MAX_BYTES
          : MYMEMORY_MAX_BYTES
  const run = (piece: string) =>
    ch === 'edge'
      ? viaEdge(piece, f, target)
      : ch === 'azure'
        ? viaAzure(piece, f, opts)
        : ch === 'google'
          ? viaGoogle(piece, f, target)
          : viaMyMemory(piece, f, target)

  if (byteLength(text) <= cap) return run(text)

  const parts = splitByBytes(text, cap)
  const out: string[] = new Array(parts.length)
  let cursor = 0
  let ok = 0
  async function worker() {
    while (cursor < parts.length) {
      const i = cursor
      cursor += 1
      try {
        out[i] = await run(parts[i])
        ok += 1
      } catch {
        out[i] = parts[i]
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, parts.length) }, worker))
  if (ok === 0) throw new TranslateError('分段后仍然全部失败', ch)
  return out.join(joinGlue(target))
}

/** 当前通道单次请求的字节上限 */
export function maxBytesFor(opts: TranslateOptions = {}): number {
  if (opts.maxBytes) return opts.maxBytes
  const ch = opts.channel ?? DEFAULT_CHANNEL
  if (ch === 'edge') return EDGE_MAX_BYTES
  if (ch === 'azure') return AZURE_MAX_BYTES
  if (ch === 'google') return GOOGLE_MAX_BYTES
  if (ch === 'mymemory') return MYMEMORY_MAX_BYTES
  // 自动模式按首选通道（Edge）切，请求数最少；真降级到 MyMemory 时
  // viaChannel 会在块内再切一次，不会因为超长直接判死。
  return EDGE_MAX_BYTES
}

/**
 * 翻译任意长度的一段文字：超上限就切分，逐段翻完按原顺序拼回。
 * 单独一段失败只留那一段的原文，不会把整段（或整篇）拖垮 —— 这是
 * 「长段落整块发出去被 MyMemory 拒绝、结果一直显示英文」的根治办法。
 */
export async function translateLongText(
  text: string,
  opts: TranslateOptions & { concurrency?: number } = {},
): Promise<{ text: string; channel: string }> {
  const trimmed = text.trim()
  if (!trimmed) return { text: '', channel: 'none' }
  const parts = splitByBytes(trimmed, maxBytesFor(opts))
  if (parts.length <= 1) {
    const r = await translateChunk(trimmed, opts)
    return { text: r.text, channel: r.channel }
  }

  const out: string[] = new Array(parts.length)
  let channel = 'cached'
  let okCount = 0
  let cursor = 0
  const limit = Math.max(1, opts.concurrency ?? 3)
  async function worker() {
    while (cursor < parts.length) {
      const i = cursor
      cursor += 1
      try {
        const r = await translateChunk(parts[i], opts)
        out[i] = r.text
        channel = r.channel
        okCount += 1
      } catch {
        out[i] = parts[i]
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, parts.length) }, worker))
  if (okCount === 0) throw new TranslateError('分段翻译全部失败', opts.channel ?? 'auto')
  // 中文/日文/韩文之间不加空格，否则会多出一堆奇怪的空白
  return { text: out.join(joinGlue(opts.target ?? DEFAULT_TARGET)), channel }
}

/** 缓存键：通道 + 目标语言 + 内容哈希。默认中文不带语言段，兼容旧缓存。 */
export function cacheKeyFor(opts: TranslateOptions, text: string): string {
  const ch = opts.channel ?? 'auto'
  const target = opts.target ?? DEFAULT_TARGET
  const lang = target === DEFAULT_TARGET ? '' : `${target}.`
  return `${ch}.${lang}${hashText(text)}`
}

export interface TranslationStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

/** 用现有 KV 存译文，key 带内容哈希，同一段文字只翻一次 */
export function kvStore(kv: KV): TranslationStore {
  const PREFIX = 'ghx.tr.v1.'
  return {
    async get(key) {
      try {
        return await kv.get(PREFIX + key)
      } catch {
        return null
      }
    },
    async set(key, value) {
      try {
        await kv.set(PREFIX + key, value)
      } catch {
        /* 存不下就算了，下次重翻 */
      }
    },
  }
}

/** 内存实现，测试与临时会话用 */
export function memoryStore(seed: Record<string, string> = {}): TranslationStore {
  const map = new Map(Object.entries(seed))
  return {
    async get(key) {
      return map.get(key) ?? null
    },
    async set(key, value) {
      map.set(key, value)
    },
  }
}

export interface TranslateResult {
  text: string
  /** 实际使用的通道；全部命中缓存时为 cached */
  channel: string
  /** 命中缓存的段数 / 总段数 */
  cached: number
  total: number
}

/**
 * 翻译一段可能很长的文字：切段 → 查缓存 → 并发请求 → 拼回。
 * 单段失败只留原文，不让整篇崩掉。
 */
export async function translateText(
  text: string,
  opts: TranslateOptions & { store?: TranslationStore; concurrency?: number } = {},
): Promise<TranslateResult> {
  const trimmed = text.trim()
  if (!trimmed) return { text: '', channel: 'none', cached: 0, total: 0 }

  const maxBytes = maxBytesFor(opts)
  let chunks = splitByBytes(trimmed, maxBytes)
  if (opts.maxChunks && chunks.length > opts.maxChunks) {
    chunks = chunks.slice(0, opts.maxChunks)
  }

  const results: string[] = new Array(chunks.length)
  let cached = 0
  let channel = 'cached'
  const pending: number[] = []

  for (let i = 0; i < chunks.length; i += 1) {
    const key = cacheKeyFor(opts, chunks[i])
    const hit = opts.store ? await opts.store.get(key) : null
    if (hit !== null) {
      results[i] = hit
      cached += 1
    } else {
      pending.push(i)
    }
  }

  const limit = Math.max(1, opts.concurrency ?? 2)
  let cursor = 0

  async function worker() {
    while (cursor < pending.length) {
      const idx = pending[cursor]
      cursor += 1
      try {
        const r = await translateChunk(chunks[idx], opts)
        results[idx] = r.text
        channel = r.channel
        if (opts.store) await opts.store.set(cacheKeyFor(opts, chunks[idx]), r.text)
      } catch {
        results[idx] = chunks[idx]
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, pending.length) }, worker))
  return { text: results.join('\n\n'), channel, cached, total: chunks.length }
}

/** 需要翻译的块类型：代码块保持原样，分隔线没有文字 */
export interface BlockLike {
  kind: string
  text?: string
  [key: string]: unknown
}

export interface TranslateBlocksResult<B extends BlockLike> {
  blocks: B[]
  /** 本批真正拿到译文的段数（缓存命中也算） */
  translated: number
  /** 本批处理的段数 */
  total: number
  channel: string
  /** 下一批从第几个块开始扫（块下标，不是「第几个待翻段」） */
  next: number
  /** 还剩多少段没翻；>0 时界面给「继续翻译」的入口 */
  remaining: number
}

/**
 * 按块翻译，保留标题层级、列表缩进与代码块。
 * 每次只翻一批（默认 30 段）：长 README 全量翻要几分钟且很烧免费额度，
 * 所以分批判，翻完一批就把 next / remaining 交回界面，由用户决定继续。
 */
export async function translateBlocks<B extends BlockLike>(
  blocks: B[],
  opts: TranslateOptions & {
    store?: TranslationStore
    maxBlocks?: number
    concurrency?: number
    /** 从第几个块开始扫，用于分批续翻。用块下标而不是待翻段序号：
     *  前一批翻完的段落已变成中文，按待翻序号会错位漏段。 */
    skip?: number
    onProgress?: (done: number, total: number) => void
    /** 每翻好一段就回调，界面可以边翻边显示，不必等全部完成 */
    onBlock?: (index: number, text: string) => void
  } = {},
): Promise<TranslateBlocksResult<B>> {
  const maxBlocks = opts.maxBlocks ?? 30
  const start = Math.max(0, Math.min(opts.skip ?? 0, blocks.length))
  const all: number[] = []

  for (let i = start; i < blocks.length; i += 1) {
    const b = blocks[i]
    if (b.kind === 'code' || b.kind === 'hr' || b.kind === 'img') continue
    const text = (b.text ?? '').trim()
    if (!text || !needsTranslation(text, opts.target ?? DEFAULT_TARGET)) continue
    all.push(i)
  }

  const targets = all.slice(0, maxBlocks)

  if (targets.length === 0) {
    return { blocks, translated: 0, total: 0, channel: 'none', next: blocks.length, remaining: 0 }
  }

  const out = blocks.map((b) => ({ ...b }))
  let done = 0
  /** 真正拿到译文的段数（缓存命中也算），全部失败时界面要能看出来 */
  let ok = 0
  let channel = 'cached'
  const limit = Math.max(1, opts.concurrency ?? 2)
  let cursor = 0

  async function worker() {
    while (cursor < targets.length) {
      const idx = targets[cursor]
      cursor += 1
      const src = (blocks[idx].text ?? '').trim()
      const key = cacheKeyFor(opts, src)
      try {
        const hit = opts.store ? await opts.store.get(key) : null
        if (hit !== null) {
          out[idx] = { ...out[idx], text: hit }
          ok += 1
          opts.onBlock?.(idx, hit)
        } else {
          // 长段落先在块内按通道上限切分再翻，否则 MyMemory 直接拒绝、整段留在英文
          const r = await translateLongText(src, opts)
          out[idx] = { ...out[idx], text: r.text }
          channel = r.channel
          ok += 1
          opts.onBlock?.(idx, r.text)
          if (opts.store) await opts.store.set(key, r.text)
        }
      } catch {
        /* 这一段保持原文 */
      }
      done += 1
      opts.onProgress?.(done, targets.length)
    }
  }

  // 先把总段数报出去，界面才不会一直显示「翻译 …」
  opts.onProgress?.(0, targets.length)
  await Promise.all(Array.from({ length: Math.min(limit, targets.length) }, worker))
  // 用最后一段的块下标 +1 作为游标，保证下次从它后面继续，不会跳段
  const next = targets[targets.length - 1] + 1
  return {
    blocks: out,
    translated: ok,
    total: targets.length,
    channel,
    next,
    remaining: Math.max(0, all.length - targets.length),
  }
}

/**
 * 微软批量翻译：一次请求最多 100 条（这里按 25 条发，单条再长也不会撞上限）。
 * 简介这种「几十条短句」的场景用它比逐条发快一个数量级。
 * 失败返回 null，调用方可以退回逐条翻译。
 */
export async function translateAzureBatch(
  texts: string[],
  opts: TranslateOptions = {},
): Promise<(string | null)[]> {
  const key = (opts.azureKey ?? '').trim()
  const f = opts.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const out: (string | null)[] = new Array(texts.length).fill(null)
  if (!key || texts.length === 0) return out
  const target = opts.target ?? DEFAULT_TARGET
  const timed = withTimeout(f, opts.timeout ?? 15_000)
  const region = (opts.azureRegion ?? '').trim()
  const BATCH = 25

  for (let start = 0; start < texts.length; start += BATCH) {
    const slice = texts.slice(start, start + BATCH)
    try {
      const res = await timed(
        `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${encodeURIComponent(target)}`,
        {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': key,
            ...(region ? { 'Ocp-Apim-Subscription-Region': region } : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(slice.map((Text) => ({ Text }))),
        },
      )
      if (!res.ok) continue
      const body = (await res.json()) as { translations?: { text?: string }[] }[]
      if (!Array.isArray(body) || body.length !== slice.length) continue
      body.forEach((item, i) => {
        const text = item.translations?.[0]?.text
        if (text) out[start + i] = unescapeHtml(text)
      })
    } catch {
      /* 这一批失败，留 null 让调用方兜底 */
    }
  }
  return out
}
