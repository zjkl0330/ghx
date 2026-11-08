import { describe, expect, it } from 'vitest'
import {
  FOLLOW_PAGE_SIZE,
  displayName,
  followPath,
  forkCount,
  hasMoreFollowers,
  joinedText,
  normalizeBlogUrl,
  twitterUrl,
  userFacts,
  userKindLabel,
  userRepoSummary,
  visibleUserRepos,
  type UserRepoView,
} from '../users'
import type { Repo } from '../types'

function repo(patch: Partial<Repo> & { name: string }): Repo {
  return {
    id: Math.random(),
    full_name: `zjkl0330/${patch.name}`,
    owner: 'zjkl0330',
    private: false,
    visibility: 'public',
    archived: false,
    disabled: false,
    description: null,
    language: null,
    stargazers_count: 0,
    forks_count: 0,
    pushed_at: '2026-01-01T00:00:00Z',
    default_branch: 'main',
    ...patch,
  }
}

const VIEW: UserRepoView = { sort: 'pushed', sourceOnly: false }

describe('visibleUserRepos', () => {
  const list = [
    repo({ name: 'old', pushed_at: '2025-01-01T00:00:00Z', stargazers_count: 9 }),
    repo({ name: 'new', pushed_at: '2026-06-01T00:00:00Z', stargazers_count: 1 }),
    repo({ name: 'mid', pushed_at: '2026-03-01T00:00:00Z', stargazers_count: 50 }),
    repo({ name: 'forked', pushed_at: '2026-07-01T00:00:00Z', fork: true }),
  ]

  it('默认按最近推送降序', () => {
    expect(visibleUserRepos(list, VIEW).map((r) => r.name)).toEqual(['forked', 'new', 'mid', 'old'])
  })

  it('按星标降序，同星标时用推送时间兜底', () => {
    expect(visibleUserRepos(list, { sort: 'stars', sourceOnly: false }).map((r) => r.name)).toEqual([
      'mid',
      'old',
      'new',
      'forked',
    ])
  })

  it('按名称升序，不区分大小写', () => {
    const mixed = [repo({ name: 'Beta' }), repo({ name: 'alpha' }), repo({ name: 'Gamma' })]
    expect(visibleUserRepos(mixed, { sort: 'name', sourceOnly: false }).map((r) => r.name)).toEqual([
      'alpha',
      'Beta',
      'Gamma',
    ])
  })

  it('「只看源仓库」过滤掉 fork', () => {
    expect(visibleUserRepos(list, { sort: 'pushed', sourceOnly: true }).map((r) => r.name)).not.toContain(
      'forked',
    )
  })

  it('时间缺失的沉到末尾，而不是排最前', () => {
    const broken = [repo({ name: 'broken', pushed_at: '' }), repo({ name: 'ok', pushed_at: '2026-01-01T00:00:00Z' })]
    expect(visibleUserRepos(broken, VIEW).map((r) => r.name)).toEqual(['ok', 'broken'])
  })

  it('不修改入参数组', () => {
    const original = list.map((r) => r.name)
    visibleUserRepos(list, { sort: 'name', sourceOnly: false })
    expect(list.map((r) => r.name)).toEqual(original)
  })

  it('空列表不炸', () => {
    expect(visibleUserRepos([], VIEW)).toEqual([])
  })
})

describe('forkCount / userRepoSummary', () => {
  it('只数 fork', () => {
    expect(forkCount([repo({ name: 'a' }), repo({ name: 'b', fork: true })])).toBe(1)
  })

  it('汇总里带上 fork 与归档数量', () => {
    const list = [repo({ name: 'a' }), repo({ name: 'b', fork: true }), repo({ name: 'c', archived: true })]
    expect(userRepoSummary(list)).toBe('3 个仓库 · 1 个 fork · 1 个已归档')
  })

  it('没有仓库时给一句人话', () => {
    expect(userRepoSummary([])).toBe('没有公开仓库')
  })
})

describe('userKindLabel', () => {
  it('识别组织与机器人，其余按个人', () => {
    expect(userKindLabel('Organization')).toBe('组织')
    expect(userKindLabel('Bot')).toBe('机器人')
    expect(userKindLabel('User')).toBe('个人')
    expect(userKindLabel(null)).toBe('个人')
  })
})

describe('displayName', () => {
  it('没填名字退回登录名', () => {
    expect(displayName({ login: 'torvalds', name: null })).toBe('torvalds')
    expect(displayName({ login: 'torvalds', name: '   ' })).toBe('torvalds')
    expect(displayName({ login: 'torvalds', name: 'Linus' })).toBe('Linus')
  })
})

describe('normalizeBlogUrl', () => {
  it('补 https://', () => {
    expect(normalizeBlogUrl('zjkl.dpdns.org')).toBe('https://zjkl.dpdns.org')
  })

  it('已有协议就不动', () => {
    expect(normalizeBlogUrl('http://a.dev')).toBe('http://a.dev')
    expect(normalizeBlogUrl('https://a.dev')).toBe('https://a.dev')
  })

  it('mailto 保留', () => {
    expect(normalizeBlogUrl('mailto:a@b.c')).toBe('mailto:a@b.c')
  })

  it('空值与空白返回 null', () => {
    expect(normalizeBlogUrl(null)).toBeNull()
    expect(normalizeBlogUrl('   ')).toBeNull()
  })
})

describe('twitterUrl', () => {
  it('去掉用户自己多写的 @', () => {
    expect(twitterUrl('@torvalds')).toBe('https://x.com/torvalds')
  })

  it('空值返回 null', () => {
    expect(twitterUrl(null)).toBeNull()
    expect(twitterUrl('')).toBeNull()
  })
})

describe('joinedText', () => {
  it('给出年月，不写「几年前」', () => {
    expect(joinedText('2011-09-03T20:39:22Z')).toBe('2011 年 9 月')
  })

  it('时间无效返回 null', () => {
    expect(joinedText('')).toBeNull()
    expect(joinedText('不是时间')).toBeNull()
  })
})

describe('userFacts', () => {
  it('按 公司 → 位置 → 博客 → X → 加入 顺序输出', () => {
    const facts = userFacts({
      company: '@Linux Foundation',
      location: 'Portland, OR',
      blog: 'kernel.org',
      created_at: '2011-09-03T20:39:22Z',
      twitter_username: 'torvalds',
    })
    expect(facts.map((f) => f.key)).toEqual(['company', 'location', 'blog', 'twitter', 'joined'])
    expect(facts[0].text).toBe('Linux Foundation')
  })

  it('博客显示去掉协议，但链接保留完整地址', () => {
    const blog = userFacts({
      company: null,
      location: null,
      blog: 'https://zjkl.dpdns.org/',
      created_at: '2020-01-01T00:00:00Z',
    }).find((f) => f.key === 'blog')
    expect(blog?.text).toBe('zjkl.dpdns.org')
    expect(blog?.href).toBe('https://zjkl.dpdns.org/')
  })

  it('空字段整行不出现，不留一排破折号', () => {
    const facts = userFacts({
      company: null,
      location: '  ',
      blog: null,
      created_at: '',
      twitter_username: null,
    })
    expect(facts).toEqual([])
  })
})

describe('followPath', () => {
  it('拼出关注者与正在关注两个端点', () => {
    expect(followPath('torvalds', 'followers')).toBe(
      `/users/torvalds/followers?per_page=${FOLLOW_PAGE_SIZE}&page=1`,
    )
    expect(followPath('torvalds', 'following', 2)).toContain('page=2')
  })

  it('登录名做 URL 编码', () => {
    expect(followPath('a b', 'followers')).toContain('/users/a%20b/')
  })
})

describe('hasMoreFollowers', () => {
  it('整页就认为可能还有下一页', () => {
    expect(hasMoreFollowers(30)).toBe(true)
    expect(hasMoreFollowers(60)).toBe(true)
  })

  it('不满一页或为空就停', () => {
    expect(hasMoreFollowers(17)).toBe(false)
    expect(hasMoreFollowers(0)).toBe(false)
  })
})
