/**
 * Compare extracted commitments against the summary that replaced them.
 *
 * This is deliberately deterministic: the summary is a string, the commitments
 * are strings, and survival is a string-overlap question. No model call, so an
 * audit costs zero tokens and can run on every compaction.
 */
import { survivalScore } from './extract.js'

/** Below this overlap a commitment counts as "possibly lost". Tuned to prefer false alarms over silence. */
export const DEFAULT_THRESHOLD = 0.5

/**
 * @param {string} summaryText - text the model now sees instead of the compacted range.
 * @param {ReadonlyArray<{id: string, kind: string, text: string, seq: number, turn?: number}>} commitments
 * @param {{threshold?: number}} [options]
 * @returns {{survived: Array<object>, lost: Array<object>, unverifiable: Array<object>}}
 */
export function auditAgainstSummary(summaryText, commitments, options = {}) {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD
  const survived = []
  const lost = []
  const unverifiable = []
  for (const item of commitments) {
    const score = survivalScore(item.text, summaryText)
    if (score === null) {
      unverifiable.push({ ...item, score: null })
      continue
    }
    const row = { ...item, score: Math.round(score * 100) / 100 }
    if (score >= threshold) survived.push(row)
    else lost.push(row)
  }
  return { survived, lost, unverifiable }
}
