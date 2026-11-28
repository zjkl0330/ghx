import { describe, expect, it } from 'vitest'
import { memoryKV } from '../storage'
import { Vault } from '../vault'

const MAIN = 'ghp_' + 'e'.repeat(36)
const SUB = 'ghp_' + 'f'.repeat(36)
const VAULT_KEY = 'ghx.vault.v1'

async function fresh(): Promise<{ kv: ReturnType<typeof memoryKV>; v: Vault }> {
  const kv = memoryKV()
  const v = new Vault(kv)
  await v.createDevice()
  return { kv, v }
}

describe('主副两把密钥', () => {
  it('导入时同时存副密钥，列表拿得到「有副密钥」与指纹', async () => {
    const { v } = await fresh()
    const rec = await v.add({ name: '主力', secret: MAIN, secondary: SUB })
    expect(rec.hasSecondary).toBe(true)
    expect(rec.secondaryPreview).toBe(`ghp_${'•'.repeat(8)}${SUB.slice(-4)}`)
    expect(await v.secondarySecret(rec.id)).toBe(SUB)
    expect(await v.secret(rec.id)).toBe(MAIN)
  })

  it('副密钥单独一个加密区，密文里没有明文', async () => {
    const { kv, v } = await fresh()
    const rec = await v.add({ name: '主力', secret: MAIN, secondary: SUB })
    const raw = (await kv.get(VAULT_KEY)) as string
    expect(raw).not.toContain(MAIN)
    expect(raw).not.toContain(SUB)
    const o = JSON.parse(raw)
    expect(Object.keys(o.secrets)).toEqual([rec.id])
    expect(Object.keys(o.secrets2)).toEqual([rec.id])
  })

  it('可以替换，也可以只清副密钥而保留主密钥', async () => {
    const { v } = await fresh()
    const rec = await v.add({ name: '主力', secret: MAIN, secondary: SUB })
    const other = 'ghp_' + '9'.repeat(36)

    await v.setSecondary(rec.id, other)
    expect(await v.secondarySecret(rec.id)).toBe(other)

    await v.setSecondary(rec.id, null)
    const list = await v.list()
    expect(list[0].hasSecondary).toBe(false)
    expect(list[0].secondaryPreview).toBeNull()
    expect(await v.secondarySecret(rec.id)).toBeNull()
    expect(await v.secret(rec.id)).toBe(MAIN)
  })

  it('副密钥格式不对直接拒绝，不会写坏主密钥', async () => {
    const { v } = await fresh()
    const rec = await v.add({ name: '主力', secret: MAIN })
    await expect(v.setSecondary(rec.id, 'not-a-token')).rejects.toThrow('副密钥')
    expect(await v.secret(rec.id)).toBe(MAIN)
  })

  it('老库没有 secrets2 也能读，并且能补上副密钥', async () => {
    const kv = memoryKV()
    const v = new Vault(kv)
    await v.createDevice()
    const rec = await v.add({ name: '主力', secret: MAIN })

    // 模拟 v1.2.x 写出的库：把副密钥区整段删掉
    const raw = JSON.parse((await kv.get(VAULT_KEY)) as string)
    delete raw.secrets2
    await kv.set(VAULT_KEY, JSON.stringify(raw))

    const reboot = new Vault(kv)
    expect(await reboot.autoUnlock()).toBe('unlocked')
    expect((await reboot.list())[0].id).toBe(rec.id)
    expect(await reboot.secondarySecret(rec.id)).toBeNull()

    await reboot.setSecondary(rec.id, SUB)
    expect(await reboot.secondarySecret(rec.id)).toBe(SUB)
  })

  it('删除账号时两把密钥一起清掉', async () => {
    const { kv, v } = await fresh()
    const rec = await v.add({ name: '主力', secret: MAIN, secondary: SUB })
    await v.remove(rec.id)
    const o = JSON.parse((await kv.get(VAULT_KEY)) as string)
    expect(o.secrets).toEqual({})
    expect(o.secrets2).toEqual({})
    expect(await v.allSecrets()).toEqual({})
  })

  it('allSecrets 一次取出主副，供备份使用', async () => {
    const { v } = await fresh()
    const a = await v.add({ name: 'A', secret: MAIN, secondary: SUB })
    const b = await v.add({ name: 'B', secret: 'ghp_' + 'a'.repeat(36) })
    expect(await v.allSecrets()).toEqual({
      [a.id]: { secret: MAIN, secondary: SUB },
      [b.id]: { secret: 'ghp_' + 'a'.repeat(36), secondary: null },
    })
  })

  it('恢复账号会换新 id，但登录名与 scopes 都带回来', async () => {
    const { v } = await fresh()
    const rec = await v.restore({
      name: '备用',
      secret: MAIN,
      secondary: SUB,
      login: 'zjkl0330',
      scopes: ['repo'],
      baseUrl: 'https://api.github.com',
    })
    expect(rec.login).toBe('zjkl0330')
    expect(rec.scopes).toEqual(['repo'])
    expect(rec.lastStatus).toBe('ok')
    expect(rec.hasSecondary).toBe(true)
    expect(await v.secret(rec.id)).toBe(MAIN)
    expect(await v.secondarySecret(rec.id)).toBe(SUB)
  })

  it('恢复时令牌格式不对要报错，不能把坏数据塞进保险库', async () => {
    const { v } = await fresh()
    await expect(v.restore({ name: 'x', secret: 'oops' })).rejects.toThrow('格式')
    expect(await v.list()).toHaveLength(0)
  })
})
