import { useCallback, useEffect, useState } from 'react'
import type { GitHubClient } from '../lib/api'
import { listDir, languageOf, summarizeDir, type ContentItem } from '../lib/code'
import { formatBytes, compactNumber } from '../lib/format'
import type { Repo } from '../lib/types'
import type { RepoTab } from '../lib/routes'
import { REPO_TABS } from '../lib/routes'
import { archiveCandidates } from '../lib/archive'
import { repoPageUrl } from '../lib/mirrors'
import { openArchive, openExternal } from '../lib/update'
import { PageHeader, PageState } from './PageHeader'
import { IssuesPage } from './IssuesPage'
import { PullsPage } from './PullsPage'
import { Icon } from './icons'

/**
 * 仓库主页：代码 / Issues / PR 三个内联页签，加一排常用动作。
 *
 * 「动作」不内联而跳到流水线页面：那边已经有完整的运行记录与筛选，
 * 这里再抄一遍只会两套逻辑各自长歪。
 */
export function RepoPage(p: {
  client: GitHubClient | null
  owner: string
  repo: string
  tab: RepoTab
  /** 外部写完数据后加一，强制列表重新拉 */
  reloadKey: number
  /** 当前加速站：下载 zip 与「打开仓库」都跟着它走 */
  mirror: string
  onToast: (msg: string) => void
  onBack: () => void
  onTab: (tab: RepoTab) => void
  onOpenIssue: (n: number) => void
  onOpenPull: (n: number) => void
  onOpenDir: (path: string) => void
  onOpenFile: (path: string) => void
  onOpenRefs: () => void
  onOpenHome: () => void
  onOpenReadme: () => void
  onOpenReleases: () => void
  onOpenForks: () => void
  onOpenWorkflows: () => void
  onOpenSettings: () => void
  onNewFile: () => void
  onCompose: () => void
}) {
  const [meta, setMeta] = useState<Repo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [root, setRoot] = useState<ContentItem[]>([])
  const [rootLoading, setRootLoading] = useState(true)
  /** 探活要挨个发 HEAD，慢的时候有两三秒，期间别让人连点 */
  const [zipBusy, setZipBusy] = useState(false)

  const load = useCallback(
    async (silent = false) => {
      if (!p.client) return
      setError(null)
      try {
        const { data } = await p.client.repo(p.owner, p.repo, silent)
        setMeta(data)
        setRootLoading(true)
        const list = await listDir(p.client, p.owner, p.repo, '', data.default_branch)
        setRoot(list)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setRootLoading(false)
      }
    },
    [p.client, p.owner, p.repo],
  )

  useEffect(() => {
    void load()
  }, [load])

  async function downloadZip() {
    if (!meta || zipBusy) return
    setZipBusy(true)
    try {
      await openArchive(archiveCandidates(p.mirror, p.owner, p.repo, meta.default_branch))
      p.onToast('已交给浏览器下载，可在通知栏看进度')
    } catch (err) {
      p.onToast((err as Error).message)
    } finally {
      setZipBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title={p.repo}
        sub={
          <span>
            {p.owner} · {meta ? (meta.private ? '私有' : '公开') : '…'}
            {meta ? ` · ${compactNumber(meta.stargazers_count)} 星` : ''}
          </span>
        }
        onBack={p.onBack}
        right={
          <button className="icon-btn" onClick={() => void load(true)} aria-label="刷新">
            <Icon name="refresh" size={17} />
          </button>
        }
        action={
          p.tab === 'issues' || p.tab === 'pulls'
            ? { label: '新建', icon: 'plus', onClick: p.onCompose }
            : undefined
        }
      />

      <div className="page" style={{ marginTop: 0 }}>
        <PageState error={error} onRetry={() => void load(true)} />

        {meta && (
          <div className="repohead">
            {meta.description && <div className="repodesc">{meta.description}</div>}
            <div className="repometa">
              {meta.language && (
                <span>
                  <i className="lang-dot" /> {meta.language}
                </span>
              )}
              <span>分支 {meta.default_branch}</span>
              <span>{compactNumber(meta.forks_count)} 复刻</span>
              {meta.archived && <span className="pill">已归档</span>}
            </div>
            <div className="chipwrap">
              <button className="chip" onClick={p.onOpenReadme}>
                <Icon name="book" size={12} /> 自述
              </button>
              <button className="chip" onClick={p.onOpenReleases}>
                <Icon name="tag" size={12} /> 发行版
              </button>
              <button className="chip" onClick={p.onOpenRefs}>
                <Icon name="branch" size={12} /> 分支
              </button>
              <button className="chip" onClick={p.onOpenWorkflows}>
                <Icon name="bolt" size={12} /> 流水线
              </button>
              <button className="chip" onClick={p.onOpenForks}>
                <Icon name="fork" size={12} /> 复刻
              </button>
              <button className="chip" onClick={p.onOpenSettings}>
                <Icon name="gear" size={12} /> 设置
              </button>
              <button className="chip" onClick={() => void downloadZip()} disabled={zipBusy}>
                <Icon name="download" size={12} /> {zipBusy ? '准备中…' : '压缩包'}
              </button>
              <button
                className="chip"
                onClick={() => void openExternal(repoPageUrl(p.mirror, `${p.owner}/${p.repo}`))}
              >
                <Icon name="external" size={12} /> 打开仓库
              </button>
            </div>
          </div>
        )}

        <div className="seg" style={{ margin: '10px 16px 0' }}>
          {REPO_TABS.map((t) => (
            <button key={t.key} className={p.tab === t.key ? 'on' : ''} onClick={() => p.onTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {p.tab === 'code' && (
          <>
            <div className="filebar">
              <span className="mono ellipsis">
                {meta?.default_branch ?? '默认分支'} · {summarizeDir(root)}
              </span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn ghost tiny" onClick={p.onNewFile}>
                  <Icon name="plus" size={12} />
                  新建
                </button>
                <button className="btn ghost tiny" onClick={p.onOpenHome}>
                  浏览
                </button>
              </span>
            </div>
            <PageState loading={rootLoading && root.length === 0} empty={root.length === 0 ? '这个仓库还没有文件' : undefined} />
            <div className="rows">
              {root.map((it) => (
                <div
                  key={it.path}
                  role="button"
                  tabIndex={0}
                  className="row file-row"
                  onClick={() => (it.type === 'dir' ? p.onOpenDir(it.path) : p.onOpenFile(it.path))}
                >
                  <span className="file-ic">
                    <Icon name={it.type === 'dir' ? 'folder' : 'file'} size={16} />
                  </span>
                  <span className="row-main">
                    <span className="row-l1">
                      <span className="row-name ellipsis">{it.name}</span>
                    </span>
                    <span className="row-meta">
                      {it.type === 'dir' ? '目录' : `${formatBytes(it.size ?? 0)} · ${languageOf(it.path)}`}
                    </span>
                  </span>
                  <Icon name="chevron" size={13} className="linkrow-arrow" />
                </div>
              ))}
            </div>
            {meta && (
              <div className="hint" style={{ padding: '12px 16px 24px' }}>
                只列到一层的目录，点进去再看下一层 —— 大仓库一次性拉整棵树会很慢。
              </div>
            )}
          </>
        )}

        {p.tab === 'issues' && (
          <IssuesPage key={`issues-${p.reloadKey}`} client={p.client} owner={p.owner} repo={p.repo} onOpen={p.onOpenIssue} />
        )}

        {p.tab === 'pulls' && (
          <PullsPage key={`pulls-${p.reloadKey}`} client={p.client} owner={p.owner} repo={p.repo} onOpen={p.onOpenPull} />
        )}
      </div>
    </>
  )
}
