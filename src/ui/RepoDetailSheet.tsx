import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { archiveFileName } from '../lib/archive'
import type { GitHubClient } from '../lib/api'
import type { AuditEntry, Repo, Visibility } from '../lib/types'
import type { Route } from '../lib/routes'
import { parseTopics, topicsToInput } from '../lib/topics'
import { openExternal } from '../lib/update'
import { copyText } from '../lib/clipboard'
import { linkifyUrls } from '../lib/mdlink'
import {
  DEFAULT_ACTION_ORDER,
  moveAction,
  readActionOrder,
  writeActionOrder,
  type DetailActionId,
} from '../lib/action-order'
import { Icon, type IconName } from './icons'
import { SpanText } from './SpanText'

interface Props {
  repo: Repo
  client: GitHubClient | null
  /** 当前登录账号，用来判断这个仓库是不是自己的 */
  login: string | null
  mirror: string
  /** 已翻好的简介；没有就显示原文 */
  descZh?: string | null
  onClose: () => void
  onChanged: (repo: Repo) => void
  onDeleted: (fullName: string) => void
  onAudit: (action: AuditEntry['action'], detail: { target: string; text: string }) => void
  onToast: (msg: string) => void
  onOpenHome: () => void
  onOpenReadme: () => void
  onOpenWorkflows: () => void
  onOpenReleases: () => void
  onOpenForks: () => void
  /**
   * 有多个账号时点 Star 走这里：先选账号再动手。
   * 只有一个账号时不传，保持「点一下直接 star」的老手感。
   */
  onMultiStar?: (kind: 'star' | 'unstar') => void
  /** 令牌里一共有几个账号，用来写那一行的副标题 */
  accountCount?: number
  /** 外部（多账号批量 star 之后）要重新查一次 star 状态时递增 */
  starTick?: number
  /** 点头像/账号名进入这个 owner 的主页；组织同样适用 */
  onOpenOwner?: () => void
  /** 下载源码 ZIP：开统一下载面板（测速选线在那边，和安装包共用一套） */
  onDownloadArchive?: () => void
  /** 简介里的 GitHub 链接在 App 内打开 */
  onOpenRoute?: (r: Route) => void
}

function relTime(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const d = Math.floor((Date.now() - t) / 86400000)
  if (d < 1) return '今天'
  if (d < 30) return `${d} 天前`
  if (d < 365) return `${Math.floor(d / 30)} 个月前`
  return `${Math.floor(d / 365)} 年前`
}

/** 排序面板要显示全部操作，包括当前仓库看不到的那些（非自己的仓库也能先排好） */
const ACTION_META: Record<DetailActionId, { label: string; icon: IconName }> = {
  star: { label: 'Star / 取消 Star', icon: 'star' },
  edit: { label: '编辑简介与话题', icon: 'dots' },
  archive: { label: '归档 / 取消归档', icon: 'archive' },
  visibility: { label: '转为私有 / 公开', icon: 'globe' },
  home: { label: '仓库主页', icon: 'repo' },
  readme: { label: '项目自述', icon: 'book' },
  workflows: { label: '工作流', icon: 'play' },
  releases: { label: '发行版', icon: 'package' },
  forks: { label: '复刻', icon: 'fork' },
  'repo-url': { label: '复制仓库地址', icon: 'copy' },
  zip: { label: '下载源码 ZIP', icon: 'download' },
  delete: { label: '删除仓库', icon: 'trash' },
}

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
}

export function RepoDetailSheet(p: Props) {
  const [starred, setStarred] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [typed, setTyped] = useState('')
  /** 简介/主页/话题就地编辑，不另开一层弹层 */
  const [editing, setEditing] = useState(false)
  const [desc, setDesc] = useState(p.repo.description ?? '')
  const [home, setHome] = useState(p.repo.homepage ?? '')
  const [topicText, setTopicText] = useState(topicsToInput(p.repo.topics))
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  /** 机翻简介旁边给一个「看原文」的开关，别让人以为原文就是这样 */
  const [showSrc, setShowSrc] = useState(false)
  /** 三条剪贴板通道都挂了，就把地址摊开让人长按选中 */
  const [copyFallback, setCopyFallback] = useState(false)
  /** 操作顺序：纯本地偏好，不分账号 */
  const [order, setOrder] = useState<DetailActionId[]>(() => readActionOrder())
  const [arranging, setArranging] = useState(false)

  const owner = p.repo.owner
  const name = p.repo.name
  // permissions 只有在 /user/repos 里才稳定存在；热门/星标搜出来的仓库可能没有，
  // 这时退回「owner 是不是自己」来判断，避免点了才报 403
  const canAdmin =
    p.repo.permissions?.admin ??
    (!!p.login && p.repo.owner.toLowerCase() === p.login.toLowerCase())

  useEffect(() => {
    let alive = true
    setStarred(null)
    setError(null)
    setConfirmDelete(false)
    setTyped('')
    setEditing(false)
    if (!p.client) return () => { alive = false }
    p.client
      .isStarred(owner, name)
      .then((v) => {
        if (alive) setStarred(v)
      })
      .catch(() => {
        if (alive) setStarred(null)
      })
    return () => {
      alive = false
    }
  }, [p.client, owner, name, p.starTick])

  async function run(key: string, fn: () => Promise<void>) {
    if (busy) return
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  function action(
    key: string,
    icon: IconName,
    label: string,
    hint: string,
    fn: () => Promise<void>,
    tone?: 'danger',
  ) {
    return (
      <button className={`actrow${tone === 'danger' ? ' danger' : ''}`} disabled={!!busy} onClick={() => void run(key, fn)}>
        <span className="act-ic">
          <Icon name={icon} size={15} />
        </span>
        <span className="act-txt">
          <b>{label}</b>
          <i>{hint}</i>
        </span>
        {busy === key && <span className="spin" style={{ width: 13, height: 13 }} />}
        {busy !== key && <Icon name="chevron" size={13} className="act-arrow" />}
      </button>
    )
  }

  async function saveMeta() {
    if (!p.client) return
    setSaving(true)
    setEditError(null)
    try {
      const { data } = await p.client.updateRepo(owner, name, {
        // 清空简介要传 null；空串会被 GitHub 当成「未修改」
        description: desc.trim() ? desc.trim() : null,
        homepage: home.trim() ? home.trim() : null,
        topics: parseTopics(topicText),
      })
      p.onChanged({ ...p.repo, ...data })
      p.onAudit('repo-edit', { target: p.repo.full_name, text: '更新简介 / 主页 / 话题' })
      p.onToast('仓库信息已更新')
      setEditing(false)
    } catch (err) {
      setEditError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const canDelete = typed.trim() === name

  /**
   * 操作清单一次性建好，再按 order 排。
   *
   * 以前这些 action(...) 是硬写在 JSX 里的，顺序等于代码顺序；要让用户自己排，
   * 就得先有一份「id → 节点」的表。可见性仍按权限算：别人的仓库不会出现
   * 编辑/归档/可见度/删除这四项，排序面板里却能看到它们（先排好，等有自己的仓库时生效）。
   */
  const acts: Partial<Record<DetailActionId, ReactNode>> = {}

  acts.star = action(
    'star',
    'star',
    starred ? '取消 Star' : 'Star 该仓库',
    p.onMultiStar
      ? `${p.accountCount ?? 2} 个账号可同时操作 · 当前${starred ? '已' : '未'} star`
      : starred === null
        ? '状态未知，操作前会先查询'
        : starred
          ? '当前已 star'
          : '当前未 star',
    async () => {
      if (!p.client) throw new Error('未连接令牌')
      const next = !starred
      // 多账号模式下不在这一层动手，交给选择面板统一执行
      if (p.onMultiStar) {
        p.onMultiStar(next ? 'star' : 'unstar')
        return
      }
      await p.client.setStarred(owner, name, next)
      setStarred(next)
      p.onAudit('repo-star', { target: p.repo.full_name, text: next ? '已 star' : '已取消 star' })
      p.onToast(next ? '已 star' : '已取消 star')
    },
  )

  if (canAdmin) {
    acts.edit = action('edit', 'dots', '编辑简介与话题', p.repo.description ?? '还没写简介', async () => {
      setDesc(p.repo.description ?? '')
      setHome(p.repo.homepage ?? '')
      setTopicText(topicsToInput(p.repo.topics))
      setEditError(null)
      setEditing(true)
    })

    acts.archive = action(
      'archive',
      'archive',
      p.repo.archived ? '取消归档' : '归档仓库',
      // 已归档时说的是「撤销会怎样」，别再写「归档后变只读」——
      // 那句话读起来像正要执行归档，两个方向正好读反
      p.repo.archived ? '恢复后可继续提交、开 Issue' : '归档后变为只读，可随时撤销',
      async () => {
        if (!p.client) throw new Error('未连接令牌')
        const next = !p.repo.archived
        const { data } = await p.client.setArchived(owner, name, next)
        p.onChanged(data ? { ...p.repo, archived: next } : { ...p.repo, archived: next })
        p.onAudit('repo-archive', { target: p.repo.full_name, text: next ? '已归档' : '已取消归档' })
        p.onToast(next ? '已归档' : '已取消归档')
      },
    )

    acts.visibility = action(
      'visibility',
      'globe',
      p.repo.private ? '转为公开' : '转为私有',
      p.repo.private ? '公开后任何人可搜索到' : '公开转私有会永久失去 star 与 watcher',
      async () => {
        if (!p.client) throw new Error('未连接令牌')
        const next: Visibility = p.repo.private ? 'public' : 'private'
        await p.client.setVisibility(owner, name, next)
        p.onChanged({ ...p.repo, private: next === 'private', visibility: next })
        p.onAudit('visibility', { target: p.repo.full_name, text: `切换为 ${next}` })
        p.onToast(next === 'private' ? '已转为私有' : '已转为公开')
      },
    )
  }

  acts.home = action('home', 'repo', '仓库主页', '代码浏览、Issues、PR、设置都在里面', async () =>
    p.onOpenHome(),
  )
  acts.readme = action('readme', 'book', '项目自述', 'README 原文，可一键翻成中文', async () =>
    p.onOpenReadme(),
  )
  acts.workflows = action('workflows', 'play', '工作流', '查看 Actions、启停与手动运行', async () =>
    p.onOpenWorkflows(),
  )
  acts.releases = action('releases', 'package', '发行版', '查看标签、附件与下载', async () =>
    p.onOpenReleases(),
  )
  acts.forks = action('forks', 'fork', '复刻', `${p.repo.forks_count} 份复刻 · 可复刻到自己账号`, async () =>
    p.onOpenForks(),
  )

  acts['repo-url'] = (
    <>
      {/* 复制的是网页地址，不是 clone 用的 .git 地址：
          这个 App 里没有终端，拿到 git@… 或 .git 结尾的地址没地方用；
          仓库地址可以直接粘进浏览器、分享给别人，也能让 git 自己补 .git。 */}
      {action('repo-url', 'copy', '复制仓库地址', `https://github.com/${p.repo.full_name}`, async () => {
        // 走 copyText 的三条通道（原生 → navigator.clipboard → execCommand）。
        // 以前这里直连 navigator.clipboard，华为 WebView 上那是 undefined，
        // 抛出的英文报错会被 run() 接到、原样染红显示在弹层里。
        const url = `https://github.com/${p.repo.full_name}`
        if (await copyText(url)) {
          setCopyFallback(false)
          p.onToast('仓库地址已复制')
          return
        }
        setCopyFallback(true)
        p.onToast('复制失败，长按下面那行地址')
      })}
      {/* 就贴在复制按钮下面：整页操作很多，放在弹层顶部等于看不见 */}
      {copyFallback && (
        <div className="url-fallback">
          <span>复制失败，长按选中：</span>
          <code>{`https://github.com/${p.repo.full_name}`}</code>
        </div>
      )}
    </>
  )

  acts.zip = action(
    'zip',
    'download',
    '下载源码 ZIP',
    `${archiveFileName(name, p.repo.default_branch)} · 默认分支 ${p.repo.default_branch}`,
    async () => {
      if (p.onDownloadArchive) {
        p.onDownloadArchive()
        return
      }
      // 没接下载面板时（老调用方）退回旧的打包地址
      await openExternal(
        `https://github.com/${owner}/${name}/archive/refs/heads/${p.repo.default_branch}.zip`,
      )
      p.onToast('已交给浏览器下载，可在通知栏看进度')
    },
  )

  if (canAdmin && !confirmDelete) {
    acts.delete = action(
      'delete',
      'trash',
      '删除仓库',
      '永久删除，无法恢复，需输入仓库名确认',
      async () => {
        setConfirmDelete(true)
      },
      'danger',
    )
  }

  function moveBy(id: DetailActionId, delta: -1 | 1) {
    const next = moveAction(order, id, delta)
    if (next === order) return
    setOrder(next)
    writeActionOrder(next)
  }

  function resetOrder() {
    const next = [...DEFAULT_ACTION_ORDER]
    setOrder(next)
    writeActionOrder(next)
    p.onToast('已恢复默认顺序')
  }

  return (
    <div className="mask" onClick={p.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ wordBreak: 'break-all' }}>{name}</h3>
            <div className="sheet-sub">
              {p.onOpenOwner ? (
                <button className="owner-link" onClick={p.onOpenOwner}>
                  {owner}
                </button>
              ) : (
                owner
              )}{' '}
              · {p.repo.private ? '私有' : '公开'}
              {p.repo.archived ? ' · 已归档' : ''} · 默认分支 {p.repo.default_branch}
            </div>
          </div>
          <button className="icon-btn" onClick={p.onClose} aria-label="关闭" style={{ marginTop: -4 }}>
            <Icon name="close" size={16} />
          </button>
        </div>

        {p.repo.description && (
          <div className="det-desc">
            {p.descZh ? (
              <>
                <div>
                  <SpanText
                    text={p.descZh}
                    spans={linkifyUrls(p.descZh)}
                    spansFor={p.descZh}
                    onRoute={p.onOpenRoute}
                  />
                  <span className="tr-mark">译</span>
                </div>
                <button className="linkbtn" style={{ marginTop: 4 }} onClick={() => setShowSrc((v) => !v)}>
                  {showSrc ? '收起原文' : '看原文'}
                </button>
                {showSrc && (
                  <div className="det-src">
                    <SpanText
                      text={p.repo.description}
                      spans={linkifyUrls(p.repo.description)}
                      spansFor={p.repo.description}
                      onRoute={p.onOpenRoute}
                    />
                  </div>
                )}
              </>
            ) : (
              <SpanText
                text={p.repo.description}
                spans={linkifyUrls(p.repo.description)}
                spansFor={p.repo.description}
                onRoute={p.onOpenRoute}
              />
            )}
          </div>
        )}

        <div className="det-stats">
          <div>
            <b>{p.repo.stargazers_count}</b>
            <i>Star</i>
          </div>
          <div>
            <b>{p.repo.forks_count}</b>
            <i>Fork</i>
          </div>
          <div>
            <b style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center' }}>
              {p.repo.language && (
                <span
                  className="dot"
                  style={{ background: LANG_COLOR[p.repo.language] ?? '#8b949e' }}
                />
              )}
              {p.repo.language ?? '—'}
            </b>
            <i>语言</i>
          </div>
          <div>
            <b>{relTime(p.repo.pushed_at)}</b>
            <i>最后推送</i>
          </div>
        </div>

        {error && (
          <div className="errline" style={{ marginTop: 2, marginBottom: 6 }}>
            {error}
          </div>
        )}

        {editing && (
          <div className="panel" style={{ marginBottom: 10 }}>
            <div className="field">
              <label htmlFor="edit-desc">仓库简介</label>
              <textarea
                id="edit-desc"
                className="textarea"
                rows={3}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="一句话说明这个仓库做什么"
              />
            </div>
            <div className="field">
              <label htmlFor="edit-home">主页</label>
              <input
                id="edit-home"
                value={home}
                onChange={(e) => setHome(e.target.value)}
                placeholder="https://…（可留空）"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>
            <div className="field">
              <label htmlFor="edit-topics">话题</label>
              <input
                id="edit-topics"
                value={topicText}
                onChange={(e) => setTopicText(e.target.value)}
                placeholder="react, android, tauri"
                autoCapitalize="off"
                spellCheck={false}
              />
              <div className="hint">
                逗号或空格分隔，最多 20 个。GitHub 只收小写字母、数字与连字符，中文会被忽略。
              </div>
            </div>
            {editError && <div className="errline">{editError}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn ghost" style={{ flex: 1 }} onClick={() => setEditing(false)}>
                取消
              </button>
              <button
                className="btn primary"
                style={{ flex: 1 }}
                disabled={saving}
                onClick={() => void saveMeta()}
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        )}

        {arranging && (
          /* 控制条放在列表顶上：12 行铺满一屏时，底部的「完成」会被推到屏幕外 */
          <div className="reorder-bar">
            <span>点箭头调整，改完自动保存</span>
            <button className="linkbtn" onClick={resetOrder}>
              恢复默认
            </button>
            <button className="btn ghost" onClick={() => setArranging(false)}>
              完成
            </button>
          </div>
        )}

        {arranging ? (
          /* 排序态：列出全部 12 项，包括当前仓库看不到的权限项 —— 用户是在排「自己的习惯」，
             不该因为此刻点开的是别人的仓库就少排几项 */
          <div className="acts reorder">
            {order.map((id, i) => {
              const meta = ACTION_META[id]
              return (
                <div className="actrow reorder-row" key={id}>
                  <span className="act-ic">
                    <Icon name={meta.icon} size={15} />
                  </span>
                  <span className="act-txt">
                    <b>{meta.label}</b>
                    {!acts[id] && <i>当前仓库不可用</i>}
                  </span>
                  <button
                    className="icon-btn"
                    aria-label={`上移「${meta.label}」`}
                    disabled={i === 0}
                    onClick={() => moveBy(id, -1)}
                  >
                    <Icon name="up" size={14} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`下移「${meta.label}」`}
                    disabled={i === order.length - 1}
                    onClick={() => moveBy(id, 1)}
                  >
                    <Icon name="down" size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="acts">
            {order
              .filter((id) => acts[id])
              .map((id) => (
                <Fragment key={id}>{acts[id]}</Fragment>
              ))}
          </div>
        )}

        {!arranging && (
          <div className="acts-foot">
            <button className="linkbtn" onClick={() => setArranging(true)}>
              调整操作顺序
            </button>
          </div>
        )}

        {!canAdmin && (
          <div className="hint" style={{ marginTop: 10 }}>
            这是 {owner} 的仓库，你没有管理权限，所以改可见度、归档与删除的入口不显示。
          </div>
        )}

        {confirmDelete && (
          <div className="dangerbox">
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--red)', display: 'flex', marginTop: 1 }}>
                <Icon name="warn" size={14} />
              </span>
              <div>
                <b style={{ fontSize: 12, color: '#f0a9a6' }}>永久删除 {p.repo.full_name}</b>
                <div style={{ fontSize: 11, color: '#c98d8a', marginTop: 4, lineHeight: 1.55 }}>
                  issue、PR、release、star 全部消失，无法撤销。输入仓库名 <code className="mono">{name}</code> 以确认。
                </div>
              </div>
            </div>
            <input
              className="danger-input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={name}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
              <button
                className="btn ghost"
                style={{ flex: 1 }}
                onClick={() => {
                  setConfirmDelete(false)
                  setTyped('')
                }}
              >
                取消
              </button>
              <button
                className="btn danger"
                style={{ flex: 1 }}
                disabled={!canDelete || !!busy}
                onClick={() =>
                  void run('delete-do', async () => {
                    if (!p.client) throw new Error('未连接令牌')
                    await p.client.deleteRepo(owner, name)
                    p.onDeleted(p.repo.full_name)
                    p.onToast('仓库已删除')
                  })
                }
              >
                {busy === 'delete-do' ? '删除中…' : '确认删除'}
              </button>
            </div>
            <div className="hint" style={{ marginTop: 7 }}>
              删除需要令牌具备 delete_repo 权限，否则会返回 403。
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
