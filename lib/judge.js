/**
 * Semantic judgement of what a compaction kept.
 *
 * The deterministic scorer in audit.js is a fallback: it compares strings and
 * cannot tell "don't touch tests/" from "tests were modified". This module asks
 * the model, once per compaction, which recorded commitments the summary no
 * longer carries.
 *
 * The model call is injected as `streamText`, so the host's exact streaming
 * shape stays in one adapter and the judgement itself is testable without a key.
 */

const SYSTEM = [
  'You audit context compaction in a coding agent.',
  'You are given (a) commitments the user made earlier and (b) the summary that replaced the history containing them.',
  'For every commitment decide one verdict:',
  '  "kept"    - the summary still states it, even if reworded or translated',
  '  "lost"    - the summary no longer carries it',
  '  "unclear" - the summary is too vague to tell',
  'Be strict about meaning, not wording. A summary that says "user prefers pnpm" keeps "不要用 npm".',
  'Reply with JSON only, no prose, no code fence:',
  '{"verdicts":[{"id":<number>,"verdict":"kept|lost|unclear","why":"<max 12 words>"}]}',
].join('\n')

/** Prompt text for one compaction judgement. */
export function buildJudgePrompt(commitments, summaryText) {
  const items = commitments
    .map((c) => `- id=${c.id} [${c.kind}] ${c.text}${c.turn === undefined ? '' : ` (turn ${c.turn})`}`)
    .join('\n')
  return [
    '## Commitments made by the user',
    items,
    '',
    '## Summary that replaced them',
    summaryText,
    '',
    'Return every id above exactly once, with a verdict.',
  ].join('\n')
}

/** Tolerant JSON extraction: models occasionally wrap JSON in prose or fences. */
export function parseVerdicts(text, ids) {
  const raw = String(text ?? '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  let parsed
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return undefined
  }
  const list = Array.isArray(parsed?.verdicts) ? parsed.verdicts : undefined
  if (list === undefined) return undefined
  const allowed = new Set(['kept', 'lost', 'unclear'])
  const wanted = new Set(ids.map(String))
  const out = new Map()
  for (const row of list) {
    const id = String(row?.id ?? '')
    const verdict = String(row?.verdict ?? '').toLowerCase()
    if (!wanted.has(id) || !allowed.has(verdict)) continue
    out.set(Number(id), { verdict, why: typeof row.why === 'string' ? row.why.slice(0, 120) : '' })
  }
  return out.size > 0 ? out : undefined
}

/**
 * Ask the model which commitments survived.
 * @param {(prompt: {system: string, user: string}) => Promise<string>} streamText - injected host call.
 * @param {ReadonlyArray<{id: number, kind: string, text: string, turn?: number}>} commitments
 * @param {string} summaryText
 * @returns {Promise<Map<number, {verdict: string, why: string}>|undefined>} undefined when the model answer is unusable.
 */
export async function judgeWithModel(streamText, commitments, summaryText) {
  if (commitments.length === 0) return undefined
  const user = buildJudgePrompt(commitments, summaryText)
  const answer = await streamText({ system: SYSTEM, user })
  return parseVerdicts(answer, commitments.map((c) => c.id))
}
