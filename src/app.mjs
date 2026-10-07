/**
 * 五子棋 · 主程序
 * AI 由 @algorithm.ts/gomoku（MIT）提供，见 ai-core.mjs
 */
import { searchMove, SIZE, BLACK, WHITE } from './ai-core.mjs'

const TAU = Math.PI * 2
const LETTERS = 'ABCDEFGHIJKLMNO'
const DROP_MS = 220 // 落子动画时长
const STORE_KEY = 'gomoku.v1'

/* ========================================================================
   棋盘皮肤
   ======================================================================== */
const SKINS = {
  clean: {
    label: '简洁',
    base: '#f6f4f0',
    grain: null,
    line: '#c9c4b9',
    lineMajor: '#ada79a',
    star: '#605c53',
    coord: '#9c968a',
    blackStone: ['#6f6f6f', '#232323', '#0b0b0b'],
    whiteStone: ['#ffffff', '#f7f7f7', '#cfcfcf'],
    stoneShadow: 'rgba(0,0,0,0.26)',
    rimBlack: 'rgba(255,255,255,0.16)',
    rimWhite: 'rgba(0,0,0,0.16)',
  },
  wood: {
    label: '木纹',
    base: '#e8d5b3',
    grain: { rgb: '150,112,64', alpha: 0.032, count: 1.1, amp: 3.6, width: 1 },
    line: '#b9a077',
    lineMajor: '#9b8259',
    star: '#5c4a2e',
    coord: '#8d7a58',
    blackStone: ['#6f6f6f', '#232323', '#0b0b0b'],
    whiteStone: ['#ffffff', '#f8f6f2', '#d5cdc0'],
    stoneShadow: 'rgba(60,38,10,0.34)',
    rimBlack: 'rgba(255,255,255,0.16)',
    rimWhite: 'rgba(120,100,70,0.28)',
  },
}

/* ========================================================================
   状态
   ======================================================================== */
const state = {
  board: new Int8Array(SIZE * SIZE),
  moves: [],            // { i, p }
  turn: BLACK,
  mode: 'pve',          // pve | pvp
  level: 'medium',      // easy | medium | hard
  human: BLACK,         // 人机模式下玩家执子
  skin: 'clean',
  over: false,
  winner: 0,            // 0 未结束/和棋, 1 黑, 2 白
  winLine: null,
  thinking: false,
  sound: true,
  coord: true,
  index: false,
  scores: { b: 0, w: 0, d: 0 },
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return
    const s = JSON.parse(raw)
    for (const k of ['mode', 'level', 'skin', 'sound', 'coord', 'index']) {
      if (s[k] !== undefined) state[k] = s[k]
    }
    if (s.human === BLACK || s.human === WHITE) state.human = s.human
    if (state.skin && !SKINS[state.skin]) state.skin = 'clean'
    if (s.scores) state.scores = { b: s.scores.b | 0, w: s.scores.w | 0, d: s.scores.d | 0 }
  } catch { /* 忽略损坏的本地数据 */ }
}
function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      mode: state.mode, level: state.level, skin: state.skin, human: state.human,
      sound: state.sound, coord: state.coord, index: state.index, scores: state.scores,
    }))
  } catch { /* 隐私模式下可能不可写 */ }
}

/* ========================================================================
   DOM
   ======================================================================== */
const $ = (id) => document.getElementById(id)
const el = {
  canvas: $('board'),
  stage: document.querySelector('.board-stage'),
  frame: document.querySelector('.board-frame'),
  badge: $('turnBadge'),
  footHint: $('footHint'),
  moveCounter: $('moveCounter'),
  pBlack: $('pBlack'), pWhite: $('pWhite'),
  roleBlack: $('roleBlack'), roleWhite: $('roleWhite'),
  scoreBlack: $('scoreBlack'), scoreWhite: $('scoreWhite'),
  status: $('status'),
  btnUndo: $('btnUndo'), btnHint: $('btnHint'), btnRestart: $('btnRestart'),
  segMode: $('segMode'), segLevel: $('segLevel'), segSide: $('segSide'), segSkin: $('segSkin'),
  fieldSide: $('fieldSide'), fieldLevel: $('fieldLevel'),
  optCoord: $('optCoord'), optIndex: $('optIndex'), optSound: $('optSound'),
  history: $('history'), histCount: $('histCount'),
  overlay: $('overlay'), dlgStone: $('dlgStone'), dlgTitle: $('dlgTitle'), dlgDesc: $('dlgDesc'),
  btnAgain: $('btnAgain'), btnCloseDlg: $('btnCloseDlg'),
  toast: $('toast'), btnSound: $('btnSound'), btnFull: $('btnFull'),
}
const ctx = el.canvas.getContext('2d')

/* ========================================================================
   音效（WebAudio 合成，不依赖外部文件）
   ======================================================================== */
let actx = null
function audio() {
  if (actx === null) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)() }
    catch { actx = false }
  }
  if (actx && actx.state === 'suspended') actx.resume()
  return actx || null
}
function sfxPlace() {
  if (!state.sound) return
  const a = audio(); if (!a) return
  const t = a.currentTime
  // 木头/棋子碰击：短促噪声
  const len = Math.max(1, Math.floor(a.sampleRate * 0.07))
  const buf = a.createBuffer(1, len, a.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 7)
  const src = a.createBufferSource(); src.buffer = buf
  const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 1.1
  const g1 = a.createGain(); g1.gain.value = 0.26
  src.connect(bp).connect(g1).connect(a.destination); src.start(t)
  // 低频闷响
  const o = a.createOscillator(); o.type = 'sine'
  o.frequency.setValueAtTime(230, t); o.frequency.exponentialRampToValueAtTime(88, t + 0.09)
  const g2 = a.createGain(); g2.gain.setValueAtTime(0.15, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.11)
  o.connect(g2).connect(a.destination); o.start(t); o.stop(t + 0.12)
}
function sfxTone(freq, at, dur, vol, type = 'sine') {
  const a = audio(); if (!state.sound || !a) return
  const o = a.createOscillator(); o.type = type; o.frequency.value = freq
  const g = a.createGain()
  g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  o.connect(g).connect(a.destination); o.start(at); o.stop(at + dur + 0.02)
}
function sfxWin() {
  if (!state.sound) return
  const a = audio(); if (!a) return
  const t = a.currentTime
  ;[523.25, 659.25, 783.99, 1046.5].forEach((f, k) => sfxTone(f, t + k * 0.1, 0.42, 0.13, 'triangle'))
}
function sfxDraw() {
  if (!state.sound) return
  const a = audio(); if (!a) return
  const t = a.currentTime
  ;[440, 392].forEach((f, k) => sfxTone(f, t + k * 0.15, 0.4, 0.11, 'triangle'))
}
function sfxClick() { const a = audio(); if (a) sfxTone(660, a.currentTime, 0.06, 0.05, 'sine') }

/* ========================================================================
   几何 & 绘制
   ======================================================================== */
let W = 0, pad = 0, cell = 0, DPR = 1
// 棋盘边距与点距的「设备像素」值，均为整数：只有落在整设备像素上，
// 网格线与棋子边缘才不会被抗锯齿抹糊。
let padDev = 0, cellDev = 0
let tex = null, texKey = ''
let hover = -1
let anim = new Map()       // idx -> 落子时间
let hintCell = -1
let hintTimer = 0
const animOrder = []       // 保持落子顺序绘制（后下的盖在上面）

const px = (i) => pad + (i % SIZE) * cell
const py = (i) => pad + Math.floor(i / SIZE) * cell

let lastKey = ''

/** n/DPR 要正好落在 Chromium 的 1/64px 布局单位上，n 必须是这个倍数的整数倍 */
function exactStep(dpr) {
  for (let k = 1; k <= 256; k++) {
    const v = (k * 64) / dpr
    if (Math.abs(v - Math.round(v)) < 1e-6) return k
  }
  return 1
}

/** 把棋盘框吸附到整设备像素；否则整张画布会被重采样而整体发糊 */
function snapFrame() {
  const f = el.frame
  if (!f) return
  const dpr = DPR || 1
  f.style.transform = 'none'
  const r = f.getBoundingClientRect()
  const dx = Math.round(r.left * dpr) / dpr - r.left
  const dy = Math.round(r.top * dpr) / dpr - r.top
  f.style.transform =
    Math.abs(dx) < 0.002 && Math.abs(dy) < 0.002
      ? 'none'
      : `translate(${dx.toFixed(4)}px, ${dy.toFixed(4)}px)`
}

function layout() {
  const stage = el.stage
  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  if (!stage) {
    // 兜底：没有舞台层时退回按 canvas 自身尺寸测量
    const rect = el.canvas.getBoundingClientRect()
    if (rect.width < 20) return
    DPR = dpr
    W = rect.width
    pad = W * 0.062
    cell = (W - pad * 2) / (SIZE - 1)
    padDev = pad * DPR
    cellDev = cell * DPR
    el.canvas.width = Math.round(W * DPR)
    el.canvas.height = Math.round(rect.height * DPR)
    texKey = ''
    return
  }

  const availW = stage.clientWidth
  if (availW < 20) return

  let cssSide
  if (getComputedStyle(stage).display === 'block') {
    // 窄屏：文档流模式，按宽度铺满，同时限制高度避免竖屏下滚动过长
    const vh = window.innerHeight || 800
    cssSide = Math.min(availW, Math.max(320, vh - 170))
  } else {
    // 桌面：在舞台可用区域里取能容纳的最大正方形
    const availH = stage.clientHeight
    if (availH < 20) return
    cssSide = Math.min(availW, availH)
  }
  if (cssSide < 180) cssSide = 180

  // 关键：画布位图取整数设备像素 n，CSS 尺寸写 n/DPR，
  // 于是 n 个位图像素恰好对应 n 个物理像素，1:1 不做任何重采样。
  // 再要求 n 让 n/DPR 正好落在 1/64px 布局单位上，避免浏览器再取整半个像素。
  const step = exactStep(dpr)
  let n = Math.floor(cssSide * dpr)
  n -= n % (step % 2 === 0 ? step : step * 2)
  if (n < 180) return

  const key = n + '@' + dpr
  if (key === lastKey) { snapFrame(); return }   // 防止 ResizeObserver 与自身尺寸互相触发
  lastKey = key

  DPR = dpr
  // 几何全部取整数设备像素，满足 n = 2*padDev + (SIZE-1)*cellDev
  let cd = Math.max(4, Math.round((n - 2 * Math.round(n * 0.062)) / (SIZE - 1)))
  let pd = Math.round((n - cd * (SIZE - 1)) / 2)
  if (pd < 2) { pd = 2; cd = Math.max(4, Math.floor((n - 4) / (SIZE - 1))) }
  padDev = pd
  cellDev = cd
  // 对外仍用 CSS 逻辑坐标（px/py/hitTest 全不用改），
  // 但这些坐标乘 DPR 之后都是整数设备像素
  W = n / DPR
  pad = padDev / DPR
  cell = cellDev / DPR

  el.frame.style.width = W + 'px'
  el.frame.style.height = W + 'px'
  el.canvas.style.width = W + 'px'
  el.canvas.style.height = W + 'px'
  el.canvas.width = n
  el.canvas.height = n
  // 让顶部的回合条和底部的提示与其对齐
  document.documentElement.style.setProperty('--board-w', W + 'px')
  texKey = ''
  snapFrame()
}

function hitTest(x, y) {
  const c = Math.round((x - pad) / cell)
  const r = Math.round((y - pad) / cell)
  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return -1
  const i = r * SIZE + c
  if (Math.hypot(x - px(i), y - py(i)) > cell * 0.62) return -1
  return i
}

const coordName = (i) => LETTERS[i % SIZE] + (Math.floor(i / SIZE) + 1)

function roundRect(g, x, y, w, h, r) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

/** 固定种子伪随机，保证木纹在缩放时不抖动 */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildTexture() {
  const key = `${Math.round(W)}|${state.skin}|${DPR}`
  if (tex && texKey === key) return
  const pal = SKINS[state.skin]
  const c = document.createElement('canvas')
  c.width = el.canvas.width; c.height = el.canvas.height
  const g = c.getContext('2d')
  g.setTransform(DPR, 0, 0, DPR, 0, 0)

  // 纯色底（保持简洁，不做渐变与暗角）
  g.fillStyle = pal.base
  g.fillRect(0, 0, W, W)

  // 木纹风格才画纹理
  if (pal.grain) {
    const rnd = mulberry32(0x5eed77)
    const count = Math.round(W * pal.grain.count)
    g.save()
    g.beginPath(); g.rect(0, 0, W, W); g.clip()
    for (let i = 0; i < count; i++) {
      const y = rnd() * W
      const amp = 1 + rnd() * pal.grain.amp
      const freq = 1.3 + rnd() * 3.4
      const ph = rnd() * TAU
      const a = pal.grain.alpha * (0.3 + rnd() * 1.2)
      g.beginPath()
      g.moveTo(0, y)
      for (let x = 0; x <= W; x += 3.5) g.lineTo(x, y + Math.sin(ph + (x / W) * Math.PI * freq) * amp)
      g.strokeStyle = `rgba(${pal.grain.rgb},${a.toFixed(4)})`
      g.lineWidth = 0.5 + rnd() * pal.grain.width
      g.stroke()
    }
    g.restore()
  }

  tex = c
  texKey = key
}

function drawStone(x, y, r, p, scale, alpha) {
  if (scale <= 0.01 || alpha <= 0.01) return
  const pal = SKINS[state.skin]
  const rr = r * scale
  const col = p === BLACK ? pal.blackStone : pal.whiteStone
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.shadowColor = pal.stoneShadow
  ctx.shadowBlur = rr * 0.32
  ctx.shadowOffsetY = rr * 0.12
  const grad = ctx.createRadialGradient(x - rr * 0.34, y - rr * 0.4, rr * 0.05, x, y, rr * 1.1)
  grad.addColorStop(0, col[0]); grad.addColorStop(0.46, col[1]); grad.addColorStop(1, col[2])
  ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fillStyle = grad; ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.globalAlpha = alpha
  // 边缘
  ctx.beginPath(); ctx.arc(x, y, rr * 0.96, 0, TAU)
  ctx.strokeStyle = p === BLACK ? pal.rimBlack : pal.rimWhite
  ctx.lineWidth = Math.max(0.7, rr * 0.07); ctx.stroke()
  // 高光
  ctx.beginPath()
  ctx.ellipse(x - rr * 0.33, y - rr * 0.37, rr * 0.26, rr * 0.16, -0.62, 0, TAU)
  ctx.fillStyle = p === BLACK ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.85)'
  ctx.fill()
  ctx.restore()
}

const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2)

/** 绘制一帧，返回是否还需要继续绘制 */
function draw(now) {
  if (!W) return false
  buildTexture()
  const pal = SKINS[state.skin]
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
  ctx.clearRect(0, 0, W, W)
  ctx.drawImage(tex, 0, 0, el.canvas.width, el.canvas.height, 0, 0, W, W)

  // 设备像素 → CSS 逻辑坐标（ctx 已按 DPR 缩放，等价于把图形画在整设备像素上）
  const dv = (v) => v / DPR
  // 棋子半径取整数设备像素
  const r = Math.round(cellDev * 0.44) / DPR
  let busy = false

  // 网格：在设备像素空间按单位阵直接铺 1 像素宽/高的矩形。
  // 不用「描边 + 0.5 设备像素偏移」——那只有线心落在半整数上才锐利，
  // 而线心坐标是 padDev + k*cellDev，间距 cellDev 是奇数时奇偶交替，
  // 会有一半的线跨在像素缝上被劈成两个半灰像素。
  // 直接 fillRect 整数坐标，每条线必然恰好占满一个设备像素。
  const g0 = padDev
  const glen = (SIZE - 1) * cellDev + 1   // 端点含最后一条线的那个像素
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = pal.line
  for (let k = 0; k < SIZE; k++) {
    const c = g0 + k * cellDev
    ctx.fillRect(c, g0, 1, glen)
    ctx.fillRect(g0, c, glen, 1)
  }

  // 外框：厚度取偶数设备像素，整像素矩形（同样用 fill，边界必然落在整像素上）
  ctx.fillStyle = pal.lineMajor
  const majDev = Math.max(2, Math.round((cellDev * 0.045) / 2) * 2)
  const f0 = g0 - majDev / 2
  const flen = (SIZE - 1) * cellDev + majDev
  ctx.fillRect(f0, f0, flen, majDev)                     // 上
  ctx.fillRect(f0, f0 + flen - majDev, flen, majDev)     // 下
  ctx.fillRect(f0, f0, majDev, flen)                     // 左
  ctx.fillRect(f0 + flen - majDev, f0, majDev, flen)     // 右
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0)

  // 星位：直径取整数设备像素
  ctx.fillStyle = pal.star
  const starDev = Math.max(2, Math.round(cellDev * 0.085))
  for (const [r0, c0] of [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]]) {
    ctx.beginPath()
    ctx.arc(dv(padDev + c0 * cellDev), dv(padDev + r0 * cellDev), starDev / DPR, 0, TAU)
    ctx.fill()
  }

  // 坐标
  if (state.coord) {
    ctx.fillStyle = pal.coord
    ctx.font = `600 ${Math.max(9, cell * 0.3).toFixed(1)}px "Segoe UI","Microsoft YaHei",system-ui,sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    // 往外挪，避免和边线上的棋子重叠
    const off = pad * 0.68
    for (let k = 0; k < SIZE; k++) {
      const c = pad + k * cell
      ctx.fillText(LETTERS[k], c, pad - off)
      ctx.fillText(LETTERS[k], c, pad + (SIZE - 1) * cell + off)
      ctx.fillText(String(k + 1), pad - off, c)
      ctx.fillText(String(k + 1), pad + (SIZE - 1) * cell + off, c)
    }
  }

  // 悬停虚影
  if (hover >= 0 && !state.over && !state.thinking && state.board[hover] === 0) {
    const canPlay = state.mode === 'pvp' || state.turn === state.human
    if (canPlay) drawStone(px(hover), py(hover), r, state.turn, 1, 0.34)
  }

  // 提示点（静态圆环，不闪烁）
  if (hintCell >= 0 && state.board[hintCell] === 0) {
    const x = px(hintCell), y = py(hintCell)
    ctx.save()
    ctx.strokeStyle = '#0078d4'
    ctx.lineWidth = Math.max(2, Math.round(cellDev * 0.08)) / DPR
    ctx.beginPath(); ctx.arc(x, y, r * 0.82, 0, TAU); ctx.stroke()
    ctx.globalAlpha = 0.1
    ctx.fillStyle = '#0078d4'
    ctx.fill()
    ctx.restore()
  }

  // 棋子（按落子顺序）
  ctx.font = `700 ${Math.max(9, cell * 0.34).toFixed(1)}px "PingFang SC","Microsoft YaHei",system-ui,sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  for (let k = 0; k < animOrder.length; k++) {
    const i = animOrder[k]
    const p = state.board[i]
    if (!p) continue
    let scale = 1, alpha = 1
    const t0 = anim.get(i)
    if (t0 !== undefined) {
      const t = (now - t0) / DROP_MS
      if (t >= 1) anim.delete(i)
      else { busy = true; scale = Math.max(0.05, easeOutBack(t)); alpha = Math.min(1, t * 3.2) }
    }
    const x = px(i), y = py(i)
    drawStone(x, y, r, p, scale, alpha)
    if (state.index && scale > 0.92) {
      ctx.fillStyle = p === BLACK ? 'rgba(255,255,255,0.72)' : 'rgba(30,40,60,0.72)'
      ctx.fillText(String(k + 1), x, y + cell * 0.02)
    }
  }

  // 最后一手标记
  if (state.moves.length && !state.over) {
    const last = state.moves[state.moves.length - 1]
    if (anim.get(last.i) === undefined) {
      const x = px(last.i), y = py(last.i)
      ctx.beginPath()
      ctx.arc(x, y, Math.max(2, r * 0.2), 0, TAU)
      ctx.fillStyle = '#d13438'
      ctx.fill()
    }
  }

  // 胜利连线（静态实线，无发光）
  if (state.winLine && state.winLine.length >= 2) {
    const line = state.winLine
    const a = line[0], b = line[line.length - 1]
    ctx.save()
    ctx.strokeStyle = '#d13438'
    ctx.lineWidth = Math.max(3, Math.round(cellDev * 0.11)) / DPR
    ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(px(a), py(a)); ctx.lineTo(px(b), py(b)); ctx.stroke()
    ctx.restore()
    for (const i of line) {
      ctx.beginPath()
      ctx.arc(px(i), py(i), r * 0.94, 0, TAU)
      ctx.strokeStyle = '#d13438'
      ctx.lineWidth = Math.max(1.5, Math.round(cellDev * 0.05)) / DPR
      ctx.stroke()
    }
  }

  return busy
}

/* ========================================================================
   动画调度
   ======================================================================== */
let rafId = 0
function scheduleDraw() {
  if (!rafId) rafId = requestAnimationFrame(tick)
}
function tick() {
  rafId = 0
  const busy = draw(performance.now())
  if (busy) scheduleDraw()
}

/* ========================================================================
   胜负判定
   ======================================================================== */
const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]]

function findWinLine(i, p) {
  const r0 = Math.floor(i / SIZE), c0 = i % SIZE
  for (const [dr, dc] of DIRS) {
    const cells = [i]
    for (const s of [1, -1]) {
      let r = r0 + dr * s, c = c0 + dc * s
      while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && state.board[r * SIZE + c] === p) {
        cells.push(r * SIZE + c); r += dr * s; c += dc * s
      }
    }
    if (cells.length >= 5) {
      cells.sort((a, b) => a - b)
      return cells
    }
  }
  return null
}

/* ========================================================================
   AI 调用（Worker 优先，主线程兜底）
   ======================================================================== */
let worker = null, workerDead = false, seq = 0
const pending = new Map()

function ensureWorker() {
  if (worker || workerDead) return worker
  const src = window.__AI_WORKER_SRC__
  if (!src) { workerDead = true; return null }
  try {
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
    const w = new Worker(url)
    w.onmessage = (e) => {
      const cb = pending.get(e.data.id)
      if (cb) { pending.delete(e.data.id); cb(e.data) }
    }
    w.onerror = () => {
      // file:// 等环境下 Worker 可能被限制，降级到主线程
      workerDead = true
      try { w.terminate() } catch { /* ignore */ }
      worker = null
      for (const [, cb] of pending) cb(null)
      pending.clear()
    }
    worker = w
  } catch {
    workerDead = true
  }
  return worker
}

/** 让浏览器先把「思考中」绘制出来 */
const nextPaint = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)))
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

function askAi(level, player, moves) {
  return new Promise((resolve) => {
    const w = ensureWorker()
    if (w) {
      const id = ++seq
      pending.set(id, (res) => resolve(res && res.ok ? res : searchMove(level, player, moves)))
      w.postMessage({ type: 'move', id, level, player, moves })
    } else {
      resolve(searchMove(level, player, moves))
    }
  })
}

let gen = 0 // 局面代次：悔棋/重开会让在途的 AI 结果作废

function nearestEmpty() {
  // 兜底：找离已有棋子最近的空点
  const occupied = []
  for (let i = 0; i < state.board.length; i++) if (state.board[i]) occupied.push(i)
  if (!occupied.length) return 7 * SIZE + 7
  let best = -1, bestD = Infinity
  for (let i = 0; i < state.board.length; i++) {
    if (state.board[i]) continue
    const x = i % SIZE, y = (i / SIZE) | 0
    let d = Infinity
    for (const o of occupied) {
      const dd = Math.max(Math.abs(x - (o % SIZE)), Math.abs(y - (((o / SIZE) | 0))))
      if (dd < d) d = dd
      if (d === 1) break
    }
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

async function aiTurn() {
  if (state.over || state.thinking || state.mode !== 'pve') return
  if (state.turn === state.human) return
  const myGen = gen
  state.thinking = true
  renderPanel()
  await nextPaint()

  const moves = state.moves.map((m) => ({ r: (m.i / SIZE) | 0, c: m.i % SIZE, p: m.p }))
  const t0 = performance.now()
  const res = await askAi(state.level, state.turn, moves)

  // 手感：不要瞬间落子
  const minThink = state.level === 'easy' ? 170 : state.level === 'medium' ? 260 : 340
  const rest = minThink - (performance.now() - t0)
  if (rest > 0) await sleep(rest)

  if (myGen !== gen) { state.thinking = false; return }   // 期间被悔棋/重开
  if (state.over) { state.thinking = false; return }

  let cell = -1
  if (res && res.ok) {
    const cand = res.r * SIZE + res.c
    if (state.board[cand] === 0) cell = cand
  }
  if (cell < 0) cell = nearestEmpty()
  state.thinking = false
  if (cell >= 0) place(cell)
  else renderPanel()
}

/* ========================================================================
   落子 / 终局
   ======================================================================== */
function place(i) {
  if (state.over || i < 0 || state.board[i] !== 0) return
  const p = state.turn
  state.board[i] = p
  state.moves.push({ i, p })
  animOrder.push(i)
  anim.set(i, performance.now())
  hintCell = -1
  sfxPlace()

  const line = findWinLine(i, p)
  if (line) {
    finish(p, line)
  } else if (state.moves.length >= SIZE * SIZE) {
    finish(0, null)
  } else {
    state.turn = p === BLACK ? WHITE : BLACK
  }
  scheduleDraw()
  renderPanel()
  if (!state.over && state.mode === 'pve' && state.turn !== state.human) aiTurn()
}

function finish(winner, line) {
  state.over = true
  state.winner = winner
  state.winLine = line
  if (winner === BLACK) state.scores.b++
  else if (winner === WHITE) state.scores.w++
  else state.scores.d++
  saveStore()
  if (winner === 0) sfxDraw(); else sfxWin()
  scheduleDraw()
  renderPanel()
  setTimeout(() => showResult(winner), line ? 680 : 260)
}

function showResult(winner) {
  el.dlgStone.className = 'dialog-stone ' + (winner === BLACK ? 'black' : winner === WHITE ? 'white' : 'draw')
  if (winner === 0) {
    el.dlgTitle.textContent = '和棋'
    el.dlgDesc.textContent = '棋盘已满，握手言和'
  } else {
    const name = winner === BLACK ? '黑棋' : '白棋'
    el.dlgTitle.textContent = name + '获胜'
    if (state.mode === 'pve') {
      el.dlgDesc.textContent = (winner === state.human ? '恭喜你，击败了 ' : '本局不敌 ') +
        ({ easy: '简单', medium: '普通', hard: '困难' }[state.level]) + ' 难度的电脑'
    } else {
      el.dlgDesc.textContent = `共 ${state.moves.length} 手`
    }
  }
  el.overlay.hidden = false
}
function hideResult() { el.overlay.hidden = true }

/* ========================================================================
   悔棋 / 重开 / 提示
   ======================================================================== */
function pop() {
  const m = state.moves.pop()
  if (!m) return
  state.board[m.i] = 0
  anim.delete(m.i)
  const k = animOrder.lastIndexOf(m.i)
  if (k >= 0) animOrder.splice(k, 1)
  state.turn = m.p
}

function undo() {
  if (state.thinking) return toast('电脑正在思考，稍等一下')
  if (!state.moves.length) return toast('还没有落子')
  gen++
  if (state.over) {
    if (state.winner === BLACK) state.scores.b = Math.max(0, state.scores.b - 1)
    else if (state.winner === WHITE) state.scores.w = Math.max(0, state.scores.w - 1)
    else state.scores.d = Math.max(0, state.scores.d - 1)
    saveStore()
  }
  pop()
  if (state.mode === 'pve') {
    while (state.moves.length && state.turn !== state.human) pop()
  }
  state.over = false; state.winner = 0; state.winLine = null
  hintCell = -1
  hideResult()
  sfxClick()
  scheduleDraw(); renderPanel()
}

function restart(silent) {
  gen++
  state.board.fill(0)
  state.moves.length = 0
  animOrder.length = 0
  anim.clear()
  state.turn = BLACK
  state.over = false; state.winner = 0; state.winLine = null
  state.thinking = false
  hintCell = -1
  hideResult()
  scheduleDraw(); renderPanel()
  if (!silent) { sfxClick(); toast('新的一局，黑棋先行') }
  if (state.mode === 'pve' && state.human !== BLACK) setTimeout(() => aiTurn(), 340)
}

async function hint() {
  if (state.over) return toast('本局已结束')
  if (state.thinking) return toast('正在计算中…')
  if (state.mode === 'pve' && state.turn !== state.human) return
  const myGen = gen
  state.thinking = true
  renderPanel()
  await nextPaint()
  const moves = state.moves.map((m) => ({ r: (m.i / SIZE) | 0, c: m.i % SIZE, p: m.p }))
  // 提示永远用最强档，给玩家的建议才有价值
  const res = await askAi('hard', state.turn, moves)
  if (myGen !== gen) { state.thinking = false; return }
  state.thinking = false
  if (res && res.ok) {
    const c = res.r * SIZE + res.c
    if (state.board[c] === 0) {
      hintCell = c
      scheduleDraw()
      // 4.5 秒后自动清除提示（用定时器，避免为了淡出而持续重绘）
      clearTimeout(hintTimer)
      hintTimer = setTimeout(() => { hintCell = -1; scheduleDraw() }, 4500)
      toast('建议下在 ' + coordName(c))
    } else toast('没有找到合适的建议')
  } else {
    toast('没有找到合适的建议')
  }
  renderPanel()
}

/* ========================================================================
   界面渲染
   ======================================================================== */
let histCount = -1

function historyRow(no, m) {
  const row = document.createElement('div')
  row.className = 'hist-row' + (no === state.moves.length ? ' last' : '')
  row.innerHTML =
    `<span class="no">${no}</span>` +
    `<span class="stone-chip mini ${m.p === BLACK ? 'black' : 'white'}"></span>` +
    `<span class="coord">${coordName(m.i)}</span>`
  return row
}

function renderHistory() {
  if (state.moves.length === histCount) return
  const rebuild = histCount < 0 || state.moves.length !== histCount + 1
  if (rebuild) {
    el.history.innerHTML = ''
    for (let k = 0; k < state.moves.length; k++) el.history.appendChild(historyRow(k + 1, state.moves[k]))
  } else {
    const last = el.history.lastElementChild
    if (last) last.classList.remove('last')
    el.history.appendChild(historyRow(state.moves.length, state.moves[state.moves.length - 1]))
  }
  histCount = state.moves.length
  el.histCount.textContent = String(histCount)
  if (!histCount && !el.history.querySelector('.history-empty')) {
    const d = document.createElement('div')
    d.className = 'history-empty'
    d.textContent = '暂无落子'
    el.history.appendChild(d)
  } else if (histCount) {
    const e = el.history.querySelector('.history-empty')
    if (e) e.remove()
  }
  el.history.scrollTop = el.history.scrollHeight
}

function renderPanel() {
  const isBlackTurn = state.turn === BLACK && !state.over
  const isWhiteTurn = state.turn === WHITE && !state.over

  el.pBlack.classList.toggle('active', isBlackTurn)
  el.pWhite.classList.toggle('active', isWhiteTurn)
  el.pBlack.classList.toggle('thinking', state.thinking && state.turn === BLACK)
  el.pWhite.classList.toggle('thinking', state.thinking && state.turn === WHITE)

  el.scoreBlack.textContent = String(state.scores.b)
  el.scoreWhite.textContent = String(state.scores.w)

  // 称号
  if (state.mode === 'pve') {
    el.roleBlack.textContent = state.human === BLACK ? '你' : '电脑'
    el.roleWhite.textContent = state.human === WHITE ? '你' : '电脑'
  } else {
    el.roleBlack.textContent = '玩家 1'
    el.roleWhite.textContent = '玩家 2'
  }

  // 状态行
  if (state.over) {
    el.status.innerHTML = state.winner === 0
      ? '和棋，棋盘已满'
      : `<b>${state.winner === BLACK ? '黑棋' : '白棋'}</b> 获胜`
  } else if (state.thinking) {
    el.status.innerHTML = `<span class="spinner"></span> 电脑思考中…`
  } else if (state.mode === 'pve') {
    el.status.innerHTML = state.turn === state.human
      ? '轮到你落子'
      : '<b>电脑</b> 回合'
  } else {
    el.status.innerHTML = `轮到 <b>${state.turn === BLACK ? '黑棋' : '白棋'}</b> 落子`
  }

  // 顶部徽标
  el.badge.classList.toggle('white', state.turn === WHITE)
  el.badge.querySelector('span:last-child').textContent = state.over
    ? (state.winner === 0 ? '和棋' : (state.winner === BLACK ? '黑棋胜' : '白棋胜'))
    : state.thinking ? '思考中…' : (state.turn === BLACK ? '黑棋回合' : '白棋回合')

  el.moveCounter.textContent = `第 ${state.moves.length} 手`
  el.footHint.textContent = state.over ? '本局已结束' : '点击棋盘落子'

  // 按钮
  el.btnUndo.disabled = !state.moves.length
  const canHint = !state.over && !state.thinking && (state.mode === 'pvp' || state.turn === state.human)
  el.btnHint.disabled = !canHint
  el.canvas.classList.toggle('thinking', state.thinking)

  // 设置区
  paintSeg(el.segMode, state.mode)
  paintSeg(el.segLevel, state.level)
  paintSeg(el.segSide, state.human === BLACK ? 'black' : 'white')
  paintSeg(el.segSkin, state.skin)
  el.fieldLevel.classList.toggle('dim', state.mode !== 'pve')
  el.fieldSide.classList.toggle('dim', state.mode !== 'pve')
  el.optCoord.checked = state.coord
  el.optIndex.checked = state.index
  el.optSound.checked = state.sound

  renderHistory()
}

function paintSeg(root, value) {
  if (!root) return
  root.querySelectorAll('button[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === value))
}

let toastTimer = 0
function toast(msg) {
  el.toast.textContent = msg
  el.toast.hidden = false
  el.toast.style.animation = 'none'
  void el.toast.offsetWidth
  el.toast.style.animation = ''
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.toast.hidden = true }, 1900)
}

/* ========================================================================
   设置交互
   ======================================================================== */
function bindSeg(root, handler) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-v]')
    if (!btn) return
    handler(btn.dataset.v)
  })
}

function setMode(v) {
  if (v === state.mode) return
  state.mode = v
  saveStore()
  restart(true)
  sfxClick()
  toast(v === 'pve' ? '人机对战：你执' + (state.human === BLACK ? '黑先行' : '白后行') : '本地双人：同屏轮流落子')
  renderPanel()
}
function setLevel(v) {
  if (v === state.level) return
  state.level = v
  saveStore(); sfxClick()
  toast('难度：' + { easy: '简单', medium: '普通', hard: '困难' }[v])
  renderPanel()
}
function setSide(v) {
  const human = v === 'black' ? BLACK : WHITE
  if (human === state.human) return
  state.human = human
  saveStore()
  restart(true)
  sfxClick()
  toast(human === BLACK ? '你执黑先行' : '你执白后行，电脑先行')
  renderPanel()
}
function setSkin(v) {
  if (v === state.skin) return
  state.skin = v
  saveStore(); sfxClick()
  texKey = ''
  scheduleDraw()
  renderPanel()
}

/* ========================================================================
   启动
   ======================================================================== */
function boot() {
  loadStore()

  bindSeg(el.segMode, setMode)
  bindSeg(el.segLevel, setLevel)
  bindSeg(el.segSide, setSide)
  bindSeg(el.segSkin, setSkin)

  el.btnUndo.addEventListener('click', undo)
  el.btnHint.addEventListener('click', hint)
  el.btnRestart.addEventListener('click', () => restart(false))
  el.btnAgain.addEventListener('click', () => restart(false))
  el.btnCloseDlg.addEventListener('click', hideResult)
  el.overlay.addEventListener('click', (e) => { if (e.target === el.overlay) hideResult() })

  el.optCoord.addEventListener('change', () => { state.coord = el.optCoord.checked; saveStore(); scheduleDraw() })
  el.optIndex.addEventListener('change', () => { state.index = el.optIndex.checked; saveStore(); scheduleDraw() })
  el.optSound.addEventListener('change', () => { state.sound = el.optSound.checked; saveStore(); if (state.sound) sfxClick() })
  el.btnSound.addEventListener('click', () => {
    state.sound = !state.sound
    saveStore(); renderPanel()
    el.btnSound.classList.toggle('on', state.sound)
    if (state.sound) sfxClick()
  })
  el.btnSound.classList.toggle('on', state.sound)
  el.btnFull.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else document.documentElement.requestFullscreen?.()
  })

  // 点击落子
  el.canvas.addEventListener('click', (e) => {
    const rect = el.canvas.getBoundingClientRect()
    const i = hitTest(e.clientX - rect.left, e.clientY - rect.top)
    if (i < 0) return
    if (state.over) return toast('本局已结束，点「重新开始」再战')
    if (state.thinking) return toast('电脑正在思考…')
    if (state.mode === 'pve' && state.turn !== state.human) return
    if (state.board[i] !== 0) return
    place(i)
  })

  // 悬停虚影（仅鼠标）
  el.canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return
    const rect = el.canvas.getBoundingClientRect()
    const i = hitTest(e.clientX - rect.left, e.clientY - rect.top)
    if (i !== hover) { hover = i; scheduleDraw() }
  })
  el.canvas.addEventListener('pointerleave', () => {
    if (hover !== -1) { hover = -1; scheduleDraw() }
  })

  // 快捷键
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return
    const k = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo() }
    else if (k === 'r') { e.preventDefault(); restart(false) }
    else if (k === 'h') { e.preventDefault(); hint() }
    else if (k === 'escape') hideResult()
  })

  // 尺寸变化：观察 board-card（尺寸由外层栅格决定，不受棋盘自身大小影响，
  // 避免 ResizeObserver 与 layout() 互相触发形成死循环）
  const resizeTarget = document.querySelector('.board-card') || el.stage
  const ro = new ResizeObserver(() => { layout(); scheduleDraw() })
  if (resizeTarget) ro.observe(resizeTarget)
  let rAF = 0
  window.addEventListener('resize', () => {
    cancelAnimationFrame(rAF)
    rAF = requestAnimationFrame(() => { layout(); scheduleDraw() })
  })
  window.addEventListener('orientationchange', () => setTimeout(() => { layout(); scheduleDraw() }, 220))

  layout()
  renderPanel()
  scheduleDraw()

  // 人机模式下若玩家执白，让电脑先开局
  if (state.mode === 'pve' && state.human !== BLACK) setTimeout(() => aiTurn(), 520)
}

boot()
