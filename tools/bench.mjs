/**
 * 基准测试：验证 @algorithm.ts/gomoku 的 API、棋力与耗时
 * 运行：node tools/bench.mjs
 */
import { GomokuSolution, createGomokuSearcher, createScoreMap } from '@algorithm.ts/gomoku'

const N = 15
const BLACK = 1
const WHITE = 0
const con = createScoreMap(5).con // con[连子数][开放端数] 的棋型分值

/* ---------- 三档难度的搜索配置 ---------- */
const PRESETS = {
  // 简单：1 层贪心 + 立即胜负判断（会堵四，但看不出后续连环三）
  easy: {
    narrow: [{ MAX_SEARCH_DEPTH: 1, MAX_CANDIDATE_COUNT: 4, MIN_PROMOTION_SCORE: Infinity, CANDIDATE_GROWTH_FACTOR: 4 }],
    deep: { MAX_SEARCH_DEPTH: 1, MIN_PROMOTION_SCORE: Infinity },
  },
  // 普通：自适应 2~4 层
  medium: {
    narrow: [
      { MAX_SEARCH_DEPTH: 2, MAX_CANDIDATE_COUNT: 6, MIN_PROMOTION_SCORE: con[2][1], CANDIDATE_GROWTH_FACTOR: 6 },
      { MAX_SEARCH_DEPTH: 4, MAX_CANDIDATE_COUNT: 3, MIN_PROMOTION_SCORE: con[3][1] * 2, CANDIDATE_GROWTH_FACTOR: 6 },
    ],
    deep: { MAX_SEARCH_DEPTH: 4, MIN_PROMOTION_SCORE: con[3][1] },
  },
  // 困难：库自带默认配置（自适应 2~8 层，关键点延伸至最深 16 层）
  hard: null,
}

function makeSolution(level) {
  const preset = PRESETS[level]
  const props = {
    MAX_ROW: N,
    MAX_COL: N,
    MAX_ADJACENT: 5,
    MAX_DISTANCE_OF_NEIGHBOR: 2,
    CANDIDATE_GROWTH_FACTOR: 8,
  }
  if (preset) {
    props.deeperSearcher = (mover) =>
      createGomokuSearcher({
        narrowSearcherOptions: preset.narrow,
        deepSearcherOption: preset.deep,
        searchContext: mover,
      })
  }
  return new GomokuSolution(props)
}

/* ---------- 工具 ---------- */
function idx(r, c) { return r * N + c }

function isFive(grid, r, c) {
  const p = grid[idx(r, c)]
  if (!p) return false
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]]
  for (const [dr, dc] of dirs) {
    let n = 1
    for (const s of [1, -1]) {
      let rr = r + dr * s, cc = c + dc * s
      while (rr >= 0 && rr < N && cc >= 0 && cc < N && grid[idx(rr, cc)] === p) { n++; rr += dr * s; cc += dc * s }
    }
    if (n >= 5) return true
  }
  return false
}

function buildSolution(level, stones) {
  const sol = makeSolution(level)
  sol.init([])
  for (const [r, c, p] of stones) sol.forward(r, c, p)
  return sol
}

function show(r, c) { return r < 0 ? '无棋可走/终局' : `(${r}, ${c})` }

let failures = 0
function check(name, ok, extra = '') {
  console.log(`${ok ? '  [通过]' : '  [失败]'} ${name} ${extra}`)
  if (!ok) failures++
}

/* ---------- 1. 进攻：黑有四连必须成五 ---------- */
console.log('\n=== 1. 进攻能力：黑四连应直接成五 ===')
{
  const stones = [[7, 3, BLACK], [7, 4, BLACK], [7, 5, BLACK], [7, 6, BLACK], [6, 3, WHITE], [6, 4, WHITE]]
  for (const lv of ['easy', 'medium', 'hard']) {
    const sol = buildSolution(lv, stones)
    const t = Date.now()
    const [r, c] = sol.minimaxSearch(BLACK)
    const grid = Array(N * N).fill(0)
    for (const [rr, cc, p] of stones) grid[idx(rr, cc)] = p
    grid[idx(r, c)] = BLACK
    check(`${lv}: 走 ${show(r, c)} 成五`, isFive(grid, r, c), `(${Date.now() - t}ms)`)
  }
}

/* ---------- 2. 防守：白必须堵黑的四 ---------- */
console.log('\n=== 2. 防守能力：对手冲四必须封堵 ===')
{
  const stones = [[7, 3, BLACK], [7, 4, BLACK], [7, 5, BLACK], [7, 6, BLACK], [7, 2, WHITE], [1, 1, WHITE]]
  for (const lv of ['easy', 'medium', 'hard']) {
    const sol = buildSolution(lv, stones)
    const t = Date.now()
    const [r, c] = sol.minimaxSearch(WHITE)
    check(`${lv}: 走 ${show(r, c)} 堵住 (7,7)`, r === 7 && c === 7, `(${Date.now() - t}ms)`)
  }
}

/* ---------- 3. 活三防守 ---------- */
console.log('\n=== 3. 活三防守：黑活三，白应封堵关键点 ===')
{
  const stones = [[7, 5, BLACK], [7, 6, BLACK], [7, 7, BLACK], [8, 8, WHITE], [1, 1, WHITE], [2, 2, BLACK]]
  for (const lv of ['easy', 'medium', 'hard']) {
    const sol = buildSolution(lv, stones)
    const t = Date.now()
    const [r, c] = sol.minimaxSearch(WHITE)
    const ok = r === 7 && (c === 4 || c === 8)
    check(`${lv}: 走 ${show(r, c)} 封堵活三 (7,4)/(7,8)`, ok, `(${Date.now() - t}ms)`)
  }
}

/* ---------- 4. 自我对弈耗时 ---------- */
console.log('\n=== 4. 自我对弈 30 手耗时统计 ===')
for (const lv of ['easy', 'medium', 'hard']) {
  const sol = makeSolution(lv)
  sol.init([])
  const grid = Array(N * N).fill(0)
  let player = BLACK
  const times = []
  let total = 0
  for (let step = 0; step < 30; step++) {
    const t = Date.now()
    const [r, c] = sol.minimaxSearch(player)
    const dt = Date.now() - t
    times.push(dt); total += dt
    if (r < 0) break
    sol.forward(r, c, player)
    grid[idx(r, c)] = player
    player ^= 1
  }
  const max = Math.max(...times)
  const avg = (total / times.length).toFixed(0)
  console.log(`  ${lv.padEnd(7)} 手数=${times.length}  总耗时=${total}ms  平均=${avg}ms  最慢=${max}ms`)
}
console.log('')
console.log(failures === 0 ? '全部用例通过' : `有 ${failures} 个用例失败`)
process.exit(failures === 0 ? 0 : 1)
