/**
 * 返回键决策。
 *
 * 安卓的返回键语义是「退一层」，不是「退整个 App」。这里把层级单独算成纯函数，
 * 方便覆盖每一种组合，也避免以后新增弹层时忘了接进返回栈。
 */

export type SheetName =
  | 'none'
  | 'add'
  | 'visibility'
  | 'update'
  | 'detail'
  | 'create'
  | 'releases'
  | 'forks'
  | 'workflow'
  | 'run'
  | 'repoPick'
  | 'sort'
  | 'readme'
  | 'mirrors'
  /** 新开 Issue / PR */
  | 'compose'
  /** 运行日志（从运行详情点进来） */
  | 'logs'

/** 首页页签：底栏第一项就是「首页」，返回时回到它 */
export const HOME_TAB = 'repos'

export interface BackState {
  /** app = 主界面；unlock / locked = 口令屏与锁定挡屏 */
  screen: 'app' | 'unlock' | 'locked'
  guardSheetOpen: boolean
  /**
   * 路由栈深度：个人页 / 设置 / 仓库 / Issue / 文件浏览都算一层。
   * 早期叫 screenDepth，路由化之后语义没变，名字改准确了。
   */
  routeDepth: number
  sheet: SheetName
  /** 运行详情是从工作流详情点进来的，返回时应回到上一层而不是直接关掉 */
  hasWorkflow: boolean
  selectMode: boolean
  tab: string
  /** 底栏第一个页签。用户可以把仓库页签藏起来，返回目标要跟着变 */
  homeTab?: string
  /** 弹层里有不可中断的任务（如在跑的批量改可见度），返回不放行 */
  sheetLocked?: boolean
  /** 加速站面板从哪个弹层进来的，返回时回到那一层 */
  mirrorReturn?: SheetName
  /** 自述/发行版/复刻从哪进来的：仓库详情弹层还是仓库主页 */
  subReturn?: SheetName
}

export type BackAction =
  | { kind: 'exit' }
  | { kind: 'close-guard' }
  | { kind: 'sheet'; to: SheetName }
  | { kind: 'pop-screen' }
  | { kind: 'exit-select' }
  | { kind: 'home' }
  | { kind: 'blocked' }

/** 关闭某个弹层后应该回到哪里 */
export function sheetBackTarget(
  sheet: SheetName,
  hasWorkflow: boolean,
  mirrorReturn: SheetName = 'none',
  subReturn: SheetName = 'detail',
): SheetName {
  switch (sheet) {
    // 加速站是从更新弹层点进来的，退回去继续看更新说明，而不是整屏收起
    case 'mirrors':
      return mirrorReturn
    // 这两个是仓库详情的子页，关掉后回到详情，而不是整屏收起
    case 'releases':
    case 'forks':
    case 'readme':
      return subReturn
    case 'run':
      return hasWorkflow ? 'workflow' : 'none'
    case 'logs':
      return 'run'
    default:
      return 'none'
  }
}

/**
 * 决定这一次返回该做什么。从「最上面一层」往下找第一个可以退的层级：
 * 口令面板 → 任意弹层 → 审计页 → 多选 → 非首页页签 → 退出 App。
 */
export function resolveBack(state: BackState): BackAction {
  // 口令屏上没有可退的界面层级，返回就是离开 App
  if (state.screen !== 'app') return { kind: 'exit' }

  if (state.guardSheetOpen) return { kind: 'close-guard' }

  if (state.sheet !== 'none') {
    // 批量改可见度跑到一半时，界面上已经没有取消按钮，返回键也不该绕过
    if (state.sheetLocked) return { kind: 'blocked' }
    return {
      kind: 'sheet',
      to: sheetBackTarget(state.sheet, state.hasWorkflow, state.mirrorReturn, state.subReturn),
    }
  }

  // 二级页面（个人页、设置、仓库、Issue、文件浏览…）先退一层
  if (state.routeDepth > 0) return { kind: 'pop-screen' }

  if (state.selectMode) return { kind: 'exit-select' }

  if (state.tab !== (state.homeTab ?? HOME_TAB)) return { kind: 'home' }

  return { kind: 'exit' }
}

/** 连按两次返回才退出的时间窗 */
export const EXIT_WINDOW_MS = 2000

/**
 * 根层的退出确认：第一次只提示，窗口内第二次才真退。
 * lastAt 为 0 表示还没按过。
 */
export function exitDecision(
  lastAt: number,
  now: number,
  windowMs: number = EXIT_WINDOW_MS,
): 'exit' | 'arm' {
  if (lastAt > 0 && now - lastAt >= 0 && now - lastAt < windowMs) return 'exit'
  return 'arm'
}
