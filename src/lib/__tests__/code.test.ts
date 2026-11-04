import { describe, expect, it } from 'vitest'
import {
  commitTitle,
  decodeBase64Utf8,
  encodeBase64Utf8,
  isBinaryPath,
  isImagePath,
  languageOf,
  sortEntries,
  summarizeDir,
  withLineNumbers,
  writeErrorHint,
  type ContentItem,
} from '../code'

function entry(name: string, type: ContentItem['type'] = 'file'): ContentItem {
  return { type, name, path: name, sha: 's', size: 1 }
}

describe('base64 与 UTF-8', () => {
  it('中文与 emoji 往返不坏', () => {
    const text = '# 标题\n中文内容 ✅ emoji 🚀\n'
    expect(decodeBase64Utf8(encodeBase64Utf8(text))).toBe(text)
  })

  it('GitHub 返回的 base64 带换行也能解', () => {
    const b64 = encodeBase64Utf8('你好世界')
    const wrapped = `${b64.slice(0, 4)}\n${b64.slice(4)}`
    expect(decodeBase64Utf8(wrapped)).toBe('你好世界')
  })

  it('空串不炸', () => {
    expect(decodeBase64Utf8('')).toBe('')
    expect(encodeBase64Utf8('')).toBe('')
  })

  it('裸 btoa 处理中文会抛错，所以必须走字节', () => {
    expect(() => btoa('中文')).toThrow()
    expect(() => encodeBase64Utf8('中文')).not.toThrow()
  })
})

describe('文件类型判断', () => {
  it('图片单独识别', () => {
    expect(isImagePath('a/b/logo.PNG')).toBe(true)
    expect(isImagePath('a/b/icon.svg')).toBe(true)
    expect(isImagePath('a/b/main.ts')).toBe(false)
  })

  it('二进制不按文本打开', () => {
    expect(isBinaryPath('dist/app.apk')).toBe(true)
    expect(isBinaryPath('assets/logo.png')).toBe(false)
    expect(isBinaryPath('src/index.ts')).toBe(false)
  })

  it('语言名', () => {
    expect(languageOf('src/a.ts')).toBe('TypeScript')
    expect(languageOf('Dockerfile')).toBe('Dockerfile')
    expect(languageOf('a/b.yaml')).toBe('YAML')
    expect(languageOf('LICENSE')).toBe('文本')
  })
})

describe('目录整理', () => {
  it('目录在前、文件在后，按名字排', () => {
    const list = [entry('b.ts'), entry('src', 'dir'), entry('a.ts'), entry('assets', 'dir')]
    expect(sortEntries(list).map((e) => e.name)).toEqual(['assets', 'src', 'a.ts', 'b.ts'])
  })

  it('目录摘要给出数量与主要语言', () => {
    const s = summarizeDir([entry('a.ts'), entry('b.ts'), entry('c.md'), entry('src', 'dir')])
    expect(s).toContain('1 个目录')
    expect(s).toContain('3 个文件')
    expect(s).toContain('TypeScript×2')
  })
})

describe('文本视图', () => {
  it('行号从 1 开始，末尾空行也保留', () => {
    expect(withLineNumbers('a\nb\n')).toEqual([
      { no: 1, text: 'a' },
      { no: 2, text: 'b' },
      { no: 3, text: '' },
    ])
  })

  it('提交信息只取第一行', () => {
    expect(commitTitle('feat: x\n\n正文')).toBe('feat: x')
    expect(commitTitle('   ')).toBe('(无提交信息)')
  })
})

describe('写文件错误的额外解释', () => {
  it('409 是乐观锁冲突', () => {
    expect(writeErrorHint('a.txt', 409)).toContain('新提交')
  })

  it('写 .github/workflows 缺 scope 会返回 404，要说明', () => {
    expect(writeErrorHint('.github/workflows/ci.yml', 404)).toContain('workflow')
    expect(writeErrorHint('src/a.ts', 404)).toBe(null)
  })
})
