import test from 'node:test'
import assert from 'node:assert/strict'
import { auditAgainstSummary } from '../lib/audit.js'

const items = [
  { id: 1, kind: 'constraint', text: '不要改 tests/ 目录', seq: 10, turn: 2 },
  { id: 2, kind: 'constraint', text: '用 pnpm', seq: 11, turn: 2 },
]

test('flags a requirement the summary dropped', () => {
  const result = auditAgainstSummary('用户要求使用 pnpm 完成工作。', items)
  assert.deepEqual(result.lost.map((i) => i.id), [1])
  assert.deepEqual(result.survived.map((i) => i.id), [2])
})

test('keeps everything when the summary preserves it', () => {
  const result = auditAgainstSummary('不要修改 tests 目录；使用 pnpm。', items)
  assert.equal(result.lost.length, 0)
  assert.equal(result.survived.length, 2)
})

test('reports unmatchable items instead of guessing', () => {
  const result = auditAgainstSummary('随便什么', [{ id: 3, kind: 'constraint', text: '！！', seq: 1 }])
  assert.equal(result.unverifiable.length, 1)
  assert.equal(result.lost.length, 0)
})
