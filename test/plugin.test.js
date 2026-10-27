import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, name, inject } from '../lib/index.js'

/** Minimal fake host: enough surface to exercise apply() without a live runtime. */
function harness() {
  const listeners = []
  const commands = new Map()
  const tools = new Map()
  const ctx = {
    on(type, fn) { listeners.push({ type, fn }) },
    commands: { register(def) { commands.set(def.name, def); return () => {} } },
    tools: { register(def) { tools.set(def.name, def); return () => {} } },
  }
  apply(ctx)
  return {
    commands,
    tools,
    send(type, session, event) {
      for (const l of listeners) if (l.type === type) l.fn(session, event)
    },
  }
}

const sessionFor = (id) => ({ id })
const session = sessionFor('sess-1')
const userMessage = (seq, text) => ({
  seq,
  time: 1_700_000_000_000,
  type: 'user/message',
  data: { role: 'user', id: `m${seq}`, source: { kind: 'user' }, content: [{ type: 'text', text }] },
})
const compaction = (seq, summary, shadowedSeqs) => ({
  seq,
  time: 1_700_000_100_000,
  type: 'compaction/summary',
  data: {
    compactionId: 'c1',
    summary: [{ type: 'text', text: summary }],
    shadowedSeqs,
    shadowedRange: { start: shadowedSeqs[0], end: shadowedSeqs[shadowedSeqs.length - 1] },
    shadowedTokenCount: 8200,
    provider: 'deepseek',
    model: 'deepseek-chat',
  },
})

test('registers a command and a tool', () => {
  const h = harness()
  assert.equal(name, 'compact-receipt')
  assert.ok(inject.includes('commands'))
  assert.ok(h.commands.has('contract'))
  assert.ok(h.tools.has('contract_report'))
})

test('end to end: a dropped requirement shows up as possibly lost', async () => {
  const h = harness()
  h.send('session/event', session, { type: 'turn/start', seq: 1, time: 1, data: { turn: 3 } })
  h.send('session/event', session, userMessage(2, '不要改 tests/ 目录，用 pnpm 不要用 npm'))
  h.send('session/event', session, compaction(3, '用户要求使用 pnpm 完成工作。', [2]))

  const answer = await h.commands.get('contract').handler({ agent: { session } })
  assert.equal(answer.kind, 'success')
  assert.match(answer.text, /疑似失落/)
  assert.match(answer.text, /tests/)
  assert.match(answer.text, /吃掉 1 条历史/)
})

test('end to end: a preserved requirement is not reported as lost', async () => {
  const h = harness()
  const session = sessionFor('sess-3')
  h.send('session/event', session, { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } })
  h.send('session/event', session, userMessage(2, '用 pnpm 不要用 npm'))
  h.send('session/event', session, compaction(3, '用户要求不要用 npm，改用 pnpm。', [2]))

  const answer = await h.commands.get('contract').handler({ agent: { session } })
  assert.match(answer.text, /疑似失落 0/)
  assert.match(answer.text, /存活 2/)
})

test('the agent-facing tool returns the same report', async () => {
  const h = harness()
  const session = sessionFor('sess-4')
  h.send('session/event', session, userMessage(2, '必须保留 API 兼容'))
  const result = await h.tools.get('contract_report').execute({}, { agent: { session }, signal: AbortSignal.timeout(1000) })
  assert.match(result.text, /API/)
})

test('ignores synthetic messages that are not from the human', async () => {
  const h = harness()
  const session = sessionFor('sess-5')
  const synthetic = userMessage(5, '不要改 tests/')
  synthetic.data.source = { kind: 'model' }
  h.send('session/event', session, synthetic)
  h.send('session/event', session, compaction(6, '无关摘要', [5]))
  const answer = await h.commands.get('contract').handler({ agent: { session } })
  assert.match(answer.text, /还没有发生过压缩/)
})
