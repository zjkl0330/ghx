import { describe, expect, it } from 'vitest'
import {
  isTemplateFile,
  parseFrontmatter,
  parseIssueTemplate,
  parseSimpleYaml,
  renderIssueForm,
  stripComment,
  toList,
} from '../templates'

const FORM = `name: Bug report
description: 报告一个问题
title: "[Bug] "
labels: ["bug", "triage"]
assignees: zjkl0330
body:
  - type: markdown
    attributes:
      value: |
        感谢反馈。先搜一下有没有人报过。
  - type: input
    id: version
    attributes:
      label: 版本号
      description: 设置页底部那一行
      placeholder: 例如 0.7.1
  - type: textarea
    id: steps
    attributes:
      label: 复现步骤
      placeholder: 1. 打开…
  - type: checkboxes
    id: checks
    attributes:
      label: 提交前确认
      options:
        - label: 我搜过现有 Issue
        - label: 我用的是最新版
  - type: dropdown
    id: platform
    attributes:
      label: 平台
      options:
        - Android
        - iOS
`

describe('stripComment', () => {
  it('去掉行尾注释', () => {
    expect(stripComment('name: bug # 这是注释')).toBe('name: bug ')
  })

  it('不动引号里的井号', () => {
    expect(stripComment('title: "issue #12"')).toBe('title: "issue #12"')
  })

  it('整行注释变空', () => {
    expect(stripComment('# 说明').trim()).toBe('')
  })
})

describe('parseSimpleYaml', () => {
  it('顶层标量与列表', () => {
    const out = parseSimpleYaml('name: Bug\nlabels: ["bug", "triage"]\n') as Record<string, unknown>
    expect(out.name).toBe('Bug')
    expect(out.labels).toEqual(['bug', 'triage'])
  })

  it('列表项是映射时能拿到嵌套字段', () => {
    const out = parseSimpleYaml(FORM) as Record<string, unknown>
    const body = out.body as Record<string, unknown>[]
    expect(body).toHaveLength(5)
    expect(body[1].type).toBe('input')
    expect((body[1].attributes as Record<string, unknown>).label).toBe('版本号')
  })

  it('块标量 | 保留换行', () => {
    const out = parseSimpleYaml(FORM) as Record<string, unknown>
    const first = (out.body as Record<string, unknown>[])[0]
    expect((first.attributes as Record<string, unknown>).value).toBe('感谢反馈。先搜一下有没有人报过。')
  })

  it('checkboxes 的 options 是列表', () => {
    const out = parseSimpleYaml(FORM) as Record<string, unknown>
    const checks = (out.body as Record<string, unknown>[])[3]
    const opts = (checks.attributes as Record<string, unknown>).options as Record<string, unknown>[]
    expect(opts.map((o) => o.label)).toEqual(['我搜过现有 Issue', '我用的是最新版'])
  })

  it('空值行不炸', () => {
    expect(parseSimpleYaml('')).toBe(null)
    expect(parseSimpleYaml('name:\n')).toEqual({ name: null })
  })

  it('布尔与数字按类型给', () => {
    const out = parseSimpleYaml('required: true\nrows: 3\n') as Record<string, unknown>
    expect(out.required).toBe(true)
    expect(out.rows).toBe(3)
  })
})

describe('parseFrontmatter', () => {
  it('拆出数据与正文', () => {
    const { data, body } = parseFrontmatter('---\nname: 功能请求\nabout: 想要新功能\nlabels: enhancement\n---\n\n正文第一行\n')
    expect(data.name).toBe('功能请求')
    expect(data.labels).toBe('enhancement')
    expect(body).toBe('正文第一行\n')
  })

  it('没有 frontmatter 时原样返回', () => {
    const { data, body } = parseFrontmatter('# 标题\n内容')
    expect(data).toEqual({})
    expect(body).toBe('# 标题\n内容')
  })
})

describe('toList', () => {
  it('数组 / 逗号 / 单值都认', () => {
    expect(toList(['a', 'b'])).toEqual(['a', 'b'])
    expect(toList('a, b')).toEqual(['a', 'b'])
    expect(toList('a')).toEqual(['a'])
    expect(toList(null)).toEqual([])
  })
})

describe('renderIssueForm', () => {
  const body = renderIssueForm(parseSimpleYaml(FORM) as Parameters<typeof renderIssueForm>[0])

  it('markdown 字段直接铺开', () => {
    expect(body).toContain('感谢反馈。先搜一下有没有人报过。')
  })

  it('每个字段一个三级标题', () => {
    expect(body).toContain('### 版本号')
    expect(body).toContain('### 复现步骤')
  })

  it('checkboxes 变成待勾选清单', () => {
    expect(body).toContain('- [ ] 我搜过现有 Issue')
  })

  it('placeholder 收进注释，不污染正文', () => {
    expect(body).toContain('<!-- 例如 0.7.1 -->')
  })

  it('dropdown 列成候选并提示删掉其余', () => {
    expect(body).toContain('- Android（选一个，删掉其余）')
    expect(body).toContain('- iOS')
  })
})

describe('parseIssueTemplate', () => {
  it('yml 表单转成模板', () => {
    const t = parseIssueTemplate('.github/ISSUE_TEMPLATE/bug.yml', FORM)
    expect(t?.name).toBe('Bug report')
    expect(t?.title).toBe('[Bug] ')
    expect(t?.labels).toEqual(['bug', 'triage'])
    expect(t?.fromForm).toBe(true)
    expect(t?.body).toContain('### 复现步骤')
  })

  it('md 模板保留正文原文', () => {
    const t = parseIssueTemplate(
      '.github/ISSUE_TEMPLATE/idea.md',
      '---\nname: 想法\nabout: 提个点子\nlabels: [idea]\n---\n\n**先说结论**\n',
    )
    expect(t?.name).toBe('想法')
    expect(t?.fromForm).toBe(false)
    expect(t?.body).toBe('**先说结论**\n')
  })

  it('写坏的 yml 返回 null，不抛错', () => {
    expect(parseIssueTemplate('.github/ISSUE_TEMPLATE/x.yml', '::: not yaml :::')).toBe(null)
  })
})

describe('isTemplateFile', () => {
  it('config.yml 不是模板', () => {
    expect(isTemplateFile('config.yml')).toBe(false)
    expect(isTemplateFile('config.yaml')).toBe(false)
  })

  it('md / yml / yaml 都算', () => {
    expect(isTemplateFile('bug.md')).toBe(true)
    expect(isTemplateFile('bug.yml')).toBe(true)
    expect(isTemplateFile('bug.yaml')).toBe(true)
    expect(isTemplateFile('notes.txt')).toBe(false)
  })
})
