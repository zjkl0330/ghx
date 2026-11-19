import { describe, expect, it } from 'vitest'
import { dirOf, isRepoPath, joinPath, resolveHref, safeHref, splitHash, type LinkContext } from '../mdlink'

const ctx: LinkContext = {
  owner: 'zjkl0330',
  repo: 'ghx',
  branch: 'main',
  basePath: 'README.md',
  mirror: '',
}

const inDocs: LinkContext = { ...ctx, basePath: 'docs/README.md' }
const proxied: LinkContext = { ...ctx, mirror: 'https://gh-proxy.com' }

describe('safeHref', () => {
  it('放行 http / https', () => {
    expect(safeHref('https://github.com/a/b')).toBe('https://github.com/a/b')
    expect(safeHref('http://example.com')).toBe('http://example.com')
  })

  it('放行 mailto 与 tel', () => {
    expect(safeHref('mailto:a@b.com')).toBe('mailto:a@b.com')
    expect(safeHref('tel:+8613800000000')).toBe('tel:+8613800000000')
  })

  it('放行锚点与相对路径', () => {
    expect(safeHref('#安装')).toBe('#安装')
    expect(safeHref('./docs/a.md')).toBe('./docs/a.md')
    expect(safeHref('docs/a.md')).toBe('docs/a.md')
  })

  it('挡掉 javascript: 与 data:', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('JavaScript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,<script>')).toBeNull()
    expect(safeHref('file:///etc/passwd')).toBeNull()
  })

  it('用控制字符拆开协议名也挡得住', () => {
    expect(safeHref('java\tscript:alert(1)')).toBeNull()
    expect(safeHref('  https://a.com  ')).toBe('https://a.com')
  })

  it('空白与空串无效', () => {
    expect(safeHref('')).toBeNull()
    expect(safeHref('   ')).toBeNull()
  })
})

describe('splitHash', () => {
  it('拆出片段', () => {
    expect(splitHash('a.md#sec')).toEqual(['a.md', 'sec'])
  })

  it('没有片段时 hash 为空串', () => {
    expect(splitHash('a.md')).toEqual(['a.md', ''])
  })
})

describe('joinPath', () => {
  it('拼接并吃掉 ./', () => {
    expect(joinPath('docs/', './a.md')).toBe('docs/a.md')
    expect(joinPath('', 'a.md')).toBe('a.md')
  })

  it('.. 回退一级', () => {
    expect(joinPath('docs/', '../img/a.png')).toBe('img/a.png')
    expect(joinPath('a/b/', '../../c.md')).toBe('c.md')
  })

  it('.. 顶到根之后返回空串，不拼出非法地址', () => {
    expect(joinPath('', '../../x.md')).toBe('')
    expect(joinPath('docs/', '../../../x.md')).toBe('')
  })

  it('合并多余斜杠', () => {
    expect(joinPath('docs/', '//a//b.md')).toBe('docs/a/b.md')
  })
})

describe('dirOf', () => {
  it('取出所在目录', () => {
    expect(dirOf('docs/README.md')).toBe('docs/')
    expect(dirOf('a/b/c.md')).toBe('a/b/')
  })

  it('根目录的自述返回空串', () => {
    expect(dirOf('README.md')).toBe('')
  })
})

describe('resolveHref', () => {
  it('锚点走内部滚动', () => {
    expect(resolveHref('#安装', ctx)).toEqual({ kind: 'anchor', id: '安装' })
  })

  it('空锚点无效', () => {
    expect(resolveHref('#', ctx)).toBeNull()
  })

  it('github 链接改走加速前缀（gh-proxy 是 URL 型代理）', () => {
    expect(resolveHref('https://github.com/a/b/issues/1', proxied)).toEqual({
      kind: 'external',
      url: 'https://gh-proxy.com/https://github.com/a/b/issues/1',
    })
  })

  it('没有加速前缀时保持 github.com', () => {
    expect(resolveHref('https://github.com/a/b', ctx)).toEqual({
      kind: 'external',
      url: 'https://github.com/a/b',
    })
  })

  it('www.github.com 也认', () => {
    expect(resolveHref('https://www.github.com/a/b', ctx)).toEqual({
      kind: 'external',
      url: 'https://github.com/a/b',
    })
  })

  it('非 github 站点原样打开，不被代理', () => {
    expect(resolveHref('https://example.com/x?y=1', proxied)).toEqual({
      kind: 'external',
      url: 'https://example.com/x?y=1',
    })
  })

  it('mailto 原样', () => {
    expect(resolveHref('mailto:a@b.com', ctx)).toEqual({ kind: 'external', url: 'mailto:a@b.com' })
  })

  it('相对路径按自述所在目录解析', () => {
    expect(resolveHref('./guide.md', inDocs)).toEqual({
      kind: 'external',
      url: 'https://github.com/zjkl0330/ghx/blob/main/docs/guide.md',
    })
  })

  it('../ 回到上一级', () => {
    expect(resolveHref('../img/a.png', inDocs)).toEqual({
      kind: 'external',
      url: 'https://github.com/zjkl0330/ghx/blob/main/img/a.png',
    })
  })

  it('根相对路径从仓库根算', () => {
    expect(resolveHref('/LICENSE', inDocs)).toEqual({
      kind: 'external',
      url: 'https://github.com/zjkl0330/ghx/blob/main/LICENSE',
    })
  })

  it('相对路径保留片段', () => {
    expect(resolveHref('a.md#安装', ctx)).toEqual({
      kind: 'external',
      url: 'https://github.com/zjkl0330/ghx/blob/main/a.md#安装',
    })
  })

  it('分支为空时兜底 main', () => {
    expect(resolveHref('a.md', { ...ctx, branch: '' })).toEqual({
      kind: 'external',
      url: 'https://github.com/zjkl0330/ghx/blob/main/a.md',
    })
  })

  it('越出仓库根的相对路径判无效', () => {
    expect(resolveHref('../../x.md', ctx)).toBeNull()
  })

  it('危险协议判无效', () => {
    expect(resolveHref('javascript:alert(1)', ctx)).toBeNull()
  })

  it('相对路径也能被加速站包住', () => {
    expect(resolveHref('a.md', proxied)).toEqual({
      kind: 'external',
      url: 'https://gh-proxy.com/https://github.com/zjkl0330/ghx/blob/main/a.md',
    })
  })
})

describe('isRepoPath', () => {
  it('相对路径与 github 链接算仓库内', () => {
    expect(isRepoPath('./a.md')).toBe(true)
    expect(isRepoPath('https://github.com/a/b/blob/main/x')).toBe(true)
  })

  it('外站、锚点、mailto 不算', () => {
    expect(isRepoPath('https://example.com/x')).toBe(false)
    expect(isRepoPath('#安装')).toBe(false)
    expect(isRepoPath('mailto:a@b.com')).toBe(false)
  })
})
