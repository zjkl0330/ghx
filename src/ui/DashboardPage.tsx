import { useCallback, useEffect, useMemo, useState } from 'react'
import { GitHubError, type GitHubClient } from '../lib/api'
import { compactNumber, relTime } from '../lib/format'
import { normalizeRepo, type RawRepo } from '../lib/repos'
import {
  buildDashboard,
  contributionGrid,
  mergeEvents,
  type ContributionGrid as GridData,
  type DashboardData,
  type DayBucket,
  type GhEvent,
  type LangSlice,
  type RepoRank,
} from '../lib/stats'
import type { Repo } from '../lib/types'
import { PageState } from './PageHeader'
import { Icon } from './icons'

const REPO_PAGE = 100
const REPO_MAX_PAGES = 3
const EVENT_PAGE = 100
const EVENT_MAX_PAGES = 3
/** 可选的活动窗口。90 天是事件流能覆盖的上限，再长就是编数据了 */
const WINDOWS = [
  { days: 14, label: '14 天' },
  { days: 30, label: '30 天' },
  { days: 90, label: '90 天' },
] as const
const DEFAULT_WINDOW = 14

const LANG_COLOR: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Kotlin: '#A97BFF',
  Java: '#b07219',
  Python: '#3572A5',
  'C++': '#f34b7d',
  Rust: '#dea584',
  Go: '#00ADD8',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Shell: '#89e051',
  Dart: '#00B4AB',
  Swift: '#F05138',
  C: '#555555',
  'C#': '#178600',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Vue: '#41b883',
  Svelte: '#ff3e00',
}

/** 当前时区的偏移分钟数（东八区 480）。stats 里的日切按它算 */
function tzOffset(): number {
  return -new Date().getTimezoneOffset()
}

interface RawUser {
  login: string
  name: string | null
  followers: number
  following: number
  public_repos: number
  public_gists: number
  created_at: string
}

interface Loaded {
  repos: Repo[]
  events: GhEvent[]
  user: RawUser
  /** 仓库列表是否被页数上限截断 —— 截断了就要说明「只统计了前 N 个」 */
  reposTruncated: boolean
  /** 事件流是否被截断。和仓库分开记：两件事的说明文字不一样 */
  eventsTruncated: boolean
}

/**
 * 数据看板。
 *
 * 只用两个接口：`/user/repos` 与 `/users/{login}/events`。两个都是分页 100，
 * 各最多拉 3 页（300 条）—— 再多就会打满 5000 次/小时的配额，
 * 而看板这种东西一天看不了几次，不值得为了「全量准确」把配额烧光。
 *
 * 拉过的路径会进 client 的请求缓存（`/user/repos` 60 秒），
 * 所以来回进出看板不会重复打网络。
 */
export function DashboardPage(p: {
  client: GitHubClient | null
  login: string | null
  /** 顶部账号切换后的口径：不是本人时隐藏私有仓库相关统计 */
  isSelf: boolean
  /** 作为二级页面时给返回按钮；作为底栏页签时不给 */
  onBack?: () => void
  onOpenRepo: (full: string) => void
}) {
  const [data, setData] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [windowDays, setWindowDays] = useState(DEFAULT_WINDOW)

  const load = useCallback(
    async (fresh = false) => {
      if (!p.client || !p.login) {
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const [userRes, repos, events] = await Promise.all([
          p.client.request<RawUser>('/user', {}, { fresh }),
          loadRepos(p.client, fresh),
          loadEvents(p.client, p.login, fresh),
        ])
        setData({
          user: userRes.data,
          repos: repos.list,
          events: events.list,
          reposTruncated: repos.truncated,
          eventsTruncated: events.truncated,
        })
        // 配额在这里顺手更新一次，顶部进度条用的是 client.rate 的实时值
      } catch (err) {
        const status = err instanceof GitHubError ? err.status : 0
        setError(
          status === 403
            ? '配额用完了，等重置后再刷新'
            : status === 401
              ? '令牌已失效，请重新导入'
              : (err as Error).message,
        )
      } finally {
        setLoading(false)
      }
    },
    [p.client, p.login],
  )

  useEffect(() => {
    void load()
  }, [load])

  const dash = useMemo<DashboardData | null>(() => {
    if (!data) return null
    return buildDashboard(data.repos, data.events, {
      days: windowDays,
      offsetMinutes: tzOffset(),
      staleDays: 90,
      langLimit: 6,
    })
  }, [data, windowDays])

  // 贡献日历固定 13 周（91 天），不跟窗口切换：格子图看的是「长期习惯」，
  // 14 天的格子图只有两列，什么也看不出来
  const grid = useMemo<GridData | null>(() => {
    if (!data) return null
    return contributionGrid(data.events, { weeks: 13, offsetMinutes: tzOffset() })
  }, [data])

  const rate = p.client?.rate ?? null

  return (
    <>
      <div className="topbar">
        {p.onBack && (
          <button className="icon-btn" onClick={p.onBack} aria-label="返回">
            <Icon name="back" size={18} />
          </button>
        )}
        <div style={{ minWidth: 0 }}>
          <div className="page-title">数据看板</div>
          <div className="page-sub ellipsis">
            {p.login ? `@${p.login}` : '还没有账号'}
            {dash ? ` · 近 ${windowDays} 天` : ''}
          </div>
        </div>
        <div className="spacer" />
        <button className="icon-btn" onClick={() => void load(true)} aria-label="刷新">
          <Icon name="refresh" size={17} />
        </button>
      </div>

      <div className="page" style={{ marginTop: 0 }}>
        <PageState loading={loading && !data} error={error} onRetry={() => void load(true)} />

        {!p.login && !loading && (
          <div className="empty">导入令牌后才能看到账号数据</div>
        )}

        {dash && data && (
          <>
            <div className="dash-kpi">
              <div className="dash-kpi-cell">
                <b>{compactNumber(dash.counts.total)}</b>
                <span>仓库</span>
                <i>
                  公开 {dash.counts.public} · 私有 {dash.counts.private}
                </i>
              </div>
              <div className="dash-kpi-cell">
                <b>{compactNumber(dash.counts.stars)}</b>
                <span>Star 总数</span>
                <i>中位 {dash.medianStars} / 仓</i>
              </div>
              <div className="dash-kpi-cell">
                <b>{compactNumber(dash.totals.commits)}</b>
                <span>事件里的提交</span>
                <i>
                  覆盖 {dash.coveredDays} 天 · 日均 {dash.commitsPerDay}
                </i>
              </div>
              <div className="dash-kpi-cell">
                <b>{dash.streak}</b>
                <span>连续活跃天数</span>
                <i>{dash.totals.repos} 个仓库动过</i>
              </div>
            </div>

            <div className="usec-head" style={{ margin: '18px 16px 8px' }}>
              <span className="section-title" style={{ margin: 0 }}>
                活动
              </span>
              <div className="chips" style={{ margin: 0 }}>
                {WINDOWS.map((w) => (
                  <button
                    key={w.days}
                    className={`chip${windowDays === w.days ? ' on' : ''}`}
                    onClick={() => setWindowDays(w.days)}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="panel dash-panel">
              <ActivityChart days={dash.days} />
              <div className="dash-axis">
                <span>{shortDay(dash.days[0]?.date)}</span>
                <span>{shortDay(dash.days[Math.floor(dash.days.length / 2)]?.date)}</span>
                <span>今天</span>
              </div>
              <div className="dash-legend">
                <span>
                  <i className="dash-dot" style={{ background: 'rgb(var(--accent-rgb))' }} />
                  提交 {dash.totals.commits}
                </span>
                <span>
                  <i className="dash-dot" style={{ background: 'rgb(var(--chart-issue-rgb))' }} />
                  Issue {dash.totals.issues}
                </span>
                <span>
                  <i className="dash-dot" style={{ background: 'rgb(var(--chart-pull-rgb))' }} />
                  PR {dash.totals.pulls}
                </span>
              </div>
            </div>

            {grid && (
              <>
                <div className="usec-head" style={{ margin: '18px 16px 8px' }}>
                  <span className="section-title" style={{ margin: 0 }}>
                    贡献日历
                  </span>
                  <span className="hint" style={{ margin: 0 }}>
                    近 13 周
                  </span>
                </div>
                <div className="panel">
                  <ContributionGrid grid={grid} />
                  <div className="cgrid-foot">
                    <span>
                      共 <b>{grid.total}</b> 次
                    </span>
                    <span>
                      活跃 <b>{grid.activeDays}</b> 天
                    </span>
                    <span>
                      最多一天 <b>{grid.max}</b> 次
                    </span>
                  </div>
                  <div className="hint" style={{ marginTop: 8 }}>
                    格子来自公开事件流（上限 90 天 / 300 条），与 GitHub 主页那张贡献图口径不同，
                    数字对不上是正常的 —— 那张含私有贡献，只有 GraphQL 拿得到。
                  </div>
                </div>
              </>
            )}

            <div className="section-title">语言分布</div>
            <div className="panel">
              {dash.langs.length === 0 ? (
                <div className="empty" style={{ padding: '18px 0' }}>
                  仓库都没标语言，GitHub 那边统计不出来
                </div>
              ) : (
                <div className="dash-langs">
                  {dash.langs.map((l) => (
                    <LangRow key={l.language} slice={l} />
                  ))}
                </div>
              )}
            </div>

            {dash.topStars.length > 0 && (
              <>
                <div className="section-title">Star 排行</div>
                <div className="panel">
                  <div className="dash-ranks">
                    {dash.topStars.map((r, i) => (
                      <RankRow
                        key={r.fullName}
                        rank={i + 1}
                        repo={r}
                        max={dash.topStars[0].stars}
                        unit="★"
                        onOpen={() => p.onOpenRepo(r.fullName)}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="section-title">最近推送</div>
            <div className="panel">
              {dash.recent.length === 0 ? (
                <div className="empty" style={{ padding: '18px 0' }}>
                  还没有推送记录
                </div>
              ) : (
                <div className="dash-recent">
                  {dash.recent.map((r) => (
                    <button key={r.fullName} className="dash-recent-row" onClick={() => p.onOpenRepo(r.fullName)}>
                      <Icon name="repo" size={14} />
                      <span className="ellipsis">{r.name}</span>
                      <i>{relTime(r.pushedAt)}</i>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="section-title">仓库构成</div>
            <div className="panel">
              <div className="dash-split">
                <SplitBar
                  parts={[
                    { label: '源仓库', value: dash.counts.source, tone: 'accent' },
                    { label: 'fork', value: dash.counts.fork, tone: 'dim' },
                  ]}
                />
                <div className="dash-facts">
                  <div>
                    <b>{dash.counts.archived}</b>
                    <span>已归档</span>
                  </div>
                  <div>
                    <b>{dash.counts.withTopics}</b>
                    <span>有话题</span>
                  </div>
                  <div>
                    <b>{dash.stale}</b>
                    <span>90 天没动</span>
                  </div>
                </div>
              </div>
            </div>

            {rate && (
              <>
                <div className="section-title">接口配额</div>
                <div className="panel">
                  <div className="dash-quota">
                    <div className="dash-quota-head">
                      <b>
                        {compactNumber(rate.remaining)} / {compactNumber(rate.limit)}
                      </b>
                      <span>剩余 · 每小时重置</span>
                    </div>
                    <div className="dash-track">
                      <div
                        className="dash-track-fill"
                        style={{ width: `${Math.max(2, (rate.remaining / Math.max(1, rate.limit)) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="hint" style={{ padding: '10px 16px 30px' }}>
              活动数据来自 GitHub 的公开事件流，只保留最近 90 天、最多 {EVENT_PAGE * EVENT_MAX_PAGES} 条，
              所以窗口拉到 90 天时，最早那几天可能本来就没覆盖到。
              提交数按推送里去重后的提交计，不是人工逐个 commit。
              {data.eventsTruncated
                ? ` 事件流已取到 ${EVENT_PAGE * EVENT_MAX_PAGES} 条上限，更早的活动不会再计入。`
                : ''}
              {data.reposTruncated
                ? ` 仓库只统计了前 ${REPO_PAGE * REPO_MAX_PAGES} 个（按最近推送排序），总数以顶部「仓库」指标为准。`
                : ''}
              {!p.isSelf ? ' 不是当前登录账号，私有仓库看不到。' : ''}
            </div>
          </>
        )}
      </div>
    </>
  )
}

async function loadRepos(client: GitHubClient, fresh: boolean) {
  const list: Repo[] = []
  let truncated = false
  for (let page = 1; page <= REPO_MAX_PAGES; page += 1) {
    const query = new URLSearchParams({
      per_page: String(REPO_PAGE),
      page: String(page),
      sort: 'pushed',
      direction: 'desc',
      // 与仓库列表同一口径：自己名下的、被邀请协作的、组织里的都算
      affiliation: 'owner,collaborator,organization_member',
    })
    const res = await client.request<RawRepo[]>(`/user/repos?${query.toString()}`, {}, { fresh })
    const batch = (res.data ?? []).map(normalizeRepo)
    list.push(...batch)
    if (batch.length < REPO_PAGE) return { list, truncated }
    if (page === REPO_MAX_PAGES) truncated = true
  }
  return { list, truncated }
}

async function loadEvents(client: GitHubClient, login: string, fresh: boolean) {
  let list: GhEvent[] = []
  let truncated = false
  for (let page = 1; page <= EVENT_MAX_PAGES; page += 1) {
    const res = await client.request<GhEvent[]>(
      `/users/${encodeURIComponent(login)}/events?per_page=${EVENT_PAGE}&page=${page}`,
      {},
      { fresh },
    )
    const merged = mergeEvents(list, res.data ?? [])
    list = merged.list
    // 用「本页新增数」而不是响应条数判断有没有下一页
    if (merged.added < EVENT_PAGE) return { list, truncated }
    if (page === EVENT_MAX_PAGES) truncated = true
  }
  return { list, truncated }
}

/** "2026-11-14" → "11-14" */
function shortDay(date: string | undefined): string {
  if (!date) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  return m ? `${m[2]}-${m[3]}` : date
}

/**
 * 贡献日历格子图。
 *
 * 用 SVG 而不是 div 网格：格子必须是正方形，div 铺满宽度会变成长条；
 * SVG 的 viewBox 能保证任何屏宽下都等比缩放。
 * `fill` 直接用 CSS 变量，颜色跟着主题与强调色走，不写死。
 */
function ContributionGrid({ grid }: { grid: GridData }) {
  const CELL = 13
  const GAP = 3
  const W = grid.weeks.length * (CELL + GAP) - GAP
  const H = 7 * (CELL + GAP) - GAP
  return (
    <svg
      className="cgrid"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`近 ${grid.weeks.length} 周贡献格子图，共 ${grid.total} 次活动`}
    >
      {grid.weeks.map((week, wi) =>
        week.map((c, di) =>
          c.future ? (
            <rect
              key={c.date}
              x={wi * (CELL + GAP)}
              y={di * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={2.5}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.1}
              strokeDasharray="2 2"
              strokeWidth={1}
            />
          ) : (
            <rect
              key={c.date}
              x={wi * (CELL + GAP)}
              y={di * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={2.5}
              fill={`var(--grid-${c.level})`}
            >
              <title>{`${c.date} · ${c.count} 次`}</title>
            </rect>
          ),
        ),
      )}
    </svg>
  )
}

/**
 * 堆叠柱状图。
 *
 * 用 SVG 手绘而不是引图表库：整个看板只有这一张图，
 * 一个 recharts 进来就是 100KB+，比整个 App 的 JS 都大。
 * 柱子只画形状，日期标签放在 HTML 里 —— 这样 viewBox 拉伸时文字不会一起变形。
 */
function ActivityChart({ days }: { days: DayBucket[] }) {
  const W = 300
  const H = 88
  const GAP = 3
  const bw = (W - GAP * Math.max(0, days.length - 1)) / Math.max(1, days.length)
  const max = Math.max(1, ...days.map((d) => d.total))
  const usable = H - 8

  return (
    <svg
      className="dash-chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`近 ${days.length} 天活动柱状图`}
    >
      <line
        x1={0}
        y1={H - 0.5}
        x2={W}
        y2={H - 0.5}
        stroke="currentColor"
        strokeOpacity={0.16}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {days.map((d, i) => {
        const x = i * (bw + GAP)
        const scale = d.total === 0 ? 0 : Math.max(2, (d.total / max) * usable)
        // 堆叠顺序：提交在下、Issue 中、PR 上。段高按各自占比切，最小 1px 免得消失
        const seg = (v: number) => (d.total === 0 ? 0 : Math.max(v > 0 ? 1 : 0, (v / d.total) * scale))
        const hCommits = seg(d.commits)
        const hIssues = seg(d.issues)
        const hPulls = seg(d.pulls)
        const bottom = H - 1
        const isToday = i === days.length - 1
        return (
          <g key={d.date} opacity={isToday ? 1 : 0.92}>
            {d.total === 0 && (
              <rect x={x} y={bottom - 2} width={bw} height={2} fill="currentColor" opacity={0.1} />
            )}
            {hCommits > 0 && (
              <rect
                x={x}
                y={bottom - hCommits}
                width={bw}
                height={hCommits}
                fill="rgb(var(--accent-rgb))"
              />
            )}
            {hIssues > 0 && (
              <rect
                x={x}
                y={bottom - hCommits - hIssues}
                width={bw}
                height={hIssues}
                fill="rgb(var(--chart-issue-rgb))"
              />
            )}
            {hPulls > 0 && (
              <rect
                x={x}
                y={bottom - hCommits - hIssues - hPulls}
                width={bw}
                height={hPulls}
                fill="rgb(var(--chart-pull-rgb))"
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}

function LangRow({ slice }: { slice: LangSlice }) {
  const color = LANG_COLOR[slice.language] ?? 'rgb(var(--accent-rgb))'
  // 「其它 N 种」没有对应语言色，用中性色
  const isOther = slice.language.startsWith('其它 ')
  return (
    <div className="dash-lang">
      <span className="dash-lang-name ellipsis">
        <i className="dot" style={{ background: isOther ? 'var(--text-dim)' : color }} />
        {slice.language}
      </span>
      <span className="dash-lang-track">
        <i
          style={{
            width: `${Math.max(3, slice.ratio * 100)}%`,
            background: isOther ? 'var(--text-dim)' : color,
            opacity: isOther ? 0.5 : 0.85,
          }}
        />
      </span>
      <span className="dash-lang-num">
        <b>{slice.count}</b>
        <em>{Math.round(slice.ratio * 100)}%</em>
      </span>
    </div>
  )
}

function RankRow(p: {
  rank: number
  repo: RepoRank
  max: number
  unit: string
  onOpen: () => void
}) {
  const ratio = p.max > 0 ? p.repo.stars / p.max : 0
  return (
    <button className="dash-rank" onClick={p.onOpen}>
      <span className="dash-rank-no">{p.rank}</span>
      <span className="dash-rank-main">
        <span className="ellipsis">{p.repo.name}</span>
        <i className="dash-rank-track">
          <i style={{ width: `${Math.max(2, ratio * 100)}%` }} />
        </i>
      </span>
      <span className="dash-rank-num">
        {p.unit} {compactNumber(p.repo.stars)}
      </span>
    </button>
  )
}

function SplitBar(p: { parts: { label: string; value: number; tone: 'accent' | 'dim' }[] }) {
  const total = p.parts.reduce((s, x) => s + x.value, 0)
  return (
    <div className="dash-splitbar">
      <div className="dash-split-track">
        {total === 0 ? (
          <i style={{ width: '100%', background: 'var(--line)' }} />
        ) : (
          p.parts.map((x) =>
            x.value === 0 ? null : (
              <i
                key={x.label}
                style={{
                  width: `${(x.value / total) * 100}%`,
                  background:
                    x.tone === 'accent' ? 'rgba(var(--accent-rgb), 0.85)' : 'rgba(var(--text-dim-rgb), 0.5)',
                }}
                title={`${x.label} ${x.value}`}
              />
            ),
          )
        )}
      </div>
      <div className="dash-split-legend">
        {p.parts.map((x) => (
          <span key={x.label}>
            <i
              className="dash-dot"
              style={{
                background:
                  x.tone === 'accent' ? 'rgba(var(--accent-rgb), 0.85)' : 'rgba(var(--text-dim-rgb), 0.5)',
              }}
            />
            {x.label} {x.value}
          </span>
        ))}
      </div>
    </div>
  )
}
