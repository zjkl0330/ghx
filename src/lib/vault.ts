import type { KV } from './storage'
import type { TokenKind, TokenRecord } from './types'
import { uuidV4 } from './uuid'

const VAULT_KEY = 'ghx.vault.v1'
const DEVICE_KEY = 'ghx.device.v1'
const PBKDF2_ITERATIONS = 210_000
const SALT_BYTES = 16
const IV_BYTES = 12
const DEVICE_KEY_BYTES = 32
const CHECK_PLAINTEXT = 'ghx-vault-v1'

export class VaultLockedError extends Error {
  constructor() {
    super('保险库未解锁')
    this.name = 'VaultLockedError'
  }
}

export class VaultAuthError extends Error {
  constructor() {
    super('口令不正确')
    this.name = 'VaultAuthError'
  }
}

interface CipherBlob {
  iv: string
  ct: string
}

interface VaultFileBase {
  check: CipherBlob
  records: TokenRecord[]
  /** 主密钥：必须过查看密码/启动口令才在界面上出现 */
  secrets: Record<string, CipherBlob>
  /**
   * 副密钥：同一账号的第二枚令牌，界面上直接展示。
   * 老库没有这一段，读取时补空对象 —— 加字段不改版本号，
   * 因为它是纯附加信息，旧版本 App 读到会忽略，令牌也不会坏。
   */
  secrets2: Record<string, CipherBlob>
}

/** v1：密钥由用户口令派生，每次启动必须输口令。 */
interface VaultFileV1 extends VaultFileBase {
  v: 1
  salt: string
}

/**
 * v2：密钥是本机随机生成的设备密钥，默认直接放在本地，启动自动解锁。
 * 若用户主动开启「启动验证」，设备密钥会被口令包裹（guard），
 * 此时才需要输口令 —— 加密强度不变，只是钥匙换了个保管方式。
 */
interface VaultFileV2 extends VaultFileBase {
  v: 2
  wrap: 'device'
  guard: CipherBlob | null
  guardSalt: string | null
}

type VaultFile = VaultFileV1 | VaultFileV2

export type UnlockState = 'unlocked' | 'need-passphrase' | 'no-vault'

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

/** 生成可直接给列表用的脱敏指纹，保留前缀与末 4 位。 */
export function previewOf(secret: string): string {
  const tail = secret.slice(-4)
  if (secret.startsWith('github_pat_')) return `github_pat_${'•'.repeat(8)}${tail}`
  if (secret.startsWith('ghp_')) return `ghp_${'•'.repeat(8)}${tail}`
  if (secret.startsWith('gho_')) return `gho_${'•'.repeat(8)}${tail}`
  return `${secret.slice(0, 4)}${'•'.repeat(8)}${tail}`
}

export function kindOf(secret: string): TokenKind {
  return secret.startsWith('github_pat_') ? 'fine-grained' : 'classic'
}

/** 只做本地格式校验，真实有效性必须联网确认。 */
export function looksLikeToken(secret: string): boolean {
  const t = secret.trim()
  if (t.startsWith('github_pat_')) return /^github_pat_[A-Za-z0-9_]{20,}$/.test(t)
  if (t.startsWith('ghp_') || t.startsWith('gho_') || t.startsWith('ghu_')) {
    return /^gh[pou]_[A-Za-z0-9]{20,}$/.test(t)
  }
  return /^[A-Za-z0-9_]{20,}$/.test(t)
}

/**
 * 令牌保险库。元数据（名称、scopes、过期时间）明文存，
 * 令牌本体 AES-256-GCM 加密。
 *
 * 密钥有两种来源：
 * - 设备密钥（默认）：随机生成、留在本机，启动自动解锁，用户无感；
 * - 口令（可选）：仅当用户开启「启动验证」时，才用它包裹设备密钥。
 *
 * 注意：免密模式下密文与钥匙同机存储，能防「文件被单独拷走」，
 * 防不了「拿到已解锁设备的人」。这一点在设置页如实写明。
 */
export class Vault {
  private key: CryptoKey | null = null
  private deviceKey: Uint8Array | null = null
  private file: VaultFile | null = null

  constructor(
    private readonly kv: KV,
    private readonly cryptoImpl: Crypto = globalThis.crypto,
  ) {}

  get locked(): boolean {
    return this.key === null
  }

  /** 当前保险库的布局；尚未加载时为 null。 */
  get mode(): 'device' | 'passphrase' | null {
    if (!this.file) return null
    return this.file.v === 2 ? 'device' : 'passphrase'
  }

  /** 是否开启了启动验证（仅 v2 可能有）。 */
  get guarded(): boolean {
    return this.file?.v === 2 && this.file.guard !== null
  }

  async exists(): Promise<boolean> {
    return (await this.kv.get(VAULT_KEY)) !== null
  }

  /** 旧接口：创建口令加密的 v1 保险库，保留用于兼容与测试。 */
  async create(passphrase: string): Promise<void> {
    if (await this.exists()) throw new Error('保险库已存在')
    const salt = this.cryptoImpl.getRandomValues(new Uint8Array(SALT_BYTES))
    const key = await this.derive(passphrase, salt)
    const check = await this.encrypt(key, CHECK_PLAINTEXT)
    const file: VaultFileV1 = { v: 1, salt: toB64(salt), check, records: [], secrets: {}, secrets2: {} }
    await this.persist(file)
    this.key = key
    this.deviceKey = null
  }

  /** 创建默认的免密保险库：密钥随机生成，启动即解，不打扰用户。 */
  async createDevice(): Promise<void> {
    if (await this.exists()) throw new Error('保险库已存在')
    const raw = this.cryptoImpl.getRandomValues(new Uint8Array(DEVICE_KEY_BYTES))
    const key = await this.importKey(raw)
    const file: VaultFileV2 = {
      v: 2,
      wrap: 'device',
      guard: null,
      guardSalt: null,
      check: await this.encrypt(key, CHECK_PLAINTEXT),
      records: [],
      secrets: {},
      secrets2: {},
    }
    await this.kv.set(DEVICE_KEY, toB64(raw))
    await this.persist(file)
    this.key = key
    this.deviceKey = raw
  }

  /**
   * 启动时调用：不需要用户输入就直接解锁。
   * 只有「老的口令库」或「用户开了启动验证」才返回 need-passphrase。
   */
  async autoUnlock(): Promise<UnlockState> {
    const file = await this.load()
    if (!file) return 'no-vault'
    if (file.v === 1 || file.guard) {
      // 先挂上文件，好让界面知道当前是「老口令库」还是「开了启动验证」
      this.file = file
      return 'need-passphrase'
    }

    const raw = await this.readDeviceKey()
    const key = await this.importKey(raw)
    if (!(await this.checkKey(key, file.check))) {
      throw new Error('设备密钥与本机保险库不匹配')
    }
    this.key = key
    this.deviceKey = raw
    this.file = file
    return 'unlocked'
  }

  async unlock(passphrase: string): Promise<void> {
    const file = await this.load()
    if (!file) throw new Error('保险库不存在')

    if (file.v === 1) {
      const key = await this.derive(passphrase, fromB64(file.salt))
      if (!(await this.checkKey(key, file.check))) throw new VaultAuthError()
      this.key = key
      this.deviceKey = null
      this.file = file
      return
    }

    if (!file.guard || !file.guardSalt) {
      // 没开启动验证，口令无意义，走自动解锁
      const state = await this.autoUnlock()
      if (state !== 'unlocked') throw new VaultAuthError()
      return
    }

    const raw = await this.openGuard(passphrase, file)
    const key = await this.importKey(raw)
    if (!(await this.checkKey(key, file.check))) throw new VaultAuthError()
    this.key = key
    this.deviceKey = raw
    this.file = file
  }

  /**
   * 只验口令，不改解锁状态。
   *
   * 用途：保险库已经解锁着，但要看主密钥时再确认一次「站在手机前的人知道口令」。
   * 与 unlock() 的区别是它不会把 key 换掉，也不会因为失败就把库锁死。
   */
  async verifyPassphrase(passphrase: string): Promise<boolean> {
    const file = await this.load()
    if (!file) throw new Error('保险库不存在')
    if (file.v === 1) {
      const key = await this.derive(passphrase, fromB64(file.salt))
      return this.checkKey(key, file.check)
    }
    if (!file.guard || !file.guardSalt) return false
    try {
      await this.openGuard(passphrase, file)
      return true
    } catch {
      return false
    }
  }

  /** 开启启动验证：用口令把设备密钥包起来。 */
  async setGuard(passphrase: string): Promise<void> {
    if (passphrase.length < 8) throw new Error('口令至少 8 位')
    const file = this.requireDeviceFile()
    if (file.guard) throw new Error('启动验证已开启')
    const raw = this.requireDeviceKey()
    const salt = this.cryptoImpl.getRandomValues(new Uint8Array(SALT_BYTES))
    const wrapKey = await this.derive(passphrase, salt)
    file.guard = await this.encrypt(wrapKey, toB64(raw))
    file.guardSalt = toB64(salt)
    await this.persist(file)
  }

  /** 关闭启动验证：校验当前口令后，把设备密钥重新放回本地。 */
  async clearGuard(passphrase: string): Promise<void> {
    const file = this.requireDeviceFile()
    if (!file.guard) return
    await this.openGuard(passphrase, file)
    file.guard = null
    file.guardSalt = null
    await this.persist(file)
  }

  async changeGuard(current: string, next: string): Promise<void> {
    if (next.length < 8) throw new Error('口令至少 8 位')
    const file = this.requireDeviceFile()
    if (!file.guard) throw new Error('尚未开启启动验证')
    const raw = await this.openGuard(current, file)
    const salt = this.cryptoImpl.getRandomValues(new Uint8Array(SALT_BYTES))
    const wrapKey = await this.derive(next, salt)
    file.guard = await this.encrypt(wrapKey, toB64(raw))
    file.guardSalt = toB64(salt)
    await this.persist(file)
  }

  /**
   * 把 v1 口令库迁移成免密库：解密全部令牌后用设备密钥重新加密。
   * 迁移后开机不再需要口令，但用户可随时重新开启启动验证。
   */
  async migrateToDevice(passphrase: string): Promise<void> {
    await this.unlock(passphrase)
    const file = this.file
    if (!file || file.v !== 1) return
    const oldKey = this.requireKey()
    const raw = this.cryptoImpl.getRandomValues(new Uint8Array(DEVICE_KEY_BYTES))
    const key = await this.importKey(raw)

    const secrets: Record<string, CipherBlob> = {}
    for (const [id, blob] of Object.entries(file.secrets)) {
      secrets[id] = await this.encrypt(key, await this.decrypt(oldKey, blob))
    }
    const secrets2: Record<string, CipherBlob> = {}
    for (const [id, blob] of Object.entries(file.secrets2 ?? {})) {
      secrets2[id] = await this.encrypt(key, await this.decrypt(oldKey, blob))
    }

    const next: VaultFileV2 = {
      v: 2,
      wrap: 'device',
      guard: null,
      guardSalt: null,
      check: await this.encrypt(key, CHECK_PLAINTEXT),
      records: file.records,
      secrets,
      secrets2,
    }
    await this.kv.set(DEVICE_KEY, toB64(raw))
    await this.persist(next)
    this.key = key
    this.deviceKey = raw
  }

  lock(): void {
    this.key = null
    this.deviceKey = null
    this.file = null
  }

  async list(): Promise<TokenRecord[]> {
    const file = await this.load()
    this.file = file
    return file ? [...file.records] : []
  }

  async add(input: {
    name: string
    secret: string
    /** 可选副密钥：同一账号的第二枚令牌，界面上可直接查看 */
    secondary?: string | null
    expiresAt?: string | null
    baseUrl?: string
  }): Promise<TokenRecord> {
    const key = this.requireKey()
    const file = this.requireFile()
    const secret = input.secret.trim()
    if (!looksLikeToken(secret)) throw new Error('令牌格式不正确')
    const secondary = (input.secondary ?? '').trim()
    if (secondary && !looksLikeToken(secondary)) throw new Error('副密钥格式不正确')

    const record: TokenRecord = {
      id: uuidV4(this.cryptoImpl),
      name: input.name.trim() || '未命名令牌',
      kind: kindOf(secret),
      preview: previewOf(secret),
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt ?? null,
      scopes: [],
      login: null,
      lastCheckedAt: null,
      lastStatus: 'unknown',
      baseUrl: input.baseUrl ?? 'https://api.github.com',
      hasSecondary: !!secondary,
      secondaryPreview: secondary ? previewOf(secondary) : null,
    }

    file.records.push(record)
    file.secrets[record.id] = await this.encrypt(key, secret)
    if (secondary) file.secrets2[record.id] = await this.encrypt(key, secondary)
    await this.persist(file)
    return record
  }

  /**
   * 设置 / 替换 / 清除副密钥。
   * 传 null 表示清除 —— 主密钥不受影响，账号照常能用。
   */
  async setSecondary(id: string, secret: string | null): Promise<TokenRecord> {
    const key = this.requireKey()
    const file = this.requireFile()
    const idx = file.records.findIndex((r) => r.id === id)
    if (idx < 0) throw new Error('令牌不存在')
    const next = (secret ?? '').trim()
    if (next && !looksLikeToken(next)) throw new Error('副密钥格式不正确')

    if (next) {
      file.secrets2[id] = await this.encrypt(key, next)
      file.records[idx] = {
        ...file.records[idx],
        hasSecondary: true,
        secondaryPreview: previewOf(next),
      }
    } else {
      delete file.secrets2[id]
      file.records[idx] = { ...file.records[idx], hasSecondary: false, secondaryPreview: null }
    }
    await this.persist(file)
    return file.records[idx]
  }

  /** 副密钥明文；没配过返回 null */
  async secondarySecret(id: string): Promise<string | null> {
    const key = this.requireKey()
    const file = this.requireFile()
    const blob = file.secrets2[id]
    if (!blob) return null
    return this.decrypt(key, blob)
  }

  /**
   * 导出备份用：把所有账号的主/副密钥一次性解出来。
   * 调用方拿到后应当立刻加密进备份文件并丢弃，别存进 React 状态。
   */
  async allSecrets(): Promise<Record<string, { secret: string; secondary: string | null }>> {
    const key = this.requireKey()
    const file = this.requireFile()
    const out: Record<string, { secret: string; secondary: string | null }> = {}
    for (const rec of file.records) {
      const blob = file.secrets[rec.id]
      if (!blob) continue
      const sec2 = file.secrets2[rec.id]
      out[rec.id] = {
        secret: await this.decrypt(key, blob),
        secondary: sec2 ? await this.decrypt(key, sec2) : null,
      }
    }
    return out
  }

  /**
   * 恢复备份里的一个账号。
   *
   * 不复用 add()：备份里带着登录名、scopes、头像这些探测结果，
   * 恢复后不该再让用户等一次联网校验。id 一律重新生成 ——
   * 两台设备撞上同一个 id 的概率极低，但撞上了就会互相覆盖。
   */
  async restore(input: {
    name: string
    secret: string
    secondary?: string | null
    login?: string | null
    avatarUrl?: string | null
    scopes?: string[]
    expiresAt?: string | null
    baseUrl?: string
  }): Promise<TokenRecord> {
    const key = this.requireKey()
    const file = this.requireFile()
    const secret = input.secret.trim()
    if (!looksLikeToken(secret)) throw new Error('备份里的令牌格式不正确')
    const secondary = (input.secondary ?? '').trim()
    if (secondary && !looksLikeToken(secondary)) throw new Error('备份里的副密钥格式不正确')

    const record: TokenRecord = {
      id: uuidV4(this.cryptoImpl),
      name: (input.name || '').trim() || '恢复的令牌',
      kind: kindOf(secret),
      preview: previewOf(secret),
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt ?? null,
      scopes: input.scopes ?? [],
      login: input.login ?? null,
      avatarUrl: input.avatarUrl ?? null,
      lastCheckedAt: null,
      lastStatus: input.login ? 'ok' : 'unknown',
      baseUrl: input.baseUrl || 'https://api.github.com',
      hasSecondary: !!secondary,
      secondaryPreview: secondary ? previewOf(secondary) : null,
    }
    file.records.push(record)
    file.secrets[record.id] = await this.encrypt(key, secret)
    if (secondary) file.secrets2[record.id] = await this.encrypt(key, secondary)
    await this.persist(file)
    return record
  }

  async remove(id: string): Promise<void> {
    const file = this.requireFile()
    file.records = file.records.filter((r) => r.id !== id)
    delete file.secrets[id]
    delete file.secrets2[id]
    await this.persist(file)
  }

  async update(id: string, patch: Partial<Omit<TokenRecord, 'id'>>): Promise<TokenRecord> {
    const file = this.requireFile()
    const idx = file.records.findIndex((r) => r.id === id)
    if (idx < 0) throw new Error('令牌不存在')
    file.records[idx] = { ...file.records[idx], ...patch }
    await this.persist(file)
    return file.records[idx]
  }

  /** 取出明文令牌。仅在解锁状态下可用，调用方用后应立即丢弃引用。 */
  async secret(id: string): Promise<string> {
    const key = this.requireKey()
    const file = this.requireFile()
    const blob = file.secrets[id]
    if (!blob) throw new Error('令牌不存在')
    return this.decrypt(key, blob)
  }

  private requireKey(): CryptoKey {
    if (!this.key) throw new VaultLockedError()
    return this.key
  }

  private requireDeviceKey(): Uint8Array {
    if (!this.deviceKey) throw new VaultLockedError()
    return this.deviceKey
  }

  private requireFile(): VaultFile {
    if (!this.file) throw new VaultLockedError()
    return this.file
  }

  private requireDeviceFile(): VaultFileV2 {
    const file = this.requireFile()
    if (file.v !== 2) throw new Error('当前保险库仍是口令模式，请先迁移')
    return file
  }

  private async readDeviceKey(): Promise<Uint8Array> {
    const raw = await this.kv.get(DEVICE_KEY)
    if (!raw) throw new Error('本机设备密钥缺失，无法自动解锁')
    return fromB64(raw)
  }

  /** 用口令解开被包裹的设备密钥，口令错时抛 VaultAuthError。 */
  private async openGuard(passphrase: string, file: VaultFileV2): Promise<Uint8Array> {
    if (!file.guard || !file.guardSalt) throw new VaultAuthError()
    const wrapKey = await this.derive(passphrase, fromB64(file.guardSalt))
    let plain: string
    try {
      plain = await this.decrypt(wrapKey, file.guard)
    } catch {
      throw new VaultAuthError()
    }
    return fromB64(plain)
  }

  private async checkKey(key: CryptoKey, blob: CipherBlob): Promise<boolean> {
    try {
      return (await this.decrypt(key, blob)) === CHECK_PLAINTEXT
    } catch {
      return false
    }
  }

  private async load(): Promise<VaultFile | null> {
    const raw = await this.kv.get(VAULT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as VaultFile
    const version = (parsed as { v?: number }).v
    if (version !== 1 && version !== 2) throw new Error(`不支持的保险库版本: ${String(version)}`)
    // 老库（v1.2.x 及以前）没有副密钥区：补个空对象，后面所有读写都不用再判空
    if (!parsed.secrets2 || typeof parsed.secrets2 !== 'object') parsed.secrets2 = {}
    return parsed
  }

  private async persist(file: VaultFile): Promise<void> {
    await this.kv.set(VAULT_KEY, JSON.stringify(file))
    this.file = file
  }

  private async importKey(raw: Uint8Array): Promise<CryptoKey> {
    return this.cryptoImpl.subtle.importKey(
      'raw',
      raw as unknown as BufferSource,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    )
  }

  private async derive(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const base = await this.cryptoImpl.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey'],
    )
    return this.cryptoImpl.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  }

  private async encrypt(key: CryptoKey, plain: string): Promise<CipherBlob> {
    const iv = this.cryptoImpl.getRandomValues(new Uint8Array(IV_BYTES))
    const ct = await this.cryptoImpl.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      new TextEncoder().encode(plain),
    )
    return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) }
  }

  private async decrypt(key: CryptoKey, blob: CipherBlob): Promise<string> {
    const iv = fromB64(blob.iv)
    const ct = fromB64(blob.ct)
    const plain = await this.cryptoImpl.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      ct as unknown as BufferSource,
    )
    return new TextDecoder().decode(plain)
  }
}
