import { describe, expect, it } from 'vitest'
import { guardLinks, unguardLinks, GUARD_L, GUARD_R } from '../linkguard'
import { parseInline } from '../markdown'
import type { Span } from '../markdown'

describe('guardLinks', () => {
  it('没有链接的块返回 null，不折腾', () => {
    const spans = parseInline('就是一段**普通**文字')
    expect(guardLinks(spans)).toBeNull()
    expect(guardLinks(undefined)).toBeNull()
  })

  it('链接标签换成 ⟦⟧ 占位，地址按出现顺序记录', () => {
    const spans = parseInline('见 [安装指南](https://x/guide) 与 [FAQ](https://x/faq)')
    const g = guardLinks(spans)
    expect(g).not.toBeNull()
    expect(g!.hrefs).toEqual(['https://x/guide', 'https://x/faq'])
    expect(g!.text).toContain(`${GUARD_L}安装指南${GUARD_R}`)
    expect(g!.text).toContain(`${GUARD_L}FAQ${GUARD_R}`)
    expect(g!.text).not.toContain('https://x/faq'.slice(10))
  })

  it('标签里混入 ⟦⟧ 时先剥掉，不影响恢复', () => {
    const spans: Span[] = [
      { t: 'text', v: '前' },
      { t: 'link', v: '带⟦怪⟧标签', href: 'https://x' },
    ]
    const g = guardLinks(spans)
    expect(g!.text).toBe(`前${GUARD_L}带怪标签${GUARD_R}`)
  })
})

describe('unguardLinks', () => {
  it('按出现顺序回填地址，标签用译文', () => {
    const hrefs = ['https://x/guide', 'https://x/faq']
    const t = `详情见${GUARD_L}安装指南${GUARD_R}，问题看${GUARD_L}常见问题${GUARD_R}。`
    const r = unguardLinks(t, hrefs)
    expect(r).not.toBeNull()
    expect(r!.text).toBe('详情见安装指南，问题看常见问题。')
    const links = r!.spans.filter((s) => s.t === 'link') as Extract<Span, { t: 'link' }>[]
    expect(links).toHaveLength(2)
    expect(links[0]).toEqual({ t: 'link', v: '安装指南', href: 'https://x/guide' })
    expect(links[1]).toEqual({ t: 'link', v: '常见问题', href: 'https://x/faq' })
  })

  it('一个占位符都没活下来时返回 null，退回纯译文', () => {
    expect(unguardLinks('整段译文没有任何占位符', ['https://x'])).toBeNull()
  })

  it('通道吞了部分占位符时，活下来的照常回填', () => {
    const t = `开头${GUARD_L}被保留的${GUARD_R}结尾`
    const r = unguardLinks(t, ['https://a', 'https://b'])
    expect(r!.spans.filter((s) => s.t === 'link')).toHaveLength(1)
  })

  it('占位符比地址多时，多余的标签降级成文字', () => {
    const t = `正${GUARD_L}文${GUARD_R}里${GUARD_L}自带的${GUARD_R}括号`
    const r = unguardLinks(t, ['https://only-one'])
    const links = r!.spans.filter((s) => s.t === 'link')
    expect(links).toHaveLength(1)
    expect(r!.text).toContain('自带的')
  })

  it('孤立残留的 ⟦⟧ 一律清除，不出怪字', () => {
    const t = `保留${GUARD_L}正常的${GUARD_R}，孤立的${GUARD_L}${GUARD_R}被清掉`
    const r = unguardLinks(t, ['https://x'])
    expect(r!.text).not.toMatch(/[\u27E6\u27E7]/)
    expect(r!.text).toContain('孤立的被清掉')
  })

  it('guard → unguard 往返：标签与地址一一对应', () => {
    const spans = parseInline('先看 [releases](https://x/r) 再看 [wiki](https://x/w)')
    const g = guardLinks(spans)!
    const r = unguardLinks(g.text, g.hrefs)
    const links = r!.spans.filter((s) => s.t === 'link') as Extract<Span, { t: 'link' }>[]
    expect(links.map((l) => l.href)).toEqual(['https://x/r', 'https://x/w'])
    expect(r!.text).toContain('releases')
    expect(r!.text).not.toContain('https://')
  })
})
