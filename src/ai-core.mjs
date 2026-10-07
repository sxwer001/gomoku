/**
 * AI 核心：封装 @algorithm.ts/gomoku（MIT）的极小化极大 + Alpha-Beta 剪枝搜索。
 *
 * 该库的搜索是「宽度自适应 + 逐层加深」结构：
 *   NarrowSearcher 在浅层按候选分值决定是否交给更深一层的搜索器，
 *   只有在关键局面（出现四、活三之类的高分候选）才会把搜索推到很深的层数。
 * 因此耗时随局面变化较大：安静局面几十毫秒内返回，关键局面可能到几百毫秒。
 *
 * 本模块被两处复用：
 *   1) ai-worker.mjs —— 放进 Web Worker，界面完全不卡；
 *   2) app.mjs       —— 作为主线程兜底（例如 file:// 下 Worker 被浏览器限制时）。
 */
import { GomokuSolution, createGomokuSearcher, createScoreMap } from '@algorithm.ts/gomoku'

export const SIZE = 15

/** 棋盘侧使用的棋子编号 */
export const BLACK = 1
export const WHITE = 2

/** 库内部用 0 表示白、1 表示黑，这里做一次映射 */
export const toLib = (p) => (p === BLACK ? 1 : 0)

/** 库的棋型分值表：con[连子数][开放端数] */
const con = createScoreMap(5).con

/**
 * 三档难度。easy/medium 用自定义搜索器，hard 直接用库的默认配置
 * （默认配置为 2→4→8 层自适应，关键点可延伸到 16 层）。
 */
const PRESETS = {
  easy: {
    narrow: [
      { MAX_SEARCH_DEPTH: 1, MAX_CANDIDATE_COUNT: 4, MIN_PROMOTION_SCORE: Infinity, CANDIDATE_GROWTH_FACTOR: 4 },
    ],
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

export const LEVELS = ['easy', 'medium', 'hard']

function build(level) {
  const preset = PRESETS[level] ?? PRESETS.medium
  const props = {
    MAX_ROW: SIZE,
    MAX_COL: SIZE,
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

/** 按难度缓存引擎实例；每次搜索前用 init 重建棋局即可，避免状态漂移 */
const engines = new Map()
function engineFor(level) {
  if (!engines.has(level)) engines.set(level, build(level))
  return engines.get(level)
}

/**
 * 求解一步棋。
 * @param {string} level  难度
 * @param {number} player 轮到谁走（BLACK / WHITE）
 * @param {Array<{r:number,c:number,p:number}>} moves 已有棋子（按落子顺序）
 * @returns {{ok:boolean, r?:number, c?:number, ms:number, reason?:string}}
 */
export function searchMove(level, player, moves) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now()
  try {
    const sol = engineFor(level)
    sol.init([])
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i]
      sol.forward(m.r, m.c, toLib(m.p))
    }
    if (moves.length === 0) {
      // 开局空盘：库内部会回退到随机候选，这里直接下天元更自然
      return { ok: true, r: 7, c: 7, ms: 0 }
    }
    const [r, c] = sol.minimaxSearch(toLib(player))
    const ms = Math.round(((typeof performance !== 'undefined' ? performance : Date).now()) - t0)
    if (r < 0 || c < 0) return { ok: false, ms, reason: 'final' }
    return { ok: true, r, c, ms }
  } catch (err) {
    const ms = Math.round(((typeof performance !== 'undefined' ? performance : Date).now()) - t0)
    return { ok: false, ms, reason: String((err && err.message) || err) }
  }
}
