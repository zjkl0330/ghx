import { describe, expect, it } from 'vitest'
import {
  EXIT_WINDOW_MS,
  exitDecision,
  resolveBack,
  sheetBackTarget,
  type BackState,
  type SheetName,
} from '../backnav'

function state(patch: Partial<BackState> = {}): BackState {
  return {
    screen: 'app',
    guardSheetOpen: false,
    auditOpen: false,
    sheet: 'none',
    hasWorkflow: false,
    selectMode: false,
    tab: 'repos',
    ...patch,
  }
}

describe('sheetBackTarget', () => {
  it('发行版与复刻关掉后回到仓库详情', () => {
    expect(sheetBackTarget('releases', false)).toBe('detail')
    expect(sheetBackTarget('forks', false)).toBe('detail')
  })

  it('运行详情从工作流进来时回到工作流', () => {
    expect(sheetBackTarget('run', true)).toBe('workflow')
  })

  it('运行详情没有来源工作流时直接收起', () => {
    expect(sheetBackTarget('run', false)).toBe('none')
  })

  it('其余弹层一律收起', () => {
    const others: SheetName[] = [
      'add',
      'visibility',
      'update',
      'detail',
      'create',
      'workflow',
      'repoPick',
    ]
    for (const s of others) expect(sheetBackTarget(s, false)).toBe('none')
  })
})

describe('resolveBack 层级顺序', () => {
  it('口令面板在最上层，先关它', () => {
    expect(resolveBack(state({ guardSheetOpen: true, sheet: 'detail', tab: 'settings' }))).toEqual({
      kind: 'close-guard',
    })
  })

  it('任意弹层优先于页签与多选', () => {
    expect(resolveBack(state({ sheet: 'detail', tab: 'stars', selectMode: true }))).toEqual({
      kind: 'sheet',
      to: 'none',
    })
  })

  it('子弹层退到详情而不是整屏收起', () => {
    expect(resolveBack(state({ sheet: 'releases' }))).toEqual({ kind: 'sheet', to: 'detail' })
    expect(resolveBack(state({ sheet: 'forks' }))).toEqual({ kind: 'sheet', to: 'detail' })
  })

  it('运行详情按来源回退', () => {
    expect(resolveBack(state({ sheet: 'run', hasWorkflow: true }))).toEqual({
      kind: 'sheet',
      to: 'workflow',
    })
    expect(resolveBack(state({ sheet: 'run' }))).toEqual({ kind: 'sheet', to: 'none' })
  })

  it('审计页是设置的子页，先退出审计', () => {
    expect(resolveBack(state({ auditOpen: true, tab: 'settings' }))).toEqual({ kind: 'close-audit' })
  })

  it('审计页优先于页签判断', () => {
    const action = resolveBack(state({ auditOpen: true, tab: 'settings' }))
    expect(action.kind).not.toBe('home')
  })

  it('多选状态先退出多选', () => {
    expect(resolveBack(state({ selectMode: true }))).toEqual({ kind: 'exit-select' })
  })

  it('多选会盖过页签：即使同时在别的页签也先退多选', () => {
    expect(resolveBack(state({ selectMode: true, tab: 'stars' }))).toEqual({ kind: 'exit-select' })
  })

  it('非首页页签回到首页', () => {
    for (const tab of ['stars', 'pipelines', 'tokens', 'settings']) {
      expect(resolveBack(state({ tab }))).toEqual({ kind: 'home' })
    }
  })

  it('首页且无任何层级时才退出', () => {
    expect(resolveBack(state())).toEqual({ kind: 'exit' })
  })

  it('批量执行中不放行返回', () => {
    expect(resolveBack(state({ sheet: 'visibility', sheetLocked: true }))).toEqual({
      kind: 'blocked',
    })
  })

  it('同一弹层任务结束后又能正常关闭', () => {
    expect(resolveBack(state({ sheet: 'visibility', sheetLocked: false }))).toEqual({
      kind: 'sheet',
      to: 'none',
    })
  })

  it('任务锁定不会盖过更上层的口令面板', () => {
    expect(
      resolveBack(state({ guardSheetOpen: true, sheet: 'visibility', sheetLocked: true })),
    ).toEqual({ kind: 'close-guard' })
  })

  it('口令屏与锁定屏直接退出，不参与页面层级', () => {
    expect(resolveBack(state({ screen: 'unlock', sheet: 'detail' }))).toEqual({ kind: 'exit' })
    expect(resolveBack(state({ screen: 'locked', selectMode: true }))).toEqual({ kind: 'exit' })
  })
})

describe('exitDecision 双击退出', () => {
  it('第一次按只上膛', () => {
    expect(exitDecision(0, 1_000_000)).toBe('arm')
  })

  it('窗口内第二次按才退出', () => {
    expect(exitDecision(1_000, 2_400)).toBe('exit')
  })

  it('刚好到窗口边界算过期', () => {
    expect(exitDecision(1_000, 1_000 + EXIT_WINDOW_MS)).toBe('arm')
  })

  it('超出窗口要重新上膛', () => {
    expect(exitDecision(1_000, 1_000 + EXIT_WINDOW_MS + 1)).toBe('arm')
  })

  it('时间回拨不误判为退出', () => {
    expect(exitDecision(5_000, 4_000)).toBe('arm')
  })
})
