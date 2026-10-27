/**
 * Pinned compaction engine.
 *
 * The stock engine decides what to summarize and asks a model for a summary.
 * That summary is the only thing the model keeps, and nothing forces it to
 * carry the user's requirements.
 *
 * This subclass changes exactly one thing: after the stock summary comes back,
 * the requirements that are still in force are appended verbatim. Preservation
 * is therefore a property of the summary, not something judged after the fact.
 *
 * Every other behaviour (when to compact, which range, retention, checkpoints,
 * failure handling) stays the stock implementation's.
 */
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'

/** Heading that marks the pinned block inside the summary. */
export const PINNED_HEADING = '## 压缩后仍有效的要求（逐字保留）'

/** One line per requirement, compact enough to cost little. */
export function formatPinnedBlock(items) {
  if (items.length === 0) return undefined
  const lines = [PINNED_HEADING]
  for (const item of items) {
    const where = item.turn === undefined ? '' : `（第 ${item.turn} 轮）`
    lines.push(`- [${item.kind}] ${item.text}${where}`)
  }
  return { type: 'text', text: `\n\n${lines.join('\n')}` }
}

/**
 * Append the pinned block to a summary.
 * Pure function so the policy is testable without a host.
 * @param {ReadonlyArray<object>} summary - summary content blocks.
 * @param {ReadonlyArray<{kind: string, text: string, turn?: number}>} commitments - still-in-force requirements.
 * @param {{maxItems?: number}} [options]
 */
export function withPinned(summary, commitments, options = {}) {
  const maxItems = options.maxItems ?? 24
  const block = formatPinnedBlock(commitments.slice(-maxItems))
  if (block === undefined) return summary
  return [...summary, block]
}

/**
 * Stock engine with one overridden step.
 * @param {object} ctx - host context.
 * @param {object} config - same configuration the stock engine accepts.
 * @param {(sessionId: string) => ReadonlyArray<object>} readCommitments - source of in-force requirements.
 */
export function createPinnedEngine(ctx, config, readCommitments) {
  return class PinnedCompactionEngine extends BasicCompactionEngine {
    constructor(context, engineConfig = config ?? {}) {
      super(context, engineConfig)
      this.readCommitments = readCommitments
    }

    async summarize(input, agent, signal) {
      const summary = await super.summarize(input, agent, signal)
      let commitments = []
      try {
        commitments = this.readCommitments(agent?.session?.id) ?? []
      } catch {
        return summary
      }
      return withPinned(summary, commitments)
    }
  }
}
