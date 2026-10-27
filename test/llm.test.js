import test from 'node:test'
import assert from 'node:assert/strict'
import { makeStreamText, resolveRoute } from '../lib/llm.js'
import { apply } from '../lib/index.js'

const fakeLlm = (answer) => ({
  stream() {
    return (async function* () {
      yield { type: 'text-delta', text: answer.slice(0, 10) }
      yield { type: 'text-delta', text: answer.slice(10) }
    })()
  },
})

const agent = (injected = []) => ({
  options: { provider: 'deepseek', model: 'deepseek-chat' },
  session: { id: 'sess-llm' },
  inject(m) { injected.push(m) },
})

test('resolves the route from agent options', () => {
  assert.deepEqual(resolveRoute(agent()), { provider: 'deepseek', model: 'deepseek-chat' })
  assert.equal(resolveRoute({ session: {} }), undefined)
})

test('returns undefined instead of throwing when the host cannot route', () => {
  assert.equal(makeStreamText({}, agent()), undefined)
  assert.equal(makeStreamText({ llm: fakeLlm('{}') }, { session: {} }), undefined)
})

test('accumulates text-delta chunks', async () => {
  const streamText = makeStreamText({ llm: fakeLlm('hello world') }, agent())
  assert.equal(await streamText({ system: 's', user: 'u' }), 'hello world')
})

// KNOWN GAP: extraction still runs on rules, so a sentence the rules miss never
// reaches the judge. Closing this needs the compaction path to hand the shadowed
// user text to the model for extraction, which needs session-log access by seq.
test.skip('a model verdict covers a commitment the rules cannot extract', async () => {
  const injected = []
  const a = agent(injected)
  const listeners = []
  const commands = new Map()
  apply({
    on: (t, fn) => listeners.push({ t, fn }),
    commands: { register: (d) => { commands.set(d.name, d); return () => {} } },
    tools: { guard: () => () => {} },
    llm: fakeLlm('{"verdicts":[{"id":1,"verdict":"lost","why":"summary only says pnpm"}]}'),
  })
  const send = (ev) => { for (const l of listeners) if (l.t === 'session/event') l.fn(a.session, ev) }
  send({ type: 'user/message', seq: 1, time: 1, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '我不想让你改 tests 目录' }] } })
  // The rule engine cannot extract this sentence at all; only the model sees it.
  send({ type: 'compaction/summary', seq: 2, time: 2, data: { compactionId: 'c', summary: [{ type: 'text', text: '用户使用 pnpm。' }], shadowedSeqs: [1], shadowedTokenCount: 100 } })
  await new Promise((r) => setTimeout(r, 10))
  const answer = await commands.get('contract').handler({ agent: a, rawInput: '' })
  assert.match(answer.text, /语义判定/)
  assert.match(answer.text, /还没有发生过压缩|契约 0 条/)
})

test('classification catches a phrasing the rules miss, then the judge scores it', async () => {
  const injected = []
  const agentLike = {
    options: { provider: 'deepseek', model: 'deepseek-chat' },
    session: { id: 'sess-cls' },
    inject: (m) => injected.push(m),
  }
  const listeners = []
  const commands = new Map()
  let guards
  const router = (options) => (options.system.toLowerCase().includes('label user messages')
    ? '{"items":[{"id":7,"label":"constraint"}]}'
    : '{"verdicts":[{"id":1,"verdict":"lost","why":"summary never mentions tests"}]}')
  apply({
    on: (t, fn) => listeners.push({ t, fn }),
    commands: { register: (d) => { commands.set(d.name, d); return () => {} } },
    tools: { guard: (fn) => { guards = fn; return () => {} } },
    llm: { stream: (options) => (async function* () { yield { type: 'text-delta', text: router(options) } })() },
  })
  // Publish the agent the way the surface does: through the guard.
  guards({ name: 'read', arguments: { path: 'a.ts' }, agent: agentLike })
  const send = (ev) => { for (const l of listeners) if (l.t === 'session/event') l.fn(agentLike.session, ev) }
  send({ type: 'user/message', seq: 7, time: 1, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'tests 目录先别碰' }] } })
  send({ type: 'compaction/summary', seq: 8, time: 2, data: { compactionId: 'c', summary: [{ type: 'text', text: '用户要求修改代码。' }], shadowedSeqs: [7], shadowedTokenCount: 50 } })
  await new Promise((r) => setTimeout(r, 20))
  const answer = await commands.get('contract').handler({ agent: agentLike, rawInput: '' })
  assert.match(answer.text, /tests 目录先别碰/)
  assert.match(answer.text, /语义判定/)
})
