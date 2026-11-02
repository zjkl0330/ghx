import type { KV } from './storage'
import type { TokenKind, TokenRecord } from './types'

const VAULT_KEY = 'ghx.vault.v1'
const PBKDF2_ITERATIONS = 210_000
const SALT_BYTES = 16
const IV_BYTES = 12
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

interface VaultFile {
  v: 1
  salt: string
  check: CipherBlob
  records: TokenRecord[]
  secrets: Record<string, CipherBlob>
}

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
 * 令牌本体 AES-GCM 加密，密钥由口令经 PBKDF2 派生，不落盘。
 */
export class Vault {
  private key: CryptoKey | null = null
  private file: VaultFile | null = null

  constructor(
    private readonly kv: KV,
    private readonly cryptoImpl: Crypto = globalThis.crypto,
  ) {}

  get locked(): boolean {
    return this.key === null
  }

  async exists(): Promise<boolean> {
    return (await this.kv.get(VAULT_KEY)) !== null
  }

  /** 首次创建：写入空保险库并用口令做一次可解性校验。 */
  async create(passphrase: string): Promise<void> {
    if (await this.exists()) throw new Error('保险库已存在')
    const salt = this.cryptoImpl.getRandomValues(new Uint8Array(SALT_BYTES))
    const key = await this.derive(passphrase, salt)
    const check = await this.encrypt(key, CHECK_PLAINTEXT)
    const file: VaultFile = { v: 1, salt: toB64(salt), check, records: [], secrets: {} }
    await this.persist(file)
    this.key = key
    this.file = file
  }

  async unlock(passphrase: string): Promise<void> {
    const file = await this.load()
    if (!file) throw new Error('保险库不存在')
    const salt = fromB64(file.salt)
    const key = await this.derive(passphrase, salt)
    let probe: string
    try {
      probe = await this.decrypt(key, file.check)
    } catch {
      throw new VaultAuthError()
    }
    if (probe !== CHECK_PLAINTEXT) throw new VaultAuthError()
    this.key = key
    this.file = file
  }

  lock(): void {
    this.key = null
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
    expiresAt?: string | null
    baseUrl?: string
  }): Promise<TokenRecord> {
    const key = this.requireKey()
    const file = this.requireFile()
    const secret = input.secret.trim()
    if (!looksLikeToken(secret)) throw new Error('令牌格式不正确')

    const record: TokenRecord = {
      id: this.cryptoImpl.randomUUID(),
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
    }

    file.records.push(record)
    file.secrets[record.id] = await this.encrypt(key, secret)
    await this.persist(file)
    return record
  }

  async remove(id: string): Promise<void> {
    const file = this.requireFile()
    file.records = file.records.filter((r) => r.id !== id)
    delete file.secrets[id]
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

  private requireFile(): VaultFile {
    if (!this.file) throw new VaultLockedError()
    return this.file
  }

  private async load(): Promise<VaultFile | null> {
    const raw = await this.kv.get(VAULT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as VaultFile
    if (parsed.v !== 1) throw new Error(`不支持的保险库版本: ${String(parsed.v)}`)
    return parsed
  }

  private async persist(file: VaultFile): Promise<void> {
    await this.kv.set(VAULT_KEY, JSON.stringify(file))
    this.file = file
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
