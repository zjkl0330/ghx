import { describe, expect, it } from 'vitest'
import {
  clipBlockedByRoute,
  clipFingerprint,
  clipRouteLabel,
  looksSecret,
  parseClipOpen,
  parseClipRoute,
  serializeClipOpen,
} from '../clipboard-link'

describe('剪贴板解析 parseClipRoute', () => {
  it('标准仓库地址', () => {
    expect(parseClipRoute('https://github.com/zjkl0330/ghx')).toEqual({
      kind: 'repo',
      owner: 'zjkl0330',
      repo: 'ghx',
      tab: 'code',
    })
  })

  it('带 www、http、尾部斜杠', () => {
    for (const s of [
      'http://www.github.com/zjkl0330/ghx/',
      'https://github.com/zjkl0330/ghx/',
      'github.com/zjkl0330/ghx',
    ]) {
      expect(parseClipRoute(s)).toMatchObject({ owner: 'zjkl0330', repo: 'ghx' })
    }
  })

  it('分享文案里夹带的链接也能捞出来', () => {
    expect(parseClipRoute('看看这个 https://github.com/a/b 挺好用的')).toMatchObject({
      owner: 'a',
      repo: 'b',
    })
  })

  it('SSH 形式', () => {
    expect(parseClipRoute('git@github.com:zjkl0330/ghx.git')).toEqual({
      kind: 'repo',
      owner: 'zjkl0330',
      repo: 'ghx',
      tab: 'code',
    })
  })

  it('仓库名后的 .git 去掉', () => {
    expect(parseClipRoute('https://github.com/a/b.git')).toMatchObject({ repo: 'b' })
  })

  it('issue 链接落到 issue 页', () => {
    expect(parseClipRoute('https://github.com/a/b/issues/12')).toEqual({
      kind: 'issue',
      owner: 'a',
      repo: 'b',
      number: 12,
    })
  })

  it('PR 链接落到 PR 页', () => {
    expect(parseClipRoute('https://github.com/a/b/pull/7')).toEqual({
      kind: 'pull',
      owner: 'a',
      repo: 'b',
      number: 7,
    })
  })

  it('issues 列表页（无编号）落到 Issues 列表', () => {
    expect(parseClipRoute('https://github.com/a/b/issues')).toEqual({
      kind: 'issues',
      owner: 'a',
      repo: 'b',
    })
  })

  it('tree 链接带分支与路径', () => {
    expect(parseClipRoute('https://github.com/a/b/tree/main/src/lib')).toEqual({
      kind: 'code',
      owner: 'a',
      repo: 'b',
      ref: 'main',
      path: 'src/lib',
    })
  })

  it('blob 链接同样落到代码页', () => {
    expect(parseClipRoute('https://github.com/a/b/blob/dev/README.md')).toMatchObject({
      kind: 'code',
      ref: 'dev',
      path: 'README.md',
    })
  })

  it('commit 链接带 sha', () => {
    expect(parseClipRoute('https://github.com/a/b/commit/122feb4abc')).toMatchObject({
      kind: 'commit',
      sha: '122feb4abc',
    })
  })

  it('sha 不像 sha 时退回仓库首页', () => {
    expect(parseClipRoute('https://github.com/a/b/commit/notasha')).toMatchObject({
      kind: 'repo',
    })
  })

  it('releases 之类落到仓库首页', () => {
    expect(parseClipRoute('https://github.com/a/b/releases/tag/v1')).toMatchObject({
      kind: 'repo',
      owner: 'a',
      repo: 'b',
    })
  })

  it('github.com 的第一段是保留字时不算仓库', () => {
    for (const s of [
      'https://github.com/issues',
      'https://github.com/settings/tokens',
      'https://github.com/notifications',
      'https://github.com/explore',
      'https://github.com/orgs/a',
    ]) {
      expect(parseClipRoute(s)).toBeNull()
    }
  })

  it('只有用户名时落到个人主页', () => {
    expect(parseClipRoute('https://github.com/zjkl0330')).toEqual({
      kind: 'user',
      login: 'zjkl0330',
    })
    expect(parseClipRoute('github.com/a')).toEqual({ kind: 'user', login: 'a' })
  })

  it('保留字即便只有一段也不跳', () => {
    expect(parseClipRoute('https://github.com/explore')).toBeNull()
    expect(parseClipRoute('https://github.com/topics')).toBeNull()
  })

  it('非 GitHub 站点不跳', () => {
    expect(parseClipRoute('https://gitlab.com/a/b')).toBeNull()
    expect(parseClipRoute('https://example.com')).toBeNull()
  })

  it('伪装域名不跳', () => {
    expect(parseClipRoute('https://notgithub.com/a/b')).toBeNull()
    expect(parseClipRoute('https://gist.github.com/a/b')).toBeNull()
  })

  it('URL 尾巴上的中文标点和引号被剔掉', () => {
    expect(parseClipRoute('地址：https://github.com/a/b）')).toMatchObject({ repo: 'b' })
    expect(parseClipRoute('"https://github.com/a/b".')).toMatchObject({ repo: 'b' })
  })

  it('仓库名里的点号合法', () => {
    expect(parseClipRoute('https://github.com/a/ghx.dev')).toMatchObject({ repo: 'ghx.dev' })
  })

  it('用户名带下划线不合规，判无效', () => {
    expect(parseClipRoute('https://github.com/a_b/c')).toBeNull()
  })

  it('空串 / 纯文字返回 null', () => {
    expect(parseClipRoute('')).toBeNull()
    expect(parseClipRoute('随便一句话')).toBeNull()
    expect(parseClipRoute('   ')).toBeNull()
  })

  it('超长文本直接放弃', () => {
    expect(parseClipRoute(`https://github.com/a/b ${'x'.repeat(5000)}`)).toBeNull()
  })
})

describe('凭据识别 looksSecret', () => {
  it('各类 GitHub 令牌都认得', () => {
    for (const s of [
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz',
      'gho_abcdefghijklmnopqrstuvwxyz01',
      'ghs_abcdefghijklmnopqrstuvwxyz01',
    ]) {
      expect(looksSecret(s)).toBe(true)
    }
  })

  it('普通文字不算', () => {
    expect(looksSecret('https://github.com/a/b')).toBe(false)
    expect(looksSecret('ghp 是前缀')).toBe(false)
  })

  it('令牌混在文字里也能认出来', () => {
    expect(looksSecret('我的令牌是 ghp_abcdefghijklmnopqrstuvwxyz0123456789 别外传')).toBe(true)
  })

  it('带令牌的内容不解析成路由', () => {
    expect(
      parseClipRoute('ghp_abcdefghijklmnopqrstuvwxyz0123456789 https://github.com/a/b'),
    ).toBeNull()
  })
})

describe('内容指纹 clipFingerprint', () => {
  it('同一条内容指纹稳定', () => {
    const s = 'https://github.com/a/b'
    expect(clipFingerprint(s)).toBe(clipFingerprint(s))
  })

  it('前后空白不影响', () => {
    expect(clipFingerprint('  https://github.com/a/b  ')).toBe(
      clipFingerprint('https://github.com/a/b'),
    )
  })

  it('不同内容指纹不同', () => {
    expect(clipFingerprint('https://github.com/a/b')).not.toBe(
      clipFingerprint('https://github.com/a/c'),
    )
  })

  it('指纹里不含原文', () => {
    const f = clipFingerprint('https://github.com/zjkl0330/ghx')
    expect(f).not.toContain('github')
    expect(f).not.toContain('zjkl0330')
  })
})

describe('开关序列化', () => {
  it('缺省视为开启', () => {
    expect(parseClipOpen(null)).toBe(true)
    expect(parseClipOpen(undefined)).toBe(true)
    expect(parseClipOpen('')).toBe(true)
  })

  it('只有 0 是关', () => {
    expect(parseClipOpen('0')).toBe(false)
    expect(parseClipOpen('1')).toBe(true)
  })

  it('序列化往返一致', () => {
    expect(parseClipOpen(serializeClipOpen(false))).toBe(false)
    expect(parseClipOpen(serializeClipOpen(true))).toBe(true)
  })
})

describe('提示语与打断判断', () => {
  it('仓库与会话编号', () => {
    expect(clipRouteLabel({ kind: 'repo', owner: 'a', repo: 'b' })).toBe('a/b')
    expect(clipRouteLabel({ kind: 'issue', owner: 'a', repo: 'b', number: 3 })).toBe('a/b #3')
  })

  it('代码页带路径', () => {
    expect(clipRouteLabel({ kind: 'code', owner: 'a', repo: 'b', path: 'src/lib' })).toBe(
      'a/b · src/lib',
    )
  })

  it('个人主页带 @', () => {
    expect(clipRouteLabel({ kind: 'user', login: 'zjkl0330' })).toBe('@zjkl0330')
  })

  it('与仓库无关的页面给空串', () => {
    expect(clipRouteLabel({ kind: 'settings' })).toBe('')
  })

  it('编辑页与 Gist 页要拦住自动跳转', () => {
    expect(clipBlockedByRoute({ kind: 'edit', owner: 'a', repo: 'b', path: 'x' })).toBe(true)
    expect(clipBlockedByRoute({ kind: 'gist', id: '' })).toBe(true)
    expect(clipBlockedByRoute({ kind: 'repo', owner: 'a', repo: 'b' })).toBe(false)
    expect(clipBlockedByRoute(undefined)).toBe(false)
  })
})
