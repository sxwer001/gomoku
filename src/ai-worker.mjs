/**
 * AI Worker：把搜索放到后台线程，保证棋盘动画与交互不掉帧。
 * 协议：
 *   收 { id, level, player, moves }
 *   发 { id, ok, r, c, ms } 或 { id, ok:false, ms, reason }
 */
import { searchMove } from './ai-core.mjs'

self.onmessage = (e) => {
  const msg = e.data
  if (!msg || msg.type !== 'move') return
  const { id, level, player, moves } = msg
  const res = searchMove(level, player, moves)
  self.postMessage({ id, ...res })
}
