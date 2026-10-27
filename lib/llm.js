/**
 * Host LLM adapter.
 *
 * Everything the host's streaming API needs to be true about is concentrated
 * here: which route to use, how options are shaped, how text is accumulated.
 * Callers get a plain `streamText({system,user}) => Promise<string>`.
 */

/** Candidate locations for the routed provider/model of one agent. */
export function resolveRoute(agent) {
  const candidates = [agent?.options, agent?.routing, agent?.session?.options]
  for (const source of candidates) {
    const provider = source?.provider
    const model = source?.model
    if (typeof provider === 'string' && provider.length > 0 && typeof model === 'string' && model.length > 0) {
      return { provider, model }
    }
  }
  return undefined
}

/**
 * Build the injected `streamText` for one agent, or undefined when this host
 * cannot route a request (no service, no known route).
 * @param {object} ctx - host context carrying `llm`.
 * @param {object} agent - agent whose route the call should use.
 * @param {{maxTokens?: number}} [options]
 */
export function makeStreamText(ctx, agent, options = {}) {
  const llm = ctx?.llm
  if (typeof llm?.stream !== 'function') return undefined
  const route = resolveRoute(agent)
  if (route === undefined) return undefined
  const maxTokens = options.maxTokens ?? 600
  return async function streamText({ system, user }) {
    let out = ''
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
      maxTokens,
    })
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
    }
    return out
  }
}
