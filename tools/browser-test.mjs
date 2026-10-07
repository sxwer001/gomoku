/**
 * 浏览器端到端测试（puppeteer-core 驱动本机 Chrome）
 *   1) file:// 打开 → 验证 Worker 降级后 AI 仍能应手
 *   2) http:// 打开 → 验证 Worker 正常
 *   3) 双人模式模拟黑棋五连 → 验证胜负与弹窗
 *   4) 切换皮肤/难度 → 截图
 * 运行：node tools/browser-test.mjs
 */
import puppeteer from 'puppeteer-core'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')
const shots = join(root, 'shots')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const SIZE = 15
const LETTERS = 'ABCDEFGHIJKLMNO'

let failures = 0
const ok = (cond, msg, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}${extra ? '  ' + extra : ''}`)
  if (!cond) failures++
}

/* ---------- 本地静态服务器（测试 http:// 场景） ---------- */
function serve(port) {
  const server = http.createServer(async (req, res) => {
    try {
      const p = req.url === '/' ? '/index.html' : req.url.split('?')[0]
      const buf = await readFile(join(dist, p))
      res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' })
      res.end(buf)
    } catch {
      res.writeHead(404); res.end('404')
    }
  })
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)))
}

/** 由画布尺寸推算棋盘交点坐标（与 app.mjs 的几何公式一致） */
function geom(rect) {
  const pad = rect.width * 0.062
  const cell = (rect.width - pad * 2) / (SIZE - 1)
  return { pad, cell }
}

async function canvasRect(page) {
  return page.evaluate(() => {
    const r = document.getElementById('board').getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })
}

async function clickCell(page, r, c) {
  const rect = await canvasRect(page)
  const { pad, cell } = geom(rect)
  await page.mouse.click(rect.x + pad + c * cell, rect.y + pad + r * cell)
}

const lastCoord = (page) =>
  page.evaluate(() => {
    const rows = document.querySelectorAll('#history .hist-row')
    return rows.length ? rows[rows.length - 1].querySelector('.coord').textContent.trim() : ''
  })
const moveCounter = (page) => page.$eval('#moveCounter', (e) => e.textContent.trim())
const statusText = (page) => page.$eval('#status', (e) => e.textContent.trim())

async function run(label, url) {
  console.log(`\n===== ${label} =====`)
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--mute-audio', '--window-size=1400,1000'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1.5 })

  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

  await page.goto(url, { waitUntil: 'load' })
  await page.waitForSelector('#board')
  await new Promise((r) => setTimeout(r, 700))

  // ---- 基础渲染 ----
  const canvasSize = await page.evaluate(() => {
    const c = document.getElementById('board')
    return { w: c.width, h: c.height, hasData: c.getContext('2d').getImageData(0, 0, 1, 1).data[3] >= 0 }
  })
  ok(canvasSize.w > 100 && canvasSize.h > 100, '画布已按 DPR 放大', `${canvasSize.w}x${canvasSize.h}`)

  const workerSrcLen = await page.evaluate(() => (window.__AI_WORKER_SRC__ || '').length)
  ok(workerSrcLen > 1000, 'AI Worker 源码已内联', `${(workerSrcLen / 1024).toFixed(1)} KB`)

  // ---- 落子与坐标校验 ----
  await clickCell(page, 7, 7)
  await new Promise((r) => setTimeout(r, 160))
  ok((await lastCoord(page)) === 'H8', '点击 (7,7) 记录为 H8', await lastCoord(page))

  // ---- AI 应手 ----
  await page.waitForFunction(() => document.getElementById('moveCounter').textContent.includes('2'), { timeout: 8000 })
    .catch(() => {})
  await new Promise((r) => setTimeout(r, 500))
  const cnt = await moveCounter(page)
  ok(cnt === '第 2 手', '人机模式：电脑已应手', `${cnt} / ${await statusText(page)}`)
  const aiCoord = await lastCoord(page)
  ok(/^[A-O](1[0-5]|[1-9])$/.test(aiCoord), '电脑落子坐标合法', aiCoord)

  await page.screenshot({ path: join(shots, `${label}-1-人机对战.png`) })

  // ---- 悔棋 ----
  await page.click('#btnUndo')
  await new Promise((r) => setTimeout(r, 350))
  ok((await moveCounter(page)) === '第 0 手', '悔棋后回到开局', await moveCounter(page))

  // ---- 双人模式：黑棋五连 ----
  await page.click('#segMode button[data-v="pvp"]')
  await new Promise((r) => setTimeout(r, 350))
  ok(await page.$eval('#fieldLevel', (e) => e.classList.contains('dim')), '双人模式下难度区置灰')

  const seq = [
    [7, 7, 'H8'], [0, 0, 'A1'],
    [7, 8, 'I8'], [0, 1, 'B1'],
    [7, 9, 'J8'], [0, 2, 'C1'],
    [7, 10, 'K8'], [0, 3, 'D1'],
    [7, 11, 'L8'],
  ]
  let coordOk = true
  for (const [r, c, want] of seq) {
    await clickCell(page, r, c)
    await new Promise((r2) => setTimeout(r2, 90))
    const got = await lastCoord(page)
    if (got !== want) { coordOk = false; console.log(`      坐标不符：期望 ${want}，实际 ${got}`) }
  }
  ok(coordOk, '双人模式连续落子坐标全部正确')

  await page.waitForSelector('#overlay:not([hidden])', { timeout: 4000 }).catch(() => {})
  const dlg = await page.evaluate(() => {
    const o = document.getElementById('overlay')
    return { open: !o.hidden, title: document.getElementById('dlgTitle').textContent.trim() }
  })
  ok(dlg.open && dlg.title.includes('黑棋'), '黑棋五连后弹出胜利弹窗', dlg.title)

  const winLine = await page.evaluate(() => document.getElementById('moveCounter').textContent)
  ok(winLine.includes('9'), '终局手数正确', winLine)

  await page.screenshot({ path: join(shots, `${label}-2-获胜弹窗.png`) })

  // 关掉弹窗，单独拍一张带胜利连线的棋盘
  await page.click('#btnCloseDlg')
  await new Promise((r) => setTimeout(r, 300))
  await page.screenshot({ path: join(shots, `${label}-3-胜利连线.png`) })

  // ---- 换皮肤 ----
  await page.click('#segSkin button[data-v="wood"]')
  await new Promise((r) => setTimeout(r, 450))
  ok(await page.$eval('#overlay', (e) => e.hidden), '弹窗可关闭')

  // ---- 回人机 + 困难 + 执白，让电脑先手 ----
  await page.click('#segMode button[data-v="pve"]')
  await new Promise((r) => setTimeout(r, 300))
  await page.click('#segLevel button[data-v="hard"]')
  await page.click('#segSide button[data-v="white"]')
  await new Promise((r) => setTimeout(r, 2600))
  const cnt2 = await moveCounter(page)
  ok(cnt2 === '第 1 手', '玩家执白时电脑自动开局', `${cnt2} / ${await lastCoord(page)}`)

  // 玩家落子
  await clickCell(page, 7, 8)
  await page.waitForFunction(() => document.getElementById('moveCounter').textContent.includes('3'), { timeout: 10000 })
    .catch(() => {})
  await new Promise((r) => setTimeout(r, 500))
  const cnt3 = await moveCounter(page)
  ok(cnt3 === '第 3 手', '困难档电脑连续应手', `${cnt3} / ${await lastCoord(page)}`)

  await page.screenshot({ path: join(shots, `${label}-4-木纹困难.png`) })

  // ---- 提示功能（toast 只显示 1.9s，需要边等边抓）----
  await page.click('#btnHint')
  let hinted = ''
  for (let i = 0; i < 60; i++) {
    hinted = await page.$eval('#toast', (e) => (e.hidden ? '' : e.textContent))
    if (hinted) break
    await new Promise((r) => setTimeout(r, 120))
  }
  ok(hinted.includes('建议') || hinted.includes('没有'), '提示功能有反馈', hinted)
  await page.screenshot({ path: join(shots, `${label}-5-提示.png`) })

  // ---- 控制台错误 ----
  const real = errors.filter((e) => !/favicon|AudioContext|autoplay|404 \(Not Found\)/i.test(e))
  ok(real.length === 0, '无控制台报错', real.slice(0, 3).join(' | '))

  await browser.close()
  return errors
}

/** 移动端：确认不出现横向滚动、棋盘与面板正常堆叠 */
async function mobileCheck(url) {
  console.log('\n===== 移动端 (390×844) =====')
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--mute-audio'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForSelector('#board')
  await new Promise((r) => setTimeout(r, 700))

  const m = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    boardW: document.getElementById('board').getBoundingClientRect().width,
    boardH: document.getElementById('board').getBoundingClientRect().height,
  }))
  ok(m.scrollW <= m.innerW + 1, '无横向溢出', `scrollW=${m.scrollW} innerW=${m.innerW}`)
  ok(Math.abs(m.boardW - m.boardH) < 2 && m.boardW > 250, '棋盘为正方形且尺寸合理', `${Math.round(m.boardW)}×${Math.round(m.boardH)}`)

  // 触屏点击落子
  const rect = await canvasRect(page)
  const { pad, cell } = geom(rect)
  await page.touchscreen.tap(rect.x + pad + 7 * cell, rect.y + pad + 7 * cell)
  await new Promise((r) => setTimeout(r, 1200))
  ok((await moveCounter(page)) === '第 2 手', '触屏点击可落子且电脑应手', await moveCounter(page))

  await page.screenshot({ path: join(shots, 'mobile-1-人机对战.png'), fullPage: true })
  await browser.close()
}

/* ---------- 主流程 ---------- */
const fileUrl = 'file:///' + join(dist, 'index.html').replace(/\\/g, '/')
if (!existsSync(join(dist, 'index.html'))) {
  console.error('请先运行 node build.mjs')
  process.exit(1)
}

await run('file', fileUrl)

const server = await serve(8731)
await run('http', 'http://127.0.0.1:8731/index.html')
await mobileCheck('http://127.0.0.1:8731/index.html')
server.close()

console.log(`\n${failures === 0 ? '全部浏览器用例通过 ✅' : `有 ${failures} 项未通过 ❌`}`)
console.log(`截图已保存到 ${shots}`)
process.exit(failures === 0 ? 0 : 1)
