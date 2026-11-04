import { describe, expect, it } from 'vitest'
import {
  canUseNotifications,
  filterThreads,
  groupByRepo,
  reasonText,
  subjectMeta,
  subjectTarget,
  unreadCount,
  type NotificationThread,
} from '../notifications'
import { codeQuery, emptyQueryHint, issueQuery, searchQuotaHint, splitFullName } from '../search-ext'
import { compactNumber, baseName, dirName, formatBytes, pathSegments, relTime, shortDate } from '../format'
import { renameImpact, repoNameError, watchLabel } from '../repo-admin'

function thread(id: string, patch: Partial<NotificationThread> = {}): NotificationThread {
  return {
    id,
    unread: true,
    reason: 'comment',
    updated_at: '2026-01-01T00:00:00Z',
    subject: { title: 't', type: 'Issue', url: 'https://api.github.com/repos/a/b/issues/7' },
    repository: { full_name: 'a/b', name: 'b', owner: { login: 'a' } },
    ...patch,
  }
}

describe('通知', () => {
  it('原因翻译成中文，未知原因原样返回', () => {
    expect(reasonText('mention')).toBe('提到了你')
    expect(reasonText('weird')).toBe('weird')
  })

  it('主题类型给中文名与图标', () => {
    expect(subjectMeta('PullRequest').label).toBe('PR')
    expect(subjectMeta('Release').icon).toBe('tag')
    expect(subjectMeta('Whatever').label).toBe('Whatever')
  })

  it('从 subject.url 解析跳转目标', () => {
    expect(subjectTarget(thread('1'))).toEqual({ kind: 'issue', owner: 'a', repo: 'b', number: 7 })
    expect(
      subjectTarget(thread('2', { subject: { title: 't', type: 'PullRequest', url: 'https://api.github.com/repos/a/b/issues/9' } })),
    ).toEqual({ kind: 'pull', owner: 'a', repo: 'b', number: 9 })
    expect(subjectTarget(thread('3', { subject: { title: 't', type: 'Release', url: null } }))).toEqual({
      kind: 'repo',
      owner: 'a',
      repo: 'b',
    })
    expect(subjectTarget(thread('4', { repository: null }))).toBe(null)
  })

  it('筛选、分组与未读数', () => {
    const list = [
      thread('1'),
      thread('2', { unread: false }),
      thread('3', { reason: 'mention', repository: { full_name: 'c/d', name: 'd', owner: { login: 'c' } } }),
    ]
    expect(filterThreads(list, { unreadOnly: true }).map((t) => t.id)).toEqual(['1', '3'])
    expect(filterThreads(list, { reason: 'mention' }).map((t) => t.id)).toEqual(['3'])
    expect(groupByRepo(list).map((g) => g.repo)).toEqual(['a/b', 'c/d'])
    expect(unreadCount(list)).toBe(2)
  })

  it('fine-grained 令牌不支持通知，要能提前判断', () => {
    expect(canUseNotifications(['repo', 'notifications'], 'classic')).toBe(true)
    expect(canUseNotifications(['notifications'], 'fine-grained')).toBe(false)
    expect(canUseNotifications([], 'classic')).toBe(false)
    expect(canUseNotifications(['repo'], 'classic')).toBe(true)
  })
})

describe('搜索语法', () => {
  it('代码搜索拼限定符，语言加引号', () => {
    expect(codeQuery('useState', { repo: 'a/b', language: 'TypeScript' })).toBe(
      'useState repo:a/b language:"TypeScript"',
    )
    expect(codeQuery('foo')).toBe('foo')
  })

  it('Issue 与 PR 必须显式声明类型，否则会混在一起', () => {
    expect(issueQuery('登录', 'issues', { repo: 'a/b', state: 'open' })).toBe(
      '登录 is:issue repo:a/b state:open',
    )
    expect(issueQuery('登录', 'pulls')).toBe('登录 is:pull-request')
  })

  it('空关键词与配额提示', () => {
    expect(emptyQueryHint('code', '  ')).toContain('函数名')
    expect(emptyQueryHint('repos', 'x')).toBe(null)
    expect(searchQuotaHint('code')).toContain('10 次')
    expect(searchQuotaHint('repos')).toBe(null)
  })

  it('拆 full_name', () => {
    expect(splitFullName('a/b')).toEqual({ owner: 'a', repo: 'b' })
    expect(splitFullName(null)).toBe(null)
    expect(splitFullName('abc')).toBe(null)
  })
})

describe('格式化', () => {
  const now = Date.parse('2026-06-01T12:00:00Z')

  it('相对时间分档', () => {
    expect(relTime('2026-06-01T11:59:40Z', now)).toBe('刚刚')
    expect(relTime('2026-06-01T11:30:00Z', now)).toBe('30 分钟前')
    expect(relTime('2026-06-01T09:00:00Z', now)).toBe('3 小时前')
    expect(relTime('2026-05-30T12:00:00Z', now)).toBe('2 天前')
    expect(relTime(null, now)).toBe('—')
    // 未来时间不显示负数
    expect(relTime('2026-06-02T12:00:00Z', now)).toBe('刚刚')
  })

  it('日期与体积', () => {
    expect(shortDate('2026-06-01T12:00:00Z')).toMatch(/^2026-06-0[12]$/)
    expect(formatBytes(890)).toBe('890 B')
    expect(formatBytes(12_400)).toBe('12 KB')
    expect(formatBytes(3.2 * 1024 * 1024)).toBe('3.2 MB')
    expect(compactNumber(1234)).toBe('1.2k')
    expect(compactNumber(2_400_000)).toBe('2.4M')
  })

  it('路径拆分', () => {
    expect(baseName('src/lib/api.ts')).toBe('api.ts')
    expect(dirName('src/lib/api.ts')).toBe('src/lib')
    expect(dirName('a.ts')).toBe('')
    expect(pathSegments('/src/lib/')).toEqual(['src', 'lib'])
  })
})

describe('仓库管理', () => {
  it('仓库名校验', () => {
    expect(repoNameError('my-repo')).toBe(null)
    expect(repoNameError('')).toContain('不能为空')
    expect(repoNameError('a b')).toContain('字母')
    expect(repoNameError('..')).toContain('不合法')
  })

  it('改名会列出连带影响', () => {
    expect(renameImpact('a/old', 'new')).toHaveLength(3)
    expect(renameImpact('a/old', 'old')).toEqual([])
  })

  it('订阅状态文案', () => {
    expect(watchLabel('subscribed')).toContain('订阅')
    expect(watchLabel('ignored')).toContain('忽略')
    expect(watchLabel(null)).toContain('未订阅')
  })
})
