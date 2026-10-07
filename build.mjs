/**
 * 构建：把 CSS / 应用代码 / AI Worker 代码全部内联进一个 HTML 文件。
 * 产物：dist/index.html（离线可用，双击即玩）
 *
 * 运行：node build.mjs
 */
import { build } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const src = join(root, 'src')
const dist = join(root, 'dist')

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const gomokuPkg = JSON.parse(
  await readFile(join(root, 'node_modules/@algorithm.ts/gomoku/package.json'), 'utf8')
)

/** 用 esbuild 打包成自包含的 IIFE 字符串 */
async function bundle(entry) {
  const res = await build({
    entryPoints: [join(src, entry)],
    bundle: true,
    write: false,
    format: 'iife',
    target: ['es2019'],
    minify: true,
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'warning',
  })
  return res.outputFiles[0].text
}

/** 防止内联脚本里出现 </script> 提前闭合标签 */
const safeForScript = (code) => code.replace(/<\/script/gi, '<\\/script')

console.log('· 打包 AI Worker …')
const workerCode = await bundle('ai-worker.mjs')
console.log(`  ${(workerCode.length / 1024).toFixed(1)} KB`)

console.log('· 打包应用 …')
const appCode = await bundle('app.mjs')
console.log(`  ${(appCode.length / 1024).toFixed(1)} KB`)

const css = await readFile(join(src, 'ui.css'), 'utf8')
let html = await readFile(join(src, 'index.html'), 'utf8')

// Worker 源码以 JSON 字符串注入（JSON.stringify 负责转义）
const workerJson = JSON.stringify(workerCode).replace(/<\//g, '<\\/')

html = html
  .replace('/*__CSS__*/', () => css)
  .replace("/*__WORKER_SRC__*/''", () => workerJson)
  .replace('/*__APP__*/', () => safeForScript(appCode))

const banner = `<!--
  ============================================================
  五子棋 · Gomoku   （单文件版，离线可玩）
  ------------------------------------------------------------
  AI 引擎：${gomokuPkg.name} v${gomokuPkg.version}
  作者：guanghechen   许可证：MIT
  仓库：https://github.com/guanghechen/algorithm.ts
  ------------------------------------------------------------
  界面与游戏逻辑为本项目原创；AI 搜索（极小化极大 + Alpha-Beta 剪枝）
  直接复用上述 MIT 开源库，未自行实现算法。

  MIT License

  Copyright (c) 2020 - present Guanghe Chen

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
  ============================================================
-->
`

html = html.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n' + banner)

await mkdir(dist, { recursive: true })
const outputs = [join(dist, 'index.html'), join(root, '五子棋.html')]
for (const out of outputs) await writeFile(out, html, 'utf8')

console.log(`\n✅ 构建完成（总大小 ${(html.length / 1024).toFixed(1)} KB，含内联 CSS + 应用 + AI 引擎）`)
for (const out of outputs) console.log(`   ${out}`)
