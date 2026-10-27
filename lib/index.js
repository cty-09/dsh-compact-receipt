/**
 * Compaction receipts for DeepSeek Harness.
 *
 * Three jobs, all deterministic — no model calls, no extra dependencies:
 *
 * 1. Record what the user actually asked for (constraints, decisions, acceptance).
 * 2. After a compaction, audit the summary and inject a short visible notice
 *    listing what it dropped, so both the user and the model see the loss.
 * 3. Guard write-family tool calls against recorded "don't touch X" rules.
 *
 * @module dsh-compact-receipt
 */
import { extractCommitments } from './extract.js'
import { auditAgainstSummary } from './audit.js'
import { formatContractReport, formatNotice } from './report.js'
import { judgeWithModel } from './judge.js'
import { makeStreamText } from './llm.js'

/** Cordis plugin name. */
export const name = 'compact-receipt'

/** Services this plugin registers into. No host packages are imported: a profile
 * cannot resolve `@deepseek-ai/*`, so the plugin stays dependency-free. */
export const inject = ['commands', 'tools']

/** Guards one pathological session from growing without bound. */
const MAX_COMMITMENTS = 400

/** Tools whose arguments name a file the model is about to modify. */
const WRITE_TOOL = /(^|_)(write|edit|patch|replace|create|append|insert)(_|$)/i

/** Argument keys that carry the target path across DSH file tools. */
const PATH_KEYS = ['path', 'file_path', 'filePath', 'target', 'filename', 'file']

/** Per-session state; sessions are independent and never share receipts. */
const sessions = new Map()

/** Last agent seen per session, so a compaction can reach the chat surface. */
const agents = new Map()

function stateOf(sessionId) {
  let state = sessions.get(sessionId)
  if (state === undefined) {
    state = { commitments: [], receipts: [], turn: 0, nextId: 1, guard: true }
    sessions.set(sessionId, state)
  }
  return state
}

/** Visible text of one message, ignoring reasoning/tool blocks. */
function textOf(message) {
  const blocks = message?.content ?? []
  let out = ''
  for (const block of blocks) {
    if (block?.type === 'text' && typeof block.text === 'string') out += `${block.text}\n`
  }
  return out.trim()
}

/** A commitment that forbids something, rather than demanding it. */
function isProhibition(text) {
  return /^(不要|别|不准|不许|禁止|严禁|勿|不可以|不能|don'?t|do not|never|avoid)/i.test(text.trim())
}

/** Record the commitments in one human message. Synthetic notices are skipped. */
function onUserMessage(state, event) {
  const message = event.data
  if (message?.source?.kind !== 'user') return
  const text = textOf(message)
  if (text.length === 0) return
  for (const found of extractCommitments(text)) {
    state.commitments.push({
      id: state.nextId++,
      kind: found.kind,
      text: found.text,
      seq: event.seq,
      turn: state.turn,
      status: 'active',
      blocked: 0,
    })
  }
  if (state.commitments.length > MAX_COMMITMENTS) {
    state.commitments.splice(0, state.commitments.length - MAX_COMMITMENTS)
  }
}

/**
 * Audit the commitments that just went into a compaction, keep a receipt, and
 * tell the chat surface about the ones the summary dropped.
 */
async function onCompaction(state, sessionId, event, ctx) {
  const data = event.data
  const summaryText = textOf({ content: data.summary })
  const shadowed = new Set(data.shadowedSeqs ?? [])
  const affected = state.commitments.filter((item) => shadowed.has(item.seq))
  if (affected.length === 0) return
  let audit = auditAgainstSummary(summaryText, affected)
  let confident = false
  const agent = agents.get(sessionId)
  const streamText = agent === undefined ? undefined : makeStreamText(ctx, agent)
  if (streamText !== undefined) {
    try {
      const verdicts = await judgeWithModel(streamText, affected, summaryText)
      if (verdicts !== undefined) {
        const judged = { survived: [], lost: [], unverifiable: [] }
        for (const item of affected) {
          const row = verdicts.get(item.id)
          if (row === undefined) {
            // The model skipped this item: keep the deterministic verdict for it.
            const fallback = audit.survived.find((x) => x.id === item.id) ? 'survived'
              : audit.lost.find((x) => x.id === item.id) ? 'lost' : 'unverifiable'
            judged[fallback].push({ ...item, score: null, why: 'rule fallback' })
            continue
          }
          const bucket = row.verdict === 'kept' ? 'survived' : row.verdict === 'lost' ? 'lost' : 'unverifiable'
          judged[bucket].push({ ...item, score: null, why: row.why })
        }
        audit = judged
        confident = true
      }
    } catch {
      // Any failure keeps the deterministic result; the receipt is marked low confidence.
    }
  }
  const mark = (items, status) => {
    for (const item of items) {
      const target = state.commitments.find((c) => c.id === item.id)
      if (target !== undefined) target.status = status
    }
  }
  mark(audit.survived, 'survived')
  mark(audit.lost, 'lost')
  mark(audit.unverifiable, 'unverifiable')
  const receipt = {
    at: event.time,
    compactionId: data.compactionId,
    shadowedCount: shadowed.size,
    shadowedTokens: data.shadowedTokenCount ?? 0,
    confident,
    total: affected.length,
    survived: audit.survived,
    lost: audit.lost,
    unverifiable: audit.unverifiable,
  }
  state.receipts.push(receipt)
  announce(state, sessionId, receipt)
}

/**
 * Put the receipt in front of the user as a chat message. This is also the
 * cheapest possible repair: the lost requirements re-enter the model's context
 * as an ordinary user turn, so the agent sees them again.
 */
function announce(state, sessionId, receipt) {
  if (receipt.lost.length === 0) return
  const agent = agents.get(sessionId)
  if (agent === undefined) return
  try {
    agent.inject({
      id: `compact-receipt-${receipt.at}-${sessionId}`,
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: formatNotice(receipt) }],
    })
  } catch {
    // The agent may be mid-turn or already retired; the receipt is still kept.
  }
}

/** Target path named by a tool call, when it names one. */
function targetPath(args) {
  if (args === null || typeof args !== 'object') return undefined
  for (const key of PATH_KEYS) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/** Denial reason when a write-family call contradicts a recorded prohibition. */
function guardReason(state, execution) {
  if (state.guard !== true) return undefined
  if (!WRITE_TOOL.test(execution.name)) return undefined
  const path = targetPath(execution.arguments)
  if (path === undefined) return undefined
  const normalized = path.toLowerCase()
  for (const item of state.commitments) {
    if (item.status === 'lost' || item.status === 'unverifiable') continue
    if (item.blocked > 0) continue
    if (!isProhibition(item.text)) continue
    const anchors = item.text.match(/[A-Za-z0-9_][A-Za-z0-9_.@/-]{1,}|[\u4e00-\u9fff]{2,}/g) ?? []
    const hit = anchors.find((a) => a.length >= 2 && normalized.includes(a.toLowerCase()))
    if (hit === undefined) continue
    return `Blocked by compact-receipt: commit #${item.id} says "${item.text}" (turn ${item.turn}), and this call targets "${path}".\n`
      + 'Ask the user to confirm before changing it, or have them run /contract unblock ' + item.id + ' to lift this rule.'
  }
  return undefined
}

/** `/contract` subcommands: report (default), `unblock <id>`, `guard on|off`. */
function runCommand(state, rawInput) {
  const words = String(rawInput ?? '').trim().split(/\s+/).filter(Boolean)
  const sub = words[0] ?? ''
  if (sub === 'unblock') {
    const id = Number(words[1])
    const item = state.commitments.find((c) => c.id === id)
    if (item === undefined) return { kind: 'error', text: `No commitment #${words[1]}.` }
    item.blocked = (item.blocked ?? 0) + 1
    return { kind: 'success', text: `Commitment #${id} will no longer block tool calls: ${item.text}` }
  }
  if (sub === 'guard') {
    const mode = words[1] ?? 'on'
    state.guard = mode !== 'off'
    return { kind: 'success', text: `Guard is now ${state.guard ? 'on' : 'off'}.` }
  }
  return { kind: 'success', text: formatContractReport(state) }
}

/**
 * Register the session observer, the tool guard, and the `/contract` command.
 * @param ctx - Cordis context of the composed host.
 */
export function apply(ctx) {
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start') {
      stateOf(session.id).turn = event.data.turn
      return
    }
    if (event.type === 'user/message') {
      onUserMessage(stateOf(session.id), event)
      return
    }
    if (event.type === 'compaction/summary') {
      onCompaction(stateOf(session.id), session.id, event, ctx).catch(() => {})
    }
  })

  ctx.tools.guard((execution) => {
    const session = execution.agent?.session
    if (session === undefined) return undefined
    agents.set(session.id, execution.agent)
    return guardReason(stateOf(session.id), execution)
  })

  ctx.commands.register({
    definitionId: 'dsh-compact-receipt:contract',
    name: 'contract',
    description: 'Show what the last compaction dropped, or manage the guard',
    handler: (invocation) => {
      const session = invocation.agent?.session
      if (session === undefined) return { kind: 'error', text: 'No active session.' }
      agents.set(session.id, invocation.agent)
      return runCommand(stateOf(session.id), invocation.rawInput)
    },
  })
}
