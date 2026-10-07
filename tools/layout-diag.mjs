/** 一次性诊断：1280×800 下到底是什么把文档撑高的 */
import puppeteer from 'puppeteer-core'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dist = join(root, 'dist')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--mute-audio'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
await page.goto('file:///' + join(dist, 'index.html').replace(/\\/g, '/'), { waitUntil: 'load' })
await page.waitForSelector('#board')
await new Promise((r) => setTimeout(r, 600))

const info = await page.evaluate(() => {
  const rows = []
  const add = (label, e) => {
    if (!e) return rows.push(`${label}: <null>`)
    const r = e.getBoundingClientRect()
    const cs = getComputedStyle(e)
    rows.push(
      `${label.padEnd(16)} rect=${Math.round(r.top)}..${Math.round(r.bottom)} h=${Math.round(r.height)} ` +
      `scrollH=${e.scrollHeight} clientH=${e.clientHeight} ` +
      `display=${cs.display} overflow=${cs.overflowY} minH=${cs.minHeight} flex=${cs.flex}`
    )
  }
  add('html', document.documentElement)
  add('body', document.body)
  add('.app', document.querySelector('.app'))
  add('.layout', document.querySelector('.layout'))
  add('.board-card', document.querySelector('.board-card'))
  add('.panel', document.querySelector('.panel'))
  add('.overlay', document.querySelector('.overlay'))
  add('.toast', document.querySelector('.toast'))

  // body 的直接子元素谁最高
  const kids = [...document.body.children].map((e) => {
    const r = e.getBoundingClientRect()
    return `${e.tagName.toLowerCase()}.${(e.className || '').toString().trim().split(/\s+/).join('.')} bottom=${Math.round(r.bottom)} h=${Math.round(r.height)}`
  })

  // 递归找“自身溢出父容器”的元素
  const leak = []
  const walk = (e) => {
    for (const c of e.children) {
      const cr = c.getBoundingClientRect()
      const er = e.getBoundingClientRect()
      const cs = getComputedStyle(e)
      const clips = cs.overflowY !== 'visible' || cs.overflowX !== 'visible'
      if (cr.bottom > er.bottom + 1 && !clips) {
        const cls = (c.className || '').toString().trim().split(/\s+/).join('.')
        leak.push(`${e.tagName.toLowerCase()}.${(e.className || '').toString().trim().split(/\s+/).join('.')} 被 ${c.tagName.toLowerCase()}.${cls}#${c.id || ''} 撑出 (${Math.round(er.bottom)} → ${Math.round(cr.bottom)})`)
      }
      walk(c)
    }
  }
  walk(document.body)

  return {
    rows,
    kids,
    leak: [...new Set(leak)].slice(0, 15),
    docScrollH: document.documentElement.scrollHeight,
    bodyScrollH: document.body.scrollHeight,
    innerH: window.innerHeight,
  }
})

console.log(info.rows.join('\n'))
console.log('\nbody 直接子元素:')
console.log('  ' + info.kids.join('\n  '))
console.log(`\ndocumentElement.scrollHeight=${info.docScrollH}  body.scrollHeight=${info.bodyScrollH}  innerHeight=${info.innerH}`)
console.log('\n溢出父容器的元素:')
console.log(info.leak.length ? '  ' + info.leak.join('\n  ') : '  （无）')

await browser.close()
