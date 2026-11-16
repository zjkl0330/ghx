import { describe, expect, it } from 'vitest'
import {
  draftFromGist,
  filesCreate,
  filesPatch,
  gistBytes,
  gistFiles,
  gistLanguage,
  gistTitle,
  hasChanges,
  validateDraft,
  type DraftFile,
  type Gist,
} from '../gists'

const gist: Gist = {
  id: 'abc123',
  description: '  用来看 Gist 的一份笔记  ',
  public: true,
  files: {
    'zz.txt': { filename: 'zz.txt', size: 10, language: null, content: 'z' },
    'README.md': { filename: 'README.md', size: 30, language: 'Markdown', content: '# hi' },
    'a.js': { filename: 'a.js', size: 20, language: 'JavaScript', content: 'let a = 1' },
  },
  comments: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
}

const d = (name: string, content: string, origin: string | null = name): DraftFile => ({
  key: `${name}-${origin ?? 'new'}`,
  name,
  content,
  origin,
})

describe('gistFiles', () => {
  it('README 排第一，其余按名字', () => {
    expect(gistFiles(gist).map((f) => f.filename)).toEqual(['README.md', 'a.js', 'zz.txt'])
  })

  it('null 文件被跳过', () => {
    const g = { files: { 'a.txt': { filename: 'a.txt' }, b: null } } as unknown as Gist
    expect(gistFiles(g)).toHaveLength(1)
  })
})

describe('gistTitle', () => {
  it('有描述时用描述并去空白', () => {
    expect(gistTitle(gist)).toBe('用来看 Gist 的一份笔记')
  })

  it('没描述时拼文件名', () => {
    expect(gistTitle({ description: '', files: gist.files })).toBe('README.md 等 3 个文件')
    expect(gistTitle({ description: null, files: { a: { filename: 'a.txt' } } })).toBe('a.txt')
  })

  it('空 Gist 不崩', () => {
    expect(gistTitle({ description: '', files: {} })).toBe('（空 Gist）')
  })
})

describe('gistLanguage / gistBytes', () => {
  it('取第一个有语言的', () => {
    expect(gistLanguage(gist)).toBe('Markdown')
    expect(gistLanguage({ files: {} })).toBe(null)
  })

  it('字节数求和', () => {
    expect(gistBytes(gist)).toBe(60)
  })
})

describe('draftFromGist', () => {
  it('保留原始文件名作为 origin', () => {
    const draft = draftFromGist(gist)
    expect(draft.map((f) => f.origin)).toEqual(['README.md', 'a.js', 'zz.txt'])
    expect(draft[0].content).toBe('# hi')
  })
})

describe('validateDraft', () => {
  it('至少一个文件', () => {
    expect(validateDraft([])?.kind).toBe('empty')
  })

  it('拦空文件名', () => {
    expect(validateDraft([d('', '')])?.kind).toBe('no-name')
  })

  it('拦重名（忽略大小写）', () => {
    expect(validateDraft([d('a.txt', '1'), d('A.TXT', '2')])?.kind).toBe('dup-name')
  })

  it('拦带斜杠的名字', () => {
    expect(validateDraft([d('a/b.txt', '1')])?.kind).toBe('no-name')
  })

  it('正常草稿通过', () => {
    expect(validateDraft([d('a.txt', '1'), d('b.txt', '2')])).toBe(null)
  })
})

describe('filesPatch', () => {
  const original = gistFiles(gist)

  it('内容没变就不发', () => {
    const patch = filesPatch(original, draftFromGist(gist))
    expect(patch).toEqual({})
    expect(hasChanges(patch)).toBe(false)
  })

  it('改内容发新内容', () => {
    const draft = draftFromGist(gist)
    draft[1].content = 'let a = 2'
    expect(filesPatch(original, draft)).toEqual({ 'a.js': { content: 'let a = 2' } })
  })

  it('删文件发 null', () => {
    const draft = draftFromGist(gist).filter((f) => f.name !== 'zz.txt')
    expect(filesPatch(original, draft)).toEqual({ 'zz.txt': null })
  })

  it('改名 = 旧名 null + 新名内容', () => {
    const draft = draftFromGist(gist)
    draft[2].name = 'renamed.txt'
    expect(filesPatch(original, draft)).toEqual({ 'zz.txt': null, 'renamed.txt': { content: 'z' } })
  })

  it('新增文件只有内容', () => {
    const draft = [...draftFromGist(gist), d('new.md', 'hello', null)]
    expect(filesPatch(original, draft)).toEqual({ 'new.md': { content: 'hello' } })
  })
})

describe('filesCreate', () => {
  it('名字去空白后作为键', () => {
    expect(filesCreate([d(' a.txt ', 'x'), d('b.txt', 'y', null)])).toEqual({
      'a.txt': { content: 'x' },
      'b.txt': { content: 'y' },
    })
  })
})
