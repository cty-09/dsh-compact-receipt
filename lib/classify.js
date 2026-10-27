/**
 * Semantic classification of user messages into pinned-policy labels.
 *
 * The rule extractor is the fallback; this is the primary path when a model is
 * reachable. Batching keeps it to one request per batch of messages instead of
 * one per message.
 */

const SYSTEM = [
  'You label user messages from a coding session so a context-compaction policy knows what must never be dropped.',
  'Labels:',
  '  constraint - a rule the work must obey (do not touch X, use Y, keep Z stable)',
  '  decision   - a chosen approach or technology',
  '  acceptance - a definition of done or acceptance criterion',
  '  chatter    - anything else',
  'Judge meaning, not keywords: postposed and implicit forms count ("tests 目录先别碰" is a constraint).',
  'Reply with JSON only: {"items":[{"id":<number>,"label":"constraint|decision|acceptance|chatter"}]}',
].join('\n')

/** Prompt for one batch. Ids must be unambiguous integers. */
export function buildClassifyPrompt(batch) {
  return [
    'Label every message. Return every id exactly once.',
    ...batch.map((row) => `- id=${row.id} ${JSON.stringify(row.text).slice(0, 400)}`),
  ].join('\n')
}

/** Parse labels, ignoring anything unrecognized. */
export function parseLabels(text, ids) {
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
  const list = Array.isArray(parsed?.items) ? parsed.items : undefined
  if (list === undefined) return undefined
  const allowed = new Set(['constraint', 'decision', 'acceptance', 'chatter'])
  const wanted = new Set(ids.map(String))
  const out = new Map()
  for (const row of list) {
    const id = String(row?.id ?? '')
    const label = String(row?.label ?? '').toLowerCase()
    if (!wanted.has(id) || !allowed.has(label)) continue
    out.set(Number(id), label)
  }
  return out.size > 0 ? out : undefined
}

/**
 * Classify a batch of messages through an injected streaming call.
 * @param {(prompt: {system: string, user: string}) => Promise<string>} streamText
 * @param {ReadonlyArray<{id: number, text: string}>} batch
 * @returns {Promise<Map<number, string>|undefined>}
 */
export async function classifyBatch(streamText, batch) {
  if (batch.length === 0) return undefined
  const answer = await streamText({ system: SYSTEM, user: buildClassifyPrompt(batch) })
  return parseLabels(answer, batch.map((r) => r.id))
}
