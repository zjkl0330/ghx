import type { CSSProperties, ReactNode } from 'react'

const P: Record<string, ReactNode> = {
  repo: (
    <>
      <path d="M4 19V6a2 2 0 012-2h12a2 2 0 012 2v13a2 2 0 01-2 2H6a2 2 0 01-2-2z" />
      <path d="M9 4v16" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="4" />
      <path d="M10.5 12.5L20 3l1.5 1.5-2 2 2 2-2 2-2-2-1.5 1.5 1.5 1.5-2 2L14 12" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.6 1.6 0 008 19.4a1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H2a2 2 0 110-4h.1A1.6 1.6 0 004.6 8a1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V2a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H22a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
      <path d="M13.7 21a2 2 0 01-3.4 0" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 018 0v3" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  check: <path d="M4 12.5l5 5L20 6.5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  warn: (
    <>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 11-3-6.7" />
      <path d="M21 4v5h-5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2" />
      <path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  /** 测速用 */
  bolt: <path d="M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5z" />,
  /** 外部页面 */
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8.5 8.5" />
      <path d="M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.2A9.9 9.9 0 0112 6c6.5 0 10 6 10 6a16 16 0 01-3 3.7" />
      <path d="M6.5 7.8A16 16 0 002 12s3.5 6 10 6a9.6 9.6 0 004.3-1" />
    </>
  ),
  dots: (
    <>
      <circle cx="12" cy="5" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="12" cy="19" r="1.4" />
    </>
  ),
  select: (
    <>
      <path d="M9 4H6a2 2 0 00-2 2v3M15 4h3a2 2 0 012 2v3M9 20H6a2 2 0 01-2-2v-3M15 20h3a2 2 0 002-2v-3" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" />,
  archive: (
    <>
      <rect x="3" y="4" width="18" height="5" rx="1.2" />
      <path d="M5 9v9a2 2 0 002 2h10a2 2 0 002-2V9" />
      <path d="M10 13h4" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 012-2h8" />
    </>
  ),
  tag: (
    <>
      <path d="M3 12V5a2 2 0 012-2h7l9 9-9 9z" />
      <circle cx="7.5" cy="7.5" r="1.3" />
    </>
  ),
  play: <path d="M7 4.5l12 7.5-12 7.5z" />,
  branch: (
    <>
      <circle cx="7" cy="5.5" r="2.2" />
      <circle cx="7" cy="18.5" r="2.2" />
      <circle cx="17" cy="8.5" r="2.2" />
      <path d="M7 7.7v8.6" />
      <path d="M17 10.7c0 3.4-3.4 3.6-6.6 4.2" />
    </>
  ),
  package: (
    <>
      <path d="M3.5 8.2L12 3.5l8.5 4.7v7.6L12 20.5l-8.5-4.7z" />
      <path d="M3.5 8.2L12 12.9l8.5-4.7M12 12.9v7.6" />
    </>
  ),
  fork: (
    <>
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="17" cy="6" r="2.2" />
      <circle cx="12" cy="19" r="2.2" />
      <path d="M7 8.2v1.6a2 2 0 002 2h6a2 2 0 002-2V8.2" />
      <path d="M12 11.8v5" />
    </>
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  sort: (
    <>
      <path d="M7 4.5v15M7 19.5l-3-3M7 19.5l3-3" />
      <path d="M17 19.5v-15M17 4.5l-3 3M17 4.5l3 3" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A1.5 1.5 0 015.5 4H11v16H5.5A1.5 1.5 0 014 18.5z" />
      <path d="M20 5.5A1.5 1.5 0 0018.5 4H13v16h5.5A1.5 1.5 0 0020 18.5z" />
    </>
  ),
  trend: (
    <>
      <path d="M3 17l6-6 4 4 7-7" />
      <path d="M14 8h6v6" />
    </>
  ),
  terminal: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M7 9.5l2.8 2.4L7 14.3M12.5 14.5H17" />
    </>
  ),
  issue: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none" />
    </>
  ),
  chat: (
    <>
      <path d="M20 11.5a7.5 7.5 0 01-10.9 6.7L4 20l1.8-4.6A7.5 7.5 0 1120 11.5z" />
    </>
  ),
  file: (
    <>
      <path d="M13.5 3.5H7a2 2 0 00-2 2v13a2 2 0 002 2h10a2 2 0 002-2V9z" />
      <path d="M13.5 3.5V9H19" />
    </>
  ),
  folder: <path d="M3.5 7.5a2 2 0 012-2h3.7l2 2.2H18.5a2 2 0 012 2v7.8a2 2 0 01-2 2h-13a2 2 0 01-2-2z" />,
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M5 20.5c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l10-10-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
  merge: (
    <>
      <circle cx="7" cy="6" r="2.2" />
      <circle cx="7" cy="18" r="2.2" />
      <circle cx="17" cy="12" r="2.2" />
      <path d="M7 8.2v7.6M9.2 6.6c0 4 2.4 4.2 5.6 5" />
    </>
  ),
  pull: (
    <>
      <circle cx="6.5" cy="6" r="2.2" />
      <circle cx="6.5" cy="18" r="2.2" />
      <circle cx="17.5" cy="18" r="2.2" />
      <path d="M6.5 8.2v7.6M17.5 15.8V9a3 3 0 00-3-3h-4" />
      <path d="M12.5 4l-2 2 2 2" />
    </>
  ),
}

export type IconName = keyof typeof P

export function Icon({
  name,
  size = 18,
  className,
  style,
}: {
  name: IconName
  size?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {P[name]}
    </svg>
  )
}
