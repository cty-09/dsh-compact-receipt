import test from 'node:test'
import assert from 'node:assert/strict'
import { CORPUS } from './corpus.js'
import { extractCommitments } from '../lib/extract.js'

/** Predicted pinned-label for one message, or 'chatter' when nothing is extracted. */
function predict(text) {
  const found = extractCommitments(text)
  return found.length > 0 ? found[0].kind : 'chatter'
}

/** Per-label precision/recall over the corpus. */
export function score(predictor) {
  const labels = ['constraint', 'decision', 'acceptance', 'chatter']
  const stats = Object.fromEntries(labels.map((l) => [l, { tp: 0, fp: 0, fn: 0 }]))
  for (const row of CORPUS) {
    const got = predictor(row.text)
    const want = row.label
    if (got === want) stats[want].tp += 1
    else {
      stats[want].fn += 1
      if (stats[got] !== undefined) stats[got].fp += 1
    }
  }
  const out = {}
  for (const l of labels) {
    const { tp, fp, fn } = stats[l]
    out[l] = {
      precision: tp + fp === 0 ? 1 : tp / (tp + fp),
      recall: tp + fn === 0 ? 1 : tp / (tp + fn),
    }
  }
  const correct = CORPUS.filter((r) => predictor(r.text) === r.label).length
  return { accuracy: correct / CORPUS.length, perLabel: out }
}

test('records the rule classifier baseline', () => {
  const result = score(predict)
  // Deliberately a low floor: this test exists to make the gap visible and to
  // fail if the rules regress, not to claim the classifier is good.
  assert.ok(result.accuracy >= 0.5, `accuracy dropped below 0.5: ${result.accuracy}`)
  console.log(`\nrule classifier accuracy: ${(result.accuracy * 100).toFixed(0)}%`)
  for (const [label, m] of Object.entries(result.perLabel)) {
    console.log(`  ${label.padEnd(11)} precision ${(m.precision * 100).toFixed(0)}%  recall ${(m.recall * 100).toFixed(0)}%`)
  }
})
