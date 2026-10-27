/**
 * Read-only classification probe.
 *
 * Before taking over compaction, answer one question honestly: if the plugin
 * pinned every message it classifies as a commitment, what would it pin, and
 * how much context would that cost?
 *
 * It records every user message by seq as it arrives, so a compaction can be
 * classified without reaching into session history.
 */

/** Rough token estimate: CJK 1 char ~ 1 token, latin ~ 4 chars per token. */
export function estimateTokens(text) {
  const s = String(text ?? '')
  let cjk = 0
  for (const ch of s) if (/[\u4e00-\u9fff]/.test(ch)) cjk += 1
  const latin = s.length - cjk
  return cjk + Math.ceil(latin / 4)
}

/** Type label for one shadowed message. */
export function classifyMessage(text, kinds) {
  if (kinds.length > 0) return kinds
  return ['chatter']
}

/**
 * Summarise what a pinned policy would have kept for one compaction.
 * @param {ReadonlyArray<{seq: number, text: string}>} shadowed - resolved source messages.
 * @param {(text: string) => Array<{kind: string}>} extract - commitment extractor.
 */
export function probeCompaction(shadowed, extract) {
  const rows = []
  let pinnedTokens = 0
  let totalTokens = 0
  for (const item of shadowed) {
    const tokens = estimateTokens(item.text)
    totalTokens += tokens
    const kinds = extract(item.text).map((c) => c.kind)
    const labels = classifyMessage(item.text, kinds)
    if (labels[0] !== 'chatter') {
      pinnedTokens += tokens
      rows.push({ seq: item.seq, labels, tokens, preview: item.text.slice(0, 60) })
    }
  }
  return {
    scanned: shadowed.length,
    pinned: rows.length,
    pinnedTokens,
    totalTokens,
    ratio: totalTokens === 0 ? 0 : pinnedTokens / totalTokens,
    rows,
  }
}
