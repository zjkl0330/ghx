import { describe, expect, it } from 'vitest'
import { memoryKV } from '../storage'
import { Vault, VaultAuthError, VaultLockedError, looksLikeToken, previewOf } from '../vault'

const SECRET = 'ghp_' + 'a'.repeat(36)

async function freshVault(pass = 'correct horse battery') {
  const kv = memoryKV()
  const v = new Vault(kv)
  await v.create(pass)
  return { kv, v, pass }
}

describe('vault 加密往返', () => {
  it('创建后 exists 为真且处于解锁态', async () => {
    const { v } = await freshVault()
    expect(await v.exists()).toBe(true)
    expect(v.locked).toBe(false)
  })

  it('写入令牌后可读回明文，且列表里是脱敏指纹', async () => {
    const { v } = await freshVault()
    const rec = await v.add({ name: '主力', secret: SECRET })
    expect(rec.preview).not.toContain(SECRET)
    expect(rec.preview.endsWith(SECRET.slice(-4))).toBe(true)
    expect(rec.kind).toBe('classic')

    const list = await v.list()
    expect(list).toHaveLength(1)
    expect(await v.secret(rec.id)).toBe(SECRET)
  })

  it('密文落盘后不含明文令牌', async () => {
    const { kv, v } = await freshVault()
    await v.add({ name: '主力', secret: SECRET })
    const raw = await kv.get('ghx.vault.v1')
    expect(raw).toBeTruthy()
    expect(raw).not.toContain(SECRET)
  })

  it('锁定后取明文抛 VaultLockedError', async () => {
    const { v } = await freshVault()
    const rec = await v.add({ name: 'a', secret: SECRET })
    v.lock()
    expect(v.locked).toBe(true)
    await expect(v.secret(rec.id)).rejects.toBeInstanceOf(VaultLockedError)
  })

  it('错误口令无法解锁', async () => {
    const { kv, pass } = await freshVault()
    const again = new Vault(kv)
    await expect(again.unlock('wrong pass')).rejects.toBeInstanceOf(VaultAuthError)
    await again.unlock(pass)
    expect(again.locked).toBe(false)
  })

  it('重新实例化后可用正确口令读回同一条令牌', async () => {
    const { kv, v, pass } = await freshVault()
    const rec = await v.add({ name: '主力', secret: SECRET })
    const rebooted = new Vault(kv)
    await rebooted.unlock(pass)
    const list = await rebooted.list()
    expect(list.map((r) => r.id)).toEqual([rec.id])
    expect(await rebooted.secret(rec.id)).toBe(SECRET)
  })

  it('密文被篡改时解密失败', async () => {
    const { kv, v, pass } = await freshVault()
    const rec = await v.add({ name: '主力', secret: SECRET })
    const file = JSON.parse((await kv.get('ghx.vault.v1')) as string)
    const blob = file.secrets[rec.id]
    const bytes = Buffer.from(blob.ct, 'base64')
    bytes[0] ^= 0xff
    file.secrets[rec.id] = { iv: blob.iv, ct: bytes.toString('base64') }
    await kv.set('ghx.vault.v1', JSON.stringify(file))

    const reopened = new Vault(kv)
    await reopened.unlock(pass)
    await expect(reopened.secret(rec.id)).rejects.toThrow()
  })

  it('删除后列表与密文同时移除', async () => {
    const { kv, v } = await freshVault()
    const rec = await v.add({ name: 'x', secret: SECRET })
    await v.remove(rec.id)
    expect(await v.list()).toHaveLength(0)
    const file = JSON.parse((await kv.get('ghx.vault.v1')) as string)
    expect(file.secrets[rec.id]).toBeUndefined()
  })

  it('拒绝格式不合法的令牌', async () => {
    const { v } = await freshVault()
    await expect(v.add({ name: 'bad', secret: 'short' })).rejects.toThrow('令牌格式不正确')
  })
})

describe('令牌格式与脱敏', () => {
  it('识别 fine-grained 前缀', () => {
    expect(looksLikeToken('github_pat_11ABCDEFG0123456789_abcdefghijklmnop')).toBe(true)
    expect(previewOf('github_pat_11ABCDEFG0123456789_abcdefghijklmnop').startsWith('github_pat_')).toBe(true)
  })

  it('拒绝明显无效的串', () => {
    expect(looksLikeToken('ghp_123')).toBe(false)
    expect(looksLikeToken('')).toBe(false)
  })
})
