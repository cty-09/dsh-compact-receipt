/**
 * Compaction receipts for DeepSeek Harness.
 *
 * Long sessions get compacted, and compaction is lossy: the summary that
 * replaces an earlier range is the only thing the model keeps. This plugin
 * records what the user actually asked for, and after every compaction reports
 * which of those requirements the summary no longer contains.
 *
 * Everything here is deterministic — no model calls, no network, no extra
 * tokens. The audit compares strings, so it costs nothing and can run on every
 * compaction.
 *
 * @module dsh-compact-receipt
 */
import { extractCommitments } from './extract.js'
import { auditAgainstSummary } from './audit.js'
import { formatContractReport } from './report.js'

/** Cordis plugin name. */
export const name = 'compact-receipt'

/** Services this plugin registers into. Commands only: importing host runtime packages
 * would not resolve from a profile, so this plugin stays dependency-free. */
export const inject = ['commands']

/** Guards one pathological session from growing without bound. */
const MAX_COMMITMENTS = 400

/** Per-session state; sessions are independent and never share receipts. */
const sessions = new Map()

function stateOf(sessionId) {
  let state = sessions.get(sessionId)
  if (state === undefined) {
    state = { commitments: [], receipts: [], turn: 0, nextId: 1 }
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

/** Record the commitments in one human message. Synthetic notices are skipped. */
function onUserMessage(state, event) {
  const message = event.data
  if (message?.source?.kind !== 'user') return
  const text = textOf(message)
  if (text.length === 0) return
  for (const found of extractCommitments(text)) {
    // The same requirement restated later replaces nothing; keep both, the
    // newer one carries the newer source position.
    state.commitments.push({
      id: state.nextId++,
      kind: found.kind,
      text: found.text,
      seq: event.seq,
      turn: state.turn,
      status: 'active',
    })
  }
  if (state.commitments.length > MAX_COMMITMENTS) {
    state.commitments.splice(0, state.commitments.length - MAX_COMMITMENTS)
  }
}

/**
 * Audit the commitments that just went into a compaction against the summary
 * that replaced them, and keep a receipt for later inspection.
 */
function onCompaction(state, event) {
  const data = event.data
  const summaryText = textOf({ content: data.summary })
  const shadowed = new Set(data.shadowedSeqs ?? [])
  const affected = state.commitments.filter((item) => shadowed.has(item.seq))
  if (affected.length === 0) return
  const audit = auditAgainstSummary(summaryText, affected)
  const mark = (items, status) => {
    for (const item of items) {
      const target = state.commitments.find((c) => c.id === item.id)
      if (target !== undefined) target.status = status
    }
  }
  mark(audit.survived, 'survived')
  mark(audit.lost, 'lost')
  mark(audit.unverifiable, 'unverifiable')
  state.receipts.push({
    at: event.time,
    compactionId: data.compactionId,
    shadowedCount: shadowed.size,
    shadowedTokens: data.shadowedTokenCount ?? 0,
    total: affected.length,
    survived: audit.survived,
    lost: audit.lost,
    unverifiable: audit.unverifiable,
  })
}

/**
 * Register the session observer, the `/contract` command, and the agent-facing
 * report tool.
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
      onCompaction(stateOf(session.id), event)
    }
  })

  ctx.commands.register({
    definitionId: 'dsh-compact-receipt:contract',
    name: 'contract',
    description: 'Show what the last compaction dropped from your requirements',
    handler: (invocation) => {
      const sessionId = invocation.agent?.session?.id
      if (sessionId === undefined) return { kind: 'error', text: 'No active session.' }
      return { kind: 'success', text: formatContractReport(stateOf(sessionId)) }
    },
  })
}
