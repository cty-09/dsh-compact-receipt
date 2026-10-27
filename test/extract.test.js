import test from 'node:test'
import assert from 'node:assert/strict'
import { extractCommitments, survivalScore, normalize, cjkBigrams } from '../lib/extract.js'

test('captures a negation with its object', () => {
  const [item] = extractCommitments('不要改 tests/ 目录')
  assert.equal(item.kind, 'constraint')
  assert.equal(item.text, '不要改 tests/ 目录')
})

test('keeps the preferred tool and the banned one apart', () => {
  const items = extractCommitments('用 pnpm 不要用 npm')
  const texts = items.map((i) => i.text)
  assert.ok(texts.includes('用 pnpm'), `expected "用 pnpm" in ${JSON.stringify(texts)}`)
  assert.ok(texts.some((t) => t.includes('npm') && t.startsWith('不要')), `expected banned npm in ${JSON.stringify(texts)}`)
})

test('separates decisions from constraints', () => {
  const items = extractCommitments('我们决定采用 decimal 方案')
  assert.equal(items[0].kind, 'decision')
  assert.match(items[0].text, /decimal/)
})

test('reads acceptance criteria', () => {
  const items = extractCommitments('验收标准是 npm test 必须通过')
  assert.equal(items[0].kind, 'acceptance')
})

test('ignores pure function words and empty input', () => {
  assert.deepEqual(extractCommitments(''), [])
  assert.deepEqual(extractCommitments('必须通过'), [])
})

test('handles English markers', () => {
  const items = extractCommitments("Don't touch the production database. We'll use pnpm.")
  const kinds = items.map((i) => i.kind)
  assert.ok(kinds.includes('constraint'))
  assert.ok(kinds.includes('decision'))
})

test('normalize folds width, case and punctuation', () => {
  assert.equal(normalize('ＡＢＣ—test_1'), 'abctest1')
})

test('dangerous bigrams are produced for Chinese text', () => {
  assert.ok(cjkBigrams('生产配置').includes('生产'))
})

test('survival score is 1 for an identical summary and low for an unrelated one', () => {
  assert.equal(survivalScore('不要改 tests/ 目录', '不要改 tests/ 目录'), 1)
  assert.ok(survivalScore('不要改 tests/ 目录', '今天我们讨论一下天气') < 0.3)
})
