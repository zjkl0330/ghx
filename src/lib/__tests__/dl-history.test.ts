import { describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT,
  appendRecord,
  clearHistory,
  historyTime,
  makeRecord,
  parseHistory,
  parsePendingDownload,
  pushRecord,
  readHistory,
  recordFromPending,
  recordId,
  removeRecord,
  writeHistory,
  type DlRecord,
} from '../dl-history'

/** 极简 localStorage 替身：jsdom 之外也能跑 */
function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage
}

function rec(over: Partial<DlRecord> = {}): DlRecord {
  return makeRecord({
    repo: 'zjkl0330/ghx',
    name: 'ghx-0.8.7-debug.apk',
    kind: 'apk',
    status: 'done',
    at: 1_700_000_000_000,
    ...over,
  })
}

describe('recordId', () => {
  it('同仓库同文件同类型视为同一条', () => {
    expect(recordId('a/b', 'apk', 'x.apk')).toBe(recordId('A/B', 'apk', 'X.APK'))
  })

  it('类型不同就是不同记录：同一个 zip 既是附件也可能是源码包', () => {
    expect(recordId('a/b', 'asset', 'x.zip')).not.toBe(recordId('a/b', 'archive', 'x.zip'))
  })
})

describe('parseHistory', () => {
  it('空值与坏 JSON 都当没有记录，不抛', () => {
    expect(parseHistory(null)).toEqual([])
    expect(parseHistory('')).toEqual([])
    expect(parseHistory('{oops')).toEqual([])
    expect(parseHistory('{"a":1}')).toEqual([])
  })

  it('逐条校验：坏的那条丢掉，好的照留', () => {
    const raw = JSON.stringify([
      { id: 'x', at: 1, repo: 'a/b', name: 'ok.apk', kind: 'apk', size: 1, bytes: 1, status: 'done' },
      { at: 1, repo: 'a/b', name: 'bad-kind.apk', kind: 'exe', status: 'done' },
      { at: 1, repo: 'a/b', name: 'no-status.apk', kind: 'apk' },
      { at: 1, repo: 'a/b', name: '', kind: 'apk', status: 'done' },
      { at: 0, repo: 'a/b', name: 'no-time.apk', kind: 'apk', status: 'done' },
    ])
    const list = parseHistory(raw)
    expect(list.map((r) => r.name)).toEqual(['ok.apk'])
  })

  it('缺 id 时按 repo+kind+name 补出来', () => {
    const raw = JSON.stringify([
      { at: 5, repo: 'a/b', name: 'x.apk', kind: 'apk', size: 3, bytes: 3, status: 'done' },
    ])
    expect(parseHistory(raw)[0].id).toBe(recordId('a/b', 'apk', 'x.apk'))
  })

  it('按时间倒序、同 id 只留第一条', () => {
    const raw = JSON.stringify([
      { id: 'same', at: 1, repo: 'a/b', name: 'x.apk', kind: 'apk', status: 'done' },
      { id: 'same', at: 9, repo: 'a/b', name: 'x.apk', kind: 'apk', status: 'failed' },
      { id: 'other', at: 5, repo: 'a/b', name: 'y.apk', kind: 'apk', status: 'done' },
    ])
    const list = parseHistory(raw)
    // 先按出现顺序去重（保住第一条），再按时间倒序
    expect(list.map((r) => r.id)).toEqual(['other', 'same'])
    expect(list[1].at).toBe(1)
  })
})

describe('pushRecord', () => {
  it('新记录在最前', () => {
    const a = rec({ name: 'a.apk' })
    const b = rec({ name: 'b.apk' })
    expect(pushRecord([a], b).map((r) => r.name)).toEqual(['b.apk', 'a.apk'])
  })

  it('同一条再次下载是替换，不是追加', () => {
    const first = rec({ status: 'failed', at: 1 })
    const second = rec({ status: 'done', at: 2 })
    const list = pushRecord([first], second)
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe('done')
  })

  it('超过上限时截掉最老的', () => {
    let list: DlRecord[] = []
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
      list = pushRecord(list, rec({ name: `f${i}.apk`, at: 1000 + i }))
    }
    expect(list).toHaveLength(HISTORY_LIMIT)
    expect(list[0].name).toBe(`f${HISTORY_LIMIT + 4}.apk`)
  })
})

describe('makeRecord', () => {
  it('字段齐全、可选字段为空时不写空串', () => {
    const r = rec()
    expect(r.id).toBe(recordId('zjkl0330/ghx', 'apk', 'ghx-0.8.7-debug.apk'))
    expect(r).not.toHaveProperty('path')
    expect(r).not.toHaveProperty('error')
    expect('path' in rec({ path: '/x/y.apk' })).toBe(true)
  })
})

describe('removeRecord', () => {
  it('只删指定那条', () => {
    const a = rec({ name: 'a.apk' })
    const b = rec({ name: 'b.apk' })
    expect(removeRecord([a, b], a.id).map((r) => r.name)).toEqual(['b.apk'])
  })
})

describe('读写', () => {
  it('反复写入读回一致，清空后为空', () => {
    const g = globalThis as { localStorage?: Storage }
    const prev = g.localStorage
    g.localStorage = fakeStorage()
    try {
      expect(readHistory()).toEqual([])
      appendRecord(rec({ name: 'a.apk' }))
      appendRecord(rec({ name: 'b.apk' }))
      expect(readHistory().map((r) => r.name)).toEqual(['b.apk', 'a.apk'])
      writeHistory([])
      expect(readHistory()).toEqual([])
      appendRecord(rec())
      clearHistory()
      expect(readHistory()).toEqual([])
    } finally {
      g.localStorage = prev
    }
  })

  it('localStorage 抛异常时静默降级（隐私模式）', () => {
    const g = globalThis as { localStorage?: Storage }
    const prev = g.localStorage
    const boom = {
      getItem() {
        throw new Error('denied')
      },
      setItem() {
        throw new Error('denied')
      },
      removeItem() {
        throw new Error('denied')
      },
    } as unknown as Storage
    g.localStorage = boom
    try {
      expect(readHistory()).toEqual([])
      expect(() => writeHistory([rec()])).not.toThrow()
      expect(() => clearHistory()).not.toThrow()
      expect(appendRecord(rec())).toHaveLength(1)
    } finally {
      g.localStorage = prev
    }
  })
})

describe('parsePendingDownload', () => {
  it('空值、坏 JSON 都返回 null', () => {
    expect(parsePendingDownload(null)).toBeNull()
    expect(parsePendingDownload('')).toBeNull()
    expect(parsePendingDownload('not json')).toBeNull()
    expect(parsePendingDownload('[1,2]')).toBeNull()
  })

  it('没有文件名就当没有这个结果', () => {
    expect(parsePendingDownload(JSON.stringify({ repo: 'a/b', ok: true }))).toBeNull()
  })

  it('完整结果逐字段还原', () => {
    const raw = JSON.stringify({
      repo: 'zjkl0330/ghx',
      kind: 'apk',
      tag: 'v0.8.8',
      name: 'ghx-0.8.8-debug.apk',
      ok: true,
      bytes: 21500000,
      ms: 4321,
      at: 1794000000000,
      path: '/data/Download/ghx-0.8.8-debug.apk',
    })
    expect(parsePendingDownload(raw)).toEqual({
      repo: 'zjkl0330/ghx',
      kind: 'apk',
      tag: 'v0.8.8',
      name: 'ghx-0.8.8-debug.apk',
      ok: true,
      bytes: 21500000,
      ms: 4321,
      at: 1794000000000,
      path: '/data/Download/ghx-0.8.8-debug.apk',
    })
  })

  it('ok 只认真正的 true，缺字段一律当失败', () => {
    expect(parsePendingDownload(JSON.stringify({ name: 'x.apk' }))?.ok).toBe(false)
    expect(parsePendingDownload(JSON.stringify({ name: 'x.apk', ok: 'true' }))?.ok).toBe(false)
  })

  it('未知类型退回 asset，不认识的字段丢掉', () => {
    const p = parsePendingDownload(JSON.stringify({ name: 'x.bin', kind: 'weird', junk: 1 }))
    expect(p?.kind).toBe('asset')
    expect(p).not.toHaveProperty('junk')
  })

  it('失败结果带着错误原因', () => {
    const p = parsePendingDownload(JSON.stringify({ name: 'x.apk', ok: false, error: 'HTTP 404' }))
    expect(p?.error).toBe('HTTP 404')
    expect(recordFromPending(p!).status).toBe('failed')
  })
})

describe('recordFromPending', () => {
  it('成功结果转成 done，路径带过去', () => {
    const r = recordFromPending(parsePendingDownload(JSON.stringify({
      repo: 'a/b', kind: 'apk', name: 'x.apk', ok: true, bytes: 10, at: 1, path: '/x.apk',
    }))!)
    expect(r).toMatchObject({ repo: 'a/b', name: 'x.apk', status: 'done', path: '/x.apk', bytes: 10 })
    expect(r.id).toBe(recordId('a/b', 'apk', 'x.apk'))
  })

  it('与手动记的那条是同一个 id，重复不会堆两条', () => {
    const manual = rec({ status: 'failed', at: 1 })
    const fromNative = recordFromPending(
      parsePendingDownload(
        JSON.stringify({ repo: 'zjkl0330/ghx', kind: 'apk', name: 'ghx-0.8.7-debug.apk', ok: true, at: 2 }),
      )!,
    )
    expect(fromNative.id).toBe(manual.id)
    expect(pushRecord([manual], fromNative)).toHaveLength(1)
  })
})

describe('historyTime', () => {  const now = new Date(2026, 10, 20, 17, 30, 0).getTime()

  it('今天只写时刻', () => {
    expect(historyTime(new Date(2026, 10, 20, 9, 5).getTime(), now)).toBe('09:05')
  })

  it('昨天带前缀', () => {
    expect(historyTime(new Date(2026, 10, 19, 23, 59).getTime(), now)).toBe('昨天 23:59')
  })

  it('同年更早写月日', () => {
    expect(historyTime(new Date(2026, 2, 8, 7, 3).getTime(), now)).toBe('03-08 07:03')
  })

  it('跨年写完整日期', () => {
    expect(historyTime(new Date(2025, 11, 31, 22, 0).getTime(), now)).toBe('2025-12-31 22:00')
  })

  it('非法时间给破折号', () => {
    expect(historyTime(Number.NaN)).toBe('—')
    expect(historyTime(0)).toBe('—')
  })
})
