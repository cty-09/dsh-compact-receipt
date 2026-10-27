/** Human-facing rendering. Plain text, no ANSI, works in every command surface. */

const KIND_LABEL = { constraint: '约束', decision: '决策', acceptance: '验收' }

/** `1234` -> `1.2k`; keeps receipts one line wide. */
export function tokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(n)
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1000000).toFixed(1)}M`
}

/** Local wall-clock time; receipts are read by humans looking at their own day. */
export function clock(ms) {
  const d = new Date(ms)
  const p = (v) => String(v).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function kindLabel(kind) {
  return KIND_LABEL[kind] ?? kind
}

/**
 * One compaction receipt.
 * @param {object} receipt
 * @param {number} index - 1-based position in the session's receipt list.
 */
export function formatReceipt(receipt, index) {
  const lines = []
  lines.push(`收据 #${index} · ${clock(receipt.at)} · 吃掉 ${receipt.shadowedCount} 条历史 (~${tokens(receipt.shadowedTokens)} tokens)`)
  lines.push(`  ${receipt.confident ? '语义判定' : '规则判定'} · 契约 ${receipt.total} 条 · 存活 ${receipt.survived.length} · 疑似失落 ${receipt.lost.length}` +
    (receipt.unverifiable.length ? ` · 无法判定 ${receipt.unverifiable.length}` : ''))
  if (receipt.lost.length > 0) {
    lines.push('')
    lines.push('  ⚠️ 疑似失落（摘要里找不到这些要求，建议确认）:')
    receipt.lost.forEach((item, i) => {
      const where = item.turn !== undefined ? ` · 第 ${item.turn} 轮` : ''
      lines.push(`   ${i + 1}. [${kindLabel(item.kind)}] ${item.text}${where}`)
    })
  }
  return lines.join('\n')
}

/** Full `/contract` answer: recent receipts, then commitments still in force. */
export function formatContractReport(state) {
  const lines = []
  if (state.receipts.length === 0) {
    lines.push(`还没有发生过压缩。当前会话已记录 ${state.commitments.length} 条契约。`)
  } else {
    lines.push(`本会话共压缩 ${state.receipts.length} 次，最近一次：`)
    lines.push('')
    lines.push(formatReceipt(state.receipts[state.receipts.length - 1], state.receipts.length))
  }
  const stillActive = state.commitments.filter((c) => c.status === 'active')
  if (stillActive.length > 0) {
    lines.push('')
    lines.push(`仍在生效的契约 ${stillActive.length} 条（尚未经历压缩）:`)
    stillActive.slice(-12).forEach((item) => {
      const where = item.turn !== undefined ? ` · 第 ${item.turn} 轮` : ''
      lines.push(`  · [${kindLabel(item.kind)}] ${item.text}${where}`)
    })
    if (stillActive.length > 12) lines.push(`  … 另有 ${stillActive.length - 12} 条`)
  }
  const lostTotal = state.receipts.reduce((sum, r) => sum + r.lost.length, 0)
  const survivedTotal = state.receipts.reduce((sum, r) => sum + r.survived.length, 0)
  if (survivedTotal + lostTotal > 0) {
    lines.push('')
    lines.push(`累计存活率: ${Math.round((survivedTotal / (survivedTotal + lostTotal)) * 100)}% (${survivedTotal}/${survivedTotal + lostTotal})`)
  }
  return lines.join('\n')
}

/**
 * The chat-visible card injected after a lossy compaction. Kept short: every
 * token here is a token the session pays, so it only lists what was lost.
 */
export function formatNotice(receipt) {
  const lines = ['📋 压缩收据 — 这次压缩丢掉了你之前的要求:']
  receipt.lost.slice(0, 3).forEach((item, i) => {
    const where = item.turn !== undefined ? `，第 ${item.turn} 轮` : ''
    lines.push(`${i + 1}. [${kindLabel(item.kind)}] ${item.text}${where}`)
  })
  if (receipt.lost.length > 3) lines.push(`… 另有 ${receipt.lost.length - 3} 条`)
  lines.push('请继续遵守以上要求；输入 /contract 查看完整收据。')
  return lines.join('\n')
}

/**
 * What a pinned-layer policy would have kept for the most recent compaction.
 * This is a measurement, not a promise: it changes nothing about the session.
 */
export function formatProbeReport(probe) {
  if (probe === undefined) return '还没有发生过压缩，没有可探测的数据。'
  const pct = Math.round(probe.ratio * 100)
  const lines = [
    `探针（最近一次压缩）· 扫描 ${probe.scanned} 条 · 会被钉住 ${probe.pinned} 条`,
    `钉住体量 ~${probe.pinnedTokens} tokens / 被遮蔽 ~${probe.totalTokens} tokens（占 ${pct}%）`,
  ]
  if (probe.rows.length > 0) {
    lines.push('')
    probe.rows.slice(0, 10).forEach((row) => {
      lines.push(`  · [${row.labels.join('/')}] ~${row.tokens}t ${row.preview}`)
    })
    if (probe.rows.length > 10) lines.push(`  … 另有 ${probe.rows.length - 10} 条`)
  }
  lines.push('')
  lines.push('只读探测：当前压缩行为没有任何改变。')
  return lines.join('\n')
}
