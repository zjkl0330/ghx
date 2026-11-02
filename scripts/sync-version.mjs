/**
 * 把 package.json 的版本同步进 android/app/build.gradle。
 *
 * 版本号只维护一处，避免「关于页写 0.2.0、安装包却是 0.1.0」这种不一致。
 * versionCode 由 semver 算出：major*10000 + minor*100 + patch。
 * 用法：pnpm version:sync <version>   （<version> 省略时用 package.json 现值）
 */
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const pkgPath = new URL('package.json', root)
const gradlePath = new URL('android/app/build.gradle', root)

const target = process.argv[2]
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

if (target) {
  if (!/^\d+\.\d+\.\d+$/.test(target)) {
    console.error(`版本号必须是 x.y.z：收到 "${target}"`)
    process.exit(1)
  }
  pkg.version = target
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
}

const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version)
if (!m) {
  console.error(`package.json 的 version 不是 x.y.z：${pkg.version}`)
  process.exit(1)
}
const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])]
const versionCode = major * 10000 + minor * 100 + patch

let gradle = readFileSync(gradlePath, 'utf-8')
const before = gradle
gradle = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]*"/, `versionName "${pkg.version}"`)

if (gradle === before) {
  console.log(`[version] 已是 ${pkg.version} (${versionCode})，无需修改`)
} else {
  writeFileSync(gradlePath, gradle)
  console.log(`[version] 已同步 ${pkg.version} → versionCode ${versionCode}`)
}
