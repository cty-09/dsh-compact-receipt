import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, name, inject } from '../lib/index.js'

/** Minimal fake host: enough surface to exercise apply() without a live runtime. */
function harness() {
  const listeners = []
  const commands = new Map()
  const guards = []
  const injected = []
  const ctx = {
    on(type, fn) { listeners.push({ type, fn }) },
    commands: { register(def) { commands.set(def.name, def); return () => {} } },
    tools: { guard(fn) { guards.push(fn); return () => {} } },
  }
  apply(ctx)
  return {
    commands,
    guards,
    injected,
    send(type, session, event) {
      for (const l of listeners) if (l.type === type) l.fn(session, event)
    },
  }
}

const sessionFor = (id) => ({ id })

function fakeAgent(id, sink) {
  return {
    session: { id },
    inject(message) { sink.push(message) },
  }
}

const userMessage = (seq, text, kind = 'user') => ({
  seq,
  time: 1_700_000_000_000,
  type: 'user/message',
  data: { role: 'user', id: `m${seq}`, source: { kind }, content: [{ type: 'text', text }] },
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
  },
})

const writeCall = (h, sessionId, args) => ({
  name: 'write',
  arguments: args,
  agent: { session: { id: sessionId }, inject(message) { h.injected.push(message) } },
})

test('registers the contract command and one guard', () => {
  const h = harness()
  assert.equal(name, 'compact-receipt')
  assert.ok(inject.includes('commands') && inject.includes('tools'))
  assert.ok(h.commands.has('contract'))
  assert.equal(h.guards.length, 1)
})

test('a dropped requirement is reported and announced in the chat', async () => {
  const h = harness()
  const session = sessionFor('sess-a')
  h.send('session/event', session, { type: 'turn/start', seq: 1, time: 1, data: { turn: 3 } })
  h.send('session/event', session, userMessage(2, '不要改 tests/ 目录，用 pnpm 不要用 npm'))
  // The guard is what publishes the agent to the plugin.
  h.guards[0](writeCall(h, 'sess-a', { path: 'src/app.ts' }))
  h.send('session/event', session, compaction(3, '用户要求使用 pnpm 完成工作。', [2]))

  const answer = await h.commands.get('contract').handler({ agent: { session }, rawInput: '' })
  assert.match(answer.text, /疑似失落/)
  assert.match(answer.text, /tests/)
  assert.equal(h.injected.length, 1)
  assert.match(h.injected[0].content[0].text, /压缩收据/)
  assert.match(h.injected[0].content[0].text, /tests/)
})

test('a preserved requirement produces no notice', () => {
  const h = harness()
  const session = sessionFor('sess-b')
  h.send('session/event', session, userMessage(2, '用 pnpm 不要用 npm'))
  h.guards[0](writeCall(h, 'sess-b', { path: 'src/app.ts' }))
  h.send('session/event', session, compaction(3, '用户要求不要用 npm，改用 pnpm。', [2]))
  assert.equal(h.injected.length, 0)
})

test('the guard blocks a write against a recorded prohibition', () => {
  const h = harness()
  const session = sessionFor('sess-c')
  h.send('session/event', session, userMessage(2, '不要改 tests/ 目录'))
  const denial = h.guards[0](writeCall(h, 'sess-c', { path: 'tests/unit/app.test.ts' }))
  assert.ok(typeof denial === 'string')
  assert.match(denial, /Blocked by compact-receipt/)
  assert.match(denial, /unblock/)
})

test('the guard allows unrelated paths and non-write tools', () => {
  const h = harness()
  const session = sessionFor('sess-d')
  h.send('session/event', session, userMessage(2, '不要改 tests/ 目录'))
  assert.equal(h.guards[0](writeCall(h, 'sess-d', { path: 'src/app.ts' })), undefined)
  assert.equal(h.guards[0]({ name: 'read', arguments: { path: 'tests/a.ts' }, agent: { session } }), undefined)
})

test('/contract unblock lifts a specific rule', async () => {
  const h = harness()
  const session = sessionFor('sess-e')
  h.send('session/event', session, userMessage(2, '不要改 tests/ 目录'))
  const blocked = h.guards[0](writeCall(h, 'sess-e', { path: 'tests/a.ts' }))
  assert.ok(blocked)
  const id = Number(blocked.match(/#(\d+)/)[1])
  await h.commands.get('contract').handler({ agent: { session }, rawInput: `unblock ${id}` })
  assert.equal(h.guards[0](writeCall(h, 'sess-e', { path: 'tests/a.ts' })), undefined)
})

test('/contract guard off disables blocking', async () => {
  const h = harness()
  const session = sessionFor('sess-f')
  h.send('session/event', session, userMessage(2, '不要改 tests/ 目录'))
  await h.commands.get('contract').handler({ agent: { session }, rawInput: 'guard off' })
  assert.equal(h.guards[0](writeCall(h, 'sess-f', { path: 'tests/a.ts' })), undefined)
})

test('ignores synthetic messages that are not from the human', async () => {
  const h = harness()
  const session = sessionFor('sess-g')
  h.send('session/event', session, userMessage(5, '不要改 tests/', 'model'))
  h.send('session/event', session, compaction(6, '无关摘要', [5]))
  const answer = await h.commands.get('contract').handler({ agent: { session }, rawInput: '' })
  assert.match(answer.text, /还没有发生过压缩/)
})

test('probe reports what a pinned policy would keep, without changing anything', async () => {
  const h = harness()
  const session = sessionFor('sess-probe')
  const turn = (n) => h.send('session/event', session, { type: 'turn/start', seq: n, time: n, data: { turn: n } })
  turn(1)
  h.send('session/event', session, userMessage(10, '帮我看看这个项目的结构'))
  h.send('session/event', session, userMessage(11, '不要改 tests/ 目录下的任何文件'))
  h.send('session/event', session, userMessage(12, '好的谢谢，辛苦了'))
  h.send('session/event', session, userMessage(13, '我们决定采用 pnpm 作为包管理器'))
  h.send('session/event', session, compaction(20, '用户查看了项目结构，并确认使用 pnpm。', [10, 11, 12, 13]))

  const answer = await h.commands.get('contract').handler({ agent: { session }, rawInput: 'probe' })
  assert.match(answer.text, /扫描 4 条/)
  assert.match(answer.text, /会被钉住 2 条/)
  assert.match(answer.text, /不要改 tests/)
  assert.match(answer.text, /只读探测/)
})

test('a successful injection is confirmed by its echo on the event stream', async () => {
  const h = harness()
  const session = sessionFor('sess-deliver')
  h.send('session/event', session, userMessage(2, '不要改 tests/ 目录'))
  const agent = { session, inject(message) { h.injected.push(message) } }
  h.guards[0](writeCall(h, 'sess-deliver', { path: 'src/app.ts' }))
  h.send('session/event', session, compaction(3, '用户要求修改部分代码。', [2]))
  assert.equal(h.injected.length, 1)
  const injectedId = h.injected[0].id
  assert.match(injectedId, /^compact-receipt-/)

  const before = await h.commands.get('contract').handler({ agent, rawInput: '' })
  assert.match(before.text, /补回待确认/)

  // The host echoes the injected message back through session/event.
  h.send('session/event', session, {
    seq: 4, time: 5, type: 'user/message',
    data: { role: 'user', id: injectedId, source: { kind: 'user' }, content: h.injected[0].content },
  })
  const after = await h.commands.get('contract').handler({ agent, rawInput: '' })
  assert.match(after.text, /已补回并确认到达/)
})
