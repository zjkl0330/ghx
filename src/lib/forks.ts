import type { Fork } from './types'

/** 当前账号是否已经复刻过这个仓库。owner 比较统一忽略大小写。 */
export function findMyFork(forks: Fork[], login: string | null): Fork | null {
  if (!login) return null
  const me = login.toLowerCase()
  return forks.find((f) => f.owner.toLowerCase() === me) ?? null
}

/** 复刻按创建时间倒序；没有创建时间的排到最后，不参与比较。 */
export function sortForks(forks: Fork[]): Fork[] {
  return [...forks].sort((a, b) => {
    const ta = Date.parse(a.created_at) || 0
    const tb = Date.parse(b.created_at) || 0
    return tb - ta
  })
}

/** `owner/name` → `name`，用于展示复刻目标。 */
export function repoName(fullName: string): string {
  const i = fullName.lastIndexOf('/')
  return i < 0 ? fullName : fullName.slice(i + 1)
}

export function forkOwnerName(f: Pick<Fork, 'owner' | 'name'>): string {
  return `${f.owner}/${f.name}`
}

/**
 * 复刻前先判断「自己已经有一份」，避免重复触发 202 排队。
 * 注意：GitHub 对重复复刻不会报错，而是返回已有仓库，所以只能靠本地判断提示用户。
 */
export function forkHint(forks: Fork[], login: string | null): string {
  const mine = findMyFork(forks, login)
  if (!login) return '未连接账号，无法判断是否已复刻'
  if (mine) return `你已有复刻 ${forkOwnerName(mine)}`
  return '复刻后可在自己的仓库列表里找到'
}
