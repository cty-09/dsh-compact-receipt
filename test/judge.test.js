import test from 'node:test'
import assert from 'node:assert/strict'
import { buildJudgePrompt, parseVerdicts, judgeWithModel } from '../lib/judge.js'

const items = [
  { id: 1, kind: 'constraint', text: '我不想让你改 tests 目录', turn: 4 },
  { id: 2, kind: 'decision', text: '用 pnpm', turn: 2 },
]

test('prompt carries ids, kinds and the summary', () => {
  const p = buildJudgePrompt(items, '用户改用 npm 安装依赖。')
  assert.match(p, /id=1/)
  assert.match(p, /我不想让你改 tests 目录/)
  assert.match(p, /用户改用 npm 安装依赖/)
})

test('parses a plain JSON answer', () => {
  const map = parseVerdicts('{"verdicts":[{"id":1,"verdict":"lost","why":"summary ignores tests"},{"id":2,"verdict":"kept","why":""}]}', [1, 2])
  assert.equal(map.get(1).verdict, 'lost')
  assert.equal(map.get(2).verdict, 'kept')
})

test('survives code fences and surrounding prose', () => {
  const map = parseVerdicts('Here you go:\n```json\n{"verdicts":[{"id":1,"verdict":"kept","why":"ok"}]}\n```\nDone.', [1])
  assert.equal(map.get(1).verdict, 'kept')
})

test('rejects malformed or foreign answers', () => {
  assert.equal(parseVerdicts('no json here', [1]), undefined)
  assert.equal(parseVerdicts('{"verdicts":[{"id":9,"verdict":"kept"}]}', [1]), undefined)
  assert.equal(parseVerdicts('{"verdicts":[{"id":1,"verdict":"maybe"}]}', [1]), undefined)
})

test('judgeWithModel forwards the prompt and maps ids', async () => {
  let seen
  const answer = await judgeWithModel(
    async (prompt) => { seen = prompt; return '{"verdicts":[{"id":1,"verdict":"lost","why":"no tests mention"}]}' },
    items,
    '摘要',
  )
  assert.match(seen.system, /audit context compaction/)
  assert.match(seen.user, /id=2/)
  assert.equal(answer.get(1).verdict, 'lost')
})

test('judgeWithModel returns undefined instead of guessing', async () => {
  assert.equal(await judgeWithModel(async () => 'I cannot help', items, 'x'), undefined)
  assert.equal(await judgeWithModel(async () => '{}', [], 'x'), undefined)
})
