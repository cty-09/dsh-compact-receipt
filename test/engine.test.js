import test from 'node:test'
import assert from 'node:assert/strict'
import { withPinned, formatPinnedBlock, PINNED_HEADING } from '../lib/engine.js'

const c = (id, text, kind = 'constraint', turn = 1) => ({ id, text, kind, turn })

test('appends a verbatim pinned block to the summary', () => {
  const summary = [{ type: 'text', text: '之前的对话摘要。' }]
  const out = withPinned(summary, [c(1, '不要改 tests/ 目录')])
  assert.equal(out.length, 2)
  assert.equal(out[0].text, '之前的对话摘要。')
  assert.match(out[1].text, /不要改 tests\/ 目录/)
  assert.match(out[1].text, /压缩后仍有效的要求/)
})

test('leaves the summary untouched when nothing is in force', () => {
  const summary = [{ type: 'text', text: '摘要' }]
  assert.deepEqual(withPinned(summary, []), summary)
})

test('caps the pinned block so it cannot grow without bound', () => {
  const many = Array.from({ length: 40 }, (_, i) => c(i, `约束 ${i}`))
  const out = withPinned(summaryOf(), many, { maxItems: 24 })
  assert.equal((out[1].text.match(/- \[/g) ?? []).length, 24)
})

test('formats each item with its turn when known', () => {
  const block = formatPinnedBlock([c(1, '用 pnpm', 'decision', 7)])
  assert.match(block.text, /\[decision\] 用 pnpm（第 7 轮）/)
})

test('returns undefined for an empty list', () => {
  assert.equal(formatPinnedBlock([]), undefined)
  assert.equal(PINNED_HEADING, '## 压缩后仍有效的要求（逐字保留）')
})

function summaryOf() {
  return [{ type: 'text', text: '摘要' }]
}
