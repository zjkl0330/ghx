import { describe, expect, it } from 'vitest'
import {
  fileStatusMeta,
  mergeFailure,
  mergeableHint,
  parsePatch,
  pullStateText,
  reviewFailure,
  slicePatch,
  totalStats,
  type PullFile,
  type PullRequest,
} from '../pulls'

function pr(patch: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 1,
    title: 't',
    state: 'open',
    merged: false,
    merged_at: null,
    mergeable: true,
    body: null,
    user: null,
    labels: [],
    head: { ref: 'feat', sha: 'abc', label: 'a:feat', repo: null },
    base: { ref: 'main', sha: 'def', label: 'a:main', repo: null },
    commits: 1,
    additions: 1,
    deletions: 0,
    changed_files: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...patch,
  }
}

describe('PR 状态', () => {
  it('草稿、已合并、开启、关闭四种文案', () => {
    expect(pullStateText(pr({ draft: true }))).toBe('草稿')
    expect(pullStateText(pr({ merged: true, merged_at: '2026-01-02T00:00:00Z', state: 'closed' }))).toBe('已合并')
    expect(pullStateText(pr())).toBe('开启中')
    expect(pullStateText(pr({ state: 'closed' }))).toBe('已关闭')
  })

  it('mergeable 为 null 时提示「正在检查」而不是「不能合并」', () => {
    expect(mergeableHint(pr({ mergeable: null }))).toBe('正在检查能否合并…')
    expect(mergeableHint(pr())).toBe(null)
    expect(mergeableHint(pr({ mergeable: false, mergeable_state: 'dirty' }))).toContain('冲突')
    expect(mergeableHint(pr({ mergeable: false, mergeable_state: 'blocked' }))).toContain('保护')
    expect(mergeableHint(pr({ merged_at: 'x', state: 'closed' }))).toBe(null)
  })
})

describe('合并失败码', () => {
  it('每种状态给不同的可操作提示', () => {
    expect(mergeFailure(405)).toContain('冲突')
    expect(mergeFailure(409)).toContain('刷新')
    expect(mergeFailure(403)).toContain('分支保护')
    expect(mergeFailure(422, { message: 'Pull Request is not mergeable' })).toContain('不可合并')
    expect(mergeFailure(422, { message: 'other' })).toContain('合并方式')
    expect(mergeFailure(500, { message: 'boom' })).toBe('boom')
  })

  it('审核：给自己投票的提示单独说清', () => {
    expect(reviewFailure(422, { message: 'Can not approve your own pull request' })).toContain('自己的 PR')
    expect(reviewFailure(403)).toContain('权限')
  })
})

describe('diff 解析', () => {
  const patch = ['@@ -1,3 +1,4 @@', ' ctx', '-old', '+new', '+extra', '\\ No newline'].join('\n')

  it('区分增删、上下文与分块标记', () => {
    expect(parsePatch(patch)).toEqual([
      { kind: 'meta', text: '@@ -1,3 +1,4 @@' },
      { kind: 'ctx', text: 'ctx' },
      { kind: 'del', text: 'old' },
      { kind: 'add', text: 'new' },
      { kind: 'add', text: 'extra' },
      { kind: 'meta', text: '\\ No newline' },
    ])
  })

  it('空 patch 返回空数组（二进制文件就是这种）', () => {
    expect(parsePatch('')).toEqual([])
  })

  it('超长 diff 截断，并报告隐藏了多少行', () => {
    const big = Array.from({ length: 500 }, (_, i) => `+line${i}`).join('\n')
    const r = slicePatch(big, 400)
    expect(r.lines).toHaveLength(400)
    expect(r.hidden).toBe(100)
  })

  it('行数没超就不截', () => {
    expect(slicePatch('+a\n+b', 10).hidden).toBe(0)
  })
})

describe('文件状态与统计', () => {
  it('状态符号', () => {
    expect(fileStatusMeta('added').mark).toBe('A')
    expect(fileStatusMeta('removed').label).toBe('删除')
    expect(fileStatusMeta('renamed').mark).toBe('R')
    expect(fileStatusMeta('modified').mark).toBe('M')
  })

  it('汇总增删行数', () => {
    const files: PullFile[] = [
      { filename: 'a', status: 'modified', additions: 3, deletions: 1, changes: 4 },
      { filename: 'b', status: 'added', additions: 5, deletions: 0, changes: 5 },
    ]
    expect(totalStats(files)).toEqual({ additions: 8, deletions: 1, changed_files: 2 })
  })
})
