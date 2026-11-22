/**
 * 多账号批量动作。
 *
 * 令牌里能存多个账号，但 star / 复刻这类动作一直是「只对当前账号」——
 * 小号和大号要各切一次，切一次还会清掉界面现场。
 * 这里把「对多个账号做同一件事」抽成纯逻辑 + 一条串行执行管道：
 *
 *   planMultiTasks  先算清楚每个账号是做、还是已经有状态可以跳过
 *   runMultiTasks   串行跑，失败不影响后续，逐条回执
 *   summarize       把回执压成一句话给 toast
 *
 * 不做并发是有意的：同一枚令牌连续敲 GitHub 会撞二级限流（secondary rate limit），
 * 而六七个账号串行也就多花一秒，换来的是一条能看懂的回执。
 *
 * 纯逻辑，不碰网络 —— 单测直接喂假数据。
 */

export type MultiKind = 'star' | 'unstar' | 'fork'

export interface MultiAccount {
  id: string
  /** 界面上显示的名字，通常是 @login */
  label: string
  login: string | null
  /** 头像地址；拿不到就画首字母 */
  avatarUrl?: string | null
}

/** 某个账号在这件事上的既有状态；null / 缺省都表示「没查到，按没有处理」 */
export interface AccountState {
  starred?: boolean | null
  forked?: boolean | null
}

export interface MultiTask {
  id: string
  label: string
  kind: MultiKind
  /** 有值表示不用发请求，直接按这个原因跳过 */
  skip?: string
}

export interface MultiResult {
  id: string
  label: string
  ok: boolean
  /** 跳过原因（ok 为 true 但没有真发请求） */
  skipped?: string
  error?: string
}

/** 主按钮文案：把账号数写进去，点之前就知道会影响几个账号 */
export function runLabel(kind: MultiKind, count: number): string {
  if (kind === 'star') return count > 1 ? `Star 到 ${count} 个账号` : 'Star 到该账号'
  if (kind === 'unstar') return count > 1 ? `在 ${count} 个账号取消 Star` : '取消 Star'
  return count > 1 ? `复刻到 ${count} 个账号` : '复刻到该账号'
}

/** 回执里「做成了」的说法，按动作分开写，中英文混排才不至于粘在一起 */
function doneText(kind: MultiKind, count: number): string {
  if (kind === 'star') return `${count} 个账号已 star`
  if (kind === 'unstar') return `${count} 个账号已取消 star`
  return `${count} 个账号已提交复刻`
}

/**
 * 算出每个账号要做什么。
 *
 * 跳过规则按动作分开定：
 * - star：已经 star 过的不再发 PUT（GitHub 会直接返回 204，但来回一次没必要）
 * - unstar：本来就没 star 的跳过
 * - fork：已经有复刻的跳过（GitHub 对重复 fork 会返回已有仓库，但那样会让人以为「刚复刻完」）
 */
export function planMultiTasks(
  accounts: MultiAccount[],
  kind: MultiKind,
  states: Record<string, AccountState>,
): MultiTask[] {
  return accounts.map((a) => {
    const st = states[a.id] ?? {}
    const task: MultiTask = { id: a.id, label: a.label, kind }
    if (kind === 'star' && st.starred === true) task.skip = '已经 star 过'
    else if (kind === 'unstar' && st.starred === false) task.skip = '本来就没 star'
    else if (kind === 'fork' && st.forked === true) task.skip = '已有复刻'
    return task
  })
}

/**
 * 默认勾选。
 *
 * v1.1.2 起由偏好决定勾几个：count=0 表示全部（老行为），1/2/3 就只勾前几个。
 * tasks 的顺序来自 buildAccounts —— **当前账号永远排第一**，所以「只勾 1 个」
 * 勾的就是用户正在用的那个，不会莫名其妙选到小号。
 */
export function defaultSelection(tasks: MultiTask[], count = 0): Set<string> {
  const open = tasks.filter((t) => !t.skip)
  const n = count > 0 ? Math.min(count, open.length) : open.length
  return new Set(open.slice(0, n).map((t) => t.id))
}

/** 勾选/取消，返回新 Set。React 比对引用，不能就地改。 */
export function toggleSelection(sel: Set<string>, id: string): Set<string> {
  const next = new Set(sel)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** 全选 / 全不选：只要还有没勾的就全勾上，全勾着就清空。 */
export function toggleAllSelection(sel: Set<string>, tasks: MultiTask[]): Set<string> {
  const open = tasks.filter((t) => !t.skip).map((t) => t.id)
  const allOn = open.length > 0 && open.every((id) => sel.has(id))
  return allOn ? new Set<string>() : new Set(open)
}

/** 复刻列表里已经存在的账号（小写），用来判断某个账号是不是早复刻过 */
export function forkOwners(forks: { owner: string }[]): Set<string> {
  return new Set(forks.map((f) => f.owner.toLowerCase()))
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => {
    setTimeout(r, ms)
  })
}

/**
 * 串行执行。单条失败只记在自己那一行，不中断后面的账号。
 *
 * onDone 每完成一条就回调一次，调用方据此把回执一批批画出来 ——
 * 全部跑完才刷新的话，四个账号要干等一秒多，看着像卡死。
 */
export async function runMultiTasks(
  tasks: MultiTask[],
  exec: (task: MultiTask) => Promise<void>,
  opts: { gap?: number; onDone?: (result: MultiResult, index: number) => void } = {},
): Promise<MultiResult[]> {
  const gap = opts.gap ?? 140
  const out: MultiResult[] = []

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]
    if (t.skip) {
      const skipped: MultiResult = { id: t.id, label: t.label, ok: true, skipped: t.skip }
      out.push(skipped)
      opts.onDone?.(skipped, i)
      continue
    }
    let result: MultiResult
    try {
      await exec(t)
      result = { id: t.id, label: t.label, ok: true }
    } catch (err) {
      result = { id: t.id, label: t.label, ok: false, error: (err as Error).message || '失败' }
    }
    out.push(result)
    opts.onDone?.(result, i)
    if (gap > 0 && i < tasks.length - 1) await delay(gap)
  }

  return out
}

/** 回执压成一句话。失败优先报，因为那才需要人去看。 */
export function summarize(results: MultiResult[], kind: MultiKind): string {
  const done = results.filter((r) => r.ok && !r.skipped).length
  const skipped = results.filter((r) => r.ok && r.skipped).length
  const failed = results.filter((r) => !r.ok).length

  const parts: string[] = []
  if (done > 0) parts.push(doneText(kind, done))
  if (skipped > 0) parts.push(`${skipped} 个跳过`)
  if (failed > 0) parts.push(`${failed} 个失败`)

  if (parts.length === 0) return '没有可执行的账号'
  return parts.join('，')
}
