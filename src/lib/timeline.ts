/**
 * Issue / PR 的「动态」（timeline events）。
 *
 * GitHub 的事件流把「谁在什么时候加了标签、指派给谁、为什么关掉」都记下来了，
 * 但 App 之前只显示评论 —— 标签怎么变的一直是空白，用户只能靠猜。这个模块把
 * 原始事件规整成一行人话，UI 只管排。
 *
 * 刻意**不显示**的东西：
 * - `commented`：评论正文已经单独渲染了，再来一行「xx 评论了」是重复；
 * - `committed` / `reviewed` / `subscribed` / `head_ref_deleted` 这类流水账，
 *   在手机上只会把真正有用的几行冲走。
 * - 认不出来的新事件类型直接丢（宁可少一行，也别显示 `xx 触发了 something`）。
 */

export interface TimelineRaw {
  id?: number | string
  event?: string
  created_at?: string
  actor?: { login?: string } | null
  user?: { login?: string } | null
  label?: { name?: string; color?: string } | null
  assignee?: { login?: string } | null
  milestone?: { title?: string } | null
  rename?: { from?: string; to?: string } | null
  commit_id?: string | null
  sha?: string | null
  state_reason?: string | null
  requested_reviewer?: { login?: string } | null
  source?: {
    issue?: {
      number?: number
      title?: string
      /** 判断来源是 PR 还是 Issue：有 pull_request 就是 PR */
      pull_request?: unknown
      repository?: { full_name?: string } | null
    } | null
  } | null
}

export type TimelineTone = 'plain' | 'label' | 'closed' | 'reopened' | 'ref' | 'merged'

export interface TimelineItem {
  /** 稳定 key：有的历史事件没有 id，用「类型 + 时间 + 序号」兜底 */
  key: string
  at: string
  actor: string
  text: string
  tone: TimelineTone
  /** 标签色，只有 label 类事件有 */
  color?: string
}

const SKIP = new Set([
  'commented',
  'committed',
  'reviewed',
  'review_requested',
  'review_request_removed',
  'subscribed',
  'unsubscribed',
  'mentioned',
  'head_ref_deleted',
  'head_ref_restored',
  'comment_deleted',
  'line-commented',
  'connected',
  'disconnected',
  'base_ref_changed',
])

function shortSha(sha: string | null | undefined): string {
  return (sha ?? '').slice(0, 7)
}

function closeReason(reason: string | null | undefined): string {
  if (reason === 'completed') return '（已完成）'
  if (reason === 'not_planned') return '（不打算处理）'
  if (reason === 'duplicate') return '（重复）'
  return ''
}

/**
 * 原始事件 → 展示行。返回空数组表示这条不该显示。
 *
 * 时间缺失的事件也丢掉：没有时间的动态排在评论中间只会误导。
 */
export function normalizeTimeline(raw: TimelineRaw[] | null | undefined): TimelineItem[] {
  const out: TimelineItem[] = []
  ;(raw ?? []).forEach((e, i) => {
    const kind = e.event ?? ''
    if (!kind || SKIP.has(kind)) return
    const at = e.created_at ?? ''
    if (!at) return
    const actor = e.actor?.login ?? e.user?.login ?? '某人'
    const key = String(e.id ?? `${kind}:${at}:${i}`)

    switch (kind) {
      case 'labeled':
        if (!e.label?.name) return
        out.push({
          key,
          at,
          actor,
          text: `加了标签「${e.label.name}」`,
          tone: 'label',
          color: e.label.color,
        })
        return
      case 'unlabeled':
        if (!e.label?.name) return
        out.push({ key, at, actor, text: `移除了标签「${e.label.name}」`, tone: 'label' })
        return
      case 'assigned':
        out.push({ key, at, actor, text: `指派给 @${e.assignee?.login ?? '某人'}`, tone: 'plain' })
        return
      case 'unassigned':
        out.push({ key, at, actor, text: `取消指派 @${e.assignee?.login ?? '某人'}`, tone: 'plain' })
        return
      case 'closed':
        out.push({ key, at, actor, text: `关闭了${closeReason(e.state_reason)}`, tone: 'closed' })
        return
      case 'reopened':
        out.push({ key, at, actor, text: '重新打开了', tone: 'reopened' })
        return
      case 'merged':
        out.push({
          key,
          at,
          actor,
          text: e.commit_id ? `合并了 ${shortSha(e.commit_id)}` : '合并了',
          tone: 'merged',
        })
        return
      case 'referenced':
        if (!e.commit_id) return
        out.push({ key, at, actor, text: `在提交 ${shortSha(e.commit_id)} 里提到`, tone: 'ref' })
        return
      case 'cross-referenced': {
        const src = e.source?.issue
        if (!src?.number) return
        const repo = src.repository?.full_name ? `${src.repository.full_name}` : ''
        const isPr = !!src.pull_request
        const label = repo ? `${repo}#${src.number}` : `#${src.number}`
        out.push({
          key,
          at,
          actor,
          text: `关联了${isPr ? ' PR ' : ' '}${label}`,
          tone: 'ref',
        })
        return
      }
      case 'renamed':
        if (!e.rename?.to) return
        out.push({
          key,
          at,
          actor,
          text: e.rename.from ? `把标题从「${e.rename.from}」改成「${e.rename.to}」` : `把标题改成「${e.rename.to}」`,
          tone: 'plain',
        })
        return
      case 'milestoned':
        if (!e.milestone?.title) return
        out.push({ key, at, actor, text: `加入里程碑「${e.milestone.title}」`, tone: 'plain' })
        return
      case 'demilestoned':
        if (!e.milestone?.title) return
        out.push({ key, at, actor, text: `移出里程碑「${e.milestone.title}」`, tone: 'plain' })
        return
      case 'locked':
        out.push({ key, at, actor, text: '锁定了对话', tone: 'plain' })
        return
      case 'unlocked':
        out.push({ key, at, actor, text: '解锁了对话', tone: 'plain' })
        return
      case 'ready_for_review':
        out.push({ key, at, actor, text: '标记为可评审', tone: 'plain' })
        return
      case 'converted_to_draft':
        out.push({ key, at, actor, text: '转为草稿', tone: 'plain' })
        return
      case 'marked_as_duplicate':
        out.push({ key, at, actor, text: '标记为重复', tone: 'plain' })
        return
      default:
        return
    }
  })
  return out
}

/**
 * 动态太多时只给最近几条 —— 手机上翻三十行历史会把评论区推到看不见的地方。
 * 返回「要显示的」与「被折叠的条数」。
 */
export function tailLimit(items: TimelineItem[], max = 8): { shown: TimelineItem[]; hidden: number } {
  if (max < 1) return { shown: [], hidden: items.length }
  if (items.length <= max) return { shown: items, hidden: 0 }
  return { shown: items.slice(items.length - max), hidden: items.length - max }
}
