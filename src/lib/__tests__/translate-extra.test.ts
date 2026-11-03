import { describe, expect, it, vi } from 'vitest'
import {
  cacheKeyFor,
  hasChinese,
  needsTranslation,
  translateAzureBatch,
  translateBlocks,
  translateChunk,
  translateLongText,
} from '../translate'

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const AZURE_OK = (text: string) => jsonResponse([{ translations: [{ text, to: 'zh-Hans' }] }])

describe('判断是否还需要翻译', () => {
  it('纯英文要翻', () => {
    expect(needsTranslation('A small tool for managing repositories.')).toBe(true)
  })

  it('纯中文不翻', () => {
    expect(needsTranslation('这是一个用来管理仓库的小工具，支持本地缓存。')).toBe(false)
  })

  it('中文里夹了一堆英文时仍然要翻（旧判定会漏掉）', () => {
    const mixed =
      '用于渲染 Markdown 的工具，支持 syntax highlighting 与 custom themes，还有 plugin system 和 dark mode'
    // 旧的按 15% 中文占比判定会认为「已经是中文」而跳过，这正是漏翻的来源
    expect(hasChinese(mixed)).toBe(true)
    expect(needsTranslation(mixed)).toBe(true)
  })

  it('目标英文时，中文内容要翻', () => {
    expect(needsTranslation('这是一个中文简介。', 'en')).toBe(true)
    expect(needsTranslation('Already written in English.', 'en')).toBe(false)
  })

  it('目标日文时，有假名就认为已经是日文', () => {
    expect(needsTranslation('これは日本語の説明です。', 'ja')).toBe(false)
    expect(needsTranslation('A tool for repos.', 'ja')).toBe(true)
  })
})

describe('长段落分段翻译', () => {
  it('超过单次上限时切分成多次请求，并按顺序拼回', async () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about repositories.`).join(' ')
    const f = vi.fn(async (url: string) => {
      const q = decodeURIComponent(url.split('q=')[1].split('&')[0])
      return jsonResponse({ responseData: { translatedText: `译:${q.length}` } })
    })
    const r = await translateLongText(long, {
      fetchImpl: f as unknown as typeof fetch,
      channel: 'mymemory',
    })
    expect(f.mock.calls.length).toBeGreaterThan(1)
    expect(r.text.startsWith('译:')).toBe(true)
    // 每一段都翻过，拼回来的长度与段数对得上
    expect(r.text.split('译:').length - 1).toBe(f.mock.calls.length)
  })

  it('某一段失败时只留那一段原文，其余仍然翻译', async () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about repositories.`).join(' ')
    let n = 0
    const f = vi.fn(async (url: string) => {
      n += 1
      if (n === 1) throw new Error('blocked')
      const q = decodeURIComponent(url.split('q=')[1].split('&')[0])
      return jsonResponse({ responseData: { translatedText: `译:${q.slice(0, 6)}` } })
    })
    const r = await translateLongText(long, {
      fetchImpl: f as unknown as typeof fetch,
      channel: 'mymemory',
    })
    expect(r.text).toContain('Sentence number 0')
    expect(r.text).toContain('译:')
  })
})

describe('微软通道', () => {
  it('带密钥时按 Azure 协议发请求', async () => {
    const f = vi.fn(async () => AZURE_OK('你好'))
    const r = await translateChunk('hello', {
      fetchImpl: f as unknown as typeof fetch,
      channel: 'azure',
      azureKey: 'k123',
    })
    expect(r.channel).toBe('azure')
    expect(r.text).toBe('你好')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('api.cognitive.microsofttranslator.com/translate')
    expect(url).toContain('to=zh-CN')
    expect((init.headers as Record<string, string>)['Ocp-Apim-Subscription-Key']).toBe('k123')
    expect(JSON.parse(String(init.body))).toEqual([{ Text: 'hello' }])
  })

  it('自动模式配了密钥就先走微软，一次成功', async () => {
    const calls: string[] = []
    const f = vi.fn(async (url: string) => {
      calls.push(url.includes('microsoft') ? 'azure' : url.includes('mymemory') ? 'mymemory' : 'google')
      return AZURE_OK('嗨')
    })
    const r = await translateChunk('hi', {
      fetchImpl: f as unknown as typeof fetch,
      azureKey: 'k',
    })
    expect(r.channel).toBe('azure')
    expect(calls).toEqual(['azure'])
  })

  it('没填密钥时微软通道直接报可读错误', async () => {
    const f = vi.fn(async () => AZURE_OK('x'))
    await expect(
      translateChunk('hi', { fetchImpl: f as unknown as typeof fetch, channel: 'azure' }),
    ).rejects.toThrow(/密钥/)
    expect(f).not.toHaveBeenCalled()
  })

  it('密钥无效时给出明确提示', async () => {
    const f = vi.fn(async () => jsonResponse({ error: {} }, 401))
    await expect(
      translateChunk('hi', { fetchImpl: f as unknown as typeof fetch, channel: 'azure', azureKey: 'bad' }),
    ).rejects.toThrow(/无效|额度/)
  })

  it('批量翻译一次请求返回多条，顺序对齐', async () => {
    const f = vi.fn(async () =>
      jsonResponse([
        { translations: [{ text: '甲' }] },
        { translations: [{ text: '乙' }] },
      ]),
    )
    const out = await translateAzureBatch(['a', 'b'], {
      fetchImpl: f as unknown as typeof fetch,
      azureKey: 'k',
    })
    expect(out).toEqual(['甲', '乙'])
    expect(f).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(body).toEqual([{ Text: 'a' }, { Text: 'b' }])
  })

  it('批量请求失败时返回 null 交给调用方兜底', async () => {
    const f = vi.fn(async () => jsonResponse({}, 429))
    const out = await translateAzureBatch(['a'], {
      fetchImpl: f as unknown as typeof fetch,
      azureKey: 'k',
    })
    expect(out).toEqual([null])
  })
})

describe('缓存键', () => {
  it('默认中文沿用旧键，历史缓存不失效', () => {
    expect(cacheKeyFor({}, 'hello')).toBe(cacheKeyFor({ target: 'zh-CN' }, 'hello'))
  })

  it('换语言换键，避免把上一门语言的译文当成命中', () => {
    expect(cacheKeyFor({ target: 'ja' }, 'hello')).not.toBe(cacheKeyFor({ target: 'zh-CN' }, 'hello'))
  })
})

describe('README 块翻译不再漏段', () => {
  const longQuote = Array.from(
    { length: 30 },
    (_, i) => `Line ${i} explains how the agent behaves in production.`,
  ).join(' ')

  it('超长引用块会被切段翻译，而不是整段留在英文', async () => {
    // 模拟真实的 MyMemory：单段超过 450 字节直接拒绝
    const f = vi.fn(async (url: string) => {
      const q = decodeURIComponent(url.split('q=')[1].split('&')[0])
      if (new TextEncoder().encode(q).length > 450) {
        return jsonResponse({ responseData: { translatedText: 'QUERY LENGTH LIMIT EXCEEDED' } })
      }
      return jsonResponse({ responseData: { translatedText: '译文段落' } })
    })
    const out = await translateBlocks(
      [{ kind: 'quote', text: longQuote }],
      { fetchImpl: f as unknown as typeof fetch, channel: 'mymemory', maxBlocks: 5 },
    )
    expect(out.translated).toBe(1)
    expect(out.blocks[0].text).toContain('译文段落')
    expect(out.blocks[0].text).not.toContain('QUERY LENGTH')
  })

  it('中英混排的段落也会翻（旧逻辑会当成中文跳过）', async () => {
    const f = vi.fn(async () => jsonResponse({ responseData: { translatedText: '混合译文' } }))
    const mixed = '用于渲染 Markdown 的工具，支持 syntax highlighting 与 custom themes，还有 plugin system 和 dark mode'
    const out = await translateBlocks([{ kind: 'p', text: mixed }], {
      fetchImpl: f as unknown as typeof fetch,
      channel: 'mymemory',
    })
    expect(out.translated).toBe(1)
    expect(out.blocks[0].text).toBe('混合译文')
  })
})
