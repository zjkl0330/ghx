/**
 * 列表简介的取数与取用。
 *
 * 机翻是按条计费的（哪怕是免费通道也有速率限制），所以「哪些行该翻」这件事
 * 必须只有一处判断：调用方各自 slice 一遍，很容易把 30 条变成 90 条并发。
 *
 * 这里只做纯计算，联网与缓存都在 useDescTranslation 里 —— 于是它可以被单测。
 */
import type { Repo } from './types'

export interface DescItem {
  /** 用 full_name 当 key：仓库改名之前它唯一，且比数字 id 可读 */
  key: string
  text: string | null | undefined
}

/**
 * 从一组仓库里挑出要翻的简介。
 *
 * - 空简介直接丢掉：没有内容可翻，留着只会白跑一次缓存查询；
 * - 同名仓库去重（热门页按语言分组时会出现同一行）；
 * - 超过 limit 的不翻：用户看不到第 31 行，翻了也是浪费；
 * - extra 是正在看详情的那一个，它可能不在当前列表里（从搜索/通知点进来）。
 */
export function pickDescItems(list: Repo[], limit = 30, extra?: Repo | null): DescItem[] {
  const out: DescItem[] = []
  const seen = new Set<string>()

  const push = (r: Repo) => {
    const text = (r.description ?? '').trim()
    if (!text || seen.has(r.full_name)) return
    seen.add(r.full_name)
    out.push({ key: r.full_name, text })
  }

  for (const r of list) {
    if (out.length >= limit) break
    push(r)
  }
  // 详情必须翻，哪怕列表已经塞满
  if (extra) push(extra)
  return out
}

/** 取译文；没有就返回 null，调用方据此决定是否显示「译」标 */
export function descText(map: Record<string, string> | undefined, fullName: string): string | null {
  const v = map?.[fullName]
  return v && v.trim() ? v : null
}
