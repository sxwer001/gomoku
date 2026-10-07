/**
 * 构建 Windows 桌面端（Electron + electron-builder）
 *   1. 把 dist/index.html 拷成 desktop/app/index.html
 *   2. 用 electron-builder 的 Node API 打包（避免依赖 PATH 里的 pnpm）
 * 运行：node tools/build-desktop.mjs [portable|nsis|dir]
 */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const desktop = join(root, 'desktop')
const dist = join(root, 'dist')

// electron-builder 及其 Electron 二进制都可能需要走镜像
process.env.ELECTRON_MIRROR ||= 'https://registry.npmmirror.com/-/binary/electron/'
process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||=
  'https://registry.npmmirror.com/-/binary/electron-builder-binaries/'

// ---- 1. 同步游戏页面 ----
const src = join(dist, 'index.html')
if (!existsSync(src)) {
  console.error('✗ 未找到 dist/index.html，请先运行 node build.mjs')
  process.exit(1)
}
await mkdir(join(desktop, 'app'), { recursive: true })
await copyFile(src, join(desktop, 'app', 'index.html'))
const kb = ((await stat(join(desktop, 'app', 'index.html'))).size / 1024).toFixed(1)
console.log(`· 游戏页面已同步到 desktop/app/index.html（${kb} KB）`)

// ---- 2. 调用 electron-builder ----
const require = createRequire(join(desktop, 'package.json'))
const ebMain = require.resolve('electron-builder')
const { build, Platform, Arch } = await import(pathToFileURL(ebMain).href)

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const targets = wanted.length ? wanted : ['portable', 'nsis']
console.log(`· 开始打包：${targets.join(', ')} …`)

await build({
  projectDir: desktop,
  targets: Platform.WINDOWS.createTarget(targets, Arch.x64),
})

// ---- 3. 汇总产物 ----
const outDir = join(root, 'release', 'windows')
const entries = await readdir(outDir, { withFileTypes: true })
console.log(`\n✅ 产物目录：${outDir}`)
for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
  const p = join(outDir, e.name)
  if (e.isFile()) {
    console.log(`   ${e.name}  (${((await stat(p)).size / 1024 / 1024).toFixed(1)} MB)`)
  } else {
    console.log(`   ${e.name}/`)
  }
}
