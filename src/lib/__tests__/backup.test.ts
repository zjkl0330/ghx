import { afterEach, describe, expect, it } from 'vitest'
import {
  accountKey,
  applySettings,
  backupFileName,
  buildBackup,
  BackupPassError,
  looksLikeBackupName,
  mergePins,
  newAccounts,
  openSecrets,
  parseBackup,
  pickSettings,
  readSettings,
  sealSecrets,
  serializeBackup,
  stampOf,
  type BackupAccount,
} from '../backup'
import { memoryKV } from '../storage'

const SECRET = 'ghp_' + 'c'.repeat(36)
const SECRET2 = 'ghp_' + 'd'.repeat(36)
const PASS = 'backup-pass-1'

function account(patch: Partial<BackupAccount> = {}): BackupAccount {
  return {
    name: '主力令牌',
    login: 'zjkl0330',
    preview: 'ghp_••••••••c3c3',
    kind: 'classic',
    scopes: ['repo', 'read:user'],
    expiresAt: null,
    baseUrl: 'https://api.github.com',
    pins: ['microsoft/vscode'],
    ...patch,
  }
}

describe('备份文件名', () => {
  it('带登录名与本地时间，云盘里能一眼分清', () => {
    const at = new Date(2026, 10, 28, 18, 30)
    expect(backupFileName({ login: 'zjkl0330' }, at)).toBe('ghx-backup-zjkl0330-20261128-1830.json')
    expect(stampOf(at)).toBe('20261128-1830')
  })

  it('登录名缺失时退回账号名，再退回 account', () => {
    const at = new Date(2026, 0, 2, 9, 5)
    expect(backupFileName({ login: null, name: '小号 B' }, at)).toBe('ghx-backup-b-20260102-0905.json')
    expect(backupFileName({}, at)).toBe('ghx-backup-account-20260102-0905.json')
  })

  it('账号名里的空格与中文不会把文件名搞坏', () => {
    const at = new Date(2026, 0, 2, 9, 5)
    const name = backupFileName({ name: '工作 账号/主力' }, at)
    expect(name).toMatch(/^ghx-backup-[a-z0-9_-]+-20260102-0905\.json$/)
    expect(name).not.toContain('/')
  })

  it('认得出备份扩展名，选到 APK 时能提前拦下', () => {
    expect(looksLikeBackupName('ghx-backup-x-20260101-0000.json')).toBe(true)
    expect(looksLikeBackupName('ghx.ghxbak')).toBe(true)
    expect(looksLikeBackupName('app-debug.apk')).toBe(false)
  })
})

describe('设置白名单', () => {
  it('只带配置项，设备密钥与密文一律不带', () => {
    const picked = pickSettings([
      ['ghx.theme', 'dark'],
      ['ghx.vault.v1', '{"v":2}'],
      ['ghx.device.v1', 'AAAA'],
      ['ghx.audit.v1', '[]'],
      ['ghx.hot.v1.t1.week.*', '{}'],
      ['ghx.ws.t1', '{}'],
      ['ghx.tr.v1.abc', '{}'],
    ])
    expect(picked).toEqual({ 'ghx.theme': 'dark' })
  })

  it('超长取值与空值直接跳过，不写进备份', () => {
    const picked = pickSettings([
      ['ghx.theme', 'light'],
      ['ghx.mirror.store', 'x'.repeat(20_000)],
      ['ghx.tabs', null],
    ])
    expect(picked).toEqual({ 'ghx.theme': 'light' })
  })
})

describe('密钥加解密', () => {
  it('封起来的内容不含明文令牌，能原样解回', async () => {
    const box = await sealSecrets(PASS, {
      a: { secret: SECRET, secondary: SECRET2 },
      b: { secret: SECRET },
    })
    expect(box.ct).not.toContain(SECRET)
    expect(box.ct).not.toContain('secondary')
    const back = await openSecrets(PASS, box)
    expect(back.a).toEqual({ secret: SECRET, secondary: SECRET2 })
    expect(back.b).toEqual({ secret: SECRET, secondary: null })
  })

  it('密码错时明确报错，不会解出半截', async () => {
    const box = await sealSecrets(PASS, { a: { secret: SECRET } })
    await expect(openSecrets('wrong-pass', box)).rejects.toBeInstanceOf(BackupPassError)
  })

  it('密码不足 8 位拒绝导出', async () => {
    await expect(sealSecrets('short', {})).rejects.toThrow('至少')
  })

  it('密文被改一个字符就解不开', async () => {
    const box = await sealSecrets(PASS, { a: { secret: SECRET } })
    const ct = box.ct
    const tampered = { ...box, ct: ct.slice(0, -2) + (ct.endsWith('A') ? 'BB' : 'AA') }
    await expect(openSecrets(PASS, tampered)).rejects.toBeInstanceOf(BackupPassError)
  })
})

describe('组装与解析', () => {
  it('往返一致：账号、设置、计数都对得上', () => {
    const file = buildBackup({
      appVersion: '1.3.0',
      account: { login: 'zjkl0330', name: '主力令牌' },
      settings: { 'ghx.theme': 'dark', 'ghx.vault.v1': 'should-drop' },
      accounts: [account()],
      at: new Date('2026-11-28T10:30:00.000Z'),
    })
    expect(file.counts).toEqual({ accounts: 1, settings: 1, secrets: 0 })
    expect(file.settings).toEqual({ 'ghx.theme': 'dark' })

    const parsed = parseBackup(serializeBackup(file))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.summary.accounts).toBe(1)
    expect(parsed.summary.labels).toEqual(['@zjkl0330'])
    expect(parsed.file.accounts[0].pins).toEqual(['microsoft/vscode'])
  })

  it('带密钥时 counts.secrets 按账号数记', () => {
    const file = buildBackup({
      appVersion: '1.3.0',
      account: { login: null, name: null },
      settings: {},
      accounts: [account(), account({ login: 'alt' })],
      sealed: { v: 1, alg: 'AES-256-GCM', iter: 210000, salt: 'A', iv: 'B', ct: 'C' },
    })
    expect(file.counts.secrets).toBe(2)
  })

  it('别的 App 的 JSON 直接拒绝', () => {
    const r = parseBackup('{"app":"tampermonkey","v":1}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('不是 ghx')
  })

  it('坏 JSON / 空文件 / 版本不符都有可读提示', () => {
    expect(parseBackup('').ok).toBe(false)
    expect(parseBackup('{oops').ok).toBe(false)
    const r = parseBackup('{"app":"ghx","kind":"backup","v":9}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('9')
  })

  it('账号里的怪字段被裁掉，不会把界面喂坏', () => {
    const r = parseBackup(
      JSON.stringify({
        app: 'ghx',
        kind: 'backup',
        v: 1,
        settings: { 'ghx.theme': 'dark', 'ghx.evil': 'x' },
        accounts: [
          { name: 123, preview: null },
          { name: '小号', login: null, scopes: ['repo', 7, 'x'.repeat(500)], pins: ['ok/repo', 5] },
        ],
      }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.file.accounts).toHaveLength(1)
    expect(r.file.accounts[0].scopes).toEqual(['repo'])
    expect(r.file.accounts[0].pins).toEqual(['ok/repo'])
    expect(r.file.settings).toEqual({ 'ghx.theme': 'dark' })
  })

  it('既没账号也没设置的备份算空，明确报错', () => {
    const r = parseBackup('{"app":"ghx","kind":"backup","v":1,"accounts":[],"settings":{}}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('没有账号')
  })
})

describe('写回本机', () => {
  it('merge 只补缺的，replace 以备份为准', async () => {
    const kv = memoryKV({ 'ghx.theme': 'light' })
    const settings = { 'ghx.theme': 'dark', 'ghx.font': 'system' }

    const m = await applySettings(kv, settings, 'merge')
    expect(m).toEqual({ written: 1, kept: 1 })
    expect(await kv.get('ghx.theme')).toBe('light')
    expect(await kv.get('ghx.font')).toBe('system')

    const r = await applySettings(kv, settings, 'replace')
    expect(r.written).toBe(2)
    expect(await kv.get('ghx.theme')).toBe('dark')
  })

  it('白名单外的键即使混进来也不写', async () => {
    const kv = memoryKV()
    await applySettings(kv, { 'ghx.vault.v1': 'pwn' } as Record<string, string>, 'replace')
    expect(await kv.get('ghx.vault.v1')).toBeNull()
  })

  it('readSettings 逐键读取，缺的就是缺的', async () => {
    const kv = memoryKV({ 'ghx.theme': 'dark', 'ghx.sort': 'stars' })
    const s = await readSettings(kv)
    expect(s).toEqual({ 'ghx.theme': 'dark', 'ghx.sort': 'stars' })
  })
})

describe('账号去重与置顶合并', () => {
  it('同一登录名 + 同一指纹视为已存在', () => {
    const exist = [{ login: 'zjkl0330', preview: 'ghp_••••••••c3c3' }]
    expect(newAccounts([account()], exist)).toHaveLength(0)
    expect(newAccounts([account({ login: 'alt' })], exist)).toHaveLength(1)
  })

  it('大小写不同的登录名也算同一个', () => {
    expect(accountKey({ login: 'ZJKL0330', preview: 'x' })).toBe(accountKey({ login: 'zjkl0330', preview: 'x' }))
  })

  it('置顶合并去重且带上限', () => {
    // 备份里的顺序在前：恢复回来看到的是「上次那套置顶」
    expect(mergePins(['a/b'], ['a/b', 'c/d'])).toEqual(['a/b', 'c/d'])
    expect(mergePins(['x/y'], ['c/d'])).toEqual(['c/d', 'x/y'])
    expect(mergePins([], ['bad', 'a/b'])).toEqual(['a/b'])
  })
})

describe('同步存储里的偏好（原生端 localStorage 与 KV 是两个桶）', () => {
  const store = new Map<string, string>()
  const fake = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      store.set(k, v)
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
  } as unknown as Storage

  const original = (globalThis as { localStorage?: Storage }).localStorage
  function useFake() {
    ;(globalThis as { localStorage?: Storage }).localStorage = fake
  }

  afterEach(() => {
    store.clear()
    if (original === undefined) delete (globalThis as { localStorage?: Storage }).localStorage
    else (globalThis as { localStorage?: Storage }).localStorage = original
  })

  it('主题只存在 localStorage 时也能导出', async () => {
    useFake()
    store.set('ghx.theme', 'light')
    store.set('ghx.font', 'system')
    const s = await readSettings(memoryKV())
    expect(s).toEqual({ 'ghx.theme': 'light', 'ghx.font': 'system' })
  })

  it('恢复时两边都写，界面读哪一份都对', async () => {
    useFake()
    const kv = memoryKV()
    await applySettings(kv, { 'ghx.theme': 'dark' }, 'replace')
    expect(store.get('ghx.theme')).toBe('dark')
    expect(await kv.get('ghx.theme')).toBe('dark')
  })

  it('合并模式把 localStorage 里已有的算作「本机已有」', async () => {
    useFake()
    store.set('ghx.theme', 'light')
    const kv = memoryKV()
    const r = await applySettings(kv, { 'ghx.theme': 'dark' }, 'merge')
    expect(r).toEqual({ written: 0, kept: 1 })
    expect(store.get('ghx.theme')).toBe('light')
  })
})
