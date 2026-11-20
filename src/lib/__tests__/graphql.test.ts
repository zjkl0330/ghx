import { describe, expect, it } from 'vitest'
import {
  PKG_ASSETS,
  PKG_BATCH,
  PKG_RELEASES,
  buildPkgQuery,
  chunkRefs,
  parsePkgResponse,
  queryRepoPkgs,
  splitFullName,
} from '../graphql'

/** 只实现用得到的两个成员：real client 的其余部分与这里无关 */
function fakeClient(opts: {
  url?: string | null
  respond?: (query: string) => unknown
  throws?: boolean
}) {
  const calls: string[] = []
  const client = {
    graphqlUrl: 'url' in opts ? (opts.url ?? null) : 'https://api.github.com/graphql',
    async graphql(query: string) {
      calls.push(query)
      if (opts.throws) throw new Error('boom')
      return (opts.respond ? opts.respond(query) : { data: {}, errors: [], rate: null }) as never
    },
  }
  return { client, calls }
}

/** 造一个「仓库节点」：releases 里每项给 tag + 资产名数组 */
function repoNode(releases: { draft?: boolean; assets: string[] }[]) {
  return {
    releases: {
      nodes: releases.map((r) => ({
        isDraft: r.draft === true,
        releaseAssets: { nodes: r.assets.map((name) => ({ name })) },
      })),
    },
  }
}

describe('splitFullName', () => {
  it('拆成 owner / name，并把空白规整掉', () => {
    expect(splitFullName(' zjkl0330 / ghx ')).toEqual({
      owner: 'zjkl0330',
      name: 'ghx',
      fullName: 'zjkl0330/ghx',
    })
  })

  it('段数不对的一律不认，免得拼出莫名其妙的查询', () => {
    expect(splitFullName('a/b/c')).toBeNull()
    expect(splitFullName('only-owner')).toBeNull()
    expect(splitFullName('/b')).toBeNull()
    expect(splitFullName('a/')).toBeNull()
    expect(splitFullName('')).toBeNull()
  })
})

describe('chunkRefs', () => {
  it('空输入返回空数组，调用方不用特判', () => {
    expect(chunkRefs([])).toEqual([])
  })

  it('正好一批时不额外切', () => {
    expect(chunkRefs(Array.from({ length: 25 }, (_, i) => i))).toHaveLength(1)
  })

  it('多一个就切两批，尾巴留得下', () => {
    const got = chunkRefs(Array.from({ length: 26 }, (_, i) => i))
    expect(got).toHaveLength(2)
    expect(got[1]).toEqual([25])
  })

  it('size 非法时兜到 1，不至于死循环', () => {
    expect(chunkRefs([1, 2, 3], 0)).toEqual([[1], [2], [3]])
  })
})

describe('buildPkgQuery', () => {
  const refs = [
    { owner: 'a', name: 'one', fullName: 'a/one' },
    { owner: 'b', name: 'two', fullName: 'b/two' },
  ]

  it('一个仓库一个别名，字段名对齐常量', () => {
    const q = buildPkgQuery(refs)
    expect(q).toContain('r0: repository(owner: "a", name: "one")')
    expect(q).toContain('r1: repository(owner: "b", name: "two")')
    expect(q).toContain(`releases(first: ${PKG_RELEASES}`)
    expect(q).toContain(`releaseAssets(first: ${PKG_ASSETS}`)
  })

  it('名字里的引号被转义，不会把查询截断', () => {
    const q = buildPkgQuery([{ owner: 'a"b', name: 'c\\d', fullName: 'x' }])
    expect(q).toContain('owner: "a\\"b"')
    expect(q).toContain('name: "c\\\\d"')
  })
})

describe('parsePkgResponse', () => {
  it('正常两仓库：一个有 apk+exe，一个空', () => {
    const got = parsePkgResponse(
      {
        data: {
          r0: repoNode([{ assets: ['app.apk', 'setup.exe', 'src.zip'] }]),
          r1: repoNode([]),
        },
        errors: [],
      },
      ['o/one', 'o/two'],
    )
    expect(got.ok['o/one']).toEqual(['apk', 'exe'])
    expect(got.ok['o/two']).toEqual([])
    expect(got.failed).toEqual([])
  })

  it('草稿的资产不算，公开的才算', () => {
    const got = parsePkgResponse(
      { data: { r0: repoNode([{ draft: true, assets: ['draft.apk'] }, { assets: ['real.exe'] }]) } },
      ['o/one'],
    )
    expect(got.ok['o/one']).toEqual(['exe'])
  })

  it('后缀大小写不影响判断', () => {
    const got = parsePkgResponse({ data: { r0: repoNode([{ assets: ['APP.APK'] }]) } }, ['o/one'])
    expect(got.ok['o/one']).toEqual(['apk'])
  })

  it('NOT_FOUND 是确定结论：按「没有包」落地，不进待重试队列', () => {
    const got = parsePkgResponse(
      {
        data: { r0: null },
        errors: [{ type: 'NOT_FOUND', path: ['r0'], message: 'Could not resolve' }],
      },
      ['o/gone'],
    )
    expect(got.ok['o/gone']).toEqual([])
    expect(got.failed).toEqual([])
  })

  it('别名缺 data 又没给 errors 时算没问到，不当成「没有包」', () => {
    const got = parsePkgResponse({ data: {}, errors: [] }, ['o/one'])
    expect(got.ok).toEqual({})
    expect(got.failed).toEqual(['o/one'])
  })

  it('暂时性错误（FORBIDDEN / RATE_LIMITED）不写缓存，留待下轮', () => {
    const got = parsePkgResponse(
      {
        data: { r0: null, r1: null },
        errors: [
          { type: 'FORBIDDEN', path: ['r0'] },
          { type: 'RATE_LIMITED', path: ['r1'] },
        ],
      },
      ['o/one', 'o/two'],
    )
    expect(got.ok).toEqual({})
    expect(got.failed).toEqual(['o/one', 'o/two'])
  })

  it('结构不符（releases 不是对象）算没问到，不能记成空', () => {
    const got = parsePkgResponse({ data: { r0: { releases: null } } }, ['o/one'])
    expect(got.ok).toEqual({})
    expect(got.failed).toEqual(['o/one'])
  })

  it('同一别名下多个发行版会合并，不覆盖', () => {
    const got = parsePkgResponse(
      {
        data: {
          r0: repoNode([{ assets: ['only-src.tar.gz'] }, { assets: ['v1.apk'] }, { assets: ['v0.exe'] }]),
        },
      },
      ['o/one'],
    )
    expect(got.ok['o/one']).toEqual(['apk', 'exe'])
  })
})

describe('queryRepoPkgs', () => {
  const names = (n: number) => Array.from({ length: n }, (_, i) => `o/r${i}`)

  it('25 个仓库只发 1 次请求 —— 这是这套改动的全部意义', async () => {
    const { client, calls } = fakeClient({})
    const got = await queryRepoPkgs(client, names(25))
    expect(calls).toHaveLength(1)
    expect(got.failed).toHaveLength(25) // 假 client 回空 data，全部算没问到
  })

  it('超过一批才继续切', async () => {
    const { client, calls } = fakeClient({})
    await queryRepoPkgs(client, names(PKG_BATCH * 2 + 10))
    expect(calls).toHaveLength(3)
  })

  it('线路不支持 GraphQL（镜像站）时不发请求，整批交给逐条回落', async () => {
    const { client, calls } = fakeClient({ url: null })
    const got = await queryRepoPkgs(client, names(3))
    expect(calls).toHaveLength(0)
    expect(got.failed).toHaveLength(3)
  })

  it('名字不合法的不进查询，直接标失败', async () => {
    const { client, calls } = fakeClient({})
    const got = await queryRepoPkgs(client, ['bad', 'o/ok'])
    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toContain('"bad"')
    expect(got.failed).toContain('bad')
  })

  it('某一批抛错只影响那一批，其它批照常落地', async () => {
    let n = 0
    const { client } = fakeClient({
      respond: (q) => {
        n += 1
        if (n === 2) throw new Error('network')
        // 按查询里实际有几个别名回数据
        const count = (q.match(/^ {2}r\d+:/gm) ?? []).length
        const data: Record<string, unknown> = {}
        for (let i = 0; i < count; i += 1) data[`r${i}`] = repoNode([{ assets: ['x.apk'] }])
        return { data, errors: [] }
      },
    })
    const all = names(60)
    const got = await queryRepoPkgs(client, all)
    expect(Object.keys(got.ok)).toHaveLength(60 - PKG_BATCH)
    expect(got.failed).toHaveLength(PKG_BATCH)
  })

  it('结果按仓库名回填，别名顺序不打乱', async () => {
    const { client } = fakeClient({
      respond: () => ({
        data: { r0: repoNode([{ assets: ['a.apk'] }]), r1: repoNode([{ assets: ['b.exe'] }]) },
        errors: [],
      }),
    })
    const got = await queryRepoPkgs(client, ['o/one', 'o/two'])
    expect(got.ok['o/one']).toEqual(['apk'])
    expect(got.ok['o/two']).toEqual(['exe'])
  })

  it('空列表一根请求都不发', async () => {
    const { client, calls } = fakeClient({})
    const got = await queryRepoPkgs(client, [])
    expect(calls).toHaveLength(0)
    expect(got).toEqual({ ok: {}, failed: [] })
  })
})
