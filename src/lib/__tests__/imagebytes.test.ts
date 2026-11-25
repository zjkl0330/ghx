import { describe, expect, it, vi } from 'vitest'
import {
  LruCache,
  contentsApiPath,
  encodeContentPath,
  isRawImage,
  rawRefCandidates,
} from '../imagebytes'

const RAW = 'https://raw.githubusercontent.com'

describe('raw 图床判定', () => {
  it('只有 raw 主机需要令牌通道', () => {
    expect(isRawImage(`${RAW}/o/r/main/a.png`)).toBe(true)
    expect(isRawImage('https://camo.githubusercontent.com/abc')).toBe(false)
    expect(isRawImage('https://img.shields.io/badge/x-y-blue.svg')).toBe(false)
  })
})

describe('raw 地址反解', () => {
  it('普通地址拆成 owner / repo / ref / path', () => {
    expect(rawRefCandidates(`${RAW}/zjkl0330/UptimeFlare/main/docs/desktop.png`)[0]).toEqual({
      owner: 'zjkl0330',
      repo: 'UptimeFlare',
      ref: 'main',
      path: 'docs/desktop.png',
    })
  })

  it('github blob / raw 地址同构解析', () => {
    expect(rawRefCandidates('https://github.com/o/r/blob/dev/docs/a.png')[0]).toEqual({
      owner: 'o',
      repo: 'r',
      ref: 'dev',
      path: 'docs/a.png',
    })
    expect(rawRefCandidates('https://github.com/o/r/raw/v1.2.0/a.png')[0]).toEqual({
      owner: 'o',
      repo: 'r',
      ref: 'v1.2.0',
      path: 'a.png',
    })
  })

  it('分支名带斜杠时给出多段候选，先按最短分支试', () => {
    const got = rawRefCandidates(`${RAW}/o/r/feature/x/a.png`)
    expect(got.map((c) => `${c.ref}|${c.path}`)).toEqual(['feature|x/a.png', 'feature/x|a.png'])
  })

  it('候选最多三段，避免长路径层层重试', () => {
    const got = rawRefCandidates(`${RAW}/o/r/a/b/c/d/e.png`)
    expect(got).toHaveLength(3)
    expect(got[2]).toEqual({ owner: 'o', repo: 'r', ref: 'a/b/c', path: 'd/e.png' })
  })

  it('query 与 hash 不参与路径', () => {
    expect(rawRefCandidates(`${RAW}/o/r/main/a.png?raw=true#x`)[0].path).toBe('a.png')
  })

  it('百分号编码解码回原文，交给 API 时再编码', () => {
    const [c] = rawRefCandidates(`${RAW}/o/r/main/docs/%E5%9B%BE%201.png`)
    expect(c.path).toBe('docs/图 1.png')
    expect(contentsApiPath(c)).toBe('/repos/o/r/contents/docs/%E5%9B%BE%201.png?ref=main')
  })

  it('不是 github 图床的一律不给候选', () => {
    expect(rawRefCandidates('https://example.com/a.png')).toEqual([])
    expect(rawRefCandidates(`${RAW}/o/r/main.png`)).toEqual([])
    expect(rawRefCandidates('')).toEqual([])
  })
})

describe('contents 路径拼装', () => {
  it('保留斜杠，逐段编码', () => {
    expect(encodeContentPath('a/b c/d.png')).toBe('a/b%20c/d.png')
  })

  it('ref 里的斜杠与特殊字符一起编码', () => {
    expect(contentsApiPath({ owner: 'o', repo: 'r', ref: 'feat/x y', path: 'a.png' })).toBe(
      '/repos/o/r/contents/a.png?ref=feat%2Fx%20y',
    )
  })
})

describe('blob 地址 LRU', () => {
  it('超出容量时淘汰最久未用的，并回调 revoke', () => {
    const evicted: string[] = []
    const cache = new LruCache<string>(2, (_k, v) => evicted.push(v))
    cache.set('a', 'url-a')
    cache.set('b', 'url-b')
    cache.get('a') // a 变新
    cache.set('c', 'url-c') // 淘汰 b
    expect(evicted).toEqual(['url-b'])
    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
  })

  it('重复 set 同一键只保留一份，且更新值', () => {
    const evicted: string[] = []
    const cache = new LruCache<string>(2, (_k, v) => evicted.push(v))
    cache.set('a', 'u1')
    cache.set('a', 'u2')
    expect(cache.size).toBe(1)
    expect(cache.get('a')).toBe('u2')
    expect(evicted).toEqual([])
  })

  it('clear 把每个地址都交回去 revoke', () => {
    const revoke = vi.fn()
    const cache = new LruCache<string>(4, (_k, v) => revoke(v))
    cache.set('a', 'u1')
    cache.set('b', 'u2')
    cache.clear()
    expect(cache.size).toBe(0)
    expect(revoke.mock.calls.map((c) => c[0]).sort()).toEqual(['u1', 'u2'])
  })

  it('容量至少为 1', () => {
    expect(() => new LruCache<string>(0)).toThrow()
  })
})
