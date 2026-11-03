import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AUTO_TRANSLATE,
  DEFAULT_CHANNEL,
  GOOGLE_MAX_BYTES,
  MYMEMORY_MAX_BYTES,
  TranslateError,
  byteLength,
  hasChinese,
  hashText,
  memoryStore,
  normalizeAutoTranslate,
  normalizeChannel,
  splitByBytes,
  translateBlocks,
  translateChunk,
  translateText,
  unescapeHtml,
} from '../translate'

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

/** Edge 端点返回的是 text/plain 的 JSON 串，走 res.text() */
function textResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

const mymemoryOk = (text: string) =>
  vi.fn(async () => jsonResponse({ responseData: { translatedText: text }, responseStatus: 200 }))

describe('分段', () => {
  it('短段落原样保留', () => {
    expect(splitByBytes('Hello world')).toEqual(['Hello world'])
  })

  it('按空行切成多段', () => {
    expect(splitByBytes('第一段\n\n第二段')).toEqual(['第一段', '第二段'])
  })

  it('超长段落按句子切开', () => {
    const s = 'This is one sentence. '.repeat(40)
    const chunks = splitByBytes(s, 100)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(byteLength(c)).toBeLessThanOrEqual(100)
  })

  it('超长单句被硬切，不会超上限', () => {
    const s = 'a'.repeat(500)
    const chunks = splitByBytes(s, 120)
    expect(chunks.length).toBeGreaterThan(3)
    for (const c of chunks) expect(byteLength(c)).toBeLessThanOrEqual(120)
  })

  it('中文按字节算而不是按字数', () => {
    const s = '这是一个中文句子。'.repeat(10)
    expect(byteLength(s)).toBeGreaterThan(s.length)
    const chunks = splitByBytes(s, 100)
    for (const c of chunks) expect(byteLength(c)).toBeLessThanOrEqual(100)
  })

  it('默认上限与通道匹配', () => {
    expect(MYMEMORY_MAX_BYTES).toBeLessThan(500)
    expect(GOOGLE_MAX_BYTES).toBeGreaterThan(MYMEMORY_MAX_BYTES)
  })

  it('空文本返回空数组', () => {
    expect(splitByBytes('   \n\n  ')).toEqual([])
  })
})

describe('辅助函数', () => {
  it('识别已经是中文的段落', () => {
    expect(hasChinese('这是一个中文说明')).toBe(true)
    expect(hasChinese('This is English text only')).toBe(false)
    // 少量中文夹在英文里不算，避免半截翻译
    expect(hasChinese('Use the ghx tool to manage your GitHub repositories 工具')).toBe(false)
  })

  it('反转义通道返回的实体', () => {
    expect(unescapeHtml('a&#10;b')).toBe('a\nb')
    expect(unescapeHtml('&lt;tag&gt; &amp; &quot;q&quot;')).toBe('<tag> & "q"')
  })

  it('哈希对同一内容稳定，对不同内容不同', () => {
    expect(hashText('abc')).toBe(hashText('abc'))
    expect(hashText('abc')).not.toBe(hashText('abd'))
  })
})

describe('通道', () => {
  it('MyMemory 正常返回译文', async () => {
    const f = mymemoryOk('你好')
    const r = await translateChunk('hello', { fetchImpl: f as unknown as typeof fetch, channel: 'mymemory' })
    expect(r.text).toBe('你好')
    expect(r.channel).toBe('mymemory')
  })

  it('MyMemory 返回警告串时判为失败', async () => {
    const f = vi.fn(async () => jsonResponse({ responseData: { translatedText: 'MYMEMORY WARNING: quota' } }))
    await expect(
      translateChunk('hello', { fetchImpl: f as unknown as typeof fetch, channel: 'mymemory' }),
    ).rejects.toBeInstanceOf(TranslateError)
  })

  it('自动模式先 Edge，失败再 MyMemory / Google', async () => {
    const calls: string[] = []
    const f = vi.fn(async (url: string) => {
      const kind = url.includes('edge.microsoft.com')
        ? 'edge'
        : url.includes('mymemory')
          ? 'mymemory'
          : 'google'
      calls.push(kind)
      if (kind !== 'google') throw new Error('blocked')
      return jsonResponse([[['你好', 'hello', null, null, 10]], null, 'en'])
    })
    const r = await translateChunk('hello', { fetchImpl: f as unknown as typeof fetch })
    expect(r.channel).toBe('google')
    expect(r.text).toBe('你好')
    expect(calls).toEqual(['edge', 'mymemory', 'google'])
  })

  it('Edge 通道正常返回，且不带 from 让服务端自动识别', async () => {
    const f = vi.fn(async () => textResponse([{ translations: [{ text: '你好，世界', to: 'zh-Hans' }] }]))
    const r = await translateChunk('hello world', {
      fetchImpl: f as unknown as typeof fetch,
      channel: 'edge',
    })
    expect(r.channel).toBe('edge')
    expect(r.text).toBe('你好，世界')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('edge.microsoft.com/translate/translatetext')
    expect(url).toContain('to=zh-CN')
    // 带 from=en 会把中文段落改坏，所以必须省略
    expect(url).not.toMatch(/[?&]from=/)
    expect(JSON.parse(String(init.body))).toEqual(['hello world'])
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('Edge 返回 400 时抛错，交给下一个通道', async () => {
    const f = vi.fn(async () => textResponse({ error: 'too long' }, 400))
    await expect(
      translateChunk('hi', { fetchImpl: f as unknown as typeof fetch, channel: 'edge' }),
    ).rejects.toBeInstanceOf(TranslateError)
  })

  it('Edge 返回非 JSON 时按结构异常处理', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, text: async () => '<html>' }) as unknown as Response)
    await expect(
      translateChunk('hi', { fetchImpl: f as unknown as typeof fetch, channel: 'edge' }),
    ).rejects.toThrow(/JSON/)
  })

  it('指定 edge 时不打其它通道', async () => {
    const f = vi.fn(async () => textResponse([{ translations: [{ text: '嗨' }] }]))
    await translateChunk('hi', { fetchImpl: f as unknown as typeof fetch, channel: 'edge' })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('指定 google 时不会去试 MyMemory', async () => {
    const f = vi.fn(async () => jsonResponse([[['嗨', 'hi', null, null, 10]], null, 'en']))
    const r = await translateChunk('hi', { fetchImpl: f as unknown as typeof fetch, channel: 'google' })
    expect(r.channel).toBe('google')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('两个通道都失败时抛错', async () => {
    const f = vi.fn(async () => jsonResponse({}, 500))
    await expect(translateChunk('x', { fetchImpl: f as unknown as typeof fetch })).rejects.toBeInstanceOf(
      TranslateError,
    )
  })

  it('Google 返回结构异常时判为失败', async () => {
    const f = vi.fn(async () => jsonResponse({ nope: 1 }))
    await expect(
      translateChunk('x', { fetchImpl: f as unknown as typeof fetch, channel: 'google' }),
    ).rejects.toBeInstanceOf(TranslateError)
  })
})

describe('整段翻译', () => {
  it('分段翻译后按段落拼回', async () => {
    const f = vi.fn(async (url: string) => {
      const q = decodeURIComponent(url.split('q=')[1].split('&')[0])
      return jsonResponse({ responseData: { translatedText: `译:${q}` }, responseStatus: 200 })
    })
    const r = await translateText('one\n\ntwo', {
      fetchImpl: f as unknown as typeof fetch,
      channel: 'mymemory',
    })
    expect(r.text).toBe('译:one\n\n译:two')
    expect(r.total).toBe(2)
  })

  it('第二次同样的内容全部命中缓存，不再请求', async () => {
    const f = vi.fn(async () =>
      jsonResponse({ responseData: { translatedText: '你好' }, responseStatus: 200 }),
    )
    const store = memoryStore()
    const opts = { fetchImpl: f as unknown as typeof fetch, channel: 'mymemory' as const, store }
    await translateText('hello', opts)
    const second = await translateText('hello', opts)
    expect(f).toHaveBeenCalledTimes(1)
    expect(second.cached).toBe(1)
    expect(second.channel).toBe('cached')
  })

  it('单段失败保留原文，不影响其他段', async () => {
    let n = 0
    const f = vi.fn(async () => {
      n += 1
      if (n === 1) throw new Error('boom')
      return jsonResponse({ responseData: { translatedText: '第二段译文' }, responseStatus: 200 })
    })
    const r = await translateText('first\n\nsecond', {
      fetchImpl: f as unknown as typeof fetch,
      channel: 'mymemory',
      concurrency: 1,
    })
    expect(r.text).toContain('first')
    expect(r.text).toContain('第二段译文')
  })

  it('maxChunks 限制请求段数', async () => {
    const f = vi.fn(async () =>
      jsonResponse({ responseData: { translatedText: 'x' }, responseStatus: 200 }),
    )
    const text = Array.from({ length: 10 }, (_, i) => `p${i}`).join('\n\n')
    const r = await translateText(text, {
      fetchImpl: f as unknown as typeof fetch,
      channel: 'mymemory',
      maxChunks: 3,
    })
    expect(r.total).toBe(3)
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('空文本不发请求', async () => {
    const f = vi.fn()
    const r = await translateText('   ', { fetchImpl: f as unknown as typeof fetch })
    expect(r.total).toBe(0)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('阅读偏好归一化', () => {
  it('合法通道原样返回，大小写与空白不影响', () => {
    expect(normalizeChannel('google')).toBe('google')
    expect(normalizeChannel(' MyMemory ')).toBe('mymemory')
    expect(normalizeChannel('AUTO')).toBe('auto')
  })

  it('空值、旧值与脏数据回落到默认通道', () => {
    expect(normalizeChannel(null)).toBe(DEFAULT_CHANNEL)
    expect(normalizeChannel('')).toBe(DEFAULT_CHANNEL)
    expect(normalizeChannel('baidu')).toBe(DEFAULT_CHANNEL)
  })

  it('自动翻译未存过时默认开启', () => {
    expect(DEFAULT_AUTO_TRANSLATE).toBe(true)
    expect(normalizeAutoTranslate(null)).toBe(true)
    expect(normalizeAutoTranslate('')).toBe(true)
  })

  it('明确的关闭值才关，乱七八糟的值不误关', () => {
    expect(normalizeAutoTranslate('off')).toBe(false)
    expect(normalizeAutoTranslate('0')).toBe(false)
    expect(normalizeAutoTranslate('false')).toBe(false)
    expect(normalizeAutoTranslate('on')).toBe(true)
    expect(normalizeAutoTranslate('谁写的')).toBe(true)
  })
})

describe('段落翻译的失败计数', () => {
  it('所有段落都失败时 translated 为 0，好让界面提示', async () => {
    const f = vi.fn(async () => {
      throw new Error('network down')
    })
    const r = await translateBlocks(
      [
        { kind: 'p' as const, text: 'hello world' },
        { kind: 'p' as const, text: 'second paragraph' },
      ],
      { fetchImpl: f as unknown as typeof fetch, channel: 'mymemory' },
    )
    expect(r.total).toBe(2)
    expect(r.translated).toBe(0)
    expect(r.blocks[0].text).toBe('hello world')
  })

  it('部分成功时按成功的段数计', async () => {
    let n = 0
    const f = vi.fn(async () => {
      n += 1
      if (n === 1) return jsonResponse({ responseData: { translatedText: '第一段' }, responseStatus: 200 })
      throw new Error('boom')
    })
    const r = await translateBlocks(
      [
        { kind: 'p' as const, text: 'first one' },
        { kind: 'p' as const, text: 'second one' },
      ],
      { fetchImpl: f as unknown as typeof fetch, channel: 'mymemory', concurrency: 1 },
    )
    expect(r.translated).toBe(1)
    expect(r.blocks[0].text).toBe('第一段')
    expect(r.blocks[1].text).toBe('second one')
  })
})

describe('实体反转义', () => {
  it('全角分号与空格夹住的数字实体也能解', () => {
    expect(unescapeHtml('什么&# 39；新')).toBe("什么'新")
  })

  it('十六进制实体与常用命名实体一起处理', () => {
    expect(unescapeHtml('a&#x27;b&nbsp;c')).toBe("a'b c")
  })

  it('换行与制表仍是控制字符', () => {
    expect(unescapeHtml('一&#10;二&#9;三')).toBe('一\n二\t三')
  })
})

describe('长自述分批', () => {
  const okFetch = () =>
    vi.fn(async () => jsonResponse({ responseData: { translatedText: '译文' }, responseStatus: 200 }))

  it('一批只翻 maxBlocks 段，并交回下一批的起点与剩余数', async () => {
    const blocks = Array.from({ length: 5 }, (_, i) => ({ kind: 'p' as const, text: `para ${i}` }))
    const r = await translateBlocks(blocks, {
      fetchImpl: okFetch() as unknown as typeof fetch,
      channel: 'mymemory',
      maxBlocks: 2,
    })
    expect(r.total).toBe(2)
    expect(r.next).toBe(2)
    expect(r.remaining).toBe(3)
    expect(r.translated).toBe(2)
  })

  it('续翻接在已翻结果之后，前面批次的译文不会被覆盖', async () => {
    const blocks = [
      { kind: 'p' as const, text: 'one' },
      { kind: 'p' as const, text: 'two' },
      { kind: 'p' as const, text: 'three' },
    ]
    const first = await translateBlocks(blocks, {
      fetchImpl: okFetch() as unknown as typeof fetch,
      channel: 'mymemory',
      maxBlocks: 1,
    })
    const second = await translateBlocks(first.blocks, {
      fetchImpl: okFetch() as unknown as typeof fetch,
      channel: 'mymemory',
      maxBlocks: 5,
      skip: first.next,
    })
    expect(second.total).toBe(2)
    expect(second.remaining).toBe(0)
    expect(second.blocks[0].text).toBe('译文')
    expect(second.blocks[2].text).toBe('译文')
  })

  it('代码块与中文段落不占批次额度', async () => {
    const blocks = [
      { kind: 'code' as const, text: 'const a = 1' },
      { kind: 'p' as const, text: '这是中文段落' },
      { kind: 'p' as const, text: 'english one' },
      { kind: 'hr' as const },
      { kind: 'p' as const, text: 'english two' },
    ]
    const r = await translateBlocks(blocks, {
      fetchImpl: okFetch() as unknown as typeof fetch,
      channel: 'mymemory',
      maxBlocks: 1,
    })
    expect(r.total).toBe(1)
    expect(r.remaining).toBe(1)
    expect(r.blocks[2].text).toBe('译文')
    expect(r.blocks[0].text).toBe('const a = 1')
  })

  it('skip 超过总段数时不再发请求', async () => {
    const f = vi.fn()
    const r = await translateBlocks(
      [{ kind: 'p' as const, text: 'only one' }],
      { fetchImpl: f as unknown as typeof fetch, channel: 'mymemory', skip: 9 },
    )
    expect(f).not.toHaveBeenCalled()
    expect(r.total).toBe(0)
    expect(r.remaining).toBe(0)
  })
})
