/**
 * 压力测试：完整对局最坏耗时 + 难度梯度是否合理
 * 运行：node tools/stress.mjs
 *
 * 注意：库内部用 0=白 / 1=黑，与"空位"无关；
 *      本脚本自己维护的棋盘用 0=空 / 1=黑 / 2=白，避免混淆。
 */
import { GomokuSolution, createGomokuSearcher, createScoreMap } from '@algorithm.ts/gomoku'

const N = 15
const LIB_BLACK = 1
const LIB_WHITE = 0
const EMPTY = 0, BLACK = 1, WHITE = 2
const con = createScoreMap(5).con

const PRESETS = {
  easy: {
    narrow: [{ MAX_SEARCH_DEPTH: 1, MAX_CANDIDATE_COUNT: 4, MIN_PROMOTION_SCORE: Infinity, CANDIDATE_GROWTH_FACTOR: 4 }],
    deep: { MAX_SEARCH_DEPTH: 1, MIN_PROMOTION_SCORE: Infinity },
  },
  medium: {
    narrow: [
      { MAX_SEARCH_DEPTH: 2, MAX_CANDIDATE_COUNT: 6, MIN_PROMOTION_SCORE: con[2][1], CANDIDATE_GROWTH_FACTOR: 6 },
      { MAX_SEARCH_DEPTH: 4, MAX_CANDIDATE_COUNT: 3, MIN_PROMOTION_SCORE: con[3][1] * 2, CANDIDATE_GROWTH_FACTOR: 6 },
    ],
    deep: { MAX_SEARCH_DEPTH: 4, MIN_PROMOTION_SCORE: con[3][1] },
  },
  hard: null,
}

function makeSolution(level) {
  const preset = PRESETS[level]
  const props = { MAX_ROW: N, MAX_COL: N, MAX_ADJACENT: 5, MAX_DISTANCE_OF_NEIGHBOR: 2, CANDIDATE_GROWTH_FACTOR: 8 }
  if (preset) {
    props.deeperSearcher = (mover) =>
      createGomokuSearcher({ narrowSearcherOptions: preset.narrow, deepSearcherOption: preset.deep, searchContext: mover })
  }
  return new GomokuSolution(props)
}

const idx = (r, c) => r * N + c
const toLib = (p) => (p === BLACK ? LIB_BLACK : LIB_WHITE)

function winAt(grid, r, c) {
  const p = grid[idx(r, c)]
  if (p === EMPTY) return false
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    let n = 1
    for (const s of [1, -1]) {
      let rr = r + dr * s, cc = c + dc * s
      while (rr >= 0 && rr < N && cc >= 0 && cc < N && grid[idx(rr, cc)] === p) { n++; rr += dr * s; cc += dc * s }
    }
    if (n >= 5) return true
  }
  return false
}

/** 交叉对弈：黑白各自一套不同难度的引擎，双方棋盘同步 */
function crossPlay(lvBlack, lvWhite, maxMoves = 150) {
  const sols = { [BLACK]: makeSolution(lvBlack), [WHITE]: makeSolution(lvWhite) }
  sols[BLACK].init([]); sols[WHITE].init([])
  const grid = new Array(N * N).fill(EMPTY)
  const times = { [BLACK]: [], [WHITE]: [] }
  let player = BLACK

  for (let step = 0; step < maxMoves; step++) {
    const sol = sols[player]
    const t = Date.now()
    const [r, c] = sol.minimaxSearch(toLib(player))
    times[player].push(Date.now() - t)
    if (r < 0) return { winner: EMPTY, moves: step, times, reason: '引擎判定终局' }
    sols[BLACK].forward(r, c, toLib(player))
    sols[WHITE].forward(r, c, toLib(player))
    grid[idx(r, c)] = player
    if (winAt(grid, r, c)) return { winner: player, moves: step + 1, times }
    player = player === BLACK ? WHITE : BLACK
  }
  return { winner: EMPTY, moves: maxMoves, times, reason: '达到手数上限' }
}

function fmt(res, label) {
  const all = [...res.times[BLACK], ...res.times[WHITE]]
  const avgOf = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-')
  const sorted = [...all].sort((a, b) => a - b)
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
  const who = res.winner === BLACK ? '黑胜' : res.winner === WHITE ? '白胜' : (res.reason || '平')
  console.log(
    `  ${label.padEnd(24)} → ${who.padEnd(6)} 手数=${String(res.moves).padStart(3)}` +
    `  黑均=${avgOf(res.times[BLACK]).padStart(5)}ms(最慢${String(Math.max(...res.times[BLACK], 0)).padStart(4)})` +
    `  白均=${avgOf(res.times[WHITE]).padStart(5)}ms(最慢${String(Math.max(...res.times[WHITE], 0)).padStart(4)})` +
    `  总P95=${String(p95).padStart(4)}ms`
  )
}

console.log('=== 自我对弈（同级别黑白互搏）===')
for (const lv of ['easy', 'medium', 'hard']) fmt(crossPlay(lv, lv), `${lv} vs ${lv}`)

console.log('\n=== 难度梯度校验（高难度应获胜）===')
fmt(crossPlay('hard', 'easy'), '黑=hard   白=easy')
fmt(crossPlay('medium', 'easy'), '黑=medium 白=easy')
fmt(crossPlay('easy', 'hard'), '黑=easy   白=hard')
fmt(crossPlay('hard', 'medium'), '黑=hard   白=medium')
