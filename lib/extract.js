/**
 * Deterministic extraction of "commitments" from human messages.
 *
 * A commitment is anything the user said that must still be true later:
 *   - constraint: "don't touch tests/", "use pnpm", "must keep the API stable"
 *   - decision:   "we'll go with plan B", "switch to decimal"
 *   - acceptance: "acceptance: npm test must pass"
 *
 * No model calls and no dependencies: every rule is a regular expression, so
 * extraction is free, fast, and reproducible.
 */

/** Marker -> what kind of commitment follows it. Order matters: first match wins per span. */
const RULES = [
  { kind: 'constraint', re: /(?:不要|别|不准|不许|禁止|严禁|勿|不可以|不能)\s*([^\n。！？；;，,]{2,50})/g },
  { kind: 'constraint', re: /(?:必须|务必|一定要|只能|统一(?:用|使用)|一律|记得|记住)\s*([^\n。！？；;，,]{2,50})/g },
  { kind: 'constraint', re: /(?:用|使用|改用|换成)\s*([A-Za-z][\w.@/-]{1,40})\s*[，,]?\s*(?:不要|别|不用|而不是)/g },
  { kind: 'constraint', re: /\b(?:don'?t|do not|never|must not|avoid|no need to)\s+([^\n.!?;]{3,70})/gi },
  { kind: 'constraint', re: /\b(?:must|only|always|make sure to|be sure to|remember to|keep)\s+([^\n.!?;]{3,70})/gi },
  { kind: 'decision', re: /(?:决定|就按|采用|最终(?:用|采用|选)|选用|确定(?:用|使用))\s*[:：]?\s*([^\n。！？；;，,]{2,50})/g },
  { kind: 'decision', re: /\b(?:we'?ll use|go with|decided to|let'?s use|switch to|opt for|settle on)\s+([^\n.!?;]{3,70})/gi },
  { kind: 'acceptance', re: /\b(?:acceptance(?: criteria)?|definition of done|done when)\s*[:：]?\s*([^\n.!?;]{3,70})/gi },
  { kind: 'acceptance', re: /(?:验收标准|验收要求|验收条件|要求是|必须通过|测试(?:要|必须)(?:过|通过)|通过标准)\s*[:：]?\s*([^\n。！？；]{2,70})/g },
]

/** Stronger labels win when one sentence matches several rule families. */
const KIND_PRIORITY = { acceptance: 0, decision: 1, constraint: 2 }

/** Words that carry no identity on their own, so they never become anchors. */
const STOPWORDS = new Set([
  'this', 'that', 'the', 'and', 'for', 'with', 'into', 'from', 'your', 'you', 'all', 'any',
  'not', 'use', 'using', 'must', 'only', 'always', 'keep', 'make', 'sure', 'avoid', 'never',
  '这个', '那个', '我们', '你们', '需要', '应该', '可以', '使用', '然后', '还有', '一下',
  '必须', '不要', '不能', '记得', '记住', '统一', '一定', '务必', '只能', '一律',
  '决定', '采用', '最终', '确定', '要求', '验收', '标准', '通过', '测试',
])

/** Strip everything but letters and digits so half-width/full-width and spacing cannot cause misses. */
export function normalize(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

/** English identifiers, paths, versions, and backticked literals: exact-match anchors. */
export function latinAnchors(text) {
  const out = new Set()
  for (const m of String(text ?? '').matchAll(/`([^`]{1,40})`/g)) out.add(m[1].trim())
  for (const m of String(text ?? '').matchAll(/[A-Za-z][A-Za-z0-9_.@/-]{1,39}/g)) out.add(m[0])
  return [...out].filter((s) => s.length >= 2 && !STOPWORDS.has(s.toLowerCase())).slice(0, 8)
}

/** Character bigrams for CJK, which tolerate rephrasing better than whole phrases. */
export function cjkBigrams(text) {
  const runs = String(text ?? '').match(/[\u4e00-\u9fff]{2,}/g) ?? []
  const out = new Set()
  for (const run of runs) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      const bg = run.slice(i, i + 2)
      if (!STOPWORDS.has(bg)) out.add(bg)
    }
  }
  return [...out].slice(0, 24)
}

/**
 * How much of one commitment survives in one summary.
 * @returns {number|null} 0..1, or null when the commitment has no matchable material.
 */
export function survivalScore(snippet, summary) {
  const latin = latinAnchors(snippet)
  const bigrams = cjkBigrams(snippet)
  if (latin.length === 0 && bigrams.length === 0) return null
  const haystack = normalize(summary)
  const latinHit = latin.filter((a) => haystack.includes(normalize(a))).length
  const bigramHit = bigrams.filter((b) => haystack.includes(b)).length
  const ratios = []
  if (latin.length > 0) ratios.push(latinHit / latin.length)
  if (bigrams.length > 0) ratios.push(bigramHit / bigrams.length)
  return ratios.reduce((a, b) => a + b, 0) / ratios.length
}

/**
 * Extract commitments from one human message.
 * @param {string} text - message text.
 * @param {{max?: number}} [options] - cap on returned items.
 * @returns {Array<{kind: string, text: string, marker: string}>}
 */
export function extractCommitments(text, options = {}) {
  const max = options.max ?? 12
  const body = String(text ?? '')
  if (body.length === 0) return []
  const found = []
  const seen = new Set()
  for (const rule of RULES) {
    for (const match of body.matchAll(rule.re)) {
      const snippet = (match[1] ?? '').trim()
      if (snippet.length < 2) continue
      const bare = normalize(snippet).replace(/^[是为:：]+/u, '')
      if (bare.length < 2 || STOPWORDS.has(bare)) continue
      // Split the match at the captured group so the marker is the literal lead-in,
      // not "everything that is not the tail".
      const at = match[0].indexOf(match[1])
      const lead = at >= 0 ? match[0].slice(0, at).trim() : ''
      const tail = snippet.replace(/^[是为:：\s]+/u, '')
      const glue = /[\u4e00-\u9fff]$/u.test(lead) && /^[\u4e00-\u9fff]/u.test(tail) ? '' : ' '
      const text = `${lead}${glue}${tail}`.trim()
      const key = `${rule.kind}:${normalize(text)}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push({ kind: rule.kind, text, marker: lead })
      if (found.length >= max) break
    }
  }
  // "验收标准是 X 必须通过" matches both the acceptance and the constraint rules;
  // the acceptance reading is the useful one, so it sorts first.
  return found
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (KIND_PRIORITY[a.item.kind] - KIND_PRIORITY[b.item.kind]) || (a.index - b.index))
    .map((row) => row.item)
}
