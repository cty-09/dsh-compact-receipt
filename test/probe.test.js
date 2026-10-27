import test from 'node:test'
import assert from 'node:assert/strict'
import { probeCompaction, estimateTokens } from '../lib/probe.js'

const extract = (text) => (/不要|别|必须/.test(text) ? [{ kind: 'constraint' }] : [])

test('estimates CJK and latin tokens', () => {
  assert.equal(estimateTokens('不要改'), 3)
  assert.equal(estimateTokens('abcdefgh'), 2)
})

test('pins commitments and skips chatter', () => {
  const result = probeCompaction([
    { seq: 1, text: '不要改 tests 目录' },
    { seq: 2, text: '好的谢谢' },
    { seq: 3, text: '今天天气不错我们聊聊别的' },
  ], extract)
  assert.equal(result.pinned, 1)
  assert.equal(result.scanned, 3)
  assert.ok(result.ratio > 0 && result.ratio < 1)
})
