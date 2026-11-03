import { describe, expect, it } from 'vitest'
import { memoryKV } from '../storage'
import { Vault, VaultAuthError, VaultLockedError } from '../vault'

const SECRET = 'ghp_' + 'b'.repeat(36)
const PASS = 'open sesame 9'

describe('免密保险库', () => {
  it('创建后无需任何口令即为解锁态', async () => {
    const kv = memoryKV()
    const v = new Vault(kv)
    await v.createDevice()
    expect(v.locked).toBe(false)
    expect(v.mode).toBe('device')
    expect(v.guarded).toBe(false)
  })

  it('新实例启动时 autoUnlock 直接返回 unlocked', async () => {
    const kv = memoryKV()
    const v = new Vault(kv)
    await v.createDevice()
    const rec = await v.add({ name: '主力', secret: SECRET })

    const rebooted = new Vault(kv)
    expect(await rebooted.autoUnlock()).toBe('unlocked')
    expect(await rebooted.secret(rec.id)).toBe(SECRET)
  })

  it('没有保险库时 autoUnlock 返回 no-vault', async () => {
    const v = new Vault(memoryKV())
    expect(await v.autoUnlock()).toBe('no-vault')
  })

  it('密文不含明文令牌，设备密钥单独存放', async () => {
    const kv = memoryKV()
    const v = new Vault(kv)
    await v.createDevice()
    await v.add({ name: '主力', secret: SECRET })
    const raw = (await kv.get('ghx.vault.v1')) as string
    expect(raw).not.toContain(SECRET)
    expect(await kv.get('ghx.device.v1')).toBeTruthy()
    expect(JSON.parse(raw).v).toBe(2)
  })

  it('设备密钥丢失时报错而不是静默空库', async () => {
    const kv = memoryKV()
    const v = new Vault(kv)
    await v.createDevice()
    await v.add({ name: '主力', secret: SECRET })
    await kv.remove('ghx.device.v1')

    const rebooted = new Vault(kv)
    await expect(rebooted.autoUnlock()).rejects.toThrow('设备密钥缺失')
  })

  it('锁定后内存中的密钥被清空', async () => {
    const kv = memoryKV()
    const v = new Vault(kv)
    await v.createDevice()
    const rec = await v.add({ name: 'a', secret: SECRET })
    v.lock()
    await expect(v.secret(rec.id)).rejects.toBeInstanceOf(VaultLockedError)
    expect(await v.autoUnlock()).toBe('unlocked')
    expect(await v.secret(rec.id)).toBe(SECRET)
  })
})

describe('可选启动验证', () => {
  it('开启后启动变为需要口令', async () => {
    const kv = memoryKV()
    const v = new Vault(kv)
    await v.createDevice()
    await v.add({ name: '主力', secret: SECRET })
    await v.setGuard(PASS)
    expect(v.guarded).toBe(true)

    const rebooted = new Vault(kv)
    expect(await rebooted.autoUnlock()).toBe('need-passphrase')
    await expect(rebooted.unlock('wrong pass')).rejects.toBeInstanceOf(VaultAuthError)
    await rebooted.unlock(PASS)
    expect(rebooted.locked).toBe(false)
  })

  it('开启启动验证后仍能读回令牌', async () => {
    const kv = memoryKV()
    const v = new Vault(kv)
    await v.createDevice()
    const rec = await v.add({ name: '主力', secret: SECRET })
    await v.setGuard(PASS)

    const rebooted = new Vault(kv)
    await rebooted.unlock(PASS)
    expect(await rebooted.secret(rec.id)).toBe(SECRET)
  })

  it('关闭后重新变回免密，且数据不丢', async () => {
    const kv = memoryKV()
    const v = new Vault(kv)
    await v.createDevice()
    const rec = await v.add({ name: '主力', secret: SECRET })
    await v.setGuard(PASS)
    await v.clearGuard(PASS)
    expect(v.guarded).toBe(false)

    const rebooted = new Vault(kv)
    expect(await rebooted.autoUnlock()).toBe('unlocked')
    expect(await rebooted.secret(rec.id)).toBe(SECRET)
  })

  it('用错口令关不掉启动验证', async () => {
    const kv = memoryKV()
    const v = new Vault(kv)
    await v.createDevice()
    await v.setGuard(PASS)
    await expect(v.clearGuard('nope nope')).rejects.toBeInstanceOf(VaultAuthError)
    expect(v.guarded).toBe(true)
  })

  it('改口令后旧口令失效、新口令可用', async () => {
    const kv = memoryKV()
    const v = new Vault(kv)
    await v.createDevice()
    await v.add({ name: '主力', secret: SECRET })
    await v.setGuard(PASS)
    await v.changeGuard(PASS, 'brand new pass 1')

    const rebooted = new Vault(kv)
    await expect(rebooted.unlock(PASS)).rejects.toBeInstanceOf(VaultAuthError)
    await rebooted.unlock('brand new pass 1')
    expect(rebooted.locked).toBe(false)
  })

  it('口令少于 8 位被拒绝', async () => {
    const v = new Vault(memoryKV())
    await v.createDevice()
    await expect(v.setGuard('1234567')).rejects.toThrow('至少 8 位')
  })
})

describe('老口令库迁移', () => {
  async function legacyVault() {
    const kv = memoryKV()
    const v = new Vault(kv)
    await v.create(PASS)
    const rec = await v.add({ name: '旧令牌', secret: SECRET })
    return { kv, rec }
  }

  it('v1 保险库启动仍需口令', async () => {
    const { kv } = await legacyVault()
    const reopened = new Vault(kv)
    expect(await reopened.autoUnlock()).toBe('need-passphrase')
  })

  it('迁移后变成免密且令牌原文不变', async () => {
    const { kv, rec } = await legacyVault()
    const migrated = new Vault(kv)
    await migrated.migrateToDevice(PASS)
    expect(migrated.mode).toBe('device')
    expect(migrated.guarded).toBe(false)

    const rebooted = new Vault(kv)
    expect(await rebooted.autoUnlock()).toBe('unlocked')
    expect(await rebooted.secret(rec.id)).toBe(SECRET)
  })

  it('迁移时口令错误直接拒绝，且原库保持可用', async () => {
    const { kv, rec } = await legacyVault()
    const v = new Vault(kv)
    await expect(v.migrateToDevice('bad password')).rejects.toBeInstanceOf(VaultAuthError)

    const stillLegacy = new Vault(kv)
    expect(await stillLegacy.autoUnlock()).toBe('need-passphrase')
    await stillLegacy.unlock(PASS)
    expect(await stillLegacy.secret(rec.id)).toBe(SECRET)
  })
})
