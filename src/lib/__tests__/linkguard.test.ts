import { describe, expect, it } from 'vitest'
import { guardInline, unguardInline, GUARD_L, GUARD_R, type InlineGuardCtx } from '../linkguard'
import { parseInline } from '../markdown'
import type { Span } from '../markdown'

const ctxOf = (...kinds: string[]): InlineGuardCtx => ({
  tokens: kinds.map((k) =>
    k === 'link' ? { kind: 'link', href: 'https://x' } : ({ kind: k } as InlineGuardCtx['tokens'][number]),
  ),
})

describe('guardInline', () => {
  it('没有任何要保护的片段返回 null，不折腾', () => {
    expect(guardInline(parseInline('就是一段普通文字'))).toBeNull()
    expect(guardInline(undefined)).toBeNull()
    expect(guardInline([])).toBeNull()
  })

  it('链接标签换成 ⟦⟧ 占位，地址按出现顺序记录', () => {
    const spans = parseInline('见 [安装指南](https://x/guide) 与 [FAQ](https://x/faq)')
    const g = guardInline(spans)
    expect(g).not.toBeNull()
    expect(g!.ctx.tokens).toEqual([
      { kind: 'link', href: 'https://x/guide' },
      { kind: 'link', href: 'https://x/faq' },
    ])
    expect(g!.text).toContain(`${GUARD_L}安装指南${GUARD_R}`)
    expect(g!.text).toContain(`${GUARD_L}FAQ${GUARD_R}`)
    expect(g!.text).not.toContain('https://')
  })

  it('粗体/斜体/删除线也占位：翻译不再把格式揉掉', () => {
    const spans = parseInline('加了 **OpenAI Codex** 和 *轻量* 与 ~~旧版~~ 支持')
    const g = guardInline(spans)
    expect(g).not.toBeNull()
    expect(g!.ctx.tokens.map((t) => t.kind)).toEqual(['strong', 'em', 'del'])
    expect(g!.text).toContain(`${GUARD_L}OpenAI Codex${GUARD_R}`)
    expect(g!.text).toContain(`${GUARD_L}轻量${GUARD_R}`)
    expect(g!.text).toContain(`${GUARD_L}旧版${GUARD_R}`)
    // 送进通道的文字里不该再有 markdown 标记，否则会被当成正文翻
    expect(g!.text).not.toContain('**')
  })

  it('链接与粗体混排时按出现顺序排 token', () => {
    const spans = parseInline('**新**功能见 [指南](https://x/g) 或 **旧**版')
    const g = guardInline(spans)!
    expect(g.ctx.tokens.map((t) => t.kind)).toEqual(['strong', 'link', 'strong'])
    expect(g.text).toBe(`${GUARD_L}新${GUARD_R}功能见 ${GUARD_L}指南${GUARD_R} 或 ${GUARD_L}旧${GUARD_R}版`)
  })

  it('标签里混入 ⟦⟧ 时先剥掉，不影响恢复', () => {
    const spans: Span[] = [
      { t: 'text', v: '前' },
      { t: 'link', v: '带⟦怪⟧标签', href: 'https://x' },
    ]
    const g = guardInline(spans)
    expect(g!.text).toBe(`前${GUARD_L}带怪标签${GUARD_R}`)
  })
})

describe('unguardInline', () => {
  it('按出现顺序回填地址，标签用译文', () => {
    const t = `详情见${GUARD_L}安装指南${GUARD_R}，问题看${GUARD_L}常见问题${GUARD_R}。`
    const r = unguardInline(t, ctxOf('link', 'link'))
    expect(r).not.toBeNull()
    expect(r!.text).toBe('详情见安装指南，问题看常见问题。')
    const links = r!.spans.filter((s) => s.t === 'link') as Extract<Span, { t: 'link' }>[]
    expect(links).toHaveLength(2)
    expect(links[0]).toEqual({ t: 'link', v: '安装指南', href: 'https://x' })
  })

  it('粗体/斜体按 token 类型回填，标签用译文', () => {
    const t = `新增${GUARD_L}OpenAI Codex 订阅${GUARD_R}与${GUARD_L}图像生成${GUARD_R}。`
    const r = unguardInline(t, ctxOf('strong', 'em'))
    const strong = r!.spans.filter((s) => s.t === 'strong')
    const em = r!.spans.filter((s) => s.t === 'em')
    expect(strong).toHaveLength(1)
    expect(strong[0]).toMatchObject({ v: 'OpenAI Codex 订阅' })
    expect(em).toHaveLength(1)
    expect(em[0]).toMatchObject({ v: '图像生成' })
    expect(r!.text).toBe('新增OpenAI Codex 订阅与图像生成。')
  })

  it('一个占位符都没活下来时返回 null，退回纯译文', () => {
    expect(unguardInline('整段译文没有任何占位符', ctxOf('link'))).toBeNull()
  })

  it('通道吞了部分占位符时整段降级纯文字 —— 不按顺序硬配', () => {
    const t = `开头${GUARD_L}被保留的${GUARD_R}结尾`
    const r = unguardInline(t, ctxOf('link', 'link'))
    // 2 个 token 只活了 1 个：硬配会把「被保留的」配上第一个地址，
    // 但它未必是第一条链接的标签 —— 错位的链接比死文字更糟
    expect(r).not.toBeNull()
    expect(r!.spans.every((s) => s.t === 'text')).toBe(true)
    expect(r!.text).not.toMatch(/[\u27E6\u27E7]/)
  })

  it('占位符比 token 多时同样整段降级，不猜哪个是正文自带的括号', () => {
    const t = `正${GUARD_L}文${GUARD_R}里${GUARD_L}自带的${GUARD_R}括号`
    const r = unguardInline(t, ctxOf('link'))
    expect(r!.spans.every((s) => s.t === 'text')).toBe(true)
    expect(r!.text).toContain('自带的')
  })

  it('孤立残留的 ⟦⟧ 一律清除，不出怪字', () => {
    const t = `保留${GUARD_L}正常的${GUARD_R}，孤立的${GUARD_L}${GUARD_R}被清掉`
    const r = unguardInline(t, ctxOf('strong'))
    expect(r!.text).not.toMatch(/[\u27E6\u27E7]/)
    expect(r!.text).toContain('孤立的被清掉')
  })

  it('guard → unguard 往返：链接与粗体各自还原', () => {
    const spans = parseInline('**重要**：先看 [releases](https://x/r) 再看 [wiki](https://x/w)')
    const g = guardInline(spans)!
    const r = unguardInline(g.text, g.ctx)
    const links = r!.spans.filter((s) => s.t === 'link') as Extract<Span, { t: 'link' }>[]
    const strong = r!.spans.filter((s) => s.t === 'strong')
    expect(links.map((l) => l.href)).toEqual(['https://x/r', 'https://x/w'])
    expect(strong).toHaveLength(1)
    expect(strong[0]).toMatchObject({ v: '重要' })
    expect(r!.text).not.toContain('https://')
    expect(r!.text).not.toContain('**')
  })
})
