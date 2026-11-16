/**
 * 里程碑（Milestone）。
 *
 * REST 端点齐全，成本很低：
 * - `GET  /repos/{o}/{r}/milestones` 列表
 * - `POST /repos/{o}/{r}/milestones` 新建（本版不做，用网页端建）
 * - `PATCH /repos/{o}/{r}/issues/{n}` body `{ milestone: number | null }` 设置
 *
 * 设置走 Issue 的 PATCH 而不是单独端点 —— GitHub 没有「把 issue 挪到某个 milestone」
 * 的专用接口。传 `null` 是移出里程碑，传数字是设置。
 *
 * 进度口径：`closed_issues / (open_issues + closed_issues)`。
 * PR 也在里面（GitHub 把 PR 当 issue 计数），这一点界面上要说明，
 * 否则「里程碑 5 个 issue 关了 3 个」和列表里看到的 issue 数对不上。
 */

export interface Milestone {
  number: number
  title: string
  state: 'open' | 'closed'
  description: string | null
  open_issues: number
  closed_issues: number
  created_at: string
  updated_at: string
  /** 截止日期；没设就是 null */
  due_on: string | null
  closed_at: string | null
  html_url?: string
}

/** 里程碑的完成进度，0–100 的整数。总数 0 时返回 0 而不是 NaN */
export function milestoneProgress(m: Milestone): number {
  const total = (m.open_issues || 0) + (m.closed_issues || 0)
  if (total <= 0) return 0
  return Math.round(((m.closed_issues || 0) / total) * 100)
}

export type DueTone = 'none' | 'ok' | 'soon' | 'over'

/**
 * 截止日期的相对说法。
 *
 * `soon` 是「7 天内到期」，`over` 是「已经过期但还没关」。
 * 已关闭的里程碑不管到期日 —— 关掉就是收工了，再标红没有意义。
 */
export function dueInfo(
  m: Milestone,
  now = Date.now(),
): { text: string; tone: DueTone } {
  if (!m.due_on) return { text: '', tone: 'none' }
  const t = Date.parse(m.due_on)
  if (Number.isNaN(t)) return { text: '', tone: 'none' }

  const days = Math.ceil((t - now) / 86_400_000)
  if (m.state === 'closed' || days < 0) {
    if (days < 0 && m.state !== 'closed') {
      const over = Math.abs(days)
      return { text: `逾期 ${over} 天`, tone: 'over' }
    }
    return { text: formatDue(m.due_on), tone: 'none' }
  }
  if (days <= 7) return { text: days === 0 ? '今天到期' : `还剩 ${days} 天`, tone: 'soon' }
  return { text: formatDue(m.due_on), tone: 'ok' }
}

/** "2026-12-01T00:00:00Z" → "12-01" */
export function formatDue(due: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(due)
  return m ? `${m[2]}-${m[3]}` : due
}

/** 下拉 / chips 里显示的文字，带上号与进度 */
export function milestoneLabel(m: Milestone): string {
  return m.title
}

/** 选中的里程碑在列表里还在不在 —— 删掉后筛选条会指向一个不存在的号 */
export function milestoneExists(list: Milestone[], number: string): boolean {
  if (!number || number === 'none' || number === '*') return true
  return list.some((m) => String(m.number) === number)
}

const enc = (s: string) => encodeURIComponent(s)

export async function listMilestones(
  client: { request: <T>(path: string, init?: RequestInit, opts?: { fresh?: boolean }) => Promise<{ data: T }> },
  owner: string,
  repo: string,
  fresh = false,
): Promise<Milestone[]> {
  const { data } = await client.request<Milestone[]>(
    `/repos/${enc(owner)}/${enc(repo)}/milestones?state=all&per_page=50&sort=due_on&direction=asc`,
    {},
    { fresh },
  )
  return Array.isArray(data) ? data : []
}

/**
 * 设置或清除某个 Issue 的里程碑。
 *
 * `milestone` 传 null 表示移出。返回 PATCH 后的 Issue（只要 milestone 字段），
 * 调用方用它直接更新界面，不再重拉整条 —— 重拉会连带刷掉未提交的本地状态。
 */
export async function setMilestone(
  client: {
    request: <T>(path: string, init?: RequestInit) => Promise<{ data: T }>
  },
  owner: string,
  repo: string,
  issueNumber: number,
  milestone: number | null,
): Promise<{ number: number | null }> {
  const { data } = await client.request<{ milestone?: { number?: number } | null }>(
    `/repos/${enc(owner)}/${enc(repo)}/issues/${issueNumber}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ milestone }),
    } as RequestInit,
  )
  return { number: data?.milestone?.number ?? null }
}
