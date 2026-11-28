/**
 * 备份与恢复。
 *
 * 对标篡改猴那种「导出一份带日期的备份文件，换机再导回来」：
 * 设置、账号、置顶仓库都带走，令牌可选择性带走（带走时必须用导出密码加密）。
 *
 * 三条硬规矩：
 *
 * 1. **文件名要认得出**：`ghx-backup-zjkl0330-20261128-1830.json` —— 谁的、什么时候的，
 *    在云盘里排一排也能分清。登录名没探测出来时退回账号名，再退回 `account`。
 * 2. **设置走白名单**：只带明确列出来的键。新版本加了敏感键（设备密钥、审计日志、
 *    翻译缓存、热门快照），老备份逻辑不会顺手把它们写进云端。
 * 3. **密钥整块加密**：明文令牌绝不落盘成文件。用导出密码 PBKDF2 派生的 AES-256-GCM
 *    密钥加密，密码错了 GCM 校验直接失败，不会「解出一半乱码」。
 *
 * 解析一律容错：外部文件可能被手改、被旧版本写出、被别的 App 覆盖过。
 * 拿到坏字段宁可丢那一条，也不要抛异常把恢复流程卡死 —— 但整体结构不对要明确报错，
 * 否则用户会以为「导入成功」却什么都没发生。
 */

import type { KV } from './storage'
import type { TokenKind } from './types'

export const BACKUP_APP = 'ghx'
export const BACKUP_KIND = 'backup'
export const BACKUP_VERSION = 1

/** 文件大小上限。正常备份几十 KB，2 MB 已经很夸张，超过基本是选错文件 */
export const BACKUP_MAX_BYTES = 2 * 1024 * 1024
/** 带密钥时导出密码的下限。比启动口令松一档：它只在两台设备之间用一次 */
export const BACKUP_PASS_MIN = 8

const PBKDF2_ITERATIONS = 210_000
const SALT_BYTES = 16
const IV_BYTES = 12
const MAGIC = 'ghx-backup-v1'

/**
 * 可以随备份走的设置项。
 *
 * 白名单是有意的：`ghx.vault.v1` / `ghx.device.v1` 是密文与钥匙，带出去等于把
 * 保险库搬到云上；`ghx.audit.v1` / `ghx.dl.history` 是本机行为记录；
 * `ghx.hot.*` / `ghx.ws.*` 里是仓库名与页面现场；`ghx.tr.v1.*` 是翻译缓存。
 * 这些都不属于「配置」，一律不带。
 */
export const BACKUP_SETTING_KEYS: readonly string[] = [
  'ghx.theme',
  'ghx.appearance',
  'ghx.font',
  'ghx.tabs',
  'ghx.sort',
  'ghx.readme.auto',
  'ghx.readme.channel',
  'ghx.tr.scope',
  'ghx.tr.target',
  'ghx.download.mode',
  'ghx.download.parts',
  'ghx.update.mode',
  'ghx.mirror',
  'ghx.mirror.auto',
  'ghx.mirror.store',
  'ghx.mirror.speed',
  'ghx.clip.open',
  'ghx.fullscreen',
  'ghx.codeview',
  'ghx.acct.pref',
]

const SETTING_SET = new Set(BACKUP_SETTING_KEYS)

export class BackupPassError extends Error {
  constructor() {
    super('导出密码不正确')
    this.name = 'BackupPassError'
  }
}

export interface BackupAccount {
  /**
   * 本机账号 id。只作为「密钥块里这一条属于谁」的索引 ——
   * 恢复时会重新生成 id，两台设备的记录不会互相覆盖。
   */
  id?: string
  name: string
  login: string | null
  preview: string
  kind: TokenKind
  scopes: string[]
  expiresAt: string | null
  baseUrl: string
  avatarUrl?: string | null
  /** 该账号名下的置顶仓库（`owner/name`），恢复时按新账号 id 写回 */
  pins?: string[]
}

/** 加密后的密钥区。放在文件里就是一段 Base64，看不出条数与内容 */
export interface SealedSecrets {
  v: 1
  alg: 'AES-256-GCM'
  iter: number
  salt: string
  iv: string
  ct: string
}

export interface BackupFile {
  app: typeof BACKUP_APP
  kind: typeof BACKUP_KIND
  v: typeof BACKUP_VERSION
  exportedAt: string
  appVersion: string
  /** 导出时正在使用的账号，仅用于文件名与列表展示 */
  account: { login: string | null; name: string | null }
  settings: Record<string, string>
  accounts: BackupAccount[]
  /** 只有勾了「连同密钥」才有 */
  sealed?: SealedSecrets
  counts: { accounts: number; settings: number; secrets: number }
}

export interface BackupSummary {
  exportedAt: string
  appVersion: string
  login: string | null
  accounts: number
  settings: number
  secrets: number
  /** 账号列表，恢复确认页直接列出来 */
  labels: string[]
}

/* ────────────────────────── 文件名 ────────────────────────── */

/** 只留小写字母、数字、短横线；登录名理论上够干净，但账号名可能带空格与中文 */
function namePart(s: string | null | undefined): string {
  const t = (s ?? '').trim().toLowerCase()
  const clean = t.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24)
  return clean || 'account'
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 本地时间戳 `20261128-1830`：用户对着手机相册/云盘时间线能对上 */
export function stampOf(at: Date): string {
  return (
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}`
  )
}

/**
 * 导出文件名。三段：来源、账号、时间。
 * 例：`ghx-backup-zjkl0330-20261128-1830.json`
 */
export function backupFileName(
  who: { login?: string | null; name?: string | null },
  at: Date = new Date(),
): string {
  return `ghx-backup-${namePart(who.login || who.name)}-${stampOf(at)}.json`
}

/** 恢复前先看扩展名：用户可能选了个 APK 或图片，早点拦下来 */
export function looksLikeBackupName(name: string): boolean {
  return /\.(json|ghxbak|txt)$/i.test(name.trim())
}

/* ────────────────────────── Base64 ────────────────────────── */

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(s: string): Uint8Array {
  const raw = atob(s)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out
}

/* ────────────────────────── 密钥加密 ────────────────────────── */

export interface BackupSecretEntry {
  secret: string
  secondary?: string | null
}

async function deriveKey(passphrase: string, salt: Uint8Array, cryptoImpl: Crypto): Promise<CryptoKey> {
  const base = await cryptoImpl.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return cryptoImpl.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * 把「账号 id → 主/副密钥」整块封起来。
 *
 * 加密的是明文 JSON，GCM 自带完整性校验：密码错、文件被改，解出来必然失败。
 * 前缀 magic 再确认一次，避免「用另一个 App 的同格式文件」解出一坨能 JSON.parse 的东西。
 */
export async function sealSecrets(
  passphrase: string,
  secrets: Record<string, BackupSecretEntry>,
  cryptoImpl: Crypto = globalThis.crypto,
): Promise<SealedSecrets> {
  if (passphrase.length < BACKUP_PASS_MIN) {
    throw new Error(`导出密码至少 ${BACKUP_PASS_MIN} 位`)
  }
  const salt = cryptoImpl.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = cryptoImpl.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt, cryptoImpl)
  const payload = JSON.stringify({ magic: MAGIC, secrets })
  const ct = await cryptoImpl.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(payload),
  )
  return {
    v: 1,
    alg: 'AES-256-GCM',
    iter: PBKDF2_ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ct)),
  }
}

/** 解封。密码错抛 BackupPassError，格式坏也按密码错处理（对用户是同一件事） */
export async function openSecrets(
  passphrase: string,
  box: SealedSecrets,
  cryptoImpl: Crypto = globalThis.crypto,
): Promise<Record<string, BackupSecretEntry>> {
  let plain: string
  try {
    const key = await deriveKey(passphrase, fromB64(box.salt), cryptoImpl)
    const buf = await cryptoImpl.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(box.iv) as unknown as BufferSource },
      key,
      fromB64(box.ct) as unknown as BufferSource,
    )
    plain = new TextDecoder().decode(buf)
  } catch {
    throw new BackupPassError()
  }
  let parsed: { magic?: unknown; secrets?: unknown }
  try {
    parsed = JSON.parse(plain) as typeof parsed
  } catch {
    throw new BackupPassError()
  }
  if (parsed.magic !== MAGIC || !parsed.secrets || typeof parsed.secrets !== 'object') {
    throw new BackupPassError()
  }
  const out: Record<string, BackupSecretEntry> = {}
  for (const [id, raw] of Object.entries(parsed.secrets as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as { secret?: unknown; secondary?: unknown }
    if (typeof e.secret !== 'string' || !e.secret) continue
    out[id] = {
      secret: e.secret,
      secondary: typeof e.secondary === 'string' && e.secondary ? e.secondary : null,
    }
  }
  return out
}

/* ────────────────────────── 组装 ────────────────────────── */

/** 白名单过滤 + 只留字符串值。KV 里可能存着旧版本留下的怪东西 */
export function pickSettings(entries: Iterable<[string, string | null]>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of entries) {
    if (typeof value !== 'string') continue
    if (!SETTING_SET.has(key)) continue
    // 单条设置再大也有个上限，别让一条异常值把整份备份撑爆
    if (value.length > 16_384) continue
    out[key] = value
  }
  return out
}

export function buildBackup(input: {
  appVersion: string
  account: { login: string | null; name: string | null }
  settings: Record<string, string>
  accounts: BackupAccount[]
  sealed?: SealedSecrets | null
  at?: Date
}): BackupFile {
  const at = input.at ?? new Date()
  const settings = pickSettings(Object.entries(input.settings))
  const accounts = input.accounts.map((a) => ({
    ...a,
    name: a.name || '未命名令牌',
    login: a.login ?? null,
    scopes: a.scopes.slice(0, 40),
    pins: (a.pins ?? []).slice(0, 200),
  }))
  const file: BackupFile = {
    app: BACKUP_APP,
    kind: BACKUP_KIND,
    v: BACKUP_VERSION,
    exportedAt: at.toISOString(),
    appVersion: input.appVersion,
    account: input.account,
    settings,
    accounts,
    counts: {
      accounts: accounts.length,
      settings: Object.keys(settings).length,
      secrets: input.sealed ? accounts.length : 0,
    },
  }
  if (input.sealed) file.sealed = input.sealed
  return file
}

/* ────────────────────────── 解析 ────────────────────────── */

function asString(v: unknown, max = 400): string | null {
  return typeof v === 'string' ? v.slice(0, max) : null
}

function asStringArray(v: unknown, max = 40): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.length <= 200).slice(0, max)
}

function kindOfUnknown(v: unknown): TokenKind {
  return v === 'fine-grained' ? 'fine-grained' : 'classic'
}

/** 单条账号的容错解析：缺字段就补默认值，名字都没有就丢掉这一条 */
function parseAccount(v: unknown): BackupAccount | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const name = asString(o.name, 80)?.trim()
  const preview = asString(o.preview, 120)
  if (!name && !preview) return null
  return {
    id: asString(o.id, 64) ?? undefined,
    name: name || '未命名令牌',
    login: asString(o.login, 80),
    preview: preview ?? '—',
    kind: kindOfUnknown(o.kind),
    scopes: asStringArray(o.scopes),
    expiresAt: asString(o.expiresAt, 40),
    baseUrl: asString(o.baseUrl, 200) || 'https://api.github.com',
    avatarUrl: asString(o.avatarUrl, 400),
    pins: asStringArray(o.pins, 200),
  }
}

function parseSealed(v: unknown): SealedSecrets | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (o.alg !== 'AES-256-GCM') return null
  const salt = asString(o.salt, 200)
  const iv = asString(o.iv, 200)
  // Base64 膨胀约 1.37 倍，字符上限给到 8M 足够容纳 2MB 明文
  const ct = asString(o.ct, 8_000_000)
  if (!salt || !iv || !ct) return null
  const iter = typeof o.iter === 'number' && o.iter >= 1000 ? Math.floor(o.iter) : PBKDF2_ITERATIONS
  return { v: 1, alg: 'AES-256-GCM', iter, salt, iv, ct }
}

export type ParseResult =
  | { ok: true; file: BackupFile; summary: BackupSummary }
  | { ok: false; error: string }

/**
 * 解析备份文本。
 *
 * 宁可多校验一层：这里拿到的东西来自文件系统，可能是别的 App 存的文件、
 * 也可能是被编辑过的半截 JSON。结构不对就明说，不要「恢复成功 0 项」。
 */
export function parseBackup(raw: string): ParseResult {
  const text = (raw ?? '').trim()
  if (!text) return { ok: false, error: '文件是空的' }
  if (text.length > BACKUP_MAX_BYTES) return { ok: false, error: '文件过大，不像是本应用的备份' }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: '不是合法的 JSON，可能选错了文件' }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: '备份内容不是对象' }

  const o = parsed as Record<string, unknown>
  if (o.app !== BACKUP_APP || o.kind !== BACKUP_KIND) {
    return { ok: false, error: '不是 ghx 的备份文件' }
  }
  if (o.v !== BACKUP_VERSION) {
    return { ok: false, error: `备份版本 ${String(o.v)} 与当前应用不兼容` }
  }

  const settingsRaw = o.settings && typeof o.settings === 'object' ? o.settings : {}
  const settings = pickSettings(
    Object.entries(settingsRaw as Record<string, unknown>).map(([k, v]) => [
      k,
      typeof v === 'string' ? v : null,
    ]),
  )

  const accountsRaw = Array.isArray(o.accounts) ? o.accounts : []
  const accounts = accountsRaw
    .map(parseAccount)
    .filter((a): a is BackupAccount => a !== null)
    .slice(0, 50)

  const sealed = parseSealed(o.sealed)
  const accountRaw = o.account && typeof o.account === 'object' ? (o.account as Record<string, unknown>) : {}

  const file: BackupFile = {
    app: BACKUP_APP,
    kind: BACKUP_KIND,
    v: BACKUP_VERSION,
    exportedAt: asString(o.exportedAt, 40) ?? '',
    appVersion: asString(o.appVersion, 40) ?? '未知',
    account: {
      login: asString(accountRaw.login, 80),
      name: asString(accountRaw.name, 80),
    },
    settings,
    accounts,
    counts: {
      accounts: accounts.length,
      settings: Object.keys(settings).length,
      secrets: sealed ? accounts.length : 0,
    },
  }
  if (sealed) file.sealed = sealed

  if (accounts.length === 0 && Object.keys(settings).length === 0) {
    return { ok: false, error: '备份里既没有账号也没有设置' }
  }

  return {
    ok: true,
    file,
    summary: {
      exportedAt: file.exportedAt,
      appVersion: file.appVersion,
      login: file.account.login,
      accounts: accounts.length,
      settings: Object.keys(settings).length,
      secrets: sealed ? accounts.length : 0,
      labels: accounts.map((a) => (a.login ? `@${a.login}` : a.name)),
    },
  }
}

/** 导出前把整份内容序列化。缩进两格：用户真去翻文件时能看懂 */
export function serializeBackup(file: BackupFile): string {
  return JSON.stringify(file, null, 2)
}

/* ────────────────────────── 写入 ────────────────────────── */

/**
 * 首屏要用的偏好（主题、外观、字体、全屏）不走 KV，而是直接读 localStorage ——
 * 它们必须在第一帧之前同步拿到，异步存储会让界面先闪一帧错色。
 *
 * 后果是：原生端的 KV 是 Capacitor Preferences，而 localStorage 是另一个桶。
 * 只按 KV 读写的话，安卓上导出的备份里没有主题，恢复也改不动主题。
 * 所以这里**两边都写、两边都读**：谁的界面读哪儿，就都能拿到对的值。
 */
function localStore(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    // 隐私模式 / 存储被禁用时访问 localStorage 本身就会抛
    return null
  }
}

/** 读一个键：同步存储优先（那是界面真正在用的那份），没有再问 KV */
async function readOne(kv: KV | null, key: string): Promise<string | null> {
  const local = localStore()?.getItem(key) ?? null
  if (local !== null) return local
  if (!kv) return null
  try {
    return await kv.get(key)
  } catch {
    return null
  }
}

async function writeOne(kv: KV | null, key: string, value: string): Promise<void> {
  try {
    localStore()?.setItem(key, value)
  } catch {
    /* 配额满 / 隐私模式：KV 那份仍会写 */
  }
  if (!kv) return
  try {
    await kv.set(key, value)
  } catch {
    /* Preferences 写失败不影响 localStorage 已写入的值 */
  }
}

export type RestoreMode = 'merge' | 'replace'

/**
 * 把备份里的设置写回本机。
 *
 * - `merge`：只补本机没有的，已经调过的偏好不动（换机首次恢复的默认选择）；
 * - `replace`：同名键以备份为准，备份里没有的键保持原样（不清空）。
 *
 * 两种模式都不会删键 —— 删除是不可逆的，恢复流程不该承担这个风险。
 */
export async function applySettings(
  kv: KV | null,
  settings: Record<string, string>,
  mode: RestoreMode,
): Promise<{ written: number; kept: number }> {
  if (!kv) return { written: 0, kept: 0 }
  let written = 0
  let kept = 0
  for (const [key, value] of Object.entries(settings)) {
    if (!SETTING_SET.has(key)) continue
    if (mode === 'merge' && (await readOne(kv, key)) !== null) {
      kept += 1
      continue
    }
    await writeOne(kv, key, value)
    written += 1
  }
  return { written, kept }
}

/**
 * 读本机当前值，用于导出。
 * 逐键 get，失败当没有 —— 一条读不出来不该让整次导出失败。
 */
export async function readSettings(kv: KV | null): Promise<Record<string, string>> {
  const entries: [string, string | null][] = []
  for (const key of BACKUP_SETTING_KEYS) {
    entries.push([key, await readOne(kv, key)])
  }
  return pickSettings(entries)
}

/** 恢复账号时的去重口径：同一登录名 + 同一指纹视为同一个账号 */
export function accountKey(a: { login?: string | null; preview?: string | null }): string {
  return `${(a.login ?? '').toLowerCase()}|${a.preview ?? ''}`
}

/** 备份里有、本机没有的账号 */
export function newAccounts(
  items: BackupAccount[],
  existing: { login?: string | null; preview?: string | null }[],
): BackupAccount[] {
  const seen = new Set(existing.map(accountKey))
  const out: BackupAccount[] = []
  for (const a of items) {
    const key = accountKey(a)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(a)
  }
  return out
}

/** 合并置顶：备份在前、本机在后，去重，保持稳定顺序 */
export function mergePins(local: string[], fromBackup: string[]): string[] {
  const out: string[] = []
  for (const name of [...fromBackup, ...local]) {
    if (typeof name !== 'string' || !name.includes('/')) continue
    if (!out.includes(name)) out.push(name)
  }
  return out.slice(0, 40)
}
