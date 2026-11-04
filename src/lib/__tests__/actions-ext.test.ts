import { describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import {
  buildDispatchInputs,
  parseDispatchInputs,
  sortLogFiles,
  unzipLogs,
  validateInputs,
} from '../actions-ext'
import { branchNameError, elideBranch, shortSha, sortBranches, suggestBranch, tagNameError } from '../refs'

const YAML = `name: CI
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      target:
        description: '部署目标'
        required: true
        default: staging
        type: choice
        options:
          - staging
          - production
      dry_run:
        description: 只演练不真部署
        required: false
        type: boolean
        default: false
      note:
        description: 备注
        required: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`

describe('workflow_dispatch 输入项解析', () => {
  it('抠出名字、说明、必填、默认值与类型', () => {
    const defs = parseDispatchInputs(YAML)
    expect(defs.map((d) => d.name)).toEqual(['target', 'dry_run', 'note'])
    expect(defs[0]).toMatchObject({
      description: '部署目标',
      required: true,
      default: 'staging',
      type: 'choice',
      options: ['staging', 'production'],
    })
    expect(defs[1].type).toBe('boolean')
    expect(defs[2].required).toBe(false)
  })

  it('没有 workflow_dispatch 返回空数组', () => {
    expect(parseDispatchInputs('name: x\non:\n  push:\n')).toEqual([])
    expect(parseDispatchInputs('')).toEqual([])
  })

  it('有 dispatch 但没有 inputs 也是空', () => {
    expect(parseDispatchInputs('on:\n  workflow_dispatch:\n')).toEqual([])
  })

  it('行内数组形式的 options 也认', () => {
    const y = `on:
  workflow_dispatch:
    inputs:
      env:
        type: choice
        options: [dev, prod]
`
    expect(parseDispatchInputs(y)[0].options).toEqual(['dev', 'prod'])
  })

  it('触发时只传非空值，空值交给工作流默认值', () => {
    const defs = parseDispatchInputs(YAML)
    expect(buildDispatchInputs(defs, { target: 'production', dry_run: '', note: 'x' })).toEqual({
      target: 'production',
      note: 'x',
    })
    expect(buildDispatchInputs(defs, {})).toBe(undefined)
  })

  it('必填项为空时给出带说明的错误', () => {
    const defs = parseDispatchInputs(YAML)
    expect(validateInputs(defs, {})).toContain('部署目标')
    expect(validateInputs(defs, { target: 'dev' })).toBe(null)
  })
})

describe('日志解压', () => {
  const zip = zipSync({
    '2_build.txt': strToU8('第二步\n构建成功'),
    '1_setup.txt': strToU8('第一步\n初始化'),
    '10_test.txt': strToU8('第十步'),
    'meta.json': strToU8('{}'),
  })

  it('按文件名里的序号排序，不是字典序', () => {
    expect(sortLogFiles(['10_a', '2_b', '1_c'])).toEqual(['1_c', '2_b', '10_a'])
  })

  it('只保留 txt/log，序号小的在前', () => {
    const files = unzipLogs(zip)
    expect(files.map((f) => f.name)).toEqual(['1_setup.txt', '2_build.txt', '10_test.txt'])
    expect(files[1].text).toContain('构建成功')
  })

  it('空 zip 不抛错', () => {
    expect(unzipLogs(zipSync({}))).toEqual([])
  })
})

describe('分支与标签名校验', () => {
  it('合法名字通过', () => {
    for (const n of ['main', 'feature/login', 'fix-123', 'release/v1.2.3', 'a_b']) {
      expect(branchNameError(n)).toBe(null)
    }
  })

  it('非法名字给出具体原因', () => {
    expect(branchNameError('')).toContain('不能为空')
    expect(branchNameError('a b')).toContain('空格')
    expect(branchNameError('/a')).toContain('斜杠')
    expect(branchNameError('a//b')).toContain('连续斜杠')
    expect(branchNameError('a..b')).toContain('..')
    expect(branchNameError('a~b')).toContain('~')
    expect(branchNameError('a.lock')).toContain('.lock')
    expect(branchNameError('-a')).toContain('- 开头')
  })

  it('标签名沿用规则但措辞换成「标签名」', () => {
    expect(tagNameError('v1.0.0')).toBe(null)
    expect(tagNameError('a b')).toContain('标签名')
  })

  it('默认分支排最前', () => {
    const list = [
      { name: 'zeta', commit: { sha: '1' } },
      { name: 'main', commit: { sha: '2' } },
      { name: 'alpha', commit: { sha: '3' } },
    ]
    expect(sortBranches(list, 'main').map((b) => b.name)).toEqual(['main', 'alpha', 'zeta'])
  })

  it('过长分支名保留最后一段', () => {
    expect(elideBranch('feature/very/long/path', 10)).toBe('…/path')
    expect(elideBranch('main', 10)).toBe('main')
  })

  it('短 sha 与建议分支名', () => {
    expect(shortSha('abcdef1234567')).toBe('abcdef1')
    expect(suggestBranch('feature/')).toMatch(/^feature\/\d{8}-\d{4}$/)
  })
})

describe('原生响应转字节', () => {
  it('ArrayBuffer / 数字数组 / base64 字符串都能转', async () => {
    const { toBytes } = await import('../actions-ext')
    expect([...toBytes(new Uint8Array([1, 2]))]).toEqual([1, 2])
    expect([...toBytes(new Uint8Array([3, 4]).buffer)]).toEqual([3, 4])
    expect([...toBytes([5, 6])]).toEqual([5, 6])
    expect([...toBytes(btoa('\x07\x08'))]).toEqual([7, 8])
    expect([...toBytes(null)]).toEqual([])
  })
})
