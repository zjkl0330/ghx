/**
 * 版本号推进规则（用户约定）：
 *   每次改动 patch +1，patch 满 10 进 minor。
 *   0.4.0 → 0.4.1 → … → 0.4.9 → 0.5.0（永远不会出现 0.4.10）
 *
 * 改完版本会立刻调用 sync-version.mjs 写进 gradle，避免打包用的是旧 versionCode。
 * 用法：
 *   pnpm version:bump            正常推进并写入 package.json + gradle
 *   pnpm version:bump --dry 0.4.9  只计算不落盘，方便验证进位
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const pkgPath = new URL('package.json', root)
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const override = args.find((a) => /^\d+\.\d+\.\d+$/.test(a))
const from = override ?? pkg.version

const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(from)
if (!m) {
  console.error(`版本号不是 x.y.z：${from}`)
  process.exit(1)
}

export function nextVersion(version) {
  const mm = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!mm) throw new Error(`版本号不是 x.y.z：${version}`)
  let major = Number(mm[1])
  let minor = Number(mm[2])
  let patch = Number(mm[3]) + 1
  if (patch >= 10) {
    patch = 0
    minor += 1
  }
  if (minor >= 10) {
    minor = 0
    major += 1
  }
  return `${major}.${minor}.${patch}`
}

const next = nextVersion(from)
console.log(`[bump] ${from} → ${next}`)

if (dry) {
  process.exit(0)
}

pkg.version = next
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
execFileSync(process.execPath, [new URL('sync-version.mjs', root).pathname], { stdio: 'inherit' })
