/**
 * 桌面端自适应布局测试
 *   验证不同窗口尺寸下：
 *     - 棋盘始终是正方形、不超出视口
 *     - 桌面宽度下整页不出现纵向滚动条（滚动只发生在右侧面板内部）
 *     - 顶部回合条 / 底部提示条与棋盘等宽对齐
 *     - 窄屏（<=980px）回退为文档流
 * 运行：node tools/layout-test.mjs
 */
import puppeteer from 'puppeteer-core'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')
const shots = join(root, 'shots')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

let failures = 0
const ok = (cond, msg, extra = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}${extra ? '  ' + extra : ''}`)
  if (!cond) failures++
}

const probe = (page) =>
  page.evaluate(() => {
    const q = (s) => document.querySelector(s)
    const r = (e) => (e ? e.getBoundingClientRect() : null)
    const canvas = r(document.getElementById('board'))
    const frame = r(q('.board-frame'))
    const bar = r(q('.board-bar'))
    const foot = r(q('.board-foot'))
    const stage = r(q('.board-stage'))
    const panel = q('.panel')
    const de = document.documentElement
    return {
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      canvas: canvas && { x: canvas.x, y: canvas.y, w: canvas.width, h: canvas.height, bottom: canvas.bottom, right: canvas.right },
      frame: frame && { w: frame.width, h: frame.height, x: frame.x, y: frame.y, bottom: frame.bottom },
      bar: bar && { w: bar.width, x: bar.x },
      foot: foot && { w: foot.width, x: foot.x },
      stage: stage && { w: stage.width, h: stage.height, display: getComputedStyle(q('.board-stage')).display },
      panelScrollable: panel ? panel.scrollHeight > panel.clientHeight + 1 : false,
      panelFits: panel ? panel.scrollHeight <= panel.clientHeight + 1 : true,
      panelBounded: panel ? panel.getBoundingClientRect().bottom <= window.innerHeight + 1 : false,
      docScrollH: de.scrollHeight,
      docScrollW: de.scrollWidth,
      boardVarCss: getComputedStyle(de).getPropertyValue('--board-w').trim(),
      appH: q('.app') ? q('.app').getBoundingClientRect().height : 0,
      // 真正渲染出来的纵向滚动条宽度（body 的 overflow 会传播到视口，
      // 此时 html.scrollHeight 可能虚高，但用户看不到也滚不动）
      scrollbarW: window.innerWidth - de.clientWidth,
      panelScrollTop: (() => { const p = panel; if (!p) return 0; p.scrollTop = 99999; const v = p.scrollTop; p.scrollTop = 0; return v })(),
      htmlOverflow: getComputedStyle(de).overflow,
      bodyOverflow: getComputedStyle(document.body).overflow,
      culprits: (() => {
        const out = []
        for (const e of document.body.querySelectorAll('*')) {
          const r = e.getBoundingClientRect()
          if (r.bottom > window.innerHeight + 1 && r.height > 0) {
            const cls = (e.className || '').toString().trim().split(/\s+/).filter(Boolean).join('.')
            out.push(`${e.tagName.toLowerCase()}${cls ? '.' + cls : ''}#${e.id || ''} bottom=${Math.round(r.bottom)} h=${Math.round(r.height)}`)
          }
        }
        return out.slice(0, 8)
      })(),
    }
  })

async function checkSize(page, w, h, label) {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
  await new Promise((r) => setTimeout(r, 450))
  const m = await probe(page)
  const desktop = w > 980
  console.log(`\n----- ${label}  ${w}×${h} -----`)
  console.log(`  棋盘 ${Math.round(m.canvas.w)}×${Math.round(m.canvas.h)}  舞台 ${Math.round(m.stage.w)}×${Math.round(m.stage.h)}  display=${m.stage.display}`)
  console.log(`  appH=${Math.round(m.appH)} innerH=${m.innerH} html.overflow=${m.htmlOverflow} body.overflow=${m.bodyOverflow}`)
  if (m.culprits.length) console.log('  超出视口的元素:\n    ' + m.culprits.join('\n    '))

  ok(Math.abs(m.canvas.w - m.canvas.h) < 2, '棋盘为正方形', `${Math.round(m.canvas.w)}×${Math.round(m.canvas.h)}`)
  ok(m.canvas.w > 240, '棋盘尺寸足够大', `${Math.round(m.canvas.w)}px`)
  ok(m.canvas.right <= m.innerW + 1 && m.canvas.bottom <= m.innerH + 1, '棋盘完全在视口内',
    `right=${Math.round(m.canvas.right)}/${m.innerW} bottom=${Math.round(m.canvas.bottom)}/${m.innerH}`)
  ok(m.canvas.w <= m.stage.w + 1 && m.canvas.h <= m.stage.h + 1, '棋盘未溢出舞台',
    `棋盘${Math.round(m.canvas.w)} vs 舞台${Math.round(m.stage.w)}×${Math.round(m.stage.h)}`)
  ok(Math.abs(m.bar.w - m.frame.w) < 2 && Math.abs(m.foot.w - m.frame.w) < 2, '顶部/底部条与棋盘外框等宽',
    `bar=${Math.round(m.bar.w)} foot=${Math.round(m.foot.w)} frame=${Math.round(m.frame.w)}`)
  ok(Math.abs(m.bar.x - m.frame.x) < 2 && Math.abs(m.foot.x - m.frame.x) < 2, '顶部/底部条与棋盘左边缘对齐',
    `barX=${Math.round(m.bar.x)} footX=${Math.round(m.foot.x)} frameX=${Math.round(m.frame.x)}`)

  // 用户可见的判据：桌面端不应出现整页滚动条，滚动只发生在右侧面板内部
  if (desktop) {
    ok(m.scrollbarW === 0, '桌面端不渲染纵向滚动条', `scrollbar=${m.scrollbarW}px`)
    ok(Math.abs(m.appH - m.innerH) < 1.5, '外壳高度正好等于视口', `appH=${Math.round(m.appH)} innerH=${m.innerH}`)
    ok(m.panelScrollTop > 0 || m.panelFits, '面板在内部滚动（内容超出时）',
      `panelScrollTop=${m.panelScrollTop} panelFits=${m.panelFits}`)
    ok(m.docScrollW <= m.innerW + 1, '整页无横向滚动条', `scrollW=${m.docScrollW}`)
  } else {
    ok(m.stage.display === 'block', '窄屏回退为文档流', `display=${m.stage.display}`)
  }
  ok(m.panelBounded || !desktop, '右侧面板高度受限于视口', `panelBounded=${m.panelBounded}`)
  return m
}

async function main() {
  if (!existsSync(join(dist, 'index.html'))) {
    console.error('请先运行 node build.mjs')
    process.exit(1)
  }
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--mute-audio'],
  })
  const page = await browser.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto('file:///' + join(dist, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' })
  await page.waitForSelector('#board')
  await new Promise((r) => setTimeout(r, 600))

  const sizes = [
    [2560, 1400, '大屏最大化'],
    [1920, 1080, '1080p 全屏'],
    [1600, 900, '常见桌面'],
    [1280, 800, '笔记本'],
    [1024, 768, '小窗桌面'],
    [1600, 620, '扁平窗口'],
    [1100, 1000, '高窄桌面'],
    [900, 1000, '窄屏回退'],
  ]
  for (const [w, h, label] of sizes) {
    await checkSize(page, w, h, label)
    if (w <= 1600) {
      await page.setViewport({ width: w, height: h })
      await new Promise((r) => setTimeout(r, 300))
      await page.screenshot({ path: join(shots, `layout-${w}x${h}.png`) })
    }
  }

  const real = errors.filter((e) => !/favicon|AudioContext|autoplay/i.test(e))
  ok(real.length === 0, '无控制台报错', real.slice(0, 2).join(' | '))

  await browser.close()
  console.log(`\n${failures === 0 ? '布局用例全部通过 ✅' : `有 ${failures} 项失败 ❌`}`)
  process.exit(failures === 0 ? 0 : 1)
}

main()
