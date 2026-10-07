/**
 * 桌面版验证：用打包用的 Electron 以「隐藏窗口」加载 desktop/app/index.html，
 * 跑一遍落子 → AI 应手 → 悔棋 → 切换设置，把结果写到临时文件再读出来。
 * 全程不显示窗口，不会打扰正常使用。
 *
 * 运行：node tools/test-desktop.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const electronExe = join(root, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
const testApp = join(root, 'tools', 'electron-test')
const outFile = join(root, 'build', 'electron-smoke-result.json')

if (!existsSync(electronExe)) {
  console.error(`✗ 未找到 Electron：${electronExe}\n  请先在 desktop 目录执行 pnpm install`)
  process.exit(1)
}
if (existsSync(outFile)) rmSync(outFile)

console.log('· 启动 Electron（隐藏窗口）执行冒烟测试 …')
let exitCode = 0
try {
  // 关键：若父进程带了 ELECTRON_RUN_AS_NODE，Electron 会退化成纯 Node 运行
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  execFileSync(electronExe, [testApp, outFile], {
    cwd: root,
    stdio: 'inherit',
    timeout: 90000,
    env,
  })
} catch (e) {
  exitCode = e.status ?? 1
}

if (!existsSync(outFile)) {
  console.error('✗ 未生成测试结果（Electron 可能启动失败）')
  process.exit(1)
}
const r = JSON.parse(readFileSync(outFile, 'utf8'))

let fails = 0
const ok = (cond, msg, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}${extra ? '  ' + extra : ''}`)
  if (!cond) fails++
}

console.log('\n===== 桌面版（Electron）验证 =====')
if (r.error) console.log(`  异常：${r.error}`)
console.log('  页面信息：', JSON.stringify(r.steps.render))
ok(r.steps.render?.canvasW > 100, '画布已渲染', `${r.steps.render?.canvasW}×${r.steps.render?.canvasH}`)
ok(r.steps.render?.workerSrcKB > 10, 'AI 代码已内联', `${r.steps.render?.workerSrcKB} KB`)
ok(r.steps.click === '第 1 手', '模拟点击可落子', r.steps.click)
ok(r.steps.afterAi?.counter === '第 2 手', '电脑已应手',
  `${r.steps.afterAi?.counter} / ${(r.steps.afterAi?.moves || []).join(' ')}`)
ok(r.steps.undo === '第 0 手', '悔棋可用', r.steps.undo)
ok(r.steps.settings?.modeOn === 'pvp' &&
   r.steps.settings?.levelOn === 'hard' &&
   r.steps.settings?.skinOn === 'wood', '设置切换生效', JSON.stringify(r.steps.settings))
ok(r.steps.settings?.localStorage === '1', 'localStorage 可写')

console.log(`\n${fails === 0 ? '桌面版全部通过 ✅' : `有 ${fails} 项未通过 ❌`}`)
process.exit(fails === 0 ? 0 : 1)
