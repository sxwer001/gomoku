/**
 * 诊断：逐手打印 hard vs easy，确认每方确实在用各自的搜索配置
 * 运行：node tools/diag.mjs
 */
import { GomokuSolution, createGomokuSearcher, createScoreMap } from '@algorithm.ts/gomoku'

const N = 15
const LIB_BLACK = 1, LIB_WHITE = 0
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
  const sol = new GomokuSolution(props)
  sol.__level = level
  return sol
}

const idx = (r, c) => r * N + c
const toLib = (p) => (p === BLACK ? LIB_BLACK : LIB_WHITE)
const nameOf = (p) => (p === BLACK ? '黑' : '白')

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

const lvBlack = process.argv[2] || 'hard'
const lvWhite = process.argv[3] || 'easy'
const maxMoves = Number(process.argv[4] || 20)

const sols = { [BLACK]: makeSolution(lvBlack), [WHITE]: makeSolution(lvWhite) }
console.log(`黑=${lvBlack}(${sols[BLACK].__level})  白=${lvWhite}(${sols[WHITE].__level})`)
sols[BLACK].init([]); sols[WHITE].init([])

const grid = new Array(N * N).fill(EMPTY)
let player = BLACK
const stat = { [BLACK]: [], [WHITE]: [] }

for (let step = 0; step < maxMoves; step++) {
  const sol = sols[player]
  const t = Date.now()
  const [r, c] = sol.minimaxSearch(toLib(player))
  const dt = Date.now() - t
  stat[player].push(dt)
  if (r < 0) { console.log('引擎判定终局'); break }
  sols[BLACK].forward(r, c, toLib(player))
  sols[WHITE].forward(r, c, toLib(player))
  grid[idx(r, c)] = player
  console.log(
    `第${String(step + 1).padStart(2)}手 ${nameOf(player)}(${sol.__level.padEnd(6)}) → (${String(r).padStart(2)},${String(c).padStart(2)})  ${String(dt).padStart(4)}ms`
  )
  if (winAt(grid, r, c)) { console.log(`${nameOf(player)} 五连获胜（第${step + 1}手）`); break }
  player = player === BLACK ? WHITE : BLACK
}

const avg = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-')
console.log(`\n黑(${lvBlack}) 出手${stat[BLACK].length}次 平均${avg(stat[BLACK])}ms 最慢${Math.max(...stat[BLACK], 0)}ms`)
console.log(`白(${lvWhite}) 出手${stat[WHITE].length}次 平均${avg(stat[WHITE])}ms 最慢${Math.max(...stat[WHITE], 0)}ms`)
