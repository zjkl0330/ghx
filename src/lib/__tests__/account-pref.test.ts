import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_PREF_KEY,
  DEFAULT_ACCOUNT_PREF,
  MAX_REPOS,
  MAX_ROUTES,
  decodeWorkspace,
  dropWorkspaceKV,
  encodeAccountPref,
  encodeWorkspace,
  loadWorkspace,
  parseAccountPref,
  parseMultiCount,
  persistWorkspace,
  readAccountPref,
  workspaceKey,
  writeAccountPref,
  type AccountPref,
} from '../account-pref'
import { memoryKV } from '../storage'
import { emptyWorkspace } from '../workspace'

const repo = (n: string) => ({ full_name: `me/${n}`, name: n }) as never

describe('账号偏好', () => {
  it('没有存过时默认保留现场', () => {
    expect(parseAccountPref(null)).toEqual(DEFAULT_ACCOUNT_PREF)
    expect(parseAccountPref('')).toEqual(DEFAULT_ACCOUNT_PREF)
    expect(DEFAULT_ACCOUNT_PREF.keepWorkspace).toBe(true)
  })

  it('坏 JSON / 非对象一律退回默认，不抛错', () => {
    expect(parseAccountPref('{')).toEqual(DEFAULT_ACCOUNT_PREF)
    expect(parseAccountPref('null')).toEqual(DEFAULT_ACCOUNT_PREF)
    expect(parseAccountPref('"x"')).toEqual(DEFAULT_ACCOUNT_PREF)
  })

  it('false 能读回来，非布尔值回落默认', () => {
    expect(parseAccountPref('{"keepWorkspace":false}').keepWorkspace).toBe(false)
    expect(parseAccountPref('{"keepWorkspace":"no"}').keepWorkspace).toBe(true)
    expect(parseAccountPref('{"keepWorkspace":0}').keepWorkspace).toBe(true)
  })

  it('只写白名单字段', () => {
    expect(JSON.parse(encodeAccountPref({ keepWorkspace: false, multiCount: 2, extra: 1 } as never))).toEqual({
      keepWorkspace: false,
      multiCount: 2,
    })
  })

  it('读写走 KV，键固定', async () => {
    const kv = memoryKV()
    expect((await readAccountPref(kv)).keepWorkspace).toBe(true)
    await writeAccountPref(kv, { keepWorkspace: false, multiCount: 2 })
    expect(await kv.get(ACCOUNT_PREF_KEY)).toBe('{"keepWorkspace":false,"multiCount":2}')
    expect((await readAccountPref(kv)).keepWorkspace).toBe(false)
    expect((await readAccountPref(kv)).multiCount).toBe(2)
    expect((await readAccountPref(null)).keepWorkspace).toBe(true)
  })
})

describe('每账号现场：编解码', () => {
  it('往返保留路由、列表、筛选与置顶', () => {
    const ws = {
      ...emptyWorkspace('pushed'),
      routeStack: [
        { kind: 'repo', owner: 'a', repo: 'b' },
        { kind: 'issue', owner: 'a', repo: 'b', number: 7 },
      ] as never[],
      repos: [repo('one'), repo('two')],
      snapshotAt: 123,
      query: 'vpn',
      visibility: 'private' as const,
      sort: 'stars' as const,
      unread: 3,
      pins: ['me/one'],
    }
    const back = decodeWorkspace(encodeWorkspace(ws))!
    expect(back.routeStack).toEqual(ws.routeStack)
    expect(back.repos.map((r) => r.full_name)).toEqual(['me/one', 'me/two'])
    expect(back.query).toBe('vpn')
    expect(back.visibility).toBe('private')
    expect(back.sort).toBe('stars')
    expect(back.unread).toBe(3)
    expect(back.pins).toEqual(['me/one'])
  })

  it('坏 JSON / 空值返回 null', () => {
    expect(decodeWorkspace(null)).toBeNull()
    expect(decodeWorkspace('')).toBeNull()
    expect(decodeWorkspace('{oops')).toBeNull()
    expect(decodeWorkspace('{}')).toBeNull()
  })

  it('未知路由类型被丢掉，不让它把页面渲染炸掉', () => {
    const raw = JSON.stringify({
      routeStack: [{ kind: 'repo', owner: 'a', repo: 'b' }, { kind: 'nope' }, null, 7],
      repos: [{ full_name: 'me/x', name: 'x' }],
    })
    const ws = decodeWorkspace(raw)!
    expect(ws.routeStack).toHaveLength(1)
    expect(ws.routeStack[0].kind).toBe('repo')
  })

  it('路由层数超上限时只留最近几层', () => {
    const stack = Array.from({ length: 12 }, (_, i) => ({ kind: 'issue', owner: 'a', repo: 'b', number: i }))
    const ws = decodeWorkspace(JSON.stringify({ routeStack: stack, repos: [repo('x')] }))!
    expect(ws.routeStack).toHaveLength(MAX_ROUTES)
    // 保留的是靠后的（最近的）那几层
    expect((ws.routeStack[ws.routeStack.length - 1] as { number: number }).number).toBe(11)
  })

  it('仓库快照有上限，坏条目被过滤', () => {
    const repos = Array.from({ length: MAX_REPOS + 20 }, (_, i) => repo(`r${i}`))
    repos.push({ name: 'no-full-name' } as never, null as never)
    const ws = decodeWorkspace(JSON.stringify({ repos }))!
    expect(ws.repos).toHaveLength(MAX_REPOS)
  })

  it('筛选/排序/未读数的非法值回落默认', () => {
    const ws = decodeWorkspace(
      JSON.stringify({ repos: [repo('x')], visibility: 'secret', sort: 'random', unread: -5, query: 9 }),
    )!
    expect(ws.visibility).toBe('all')
    expect(ws.sort).toBe('pushed')
    expect(ws.unread).toBe(0)
    expect(ws.query).toBe('')
  })

  it('置顶只留字符串并裁掉多余项', () => {
    const pins = [...Array.from({ length: 60 }, (_, i) => `me/r${i}`), 42, null]
    const ws = decodeWorkspace(JSON.stringify({ repos: [repo('x')], pins }))!
    expect(ws.pins.every((p) => typeof p === 'string')).toBe(true)
    expect(ws.pins.length).toBeLessThanOrEqual(40)
  })

  it('只有路由没有列表也算有效现场', () => {
    const ws = decodeWorkspace(JSON.stringify({ routeStack: [{ kind: 'profile' }] }))!
    expect(ws.routeStack).toHaveLength(1)
    expect(ws.repos).toHaveLength(0)
  })
})

describe('每账号现场：KV', () => {
  it('键带账号 id，读写往返', async () => {
    const kv = memoryKV()
    expect(workspaceKey('t1')).toBe('ghx.ws.t1')
    const ws = { ...emptyWorkspace('pushed'), repos: [repo('one')], query: 'q' }
    await persistWorkspace(kv, 't1', ws)
    const back = await loadWorkspace(kv, 't1')
    expect(back?.query).toBe('q')
    expect(back?.repos[0].full_name).toBe('me/one')
    expect(await loadWorkspace(kv, 't2')).toBeNull()
    expect(await loadWorkspace(null, 't1')).toBeNull()
  })

  it('删号顺手清掉那一个账号的现场，别的账号不受影响', async () => {
    const kv = memoryKV()
    await persistWorkspace(kv, 'a', { ...emptyWorkspace('pushed'), repos: [repo('a1')] })
    await persistWorkspace(kv, 'b', { ...emptyWorkspace('pushed'), repos: [repo('b1')] })
    await dropWorkspaceKV(kv, 'a')
    expect(await loadWorkspace(kv, 'a')).toBeNull()
    expect((await loadWorkspace(kv, 'b'))?.repos[0].full_name).toBe('me/b1')
  })

  it('KV 抛错时静默降级，不打断启动', async () => {
    const bad = {
      get: async () => {
        throw new Error('boom')
      },
      set: async () => {
        throw new Error('boom')
      },
      remove: async () => {
        throw new Error('boom')
      },
    }
    await expect(loadWorkspace(bad, 'x')).resolves.toBeNull()
    await expect(persistWorkspace(bad, 'x', emptyWorkspace('pushed'))).resolves.toBeUndefined()
    await expect(dropWorkspaceKV(bad, 'x')).resolves.toBeUndefined()
  })
})

describe('多账号默认勾选数', () => {
  it('旧版本没有这个字段时按「全部」', () => {
    const p = parseAccountPref('{"keepWorkspace":true}')
    expect(p.multiCount).toBe(0)
  })

  it('1/2/3 原样保留', () => {
    expect(parseAccountPref('{"multiCount":1}').multiCount).toBe(1)
    expect(parseAccountPref('{"multiCount":2}').multiCount).toBe(2)
    expect(parseAccountPref('{"multiCount":3}').multiCount).toBe(3)
  })

  it('0、负数、字符串、超大值都归到「全部」', () => {
    expect(parseMultiCount(0)).toBe(0)
    expect(parseMultiCount(-1)).toBe(0)
    expect(parseMultiCount('2')).toBe(0)
    expect(parseMultiCount(9)).toBe(0)
    expect(parseMultiCount(null)).toBe(0)
    expect(parseMultiCount(undefined)).toBe(0)
  })

  it('编码后能原样读回', () => {
    for (const n of [0, 1, 2, 3] as const) {
      const p: AccountPref = { keepWorkspace: true, multiCount: n }
      expect(parseAccountPref(encodeAccountPref(p)).multiCount).toBe(n)
    }
  })
})
