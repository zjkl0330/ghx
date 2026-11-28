import { describe, expect, it } from 'vitest'
import {
  MAX_FOLDERS,
  MAX_FOLDER_NAME,
  assignFolder,
  cleanFolderName,
  createFolder,
  deleteFolder,
  emptyStore,
  filterByFolder,
  folderById,
  folderCounts,
  folderOf,
  parseStarFolders,
  renameFolder,
  serializeStarFolders,
  starFoldersKey,
  type StarFolderStore,
} from '../star-folders'

const repo = (full: string) => ({ full_name: full })

function withFolders(...names: string[]): StarFolderStore {
  return names.reduce((s, n) => createFolder(s, n).store, emptyStore())
}

describe('文件夹解析', () => {
  it('脏数据一律吞掉，不抛错', () => {
    expect(parseStarFolders(null).folders).toEqual([])
    expect(parseStarFolders('').folders).toEqual([])
    expect(parseStarFolders('不是 JSON').folders).toEqual([])
    expect(parseStarFolders('[1,2]').folders).toEqual([])
    expect(parseStarFolders('{"folders":"x","assign":5}').folders).toEqual([])
  })

  it('丢掉非法 id、空名、重复 id 与重复名', () => {
    const raw = JSON.stringify({
      folders: [
        { id: 'f1', name: '常用' },
        { id: 'f1', name: '另一个' },
        { id: '带空格 id', name: '坏 id' },
        { id: 'f2', name: '  ' },
        { id: 'f3', name: '常用' },
        { id: 'f4', name: '学习' },
      ],
    })
    expect(parseStarFolders(raw).folders).toEqual([
      { id: 'f1', name: '常用' },
      { id: 'f4', name: '学习' },
    ])
  })

  it('指向不存在文件夹的归类记录被丢掉', () => {
    const raw = JSON.stringify({
      folders: [{ id: 'f1', name: '常用' }],
      assign: { 'a/b': 'f1', 'c/d': 'f9', '坏键': 'f1', 'a/b/c': 'f1', 'E/F': 'f1' },
    })
    expect(parseStarFolders(raw).assign).toEqual({ 'a/b': 'f1', 'e/f': 'f1' })
  })

  it('文件夹数量与名字长度都封顶', () => {
    const many = Array.from({ length: MAX_FOLDERS + 5 }, (_, i) => ({ id: `f${i + 1}`, name: `组${i}` }))
    expect(parseStarFolders(JSON.stringify({ folders: many })).folders).toHaveLength(MAX_FOLDERS)
    expect(cleanFolderName('长'.repeat(40))).toHaveLength(MAX_FOLDER_NAME)
  })

  it('序列化后能原样读回', () => {
    const s = assignFolder(withFolders('常用', '学习'), 'a/b', 'f1')
    expect(parseStarFolders(serializeStarFolders(s))).toEqual(s)
  })
})

describe('名字清洗', () => {
  it('压掉换行与连续空格', () => {
    expect(cleanFolderName('  常用\n\n 仓库 ')).toBe('常用 仓库')
  })

  it('空名返回 null', () => {
    expect(cleanFolderName('')).toBeNull()
    expect(cleanFolderName('   ')).toBeNull()
    expect(cleanFolderName(3)).toBeNull()
  })

  it('按码点截断，不劈开 emoji', () => {
    expect(cleanFolderName('🚀'.repeat(30))).toHaveLength(MAX_FOLDER_NAME * 2)
  })
})

describe('新建 / 重命名 / 删除', () => {
  it('依次拿到 f1、f2', () => {
    const s1 = createFolder(emptyStore(), '常用')
    expect(s1.ok).toBe(true)
    expect(s1.id).toBe('f1')
    const s2 = createFolder(s1.store, '学习')
    expect(s2.id).toBe('f2')
  })

  it('同名不重复建，返回已有 id', () => {
    const base = withFolders('常用')
    const again = createFolder(base, '常用')
    expect(again.ok).toBe(false)
    expect(again.reason).toBe('dupe')
    expect(again.id).toBe('f1')
    expect(again.store.folders).toHaveLength(1)
  })

  it('名字大小写不同也算重名', () => {
    const base = withFolders('Tools')
    expect(createFolder(base, 'tools').reason).toBe('dupe')
  })

  it('数量到顶时拒绝新建', () => {
    const base = withFolders(...Array.from({ length: MAX_FOLDERS }, (_, i) => `组${i}`))
    expect(createFolder(base, '再来一个').reason).toBe('full')
  })

  it('改名成功，改成别人已有的名字被拒', () => {
    const base = withFolders('常用', '学习')
    expect(renameFolder(base, 'f1', '工作').store.folders[0].name).toBe('工作')
    expect(renameFolder(base, 'f1', '学习').reason).toBe('dupe')
    expect(renameFolder(base, 'f9', '随便').reason).toBe('missing')
    expect(renameFolder(base, 'f1', '  ').reason).toBe('empty')
  })

  it('删除文件夹只取消归类，不动仓库本身', () => {
    const base = assignFolder(assignFolder(withFolders('常用', '学习'), 'a/b', 'f1'), 'c/d', 'f2')
    const del = deleteFolder(base, 'f1')
    expect(del.ok).toBe(true)
    expect(del.store.folders.map((f) => f.id)).toEqual(['f2'])
    expect(del.store.assign).toEqual({ 'c/d': 'f2' })
    expect(deleteFolder(base, 'f9').reason).toBe('missing')
  })
})

describe('归类', () => {
  it('按大小写不敏感存键，查询同样不敏感', () => {
    const base = withFolders('常用')
    const s = assignFolder(base, 'Owner/Repo', 'f1')
    expect(s.assign['owner/repo']).toBe('f1')
    expect(folderOf(s, 'OWNER/REPO')).toBe('f1')
  })

  it('移出文件夹回到未分类', () => {
    const base = assignFolder(withFolders('常用'), 'a/b', 'f1')
    expect(folderOf(assignFolder(base, 'a/b', null), 'a/b')).toBeNull()
  })

  it('指向不存在的文件夹时按未分类处理', () => {
    const base = assignFolder(withFolders('常用'), 'a/b', 'f9')
    expect(folderOf(base, 'a/b')).toBeNull()
  })

  it('同一个仓库换组时只留新组', () => {
    const base = assignFolder(assignFolder(withFolders('常用', '学习'), 'a/b', 'f1'), 'a/b', 'f2')
    expect(folderOf(base, 'a/b')).toBe('f2')
  })

  it('没有变化时返回同一引用，省一次重渲染', () => {
    const base = assignFolder(withFolders('常用'), 'a/b', 'f1')
    expect(assignFolder(base, 'a/b', 'f1')).toBe(base)
  })
})

describe('筛选与计数', () => {
  const base = assignFolder(assignFolder(withFolders('常用', '学习'), 'a/b', 'f1'), 'c/d', 'f2')
  const repos = [repo('a/b'), repo('c/d'), repo('e/f')]

  it('全部 / 未分类 / 指定文件夹', () => {
    expect(filterByFolder(base, repos, 'all')).toHaveLength(3)
    expect(filterByFolder(base, repos, 'none').map((r) => r.full_name)).toEqual(['e/f'])
    expect(filterByFolder(base, repos, 'f2').map((r) => r.full_name)).toEqual(['c/d'])
  })

  it('选中的文件夹已经不存在时退回全部', () => {
    expect(filterByFolder(base, repos, 'f9')).toHaveLength(3)
  })

  it('计数只统计传进来的仓库', () => {
    expect(folderCounts(base, repos)).toEqual({ all: 3, none: 1, byId: { f1: 1, f2: 1 } })
  })

  it('按 id 查名字', () => {
    expect(folderById(base, 'f1')?.name).toBe('常用')
    expect(folderById(base, 'f9')).toBeNull()
  })
})

describe('存储键', () => {
  it('按账号分片', () => {
    expect(starFoldersKey('abc')).toBe('ghx.starfolders.abc')
  })
})
