import { useState } from 'react'
import { fileStatusMeta, slicePatch, type PullFile } from '../lib/pulls'
import { Icon } from './icons'

/**
 * diff 视图。
 *
 * 默认收起：一个 PR 动辄几十个文件，全展开在手机上没法看。
 * 单文件内也截断到 400 行，超出提示「还有 N 行」。
 */
export function DiffView(p: { files: PullFile[]; defaultOpen?: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    p.files.slice(0, p.defaultOpen ?? 0).forEach((f) => {
      init[f.filename] = true
    })
    return init
  })

  return (
    <div className="diff">
      {p.files.map((f) => {
        const meta = fileStatusMeta(f.status)
        const isOpen = !!open[f.filename]
        return (
          <div className="diff-file" key={f.filename}>
            <button
              className="diff-head"
              onClick={() => setOpen((s) => ({ ...s, [f.filename]: !s[f.filename] }))}
            >
              <span className={`diff-mark s-${f.status}`}>{meta.mark}</span>
              <span className="diff-name ellipsis">
                {f.filename}
                {f.previous_filename && <i className="diff-from"> ← {f.previous_filename}</i>}
              </span>
              <span className="diff-stat">
                <b className="add">+{f.additions}</b>
                <b className="del">−{f.deletions}</b>
              </span>
              <Icon name={isOpen ? 'chevron' : 'arrowRight'} size={13} />
            </button>

            {isOpen && <FilePatch file={f} />}
          </div>
        )
      })}
    </div>
  )
}

function FilePatch({ file }: { file: PullFile }) {
  if (!file.patch) {
    return (
      <div className="diff-empty">
        {file.status === 'removed'
          ? '这个文件被删除了，没有可显示的内容'
          : '看不到 diff：可能是二进制文件、图片，或者改动太大被 GitHub 省掉了'}
      </div>
    )
  }
  const { lines, hidden } = slicePatch(file.patch)
  return (
    <div className="diff-body">
      {lines.map((l, i) => (
        <div className={`diff-line ${l.kind}`} key={i}>
          <span className="diff-sign">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
          <span className="diff-text">{l.text || '\u00a0'}</span>
        </div>
      ))}
      {hidden > 0 && <div className="diff-more">还有 {hidden} 行没显示，改动太大，建议在电脑上看</div>}
    </div>
  )
}
