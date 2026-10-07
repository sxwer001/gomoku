/**
 * Electron 离屏冒烟测试入口（由 electron.exe 以 app 方式运行，不显示窗口）
 * 用法： electron.exe tools/electron-test <结果输出文件>
 */
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const outFile = process.argv[process.argv.length - 1]
app.disableHardwareAcceleration()

// 用一次性 userData 目录，避免上次测试写入的 localStorage（模式/难度等）影响本次结果
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'gomoku-smoke-'))
app.setPath('userData', tmpUserData)

function save(data) {
  try { fs.writeFileSync(outFile, JSON.stringify(data, null, 2), 'utf8') } catch (e) { /* ignore */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  const result = { ok: false, steps: {} }
  const exec = (js) => win.webContents.executeJavaScript(js)
  let win
  try {
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 920,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    })
    const page = path.join(__dirname, '..', '..', 'desktop', 'app', 'index.html')
    await win.loadFile(page)
    await sleep(1800)

    // 1) 页面基础渲染 + 清晰度诊断（DPR 与画布位图/CSS 尺寸比）
    result.steps.render = await exec(`(() => {
      const c = document.getElementById('board')
      const r = c.getBoundingClientRect()
      const st = document.querySelector('.board-stage')
      const W = r.width
      return {
        title: document.title,
        canvasW: c.width,
        canvasH: c.height,
        counter: document.getElementById('moveCounter').textContent,
        status: document.getElementById('status').textContent,
        mode: document.querySelector('#segMode button.on').dataset.v,
        level: document.querySelector('#segLevel button.on').dataset.v,
        workerSrcKB: Math.round(((window.__AI_WORKER_SRC__ || '').length) / 1024),
        dpr: window.devicePixelRatio,
        canvasCssW: +r.width.toFixed(2),
        canvasCssH: +r.height.toFixed(2),
        cssToBitmap: +(c.width / r.width).toFixed(4),
        frameW: +document.querySelector('.board-frame').getBoundingClientRect().width.toFixed(2),
        stageW: st.clientWidth, stageH: st.clientHeight,
        innerW: window.innerWidth, innerH: window.innerHeight,
        boardPad: +(W * 0.062).toFixed(3),
        boardCell: +(((W - W * 0.062 * 2) / 14)).toFixed(4),
      }
    })()`)

    // 1b) 按 1:1 物理像素抓一张棋盘区域图，供人工核对清晰度
    try {
      const rc = await exec(`(() => {
        const r = document.getElementById('board').getBoundingClientRect()
        return { x: r.left, y: r.top, width: r.width, height: r.height }
      })()`)
      const shot = await win.webContents.capturePage({
        x: Math.round(rc.x), y: Math.round(rc.y),
        width: Math.round(rc.width), height: Math.round(rc.height),
      })
      const png = shot.toPNG()
      fs.writeFileSync(path.join(path.dirname(outFile), 'electron-crop.png'), png)
      result.steps.crop = { ...rc, pngSize: shot.getSize(), bytes: png.length }
    } catch (e) {
      result.steps.crop = { error: String((e && e.message) || e) }
    }

    // 2) 模拟点击棋盘中心落子
    result.steps.click = await exec(`(() => {
      const c = document.getElementById('board')
      const r = c.getBoundingClientRect()
      const pad = r.width * 0.062
      const cell = (r.width - pad * 2) / 14
      c.dispatchEvent(new MouseEvent('click', {
        clientX: r.left + pad + 7 * cell,
        clientY: r.top + pad + 7 * cell,
        bubbles: true,
      }))
      return document.getElementById('moveCounter').textContent
    })()`)

    // 3) 轮询等待 AI 应手（不用固定 sleep，避免偶发慢一拍就误判）
    let counter = result.steps.click
    for (let i = 0; i < 32; i++) {
      await sleep(250)
      counter = await exec(`document.getElementById('moveCounter').textContent`)
      if (counter.includes('2')) break
    }
    result.steps.afterAi = await exec(`(() => {
      const rows = document.querySelectorAll('#history .hist-row')
      return {
        counter: document.getElementById('moveCounter').textContent,
        status: document.getElementById('status').textContent,
        moves: Array.from(rows).map(r => r.querySelector('.coord').textContent),
      }
    })()`)

    // 4) 悔棋
    await exec(`document.getElementById('btnUndo').click()`)
    await sleep(700)
    result.steps.undo = await exec(`document.getElementById('moveCounter').textContent`)

    // 5) 切换模式 / 难度 / 皮肤，并验证 localStorage
    result.steps.settings = await exec(`(() => {
      document.querySelector('#segMode button[data-v="pvp"]').click()
      document.querySelector('#segLevel button[data-v="hard"]').click()
      document.querySelector('#segSkin button[data-v="wood"]').click()
      let ls = 'n/a'
      try { localStorage.setItem('__probe', '1'); ls = localStorage.getItem('__probe'); localStorage.removeItem('__probe') } catch (e) { ls = 'error' }
      return {
        modeOn: document.querySelector('#segMode button.on').dataset.v,
        levelOn: document.querySelector('#segLevel button.on').dataset.v,
        skinOn: document.querySelector('#segSkin button.on').dataset.v,
        localStorage: ls,
      }
    })()`)

    result.ok =
      result.steps.render.canvasW > 100 &&
      result.steps.click === '第 1 手' &&
      result.steps.afterAi.counter === '第 2 手' &&
      result.steps.undo === '第 0 手' &&
      result.steps.settings.localStorage === '1'
  } catch (err) {
    result.error = String((err && err.stack) || err)
  }
  save(result)
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  app.exit(result.ok ? 0 : 1)
})
