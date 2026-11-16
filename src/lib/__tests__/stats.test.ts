import { describe, expect, it } from 'vitest'
import type { Repo } from '../types'
import {
  activityTotals,
  buildDashboard,
  classifyEvent,
  commitsOf,
  countRepos,
  contributionGrid,
  dailyActivity,
  dayKey,
  gridLevel,
  languageSlices,
  median,
  mergeEvents,
  recentRepos,
  staleRepos,
  streakDays,
  todayKey,
  topRepos,
  type GhEvent,
} from '../stats'

const NOW = Date.parse('2026-11-14T06:00:00Z') // 北京时间 14:00
const CST = 480

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
    language: 'TypeScript',
    stargazers_count: 0,
    forks_count: 0,
    fork: false,
    pushed_at: '2026-11-10T00:00:00Z',
    default_branch: 'main',
    ...patch,
  } as Repo
}

function ev(type: string, at: string, extra: Partial<GhEvent> = {}): GhEvent {
  return { id: `${type}-${at}`, type, created_at: at, repo: { name: 'zjkl0330/ghx' }, ...extra }
}

describe('dayKey / todayKey', () => {
  it('按给定时区折算日期，东八区早上 7 点算前一天', () => {
    // UTC 2026-11-13 23:00 = 北京 11-14 07:00
    expect(dayKey('2026-11-13T23:00:00Z', CST)).toBe('2026-11-14')
    // 同一时刻按 UTC 切就是 13 号 —— 这正是不能用 toISOString 的原因
    expect(dayKey('2026-11-13T23:00:00Z', 0)).toBe('2026-11-13')
  })

  it('非法时间与空值返回 null', () => {
    expect(dayKey(null)).toBeNull()
    expect(dayKey('')).toBeNull()
    expect(dayKey('不是时间')).toBeNull()
  })

  it('todayKey 与 dayKey 口径一致', () => {
    expect(todayKey(NOW, CST)).toBe('2026-11-14')
    expect(todayKey(NOW, 0)).toBe('2026-11-14')
    // UTC 17:00 → 北京次日 01:00
    const late = Date.parse('2026-11-14T17:00:00Z')
    expect(todayKey(late, 0)).toBe('2026-11-14')
    expect(todayKey(late, CST)).toBe('2026-11-15')
  })
})

describe('countRepos', () => {
  it('公开/私有、源/fork、归档、star 与 fork 总量分开算', () => {
    const c = countRepos([
      repo({ name: 'a', stargazers_count: 10, forks_count: 2, topics: ['x'] }),
      repo({ name: 'b', private: true, stargazers_count: 5 }),
      repo({ name: 'c', fork: true, stargazers_count: 1, forks_count: 1 }),
      repo({ name: 'd', archived: true }),
    ])
    expect(c).toMatchObject({
      total: 4,
      public: 3,
      private: 1,
      fork: 1,
      source: 3,
      archived: 1,
      stars: 16,
      forks: 3,
      withTopics: 1,
    })
  })

  it('空列表全 0', () => {
    expect(countRepos([]).total).toBe(0)
    expect(countRepos([]).stars).toBe(0)
  })
})

describe('languageSlices', () => {
  it('按仓库数排序，比例的分母是「已标注语言」的仓库数', () => {
    const s = languageSlices([
      repo({ name: 'a', language: 'TypeScript' }),
      repo({ name: 'b', language: 'TypeScript' }),
      repo({ name: 'c', language: 'Rust' }),
      repo({ name: 'd', language: null }),
    ])
    expect(s.map((x) => x.language)).toEqual(['TypeScript', 'Rust'])
    expect(s[0]).toMatchObject({ count: 2, ratio: 2 / 3 })
    expect(s[1]).toMatchObject({ count: 1, ratio: 1 / 3 })
  })

  it('超出上限时尾部合并成「其它 N 种」，比例仍然对得上', () => {
    const s = languageSlices(
      [
        repo({ name: 'a', language: 'TS' }),
        repo({ name: 'b', language: 'TS' }),
        repo({ name: 'c', language: 'TS' }),
        repo({ name: 'd', language: 'TS' }),
        repo({ name: 'e', language: 'Go' }),
        repo({ name: 'f', language: 'Go' }),
        repo({ name: 'g', language: 'Rust' }),
        repo({ name: 'h', language: 'C' }),
      ],
      2,
    )
    expect(s).toHaveLength(3)
    expect(s.map((x) => x.language)).toEqual(['TS', 'Go', '其它 2 种'])
    expect(s[2].count).toBe(2)
    expect(s[0].count + s[1].count + s[2].count).toBe(8)
  })

  it('全都没标语言时返回空数组，不造一个「未知」出来', () => {
    expect(languageSlices([repo({ name: 'a', language: null })])).toEqual([])
  })

  it('同数量时按 star 再排，避免顺序随机跳变', () => {
    const s = languageSlices([
      repo({ name: 'a', language: 'Go', stargazers_count: 1 }),
      repo({ name: 'b', language: 'Rust', stargazers_count: 9 }),
    ])
    expect(s[0].language).toBe('Rust')
  })
})

describe('commitsOf', () => {
  it('优先 distinct_size，其次 commits 长度，再次 size', () => {
    expect(commitsOf({ payload: { distinct_size: 2, size: 5, commits: [1, 2, 3] } })).toBe(2)
    expect(commitsOf({ payload: { size: 5, commits: [1, 2] } })).toBe(2)
    expect(commitsOf({ payload: { size: 5 } })).toBe(5)
    expect(commitsOf({ payload: null })).toBe(1)
  })

  it('distinct_size 为 0 是合法的（全被去重），不该退到 size', () => {
    expect(commitsOf({ payload: { distinct_size: 0, size: 3 } })).toBe(0)
  })
})

describe('classifyEvent', () => {
  it('三类活动与其它、跳过分开', () => {
    expect(classifyEvent('PushEvent')).toBe('commit')
    expect(classifyEvent('IssuesEvent')).toBe('issue')
    expect(classifyEvent('PullRequestEvent')).toBe('pull')
    expect(classifyEvent('ReleaseEvent')).toBe('other')
    expect(classifyEvent('WatchEvent')).toBe('skip')
    expect(classifyEvent(null)).toBe('other')
  })
})

describe('dailyActivity', () => {
  it('格子数等于窗口天数，最后一个是今天，没事件的日子补 0', () => {
    const days = dailyActivity([], 5, CST, NOW)
    expect(days).toHaveLength(5)
    expect(days[4].date).toBe('2026-11-14')
    expect(days[0].date).toBe('2026-11-10')
    expect(days.every((d) => d.total === 0)).toBe(true)
  })

  it('按类型累加，提交按 distinct_size 记', () => {
    const days = dailyActivity(
      [
        ev('PushEvent', '2026-11-14T02:00:00Z', { payload: { distinct_size: 3, size: 5 } }),
        ev('PushEvent', '2026-11-14T03:00:00Z', { payload: { distinct_size: 1 } }),
        ev('IssuesEvent', '2026-11-14T04:00:00Z'),
        ev('PullRequestEvent', '2026-11-13T04:00:00Z'),
        ev('WatchEvent', '2026-11-13T05:00:00Z'),
      ],
      3,
      CST,
      NOW,
    )
    const today = days[2]
    expect(today.date).toBe('2026-11-14')
    expect(today).toMatchObject({ commits: 4, issues: 1, pulls: 0, total: 5 })
    const yesterday = days[1]
    expect(yesterday).toMatchObject({ commits: 0, issues: 0, pulls: 1, total: 1 })
  })

  it('窗口外的旧事件不计入，但也不会抛错', () => {
    const days = dailyActivity([ev('PushEvent', '2026-01-01T00:00:00Z')], 3, CST, NOW)
    expect(days.reduce((s, d) => s + d.total, 0)).toBe(0)
  })

  it('时区边界：UTC 前一天 23 点算到北京时间今天', () => {
    const days = dailyActivity(
      [ev('IssuesEvent', '2026-11-13T23:30:00Z')],
      2,
      CST,
      NOW,
    )
    expect(days[1].issues).toBe(1)
  })
})

describe('activityTotals', () => {
  it('汇总四类、统计涉事仓库数与最早时间', () => {
    const t = activityTotals([
      ev('PushEvent', '2026-11-14T01:00:00Z', { payload: { distinct_size: 2 } }),
      ev('IssuesEvent', '2026-11-10T01:00:00Z'),
      ev('ReleaseEvent', '2026-11-05T01:00:00Z', { repo: { name: 'zjkl0330/other' } }),
      ev('WatchEvent', '2026-11-01T01:00:00Z'),
    ])
    expect(t).toMatchObject({ commits: 2, issues: 1, pulls: 0, other: 1, repos: 2 })
    expect(t.since).toBe('2026-11-05T01:00:00Z')
  })

  it('空事件流返回全 0 与 null', () => {
    expect(activityTotals([])).toEqual({
      commits: 0,
      issues: 0,
      pulls: 0,
      other: 0,
      repos: 0,
      since: null,
    })
  })
})

describe('streakDays', () => {
  const day = (date: string, total: number, other = 0) => ({
    date,
    commits: total,
    issues: 0,
    pulls: 0,
    other,
    total,
  })

  it('从最后一天往回数连续段', () => {
    expect(streakDays([day('1', 1), day('2', 2), day('3', 0), day('4', 1), day('5', 1)])).toBe(2)
  })

  it('今天还没活动时不判为断，从昨天起数', () => {
    expect(streakDays([day('1', 1), day('2', 1), day('3', 0), day('4', 0)])).toBe(2)
  })

  it('只有 other 事件也算动过', () => {
    expect(streakDays([day('1', 0), day('2', 0, 1)])).toBe(1)
  })

  it('全空返回 0', () => {
    expect(streakDays([day('1', 0), day('2', 0)])).toBe(0)
    expect(streakDays([])).toBe(0)
  })
})

describe('topRepos / recentRepos', () => {
  const repos = [
    repo({ name: 'a', stargazers_count: 100, forks_count: 1, pushed_at: '2026-11-01T00:00:00Z' }),
    repo({ name: 'b', stargazers_count: 5, forks_count: 50, pushed_at: '2026-11-12T00:00:00Z' }),
    repo({ name: 'c', stargazers_count: 0, forks_count: 0, pushed_at: '2026-11-13T00:00:00Z' }),
  ]

  it('star 榜只收有 star 的，按数量降序', () => {
    expect(topRepos(repos, 'stars').map((r) => r.name)).toEqual(['a', 'b'])
  })

  it('fork 榜口径独立', () => {
    expect(topRepos(repos, 'forks').map((r) => r.name)).toEqual(['b', 'a'])
  })

  it('最近推送按时间降序，null 时间的排掉', () => {
    expect(recentRepos(repos).map((r) => r.name)).toEqual(['c', 'b', 'a'])
    expect(recentRepos([repo({ name: 'x', pushed_at: '' })])).toEqual([])
  })

  it('排行榜带 fullName 与语言，界面点了能跳转', () => {
    const [first] = topRepos(repos, 'stars')
    expect(first.fullName).toBe('zjkl0330/a')
    expect(first.language).toBe('TypeScript')
  })
})

describe('staleRepos', () => {
  it('超过阈值算久未更新，归档的不算', () => {
    const old = '2026-01-01T00:00:00Z'
    const n = staleRepos(
      [
        repo({ name: 'a', pushed_at: old }),
        repo({ name: 'b', pushed_at: old, archived: true }),
        repo({ name: 'c', pushed_at: '2026-11-13T00:00:00Z' }),
      ],
      90,
      NOW,
    )
    expect(n).toBe(1)
  })

  it('时间缺失的仓库不参与统计', () => {
    expect(staleRepos([repo({ name: 'a', pushed_at: '' })], 90, NOW)).toBe(0)
  })
})

describe('median', () => {
  it('奇数取中间，偶数取平均并四舍五入', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 10])).toBe(3)
    expect(median([])).toBe(0)
  })

  it('不修改原数组', () => {
    const arr = [3, 1, 2]
    median(arr)
    expect(arr).toEqual([3, 1, 2])
  })
})

describe('buildDashboard', () => {
  it('把仓库与事件拼成一份完整看板数据', () => {
    const d = buildDashboard(
      [
        repo({ name: 'a', stargazers_count: 40, language: 'TS', pushed_at: '2026-11-13T00:00:00Z' }),
        repo({ name: 'b', stargazers_count: 2, language: 'TS' }),
        repo({ name: 'c', language: 'Rust', pushed_at: '2026-01-01T00:00:00Z' }),
      ],
      [
        ev('PushEvent', '2026-11-14T02:00:00Z', { payload: { distinct_size: 4 } }),
        ev('IssuesEvent', '2026-11-13T02:00:00Z'),
      ],
      { days: 7, offsetMinutes: CST, now: NOW, staleDays: 90 },
    )
    expect(d.days).toHaveLength(7)
    expect(d.counts.total).toBe(3)
    expect(d.counts.stars).toBe(42)
    expect(d.totals.commits).toBe(4)
    expect(d.streak).toBe(2)
    expect(d.stale).toBe(1)
    expect(d.medianStars).toBe(2)
    expect(d.langs[0]).toMatchObject({ language: 'TS', count: 2 })
    expect(d.topStars[0].name).toBe('a')
    expect(d.recent[0].name).toBe('a')
  })

  it('没有任何数据时不出现 NaN / Infinity', () => {
    const d = buildDashboard([], [], { now: NOW, offsetMinutes: CST })
    expect(d.commitsPerDay).toBe(0)
    expect(d.coveredDays).toBe(1)
    expect(d.medianStars).toBe(0)
    expect(d.counts.total).toBe(0)
    expect(Number.isFinite(d.commitsPerDay)).toBe(true)
    expect(d.langs).toEqual([])
    expect(d.topStars).toEqual([])
  })

  it('commitsPerDay 的分母是事件覆盖天数，不是仓库年龄', () => {
    const d = buildDashboard(
      [repo({ name: 'a' })],
      [
        ev('PushEvent', '2026-11-10T00:00:00Z', { payload: { distinct_size: 5 } }),
        ev('PushEvent', '2026-11-14T00:00:00Z', { payload: { distinct_size: 5 } }),
      ],
      { now: NOW, offsetMinutes: CST },
    )
    // 11-10 到 11-14 共 5 天，10 个提交 → 2.0
    expect(d.coveredDays).toBe(5)
    expect(d.commitsPerDay).toBe(2)
  })
})


describe('mergeEvents', () => {
  it('正常追加，返回本页新增数', () => {
    const a = mergeEvents([], [ev('PushEvent', '2026-11-14T01:00:00Z'), ev('IssuesEvent', '2026-11-13T01:00:00Z')])
    expect(a.list).toHaveLength(2)
    expect(a.added).toBe(2)
  })

  it('重复的 id 只收一次 —— 代理忽略 page 参数时不会翻三倍', () => {
    const page = [ev('PushEvent', '2026-11-14T01:00:00Z'), ev('IssuesEvent', '2026-11-13T01:00:00Z')]
    const first = mergeEvents([], page)
    const again = mergeEvents(first.list, page)
    expect(again.list).toHaveLength(2)
    expect(again.added).toBe(0)
  })

  it('跨页去重：第二页只有部分是新的时候，added 反映真实新增', () => {
    const p1 = [ev('PushEvent', '2026-11-14T01:00:00Z'), ev('IssuesEvent', '2026-11-13T01:00:00Z')]
    const p2 = [ev('IssuesEvent', '2026-11-13T01:00:00Z'), ev('PullRequestEvent', '2026-11-12T01:00:00Z')]
    const r = mergeEvents(p1, p2)
    expect(r.list).toHaveLength(3)
    expect(r.added).toBe(1)
  })

  it('没有 id 的事件不去重，全算新增（宁可多算也不丢）', () => {
    const r = mergeEvents(
      [{ type: 'PushEvent', created_at: '2026-11-14T01:00:00Z' }],
      [{ type: 'PushEvent', created_at: '2026-11-14T01:00:00Z' }],
    )
    expect(r.list).toHaveLength(2)
    expect(r.added).toBe(1)
  })

  it('不修改传进来的数组', () => {
    const prev = [ev('PushEvent', '2026-11-14T01:00:00Z')]
    mergeEvents(prev, [ev('IssuesEvent', '2026-11-13T01:00:00Z')])
    expect(prev).toHaveLength(1)
  })
})

describe('gridLevel', () => {
  it('0 是空格子', () => {
    expect(gridLevel(0)).toBe(0)
  })

  it('1 就点亮第一档 —— 有活动必须看得出来', () => {
    expect(gridLevel(1)).toBe(1)
  })

  it('分档边界', () => {
    expect(gridLevel(2)).toBe(2)
    expect(gridLevel(3)).toBe(2)
    expect(gridLevel(4)).toBe(3)
    expect(gridLevel(6)).toBe(3)
    expect(gridLevel(7)).toBe(4)
    expect(gridLevel(99)).toBe(4)
  })

  it('负数当 0', () => {
    expect(gridLevel(-5)).toBe(0)
  })
})

describe('contributionGrid', () => {
  // 2026-11-16 是周一。按东八区 12:00 算，避免日界擦边
  const NOW = Date.parse('2026-11-16T04:00:00Z')

  it('列数 × 7 格，最后一列包含今天', () => {
    const g = contributionGrid([], { weeks: 13, offsetMinutes: CST, now: NOW })
    expect(g.weeks).toHaveLength(13)
    expect(g.weeks.every((w) => w.length === 7)).toBe(true)
    const last = g.weeks[12]
    const today = last.find((c) => c.date === '2026-11-16')
    expect(today).toBeTruthy()
    expect(today?.future).toBe(false)
  })

  it('今天之后的格子标 future，且不计入总数', () => {
    const g = contributionGrid([], { weeks: 13, offsetMinutes: CST, now: NOW })
    // 周一是本周第 2 天（周日是第 1 天），所以本周后面还有 5 个未来格子
    const future = g.weeks[12].filter((c) => c.future)
    expect(future).toHaveLength(5)
    expect(future.every((c) => c.count === 0 && c.level === 0)).toBe(true)
  })

  it('列从周日起 —— 第一列第一格是周日', () => {
    const g = contributionGrid([], { weeks: 2, offsetMinutes: CST, now: NOW })
    const first = g.weeks[0][0].date
    // 13 周窗口起点：2026-11-16 往前 12*7 + 周一偏移 1 天 = 2026-08-23，那天是周日
    const start = contributionGrid([], { weeks: 13, offsetMinutes: CST, now: NOW }).weeks[0][0].date
    expect(new Date(`${start}T00:00:00Z`).getUTCDay()).toBe(0)
    expect(new Date(`${first}T00:00:00Z`).getUTCDay()).toBe(0)
  })

  it('提交按 distinct_size 累加，其余事件每件 1', () => {
    const events: GhEvent[] = [
      ev('PushEvent', '2026-11-16T01:00:00Z', { payload: { distinct_size: 4 } }),
      ev('IssuesEvent', '2026-11-16T02:00:00Z', { payload: { action: 'opened' } }),
      ev('PullRequestEvent', '2026-11-16T03:00:00Z', { payload: { action: 'opened' } }),
    ]
    const g = contributionGrid(events, { weeks: 13, offsetMinutes: CST, now: NOW })
    const cell = g.weeks.flat().find((c) => c.date === '2026-11-16')
    expect(cell?.count).toBe(6)
    expect(cell?.level).toBe(3)
  })

  it('WatchEvent 不点亮格子 —— star 别人不算活动', () => {
    const g = contributionGrid([ev('WatchEvent', '2026-11-16T01:00:00Z')], {
      weeks: 13,
      offsetMinutes: CST,
      now: NOW,
    })
    expect(g.total).toBe(0)
    expect(g.activeDays).toBe(0)
    expect(g.best).toBe(null)
  })

  it('窗口外的事件被丢掉，不会算进 total', () => {
    const g = contributionGrid([ev('PushEvent', '2019-01-01T00:00:00Z')], {
      weeks: 13,
      offsetMinutes: CST,
      now: NOW,
    })
    expect(g.total).toBe(0)
  })

  it('统计活动天数与最高那天', () => {
    const events: GhEvent[] = [
      ev('PushEvent', '2026-11-10T01:00:00Z', { payload: { distinct_size: 2 } }),
      ev('PushEvent', '2026-11-11T01:00:00Z', { payload: { distinct_size: 9 } }),
      ev('IssuesEvent', '2026-11-11T05:00:00Z'),
    ]
    const g = contributionGrid(events, { weeks: 13, offsetMinutes: CST, now: NOW })
    expect(g.activeDays).toBe(2)
    expect(g.max).toBe(10)
    expect(g.best).toEqual({ date: '2026-11-11', count: 10 })
    expect(g.total).toBe(12)
  })

  it('时区偏移影响归日：东八区的凌晨算当天，UTC 算前一天', () => {
    const e = [ev('PushEvent', '2026-11-15T17:00:00Z', { payload: { distinct_size: 3 } })]
    const cst = contributionGrid(e, { weeks: 2, offsetMinutes: CST, now: NOW })
    const utc = contributionGrid(e, { weeks: 2, offsetMinutes: 0, now: NOW })
    expect(cst.weeks.flat().find((c) => c.date === '2026-11-16')?.count).toBe(3)
    expect(utc.weeks.flat().find((c) => c.date === '2026-11-15')?.count).toBe(3)
  })
})
