import { describe, expect, it } from 'vitest'
import { applyInline, inlineGuard, planInline } from '../linkguard'
import { parseInline } from '../markdown'
import type { Span } from '../markdown'

const roundTrip = (raw: string, parts: string[], target = 'zh-CN') => {
  const plan = planInline(parseInline(raw), target)
  expect(plan).not.toBeNull()
  return applyInline(parts, plan!.ctx)
}

describe('planInline', () => {
  it('纯中文段落不折腾，直接走原文', () => {
    expect(planInline(parseInline('就是一段普通文字'))).toBeNull()
    expect(planInline(undefined)).toBeNull()
    expect(planInline([])).toBeNull()
  })

  it('英文段落进片段，链接地址不送进通道', () => {
    const plan = planInline(parseInline('See [the guide](https://x/guide) for details'))!
    expect(plan.parts).toEqual(['See ', 'the guide', ' for details'])
    expect(plan.parts.join('')).not.toContain('https://')
    expect(plan.ctx.parts.filter((p) => p.kind === 'link')).toHaveLength(1)
    expect(plan.ctx.parts.find((p) => p.kind === 'link')!.href).toBe('https://x/guide')
  })

  it('裸地址标签不送翻：通道改写它只会把链接变成正文', () => {
    const plan = planInline(parseInline('稳定版在 https://github.com/x/y 上可用'))!
    const link = plan.ctx.parts.find((p) => p.kind === 'link')!
    expect(link.translate).toBe(false)
    expect(plan.parts).not.toContain('https://github.com/x/y')
  })

  it('粗体/斜体/删除线各成片段，送翻时不带 markdown 标记', () => {
    const plan = planInline(parseInline('Add **OpenAI Codex** and *lightweight* with ~~legacy~~ support'))!
    expect(plan.parts).toContain('OpenAI Codex')
    expect(plan.parts).toContain('lightweight')
    expect(plan.parts).toContain('legacy')
    expect(plan.parts.join('')).not.toContain('**')
  })

  it('emoji 与符号片段不送翻：通道啃不动它，也就不会变成 ◆◆', () => {
    const spans: Span[] = [
      { t: 'text', v: 'Stable Edition ' },
      { t: 'text', v: '🡒' },
      { t: 'text', v: ' available' },
    ]
    const plan = planInline(spans)!
    expect(plan.parts).toEqual(['Stable Edition ', ' available'])
    expect(plan.parts.join('')).not.toContain('🡒')
  })

  it('目标已是中文时不把中文片段再翻一遍', () => {
    const plan = planInline(parseInline('稳定版在 [🡒](https://x) 上可用'), 'zh-CN')!
    expect(plan.parts).toEqual([])
    expect(plan.ctx.parts.map((p) => p.kind)).toEqual(['text', 'link', 'text'])
  })

  it('只有结构、没有可翻文字时也返回计划 —— 结构由本地拼回', () => {
    const plan = planInline(parseInline('看 [文档](https://x/d)'))!
    expect(plan.parts).toEqual([])
    expect(plan.ctx.parts).toHaveLength(2)
  })
})

describe('applyInline', () => {
  it('按片段顺序回填，链接 href 与数量一个不少', () => {
    const r = roundTrip('See [Install guide](https://x/guide) and [FAQ](https://x/faq)', [
      '见 ',
      '安装手册',
      ' 与 ',
      '常见问题',
    ])!
    const links = r.spans.filter((s) => s.t === 'link') as Extract<Span, { t: 'link' }>[]
    expect(links).toHaveLength(2)
    expect(links[0]).toEqual({ t: 'link', v: '安装手册', href: 'https://x/guide' })
    expect(links[1]).toEqual({ t: 'link', v: '常见问题', href: 'https://x/faq' })
    expect(r.text).toBe('见 安装手册 与 常见问题')
  })

  it('链接顺序与原文一致：即使译文把地址挪了位也不受影响', () => {
    const r = roundTrip('First [A](https://x/a) then [B](https://x/b)', [
      '先 ',
      'A2',
      ' 再 ',
      'B2',
    ])!
    const links = r.spans.filter((s) => s.t === 'link') as Extract<Span, { t: 'link' }>[]
    expect(links.map((l) => l.href)).toEqual(['https://x/a', 'https://x/b'])
  })

  it('纯 URL 标签原样保留，不因翻译变成别的内容', () => {
    const plan = planInline(
      parseInline('Stable: https://github.com/SoftEtherVPN/SoftEtherVPN_Stable is ready'),
    )!
    // 只有两段英文文字要翻
    const r = applyInline(['稳定版：', ' 已就绪'], plan.ctx)!
    const link = r.spans.find((s) => s.t === 'link') as Extract<Span, { t: 'link' }>
    expect(link.v).toBe('https://github.com/SoftEtherVPN/SoftEtherVPN_Stable')
    expect(link.href).toBe('https://github.com/SoftEtherVPN/SoftEtherVPN_Stable')
    expect(r.text).not.toMatch(/[\u27E6\u27E7\u3016\u3017]/)
  })

  it('译文缺一条就整体放弃 —— 宁可这段不翻，也不硬配错位', () => {
    const plan = planInline(parseInline('See [A](https://x/a) and [B](https://x/b)'))!
    expect(applyInline(['看 ', '甲'], plan.ctx)).toBeNull()
    expect(applyInline(['看 ', '甲', ' 和 '], plan.ctx)).toBeNull()
  })

  it('译文混进替换字符时放弃，正文不出现 ◆◆/�', () => {
    const plan = planInline(parseInline('Stable edition is available on the server'))!
    expect(applyInline(['稳定版\uFFFD\uFFFD可用'], plan.ctx)).toBeNull()
    expect(applyInline(['稳定版\u25C6\u25C6可用'], plan.ctx)).toBeNull()
  })

  it('原文的 emoji 在译文里丢了（变成 ? 或消失）也放弃', () => {
    const plan = planInline(parseInline('Stable edition 🡒 is available'))!
    expect(applyInline(['稳定版?已可用'], plan.ctx)).toBeNull()
    expect(applyInline(['稳定版已可用'], plan.ctx)).toBeNull()
    // emoji 还在就照常采用
    expect(applyInline(['稳定版 🡒 已可用'], plan.ctx)?.text).toBe('稳定版 🡒 已可用')
  })

  it('译文为空串时保留原文，不在句子里留洞', () => {
    const plan = planInline(parseInline('Release notes are here'))!
    const r = applyInline([''], plan.ctx)!
    expect(r.text).toBe('Release notes are here')
  })

  it('相邻文本合并成一个 span，不把一行切碎', () => {
    const r = roundTrip('a [L](https://x) b', ['甲 ', 'L2', ' 乙'])!
    const texts = r.spans.filter((s) => s.t === 'text')
    expect(texts.length).toBeLessThanOrEqual(2)
    for (const t of texts) expect(t.v.length).toBeGreaterThan(0)
  })

  it('ctx 不对时返回 null，调用方保留原文', () => {
    expect(applyInline(['x'], null)).toBeNull()
    expect(applyInline(['x'], {})).toBeNull()
  })
})

describe('inlineGuard', () => {
  it('guard → restore 往返：链接、粗体、顺序全部保住', () => {
    const b = {
      kind: 'p' as const,
      text: '**重要**：先看 [releases](https://x/r) 再看 [wiki](https://x/w)',
      spans: parseInline('**重要**：先看 [releases](https://x/r) 再看 [wiki](https://x/w)'),
      spansFor: '重要：先看 releases 再看 wiki',
    }
    const g = inlineGuard<typeof b>('zh-CN')
    const plan = g.protect(b)!
    expect(plan.parts.length).toBeGreaterThan(0)
    const out = g.restore(b, plan.parts.map((p) => `译:${p}`), plan.ctx)!
    const links = (out.spans ?? []).filter((s) => s.t === 'link') as Extract<Span, { t: 'link' }>[]
    expect(links.map((l) => l.href)).toEqual(['https://x/r', 'https://x/w'])
    expect(out.text).not.toContain('https://')
    expect(out.text).not.toContain('**')
  })

  it('restore 拿不到完整译文时返回 null，让 translateBlocks 保留原块', () => {
    const b = { kind: 'p' as const, text: 'See [guide](https://x)', spans: parseInline('See [guide](https://x)') }
    const g = inlineGuard<typeof b>('zh-CN')
    const plan = g.protect(b)!
    expect(g.restore(b, [], plan.ctx)).toBeNull()
  })
})
