// lib/extract.js
var RULES = [
  { kind: "constraint", re: /(?:不要|别|不准|不许|禁止|严禁|勿|不可以|不能)\s*([^\n。！？；;，,]{2,50})/g },
  { kind: "constraint", re: /(?:必须|务必|一定要|只能|统一(?:用|使用)|一律|记得|记住)\s*([^\n。！？；;，,]{2,50})/g },
  { kind: "constraint", re: /(?:用|使用|改用|换成)\s*([A-Za-z][\w.@/-]{1,40})\s*[，,]?\s*(?:不要|别|不用|而不是)/g },
  { kind: "constraint", re: /\b(?:don'?t|do not|never|must not|avoid|no need to)\s+([^\n.!?;]{3,70})/gi },
  { kind: "constraint", re: /\b(?:must|only|always|make sure to|be sure to|remember to|keep)\s+([^\n.!?;]{3,70})/gi },
  { kind: "decision", re: /(?:决定|就按|采用|最终(?:用|采用|选)|选用|确定(?:用|使用))\s*[:：]?\s*([^\n。！？；;，,]{2,50})/g },
  { kind: "decision", re: /\b(?:we'?ll use|go with|decided to|let'?s use|switch to|opt for|settle on)\s+([^\n.!?;]{3,70})/gi },
  { kind: "acceptance", re: /\b(?:acceptance(?: criteria)?|definition of done|done when)\s*[:：]?\s*([^\n.!?;]{3,70})/gi },
  { kind: "acceptance", re: /(?:验收标准|验收要求|验收条件|要求是|必须通过|测试(?:要|必须)(?:过|通过)|通过标准)\s*[:：]?\s*([^\n。！？；]{2,70})/g }
];
var KIND_PRIORITY = { acceptance: 0, decision: 1, constraint: 2 };
var STOPWORDS = /* @__PURE__ */ new Set([
  "this",
  "that",
  "the",
  "and",
  "for",
  "with",
  "into",
  "from",
  "your",
  "you",
  "all",
  "any",
  "not",
  "use",
  "using",
  "must",
  "only",
  "always",
  "keep",
  "make",
  "sure",
  "avoid",
  "never",
  "\u8FD9\u4E2A",
  "\u90A3\u4E2A",
  "\u6211\u4EEC",
  "\u4F60\u4EEC",
  "\u9700\u8981",
  "\u5E94\u8BE5",
  "\u53EF\u4EE5",
  "\u4F7F\u7528",
  "\u7136\u540E",
  "\u8FD8\u6709",
  "\u4E00\u4E0B",
  "\u5FC5\u987B",
  "\u4E0D\u8981",
  "\u4E0D\u80FD",
  "\u8BB0\u5F97",
  "\u8BB0\u4F4F",
  "\u7EDF\u4E00",
  "\u4E00\u5B9A",
  "\u52A1\u5FC5",
  "\u53EA\u80FD",
  "\u4E00\u5F8B",
  "\u51B3\u5B9A",
  "\u91C7\u7528",
  "\u6700\u7EC8",
  "\u786E\u5B9A",
  "\u8981\u6C42",
  "\u9A8C\u6536",
  "\u6807\u51C6",
  "\u901A\u8FC7",
  "\u6D4B\u8BD5"
]);
function normalize(text) {
  return String(text ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
function latinAnchors(text) {
  const out = /* @__PURE__ */ new Set();
  for (const m of String(text ?? "").matchAll(/`([^`]{1,40})`/g)) out.add(m[1].trim());
  for (const m of String(text ?? "").matchAll(/[A-Za-z][A-Za-z0-9_.@/-]{1,39}/g)) out.add(m[0]);
  return [...out].filter((s) => s.length >= 2 && !STOPWORDS.has(s.toLowerCase())).slice(0, 8);
}
function cjkBigrams(text) {
  const runs = String(text ?? "").match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const out = /* @__PURE__ */ new Set();
  for (const run of runs) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      const bg = run.slice(i, i + 2);
      if (!STOPWORDS.has(bg)) out.add(bg);
    }
  }
  return [...out].slice(0, 24);
}
function survivalScore(snippet, summary) {
  const latin = latinAnchors(snippet);
  const bigrams = cjkBigrams(snippet);
  if (latin.length === 0 && bigrams.length === 0) return null;
  const haystack = normalize(summary);
  const latinHit = latin.filter((a) => haystack.includes(normalize(a))).length;
  const bigramHit = bigrams.filter((b) => haystack.includes(b)).length;
  const ratios = [];
  if (latin.length > 0) ratios.push(latinHit / latin.length);
  if (bigrams.length > 0) ratios.push(bigramHit / bigrams.length);
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}
function extractCommitments(text, options = {}) {
  const max = options.max ?? 12;
  const body = String(text ?? "");
  if (body.length === 0) return [];
  const found = [];
  const seen = /* @__PURE__ */ new Set();
  for (const rule of RULES) {
    for (const match of body.matchAll(rule.re)) {
      const snippet = (match[1] ?? "").trim();
      if (snippet.length < 2) continue;
      const bare = normalize(snippet).replace(/^[是为:：]+/u, "");
      if (bare.length < 2 || STOPWORDS.has(bare)) continue;
      const at = match[0].indexOf(match[1]);
      const lead = at >= 0 ? match[0].slice(0, at).trim() : "";
      const tail = snippet.replace(/^[是为:：\s]+/u, "");
      const glue = /[\u4e00-\u9fff]$/u.test(lead) && /^[\u4e00-\u9fff]/u.test(tail) ? "" : " ";
      const text2 = `${lead}${glue}${tail}`.trim();
      const key = `${rule.kind}:${normalize(text2)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ kind: rule.kind, text: text2, marker: lead });
      if (found.length >= max) break;
    }
  }
  return found.map((item, index) => ({ item, index })).sort((a, b) => KIND_PRIORITY[a.item.kind] - KIND_PRIORITY[b.item.kind] || a.index - b.index).map((row) => row.item);
}

// lib/audit.js
var DEFAULT_THRESHOLD = 0.5;
function auditAgainstSummary(summaryText2, commitments, options = {}) {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const survived = [];
  const lost = [];
  const unverifiable = [];
  for (const item of commitments) {
    const score = survivalScore(item.text, summaryText2);
    if (score === null) {
      unverifiable.push({ ...item, score: null });
      continue;
    }
    const row = { ...item, score: Math.round(score * 100) / 100 };
    if (score >= threshold) survived.push(row);
    else lost.push(row);
  }
  return { survived, lost, unverifiable };
}

// lib/report.js
var KIND_LABEL = { constraint: "\u7EA6\u675F", decision: "\u51B3\u7B56", acceptance: "\u9A8C\u6536" };
function tokens(n) {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1e3) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(1)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}
function clock(ms) {
  const d = new Date(ms);
  const p = (v) => String(v).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function kindLabel(kind) {
  return KIND_LABEL[kind] ?? kind;
}
function formatReceipt(receipt, index) {
  const lines = [];
  lines.push(`\u6536\u636E #${index} \xB7 ${clock(receipt.at)} \xB7 \u5403\u6389 ${receipt.shadowedCount} \u6761\u5386\u53F2 (~${tokens(receipt.shadowedTokens)} tokens)`);
  const delivery = receipt.lost.length === 0 ? "" : receipt.delivered === true ? " \xB7 \u5DF2\u8865\u56DE\u5E76\u786E\u8BA4\u5230\u8FBE" : " \xB7 \u8865\u56DE\u5F85\u786E\u8BA4";
  lines.push(`  ${receipt.confident ? "\u8BED\u4E49\u5224\u5B9A" : "\u89C4\u5219\u5224\u5B9A"} \xB7 \u5951\u7EA6 ${receipt.total} \u6761 \xB7 \u5B58\u6D3B ${receipt.survived.length} \xB7 \u7591\u4F3C\u5931\u843D ${receipt.lost.length}${delivery}` + (receipt.unverifiable.length ? ` \xB7 \u65E0\u6CD5\u5224\u5B9A ${receipt.unverifiable.length}` : ""));
  if (receipt.lost.length > 0) {
    lines.push("");
    lines.push("  \u26A0\uFE0F \u7591\u4F3C\u5931\u843D\uFF08\u6458\u8981\u91CC\u627E\u4E0D\u5230\u8FD9\u4E9B\u8981\u6C42\uFF0C\u5EFA\u8BAE\u786E\u8BA4\uFF09:");
    receipt.lost.forEach((item, i) => {
      const where = item.turn !== void 0 ? ` \xB7 \u7B2C ${item.turn} \u8F6E` : "";
      lines.push(`   ${i + 1}. [${kindLabel(item.kind)}] ${item.text}${where}`);
    });
  }
  return lines.join("\n");
}
function formatContractReport(state) {
  const lines = [];
  if (state.receipts.length === 0) {
    lines.push(`\u8FD8\u6CA1\u6709\u53D1\u751F\u8FC7\u538B\u7F29\u3002\u5F53\u524D\u4F1A\u8BDD\u5DF2\u8BB0\u5F55 ${state.commitments.length} \u6761\u5951\u7EA6\u3002`);
  } else {
    lines.push(`\u672C\u4F1A\u8BDD\u5171\u538B\u7F29 ${state.receipts.length} \u6B21\uFF0C\u6700\u8FD1\u4E00\u6B21\uFF1A`);
    lines.push("");
    lines.push(formatReceipt(state.receipts[state.receipts.length - 1], state.receipts.length));
  }
  const stillActive = state.commitments.filter((c) => c.status === "active");
  if (stillActive.length > 0) {
    lines.push("");
    lines.push(`\u4ECD\u5728\u751F\u6548\u7684\u5951\u7EA6 ${stillActive.length} \u6761\uFF08\u5C1A\u672A\u7ECF\u5386\u538B\u7F29\uFF09:`);
    stillActive.slice(-12).forEach((item) => {
      const where = item.turn !== void 0 ? ` \xB7 \u7B2C ${item.turn} \u8F6E` : "";
      lines.push(`  \xB7 [${kindLabel(item.kind)}] ${item.text}${where}`);
    });
    if (stillActive.length > 12) lines.push(`  \u2026 \u53E6\u6709 ${stillActive.length - 12} \u6761`);
  }
  const lostTotal = state.receipts.reduce((sum, r) => sum + r.lost.length, 0);
  const survivedTotal = state.receipts.reduce((sum, r) => sum + r.survived.length, 0);
  if (survivedTotal + lostTotal > 0) {
    lines.push("");
    lines.push(`\u7D2F\u8BA1\u5B58\u6D3B\u7387: ${Math.round(survivedTotal / (survivedTotal + lostTotal) * 100)}% (${survivedTotal}/${survivedTotal + lostTotal})`);
  }
  return lines.join("\n");
}
function formatNotice(receipt) {
  const lines = ["\u{1F4CB} \u538B\u7F29\u6536\u636E \u2014 \u8FD9\u6B21\u538B\u7F29\u4E22\u6389\u4E86\u4F60\u4E4B\u524D\u7684\u8981\u6C42:"];
  receipt.lost.slice(0, 3).forEach((item, i) => {
    const where = item.turn !== void 0 ? `\uFF0C\u7B2C ${item.turn} \u8F6E` : "";
    lines.push(`${i + 1}. [${kindLabel(item.kind)}] ${item.text}${where}`);
  });
  if (receipt.lost.length > 3) lines.push(`\u2026 \u53E6\u6709 ${receipt.lost.length - 3} \u6761`);
  lines.push("\u8BF7\u7EE7\u7EED\u9075\u5B88\u4EE5\u4E0A\u8981\u6C42\uFF1B\u8F93\u5165 /contract \u67E5\u770B\u5B8C\u6574\u6536\u636E\u3002");
  return lines.join("\n");
}
function formatProbeReport(probe) {
  if (probe === void 0) return "\u8FD8\u6CA1\u6709\u53D1\u751F\u8FC7\u538B\u7F29\uFF0C\u6CA1\u6709\u53EF\u63A2\u6D4B\u7684\u6570\u636E\u3002";
  const pct = Math.round(probe.ratio * 100);
  const lines = [
    `\u63A2\u9488\uFF08\u6700\u8FD1\u4E00\u6B21\u538B\u7F29\uFF09\xB7 \u626B\u63CF ${probe.scanned} \u6761 \xB7 \u4F1A\u88AB\u9489\u4F4F ${probe.pinned} \u6761`,
    `\u9489\u4F4F\u4F53\u91CF ~${probe.pinnedTokens} tokens / \u88AB\u906E\u853D ~${probe.totalTokens} tokens\uFF08\u5360 ${pct}%\uFF09`
  ];
  if (probe.rows.length > 0) {
    lines.push("");
    probe.rows.slice(0, 10).forEach((row) => {
      lines.push(`  \xB7 [${row.labels.join("/")}] ~${row.tokens}t ${row.preview}`);
    });
    if (probe.rows.length > 10) lines.push(`  \u2026 \u53E6\u6709 ${probe.rows.length - 10} \u6761`);
  }
  lines.push("");
  lines.push("\u53EA\u8BFB\u63A2\u6D4B\uFF1A\u5F53\u524D\u538B\u7F29\u884C\u4E3A\u6CA1\u6709\u4EFB\u4F55\u6539\u53D8\u3002");
  return lines.join("\n");
}

// lib/judge.js
var SYSTEM = [
  "You audit context compaction in a coding agent.",
  "You are given (a) commitments the user made earlier and (b) the summary that replaced the history containing them.",
  "For every commitment decide one verdict:",
  '  "kept"    - the summary still states it, even if reworded or translated',
  '  "lost"    - the summary no longer carries it',
  '  "unclear" - the summary is too vague to tell',
  'Be strict about meaning, not wording. A summary that says "user prefers pnpm" keeps "\u4E0D\u8981\u7528 npm".',
  "Reply with JSON only, no prose, no code fence:",
  '{"verdicts":[{"id":<number>,"verdict":"kept|lost|unclear","why":"<max 12 words>"}]}'
].join("\n");
function buildJudgePrompt(commitments, summaryText2) {
  const items = commitments.map((c) => `- id=${c.id} [${c.kind}] ${c.text}${c.turn === void 0 ? "" : ` (turn ${c.turn})`}`).join("\n");
  return [
    "## Commitments made by the user",
    items,
    "",
    "## Summary that replaced them",
    summaryText2,
    "",
    "Return every id above exactly once, with a verdict."
  ].join("\n");
}
function parseVerdicts(text, ids) {
  const raw = String(text ?? "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return void 0;
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return void 0;
  }
  const list = Array.isArray(parsed?.verdicts) ? parsed.verdicts : void 0;
  if (list === void 0) return void 0;
  const allowed = /* @__PURE__ */ new Set(["kept", "lost", "unclear"]);
  const wanted = new Set(ids.map(String));
  const out = /* @__PURE__ */ new Map();
  for (const row of list) {
    const id = String(row?.id ?? "");
    const verdict = String(row?.verdict ?? "").toLowerCase();
    if (!wanted.has(id) || !allowed.has(verdict)) continue;
    out.set(Number(id), { verdict, why: typeof row.why === "string" ? row.why.slice(0, 120) : "" });
  }
  return out.size > 0 ? out : void 0;
}
async function judgeWithModel(streamText, commitments, summaryText2) {
  if (commitments.length === 0) return void 0;
  const user = buildJudgePrompt(commitments, summaryText2);
  const answer = await streamText({ system: SYSTEM, user });
  return parseVerdicts(answer, commitments.map((c) => c.id));
}

// lib/llm.js
function resolveRoute(agent) {
  const candidates = [agent?.options, agent?.routing, agent?.session?.options];
  for (const source of candidates) {
    const provider = source?.provider;
    const model = source?.model;
    if (typeof provider === "string" && provider.length > 0 && typeof model === "string" && model.length > 0) {
      return { provider, model };
    }
  }
  return void 0;
}
function makeStreamText(ctx, agent, options = {}) {
  const llm = ctx?.llm;
  if (typeof llm?.stream !== "function") return void 0;
  const route = resolveRoute(agent);
  if (route === void 0) return void 0;
  const maxTokens = options.maxTokens ?? 600;
  return async function streamText({ system, user }) {
    let out = "";
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages: [{ role: "user", content: [{ type: "text", text: user }] }],
      maxTokens
    });
    for await (const chunk of stream) {
      if (chunk?.type === "text-delta" && typeof chunk.text === "string") out += chunk.text;
    }
    return out;
  };
}

// lib/probe.js
function estimateTokens(text) {
  const s = String(text ?? "");
  let cjk = 0;
  for (const ch of s) if (/[\u4e00-\u9fff]/.test(ch)) cjk += 1;
  const latin = s.length - cjk;
  return cjk + Math.ceil(latin / 4);
}
function classifyMessage(text, kinds) {
  if (kinds.length > 0) return kinds;
  return ["chatter"];
}
function probeCompaction(shadowed, extract) {
  const rows = [];
  let pinnedTokens = 0;
  let totalTokens = 0;
  for (const item of shadowed) {
    const tokens2 = estimateTokens(item.text);
    totalTokens += tokens2;
    const kinds = extract(item.text).map((c) => c.kind);
    const labels = classifyMessage(item.text, kinds);
    if (labels[0] !== "chatter") {
      pinnedTokens += tokens2;
      rows.push({ seq: item.seq, labels, tokens: tokens2, preview: item.text.slice(0, 60) });
    }
  }
  return {
    scanned: shadowed.length,
    pinned: rows.length,
    pinnedTokens,
    totalTokens,
    ratio: totalTokens === 0 ? 0 : pinnedTokens / totalTokens,
    rows
  };
}

// lib/classify.js
var SYSTEM2 = [
  "You label user messages from a coding session so a context-compaction policy knows what must never be dropped.",
  "Labels:",
  "  constraint - a rule the work must obey (do not touch X, use Y, keep Z stable)",
  "  decision   - a chosen approach or technology",
  "  acceptance - a definition of done or acceptance criterion",
  "  chatter    - anything else",
  'Judge meaning, not keywords: postposed and implicit forms count ("tests \u76EE\u5F55\u5148\u522B\u78B0" is a constraint).',
  'Reply with JSON only: {"items":[{"id":<number>,"label":"constraint|decision|acceptance|chatter"}]}'
].join("\n");
function buildClassifyPrompt(batch) {
  return [
    "Label every message. Return every id exactly once.",
    ...batch.map((row) => `- id=${row.id} ${JSON.stringify(row.text).slice(0, 400)}`)
  ].join("\n");
}
function parseLabels(text, ids) {
  const raw = String(text ?? "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return void 0;
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return void 0;
  }
  const list = Array.isArray(parsed?.items) ? parsed.items : void 0;
  if (list === void 0) return void 0;
  const allowed = /* @__PURE__ */ new Set(["constraint", "decision", "acceptance", "chatter"]);
  const wanted = new Set(ids.map(String));
  const out = /* @__PURE__ */ new Map();
  for (const row of list) {
    const id = String(row?.id ?? "");
    const label = String(row?.label ?? "").toLowerCase();
    if (!wanted.has(id) || !allowed.has(label)) continue;
    out.set(Number(id), label);
  }
  return out.size > 0 ? out : void 0;
}
async function classifyBatch(streamText, batch) {
  if (batch.length === 0) return void 0;
  const answer = await streamText({ system: SYSTEM2, user: buildClassifyPrompt(batch) });
  return parseLabels(answer, batch.map((r) => r.id));
}

// node_modules/@deepseek-ai/cosmokit/lib/index.js
function isNullable(value) {
  return value === null || value === void 0;
}
function isPlainObject(data) {
  return data && typeof data === "object" && !Array.isArray(data);
}
function filterKeys(object, filter) {
  return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
function mapValues(object, transform) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
function pick(source, keys, forced) {
  if (!keys) return { ...source };
  const result = {};
  for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
  return result;
}
function defineProperty(object, key, value) {
  return Object.defineProperty(object, key, {
    writable: true,
    value,
    enumerable: false
  });
}
var write = Symbol.for("cosmokit.volatile.write");
function snapshot(value, ancestors = /* @__PURE__ */ new Set()) {
  if (typeof value === "function") throw new TypeError("volatile config cannot contain functions");
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) throw new TypeError("volatile config cannot contain cycles");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return Object.freeze(value.map((item) => snapshot(item, ancestors)));
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError("volatile config objects must be plain objects or arrays");
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshot(item, ancestors)])));
  } finally {
    ancestors.delete(value);
  }
}
function createVolatile(value) {
  let current = snapshot(value);
  return Object.freeze({
    get: () => current,
    [write]: (value2) => {
      current = value2;
    }
  });
}
function isVolatile(value) {
  return typeof value === "object" && value !== null && write in value;
}
function is(type, value) {
  if (arguments.length === 1) return (value2) => is(type, value2);
  return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
  return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
  return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
var Binary;
(function(Binary2) {
  Binary2.is = isArrayBufferLike;
  Binary2.isSource = isArrayBufferSource;
  function fromSource(source) {
    if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    else return source;
  }
  Binary2.fromSource = fromSource;
  function toBase64(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
    let binary = "";
    const bytes = new Uint8Array(source);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  Binary2.toBase64 = toBase64;
  function fromBase64(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
    return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
  }
  Binary2.fromBase64 = fromBase64;
  function toHex(source) {
    source = fromSource(source);
    if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
    return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  Binary2.toHex = toHex;
  function fromHex(source) {
    if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
    const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
    const buffer = [];
    for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
    return Uint8Array.from(buffer).buffer;
  }
  Binary2.fromHex = fromHex;
})(Binary || (Binary = {}));
var base64ToArrayBuffer = Binary.fromBase64;
var arrayBufferToBase64 = Binary.toBase64;
var hexToArrayBuffer = Binary.fromHex;
var arrayBufferToHex = Binary.toHex;
function clone(source, refs = /* @__PURE__ */ new Map()) {
  if (!source || typeof source !== "object") return source;
  if (is("Date", source)) return new Date(source.valueOf());
  if (is("RegExp", source)) return new RegExp(source.source, source.flags);
  if (isArrayBufferLike(source)) return source.slice(0);
  if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const cached = refs.get(source);
  if (cached) return cached;
  if (Array.isArray(source)) {
    const result2 = [];
    refs.set(source, result2);
    source.forEach((value, index) => {
      result2[index] = Reflect.apply(clone, null, [value, refs]);
    });
    return result2;
  }
  const result = Object.create(Object.getPrototypeOf(source));
  refs.set(source, result);
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
    if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
    Reflect.defineProperty(result, key, descriptor);
  }
  return result;
}
function deepEqual(a, b, strict) {
  const ancestors = /* @__PURE__ */ new Set();
  function compare(a2, b2) {
    if (a2 === b2) return true;
    if (isVolatile(a2) || isVolatile(b2)) return isVolatile(a2) && isVolatile(b2);
    if (!strict && isNullable(a2) && isNullable(b2)) return true;
    if (typeof a2 !== typeof b2 || typeof a2 !== "object" || !a2 || !b2) return false;
    if (ancestors.has(a2)) return false;
    function check(test, then) {
      return test(a2) ? test(b2) ? then(a2, b2) : false : test(b2) ? false : void 0;
    }
    ancestors.add(a2);
    try {
      return check(Array.isArray, (a3, b3) => {
        if (a3.length !== b3.length) return false;
        for (let index = 0; index < a3.length; index++) if (!compare(a3[index], b3[index])) return false;
        return true;
      }) ?? check(is("Date"), (a3, b3) => a3.valueOf() === b3.valueOf()) ?? check(is("URL"), (a3, b3) => a3.href === b3.href) ?? check(is("RegExp"), (a3, b3) => a3.source === b3.source && a3.flags === b3.flags) ?? check(isArrayBufferLike, (a3, b3) => {
        if (a3.byteLength !== b3.byteLength) return false;
        const viewA = new Uint8Array(a3);
        const viewB = new Uint8Array(b3);
        for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
        return true;
      }) ?? ((!strict || [a2, b2].every((value) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) && Object.keys({
        ...a2,
        ...b2
      }).every((key) => compare(a2[key], b2[key])));
    } finally {
      ancestors.delete(a2);
    }
  }
  return compare(a, b);
}
function tokenize(source, delimiters, delimiter) {
  const output = [];
  let state = 0;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code >= 65 && code <= 90) {
      if (state === 1) {
        const next = source.charCodeAt(i + 1);
        if (next >= 97 && next <= 122) output.push(delimiter);
        output.push(code + 32);
      } else {
        if (state !== 0) output.push(delimiter);
        output.push(code + 32);
      }
      state = 1;
    } else if (code >= 97 && code <= 122) {
      output.push(code);
      state = 2;
    } else if (delimiters.includes(code)) {
      if (state !== 0) output.push(delimiter);
      state = 0;
    } else output.push(code);
  }
  return String.fromCharCode(...output);
}
function paramCase(source) {
  return tokenize(source, [45, 95], 45);
}
var hyphenate = paramCase;
var Time;
(function(Time2) {
  Time2.millisecond = 1;
  Time2.second = 1e3;
  Time2.minute = Time2.second * 60;
  Time2.hour = Time2.minute * 60;
  Time2.day = Time2.hour * 24;
  Time2.week = Time2.day * 7;
  let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
  function setTimezoneOffset(offset) {
    timezoneOffset = offset;
  }
  Time2.setTimezoneOffset = setTimezoneOffset;
  function getTimezoneOffset() {
    return timezoneOffset;
  }
  Time2.getTimezoneOffset = getTimezoneOffset;
  function getDateNumber(date2 = /* @__PURE__ */ new Date(), offset) {
    if (typeof date2 === "number") date2 = new Date(date2);
    if (offset === void 0) offset = timezoneOffset;
    return Math.floor((date2.valueOf() / Time2.minute - offset) / 1440);
  }
  Time2.getDateNumber = getDateNumber;
  function fromDateNumber(value, offset) {
    const date2 = new Date(value * Time2.day);
    if (offset === void 0) offset = timezoneOffset;
    return new Date(+date2 + offset * Time2.minute);
  }
  Time2.fromDateNumber = fromDateNumber;
  const numeric = /\d+(?:\.\d+)?/.source;
  const timeRegExp = new RegExp(`^${[
    "w(?:eek(?:s)?)?",
    "d(?:ay(?:s)?)?",
    "h(?:our(?:s)?)?",
    "m(?:in(?:ute)?(?:s)?)?",
    "s(?:ec(?:ond)?(?:s)?)?"
  ].map((unit) => `(${numeric}${unit})?`).join("")}$`);
  function parseTime(source) {
    const capture = timeRegExp.exec(source);
    if (!capture) return 0;
    return (parseFloat(capture[1]) * Time2.week || 0) + (parseFloat(capture[2]) * Time2.day || 0) + (parseFloat(capture[3]) * Time2.hour || 0) + (parseFloat(capture[4]) * Time2.minute || 0) + (parseFloat(capture[5]) * Time2.second || 0);
  }
  Time2.parseTime = parseTime;
  function parseDate(date2) {
    const parsed = parseTime(date2);
    if (parsed) date2 = Date.now() + parsed;
    else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date2}`;
    else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date2)) date2 = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date2}`;
    return date2 ? new Date(date2) : /* @__PURE__ */ new Date();
  }
  Time2.parseDate = parseDate;
  function format(ms) {
    const abs = Math.abs(ms);
    if (abs >= Time2.day - Time2.hour / 2) return Math.round(ms / Time2.day) + "d";
    else if (abs >= Time2.hour - Time2.minute / 2) return Math.round(ms / Time2.hour) + "h";
    else if (abs >= Time2.minute - Time2.second / 2) return Math.round(ms / Time2.minute) + "m";
    else if (abs >= Time2.second) return Math.round(ms / Time2.second) + "s";
    return ms + "ms";
  }
  Time2.format = format;
  function toDigits(source, length = 2) {
    return source.toString().padStart(length, "0");
  }
  Time2.toDigits = toDigits;
  function template(template2, time = /* @__PURE__ */ new Date()) {
    return template2.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
  }
  Time2.template = template;
})(Time || (Time = {}));

// node_modules/@deepseek-ai/schemastery/lib/index.mjs
var kSchema = Symbol.for("schemastery");
var kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
  options;
  name = "ValidationError";
  constructor(message, options) {
    let prefix = "$";
    for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
    else if (typeof segment === "number") prefix += "[" + segment + "]";
    else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
    if (prefix.startsWith(".")) prefix = prefix.slice(1);
    super((prefix === "$" ? "" : `${prefix} `) + message);
    this.options = options;
  }
  static is(error) {
    return !!error?.[kValidationError];
  }
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
var Schema = function(options) {
  const schema = function(data, options2 = {}) {
    return Schema.resolve(data, schema, options2)[0];
  };
  if (options.refs) {
    const refs = mapValues(options.refs, (options2) => new Schema(options2));
    const getRef = (uid) => refs[uid];
    for (const key in refs) {
      const options2 = refs[key];
      options2.sKey = getRef(options2.sKey);
      options2.inner = getRef(options2.inner);
      options2.list = options2.list && options2.list.map(getRef);
      options2.dict = options2.dict && mapValues(options2.dict, getRef);
    }
    return refs[options.uid];
  }
  Object.assign(schema, options);
  if (typeof schema.callback === "string") try {
    schema.callback = new Function("return " + schema.callback)();
  } catch {
  }
  Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
  Object.setPrototypeOf(schema, Schema.prototype);
  schema.meta ||= {};
  schema.toString = schema.toString.bind(schema);
  return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
  return {
    version: 1,
    vendor: "schemastery",
    validate: (value) => {
      try {
        return { value: Schema.resolve(value, this, {})[0] };
      } catch (error) {
        if (ValidationError.is(error)) return { issues: [{
          message: error.message,
          path: error.options.path
        }] };
        throw error;
      }
    }
  };
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
  if (globalThis.__schemastery_refs__) {
    globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
    return this.uid;
  }
  globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
  globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
  const result = {
    uid: this.uid,
    refs: globalThis.__schemastery_refs__
  };
  globalThis.__schemastery_refs__ = void 0;
  return result;
};
Schema.prototype.set = function set(key, value) {
  this.dict[key] = value;
  return this;
};
Schema.prototype.push = function push(value) {
  this.list.push(value);
  return this;
};
function mergeDesc(original, messages) {
  const result = typeof original === "string" ? { "": original } : { ...original };
  for (const locale in messages) {
    const value = messages[locale];
    if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
    else if (typeof value === "string") result[locale] = value;
  }
  return result;
}
function getInner(value) {
  return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
  return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
  const schema = Schema(this);
  const desc = mergeDesc(schema.meta.description, messages);
  if (Object.keys(desc).length) schema.meta.description = desc;
  if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
    return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
  });
  if (schema.list) schema.list = schema.list.map((inner, index) => {
    return inner.i18n(mapValues(messages, (data = {}) => {
      if (Array.isArray(getInner(data))) return getInner(data)[index];
      if (Array.isArray(data)) return data[index];
      return extractKeys(data);
    }));
  });
  if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
    if (getInner(data)) return getInner(data);
    return extractKeys(data);
  }));
  if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
  return schema;
};
Schema.prototype.extra = function extra(key, value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
};
for (const key of [
  "required",
  "disabled",
  "collapse",
  "hidden",
  "loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.deprecated = function deprecated() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "deprecated",
    type: "danger"
  });
  return schema;
};
Schema.prototype.experimental = function experimental() {
  const schema = Schema(this);
  schema.meta.badges ||= [];
  schema.meta.badges.push({
    text: "experimental",
    type: "warning"
  });
  return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
  const schema = Schema(this);
  const pattern2 = pick(regexp, ["source", "flags"]);
  schema.meta = {
    ...schema.meta,
    pattern: pattern2
  };
  return schema;
};
Schema.prototype.simplify = function simplify(value) {
  if (isVolatile(value)) value = value.get();
  if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
  if (isNullable(value)) return value;
  if (this.type === "object" || this.type === "dict") {
    const result = {};
    for (const key in value) {
      const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
      if (this.type === "dict" || !isNullable(item)) result[key] = item;
    }
    if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
    return result;
  } else if (this.type === "array" || this.type === "tuple") {
    const result = [];
    value.forEach((value2, index) => {
      const schema = this.type === "array" ? this.inner : this.list[index];
      const item = schema ? schema.simplify(value2) : value2;
      result.push(item);
    });
    return result;
  } else if (this.type === "intersect") {
    const result = {};
    for (const item of this.list) Object.assign(result, item.simplify(value));
    return result;
  } else if (this.type === "union") for (const schema of this.list) try {
    Schema.resolve(value, schema, {});
    return schema.simplify(value);
  } catch {
  }
  return value;
};
Schema.prototype.toString = function toString(inline) {
  return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra2) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    role,
    extra: extra2
  };
  return schema;
};
for (const key of [
  "default",
  "link",
  "comment",
  "description",
  "max",
  "min",
  "step"
]) Object.assign(Schema.prototype, { [key](value) {
  const schema = Schema(this);
  schema.meta = {
    ...schema.meta,
    [key]: value
  };
  return schema;
} });
Schema.prototype.volatile = function volatile() {
  if (this.meta.volatile) throw new TypeError("volatile schema is already wrapped");
  return this.extra("volatile", true);
};
var resolvers = {};
var checkedVolatile = Symbol("checked-volatile-schema");
function validateVolatileSchema(schema, path = [], blocked = false, seen = /* @__PURE__ */ new Map()) {
  const states = seen.get(schema) ?? /* @__PURE__ */ new Set();
  if (states.has(blocked)) return;
  states.add(blocked);
  seen.set(schema, states);
  if (schema.meta?.volatile && blocked) throw new ValidationError("volatile fields require a fixed object path without an enclosing volatile field", { path });
  const nested = blocked || !!schema.meta?.volatile;
  if (schema.dict) for (const [key, child] of Object.entries(schema.dict)) validateVolatileSchema(child, [...path, key], nested, seen);
  if (schema.sKey) validateVolatileSchema(schema.sKey, [...path, "<key>"], true, seen);
  if (schema.inner && (schema.type !== "lazy" || schema.inner[kSchema])) validateVolatileSchema(schema.inner, [...path, "*"], true, seen);
  if (schema.list) for (let index = 0; index < schema.list.length; index++) validateVolatileSchema(schema.list[index], [...path, String(index)], true, seen);
}
Schema.extend = function extend(type, resolve2) {
  resolvers[type] = resolve2;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
  if (!schema) return [data];
  if (!options[checkedVolatile]) {
    validateVolatileSchema(schema, options.path);
    options = {
      ...options,
      [checkedVolatile]: true
    };
  }
  if (schema.meta?.volatile) {
    const inner = Schema(schema);
    inner.meta = {
      ...schema.meta,
      volatile: false
    };
    const [value, adapted] = Schema.resolve(data, inner, options, strict);
    try {
      return [createVolatile(value), adapted];
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : String(error), options);
    }
  }
  if (options.ignore?.(data, schema)) return [data];
  if (isNullable(data) && schema.type !== "lazy") {
    if (schema.meta.required) throw new ValidationError(`missing required value`, options);
    let current = schema;
    let fallback = schema.meta.default;
    while (current?.type === "intersect" && isNullable(fallback)) {
      current = current.list[0];
      fallback = current?.meta.default;
    }
    if (isNullable(fallback)) return [data];
    data = clone(fallback);
  }
  const callback = resolvers[schema.type];
  if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
  try {
    return callback(data, schema, options, strict);
  } catch (error) {
    if (!schema.meta.loose) throw error;
    return [schema.meta.default];
  }
};
Schema.from = function from(source) {
  if (isNullable(source)) return Schema.any();
  else if ([
    "string",
    "number",
    "boolean"
  ].includes(typeof source)) return Schema.const(source).required();
  else if (source[kSchema]) return source;
  else if (typeof source === "function") switch (source) {
    case String:
      return Schema.string().required();
    case Number:
      return Schema.number().required();
    case Boolean:
      return Schema.boolean().required();
    case Function:
      return Schema.function().required();
    default:
      return Schema.is(source).required();
  }
  else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
  const toJSON2 = () => {
    if (!schema.inner[kSchema]) {
      schema.inner = schema.builder();
      schema.inner.meta = {
        ...schema.meta,
        ...schema.inner.meta
      };
    }
    return schema.inner.toJSON();
  };
  const schema = new Schema({
    type: "lazy",
    builder,
    inner: { toJSON: toJSON2 }
  });
  return schema;
};
Schema.natural = function natural() {
  return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
  return Schema.number().step(0.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
  return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
    const date2 = new Date(value);
    if (isNaN(+date2)) throw new ValidationError(`invalid date "${value}"`, options);
    return date2;
  }, true)]);
};
Schema.regExp = function regExp(flag = "") {
  return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
    try {
      return new RegExp(value, flag);
    } catch (e) {
      throw new ValidationError(e.message, options);
    }
  }, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
  return Schema.union([
    Schema.is(ArrayBuffer),
    Schema.is(SharedArrayBuffer),
    Schema.transform(Schema.any(), (value, options) => {
      if (Binary.isSource(value)) return Binary.fromSource(value);
      throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
    }, true),
    ...encoding ? [Schema.transform(Schema.string(), (value, options) => {
      try {
        return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
      } catch (e) {
        throw new ValidationError(e.message, options);
      }
    }, true)] : []
  ]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
  if (!schema.inner[kSchema]) {
    schema.inner = schema.builder();
    schema.inner.meta = {
      ...schema.meta,
      ...schema.inner.meta
    };
    validateVolatileSchema(schema.inner, options.path, true);
  }
  return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
  return [data];
});
Schema.extend("never", (data, _, options) => {
  throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
  if (deepEqual(data, value)) return [value];
  throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
  const { max = Infinity, min = -Infinity } = meta;
  if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
  if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
  if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
  if (meta.pattern) {
    const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
    if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
  }
  checkWithinRange(data.length, meta, "string length", options);
  return [data];
});
function decimalShift(data, digits) {
  const str = data.toString();
  if (str.includes("e")) return data * Math.pow(10, digits);
  const index = str.indexOf(".");
  if (index === -1) return data * Math.pow(10, digits);
  const frac = str.slice(index + 1);
  const integer = str.slice(0, index);
  if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
  return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
  step = Math.abs(step);
  if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
  const index = step.toString().indexOf(".");
  const digits = step.toString().slice(index + 1).length;
  return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
  if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
  checkWithinRange(data, meta, "number", options);
  const { step } = meta;
  if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
  return [data];
});
Schema.extend("boolean", (data, _, options) => {
  if (typeof data === "boolean") return [data];
  throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
  let value = 0, keys = [];
  if (typeof data === "number") {
    value = data;
    for (const key in bits) if (data & bits[key]) keys.push(key);
  } else if (Array.isArray(data)) {
    keys = data;
    for (const key of keys) {
      if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
      if (key in bits) value |= bits[key];
    }
  } else throw new ValidationError(`expected number or array but got ${data}`, options);
  if (value === meta.default) return [value];
  return [value, keys];
});
Schema.extend("function", (data, _, options) => {
  if (typeof data === "function") return [data];
  throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
  if (typeof constructor === "function") {
    if (data instanceof constructor) return [data];
    throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
  } else {
    if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
    let prototype = Object.getPrototypeOf(data);
    while (prototype) {
      if (prototype.constructor?.name === constructor) return [data];
      prototype = Object.getPrototypeOf(prototype);
    }
    throw new ValidationError(`expected ${constructor} but got ${data}`, options);
  }
});
function property(data, key, schema, options) {
  try {
    const [value, adapted] = Schema.resolve(data[key], schema, {
      ...options,
      path: [...options.path || [], key]
    });
    if (adapted !== void 0) data[key] = adapted;
    return value;
  } catch (e) {
    if (!options?.autofix) throw e;
    delete data[key];
    return schema.meta.volatile ? createVolatile(schema.meta.default) : schema.meta.default;
  }
}
Schema.extend("array", (data, { inner, meta }, options) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
  return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in data) {
    let rKey;
    try {
      rKey = Schema.resolve(key, sKey, options)[0];
    } catch (error) {
      if (strict) continue;
      throw error;
    }
    result[rKey] = property(data, key, inner, options);
    data[rKey] = data[key];
    if (key !== rKey) delete data[key];
  }
  return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
  if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
  const result = list.map((inner, index) => property(data, index, inner, options));
  if (strict) return [result];
  result.push(...data.slice(list.length));
  return [result];
});
function merge(result, data) {
  for (const key in data) {
    if (key in result) continue;
    result[key] = data[key];
  }
}
Schema.extend("object", (data, { dict }, options, strict) => {
  if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
  const result = {};
  for (const key in dict) {
    const value = property(data, key, dict[key], options);
    if (!isNullable(value) || key in data) result[key] = value;
  }
  if (!strict) merge(result, data);
  return [result];
});
Schema.extend("union", (data, { list, toString: toString2 }, options, strict) => {
  const messages = [];
  for (const inner of list) try {
    return Schema.resolve(data, inner, options, strict);
  } catch (error) {
    messages.push(error);
  }
  throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString: toString2 }, options, strict) => {
  if (!list.length) return [data];
  let result;
  for (const inner of list) {
    const value = Schema.resolve(data, inner, options, true)[0];
    if (isNullable(value)) continue;
    if (isNullable(result)) result = value;
    else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
    else if (typeof value === "object") merge(result ??= {}, value);
    else if (result !== value) throw new ValidationError(`expected ${toString2()} but got ${JSON.stringify(data)}`, options);
  }
  if (!strict && isPlainObject(data)) merge(result, data);
  return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
  const [result, adapted = data] = Schema.resolve(data, inner, options, true);
  if (preserve) return [callback(result)];
  else return [callback(result), callback(adapted)];
});
var formatters = {};
function defineMethod(name2, keys, format) {
  formatters[name2] = format;
  Object.assign(Schema, { [name2](...args) {
    const schema = new Schema({ type: name2 });
    keys.forEach((key, index) => {
      switch (key) {
        case "sKey":
          schema.sKey = args[index] ?? Schema.string();
          break;
        case "inner":
          schema.inner = Schema.from(args[index]);
          break;
        case "list":
          schema.list = args[index].map(Schema.from);
          break;
        case "dict":
          schema.dict = mapValues(args[index], Schema.from);
          break;
        case "bits":
          schema.bits = {};
          for (const key2 in args[index]) {
            if (typeof args[index][key2] !== "number") continue;
            schema.bits[key2] = args[index][key2];
          }
          break;
        case "callback": {
          const callback = schema.callback = args[index];
          callback["toJSON"] ||= () => callback.toString();
          break;
        }
        case "constructor": {
          const constructor = schema.constructor = args[index];
          if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
          break;
        }
        default:
          schema[key] = args[index];
      }
    });
    if (name2 === "object" || name2 === "dict") schema.meta.default = {};
    else if (name2 === "array" || name2 === "tuple") schema.meta.default = [];
    else if (name2 === "bitset") schema.meta.default = 0;
    return schema;
  } });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
  if (typeof constructor === "function") return constructor.name;
  else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
  if (Object.keys(dict).length === 0) return "{}";
  return `{ ${Object.entries(dict).map(([key, inner]) => {
    return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
  }).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
  const result = list.map(({ toString: format }) => format()).join(" | ");
  return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
  return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
  "inner",
  "callback",
  "preserve"
], ({ inner }, isInner) => inner.toString(isInner));

// node_modules/@deepseek-ai/cordis/lib/index.js
var DisposableList = class {
  sn = 0;
  map = /* @__PURE__ */ new Map();
  weak = /* @__PURE__ */ new WeakMap();
  get length() {
    return this.map.size;
  }
  push(value) {
    const sn = ++this.sn;
    this.map.set(sn, value);
    this.weak.set(value, sn);
    return () => this.map.delete(sn);
  }
  delete(value) {
    const sn = this.weak.get(value);
    if (!sn) return false;
    return this.map.delete(sn);
  }
  clear() {
    const values = [...this.map.values()];
    this.map.clear();
    return values.reverse();
  }
  [Symbol.iterator]() {
    return this.map.values();
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return [...this];
  }
};
var symbols = {
  shadow: Symbol.for("cordis.shadow"),
  receiver: Symbol.for("cordis.receiver"),
  original: Symbol.for("cordis.original"),
  metadata: Symbol.for("cordis.metadata"),
  initHooks: Symbol.for("cordis.initHooks"),
  checkProto: Symbol.for("cordis.checkProto"),
  effect: Symbol.for("cordis.effect"),
  filter: Symbol.for("cordis.filter"),
  isolate: Symbol.for("cordis.isolate"),
  intercept: Symbol.for("cordis.intercept"),
  init: Symbol.for("cordis.init"),
  check: Symbol.for("cordis.check"),
  config: Symbol.for("cordis.config"),
  invoke: Symbol.for("cordis.invoke"),
  extend: Symbol.for("cordis.extend"),
  tracker: Symbol.for("cordis.tracker"),
  resolveConfig: Symbol.for("cordis.resolveConfig")
};
var GeneratorFunction = function* () {
}.constructor;
var AsyncGeneratorFunction = async function* () {
}.constructor;
function isConstructor(func) {
  if (!func.prototype) return false;
  if (func instanceof GeneratorFunction) return false;
  if (AsyncGeneratorFunction !== Function && func instanceof AsyncGeneratorFunction) return false;
  return true;
}
function joinPrototype(proto1, proto2) {
  if (proto1 === Object.prototype) return proto2;
  const result = Object.create(joinPrototype(Object.getPrototypeOf(proto1), proto2));
  for (const key of Reflect.ownKeys(proto1)) Object.defineProperty(result, key, Object.getOwnPropertyDescriptor(proto1, key));
  return result;
}
function isObject(value) {
  return value && (typeof value === "object" || typeof value === "function");
}
function getPropertyDescriptor(target, prop) {
  let proto = target;
  while (proto) {
    const desc = Reflect.getOwnPropertyDescriptor(proto, prop);
    if (desc) return desc;
    proto = Object.getPrototypeOf(proto);
  }
}
function getTraceable(ctx, value) {
  if (!isObject(value)) return value;
  if (Object.hasOwn(value, symbols.shadow)) return Object.getPrototypeOf(value);
  const tracker = value[symbols.tracker];
  if (!tracker) return value;
  return createTraceable(ctx, value, tracker);
}
function withProps(target, props) {
  if (!props) return target;
  return new Proxy(target, {
    get: (target2, prop, receiver) => {
      if (prop in props && prop !== "constructor") return Reflect.get(props, prop, receiver);
      return Reflect.get(target2, prop, receiver);
    },
    set: (target2, prop, value, receiver) => {
      if (prop in props && prop !== "constructor") return Reflect.set(props, prop, value, receiver);
      return Reflect.set(target2, prop, value, receiver);
    }
  });
}
function withProp(target, prop, value) {
  return withProps(target, Object.defineProperty(/* @__PURE__ */ Object.create(null), prop, {
    value,
    writable: false
  }));
}
function createShadow(ctx, target, property2, receiver) {
  if (!property2) return receiver;
  const origin = Reflect.getOwnPropertyDescriptor(target, property2)?.value;
  if (!origin) return receiver;
  return withProp(receiver, property2, ctx.extend({ [symbols.shadow]: origin }));
}
function createShadowMethod(ctx, value, outer, shadow) {
  return new Proxy(value, { apply: (target, thisArg, args) => {
    if (thisArg === outer) thisArg = shadow;
    return getTraceable(ctx, Reflect.apply(target, thisArg, args));
  } });
}
function createTraceable(ctx, value, tracker) {
  if (ctx[symbols.shadow] && !tracker.noShadow) ctx = Object.getPrototypeOf(ctx);
  const proxy = new Proxy(value, {
    get: (target, prop, receiver) => {
      if (prop === symbols.original) return target;
      if (prop === tracker.property) return ctx;
      if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
      if (tracker.associate && ctx.reflect.props[`${tracker.associate}.${prop}`]) return Reflect.get(ctx, `${tracker.associate}.${prop}`, withProp(ctx, symbols.receiver, receiver));
      let shadow, innerValue;
      const desc = getPropertyDescriptor(target, prop);
      if (desc && "value" in desc) innerValue = desc.value;
      else {
        shadow = createShadow(ctx, target, tracker.property, receiver);
        innerValue = Reflect.get(target, prop, shadow);
      }
      const innerTracker = innerValue?.[symbols.tracker];
      if (innerTracker) return createTraceable(ctx, innerValue, innerTracker);
      else if (!tracker.noShadow && typeof innerValue === "function") {
        shadow ??= createShadow(ctx, target, tracker.property, receiver);
        return createShadowMethod(ctx, innerValue, receiver, shadow);
      } else return innerValue;
    },
    set: (target, prop, value2, receiver) => {
      if (prop === symbols.original) return false;
      if (prop === tracker.property) return false;
      if (typeof prop === "symbol") return Reflect.set(target, prop, value2, receiver);
      if (tracker.associate && ctx.reflect.props[`${tracker.associate}.${prop}`]) return Reflect.set(ctx, `${tracker.associate}.${prop}`, value2, withProp(ctx, symbols.receiver, receiver));
      const shadow = createShadow(ctx, target, tracker.property, receiver);
      return Reflect.set(target, prop, value2, shadow);
    },
    apply: (target, thisArg, args) => {
      return applyTraceable(proxy, target, thisArg, args);
    }
  });
  return proxy;
}
function applyTraceable(proxy, value, thisArg, args) {
  if (!value[symbols.invoke]) return Reflect.apply(value, thisArg, args);
  return value[symbols.invoke].apply(proxy, args);
}
function createCallable(name2, proto, tracker) {
  const self = function(...args) {
    return applyTraceable(createTraceable(self["ctx"], self, tracker), self, this, args);
  };
  defineProperty(self, "name", name2);
  return Object.setPrototypeOf(self, proto);
}
function handleError(info, reason, getOuterStack) {
  const innerLines = info.error.stack.split("\n");
  if (typeof reason?.stack !== "string") {
    const outerError = new Error(reason);
    const lines2 = outerError.stack.split("\n");
    lines2.splice(1, Infinity, ...getOuterStack());
    outerError.stack = lines2.join("\n");
    throw outerError;
  }
  const lines = reason.stack.split("\n");
  let index = lines.indexOf(innerLines[2]);
  if (index === -1) throw reason;
  index -= info.offset;
  while (index > 0) {
    if (!lines[index - 1].endsWith(" (<anonymous>)")) break;
    index -= 1;
  }
  lines.splice(index, Infinity, ...getOuterStack());
  reason.stack = lines.join("\n");
  throw reason;
}
function composeError(callback, getOuterStack = buildOuterStack()) {
  const info = {
    offset: 1,
    error: /* @__PURE__ */ new Error()
  };
  try {
    const result = callback(info);
    if (isObject(result) && "then" in result) return result.then(void 0, (reason) => handleError(info, reason, getOuterStack));
    else return result;
  } catch (reason) {
    handleError(info, reason, getOuterStack);
  }
}
function buildOuterStack(offset = 0) {
  const outerError = /* @__PURE__ */ new Error();
  return () => outerError.stack.split("\n").slice(3 + offset);
}
function isBailed(value) {
  return value !== null && value !== false && value !== void 0;
}
var EventsService = class {
  ctx;
  _hooks = {};
  constructor(ctx) {
    this.ctx = ctx;
    defineProperty(this, symbols.tracker, {
      property: "ctx",
      noShadow: true
    });
    this.on("internal/listener", function(name2, listener, options) {
      if (name2 === "internal/update" && !options.global) return (this.fiber._hooks["internal/update"] ??= new DisposableList())[options.prepend ? "unshift" : "push"](listener);
    });
    this.on("internal/update", function(config, noSave, next) {
      const cbs = [...this._hooks["internal/update"] || []];
      const _next = () => {
        return (cbs.shift() ?? next).call(this, config, noSave, _next);
      };
      return _next();
    }, {
      global: true,
      prepend: true
    });
  }
  /**
  * Resolve listeners for one dispatch and apply context filtering.
  *
  * @param type — the dispatch mode, reported on `internal/dispatch`.
  * @param args — the raw dispatch arguments; consumed up to the event name.
  * @returns the matching listener callbacks, bound to the dispatch `this`.
  */
  dispatch(type, args) {
    const thisArg = typeof args[0] === "object" || typeof args[0] === "function" ? args.shift() : null;
    const name2 = args.shift();
    if (!name2.startsWith("internal/")) this.emit("internal/dispatch", type, name2, args, thisArg);
    const filter = thisArg?.[Context.filter];
    return (this._hooks[name2] || []).filter((hook) => hook.global || !filter || filter.call(thisArg, hook.ctx)).map((hook) => hook.callback.bind(thisArg));
  }
  /**
  * Run listeners concurrently and wait for all of them.
  *
  * @param args — optional `this`, the event name, then listener arguments.
  * @returns a promise resolving once every listener has settled.
  */
  async parallel(...args) {
    const errors = (await Promise.allSettled(this.dispatch("emit", args).map(async (cb) => cb(...args)))).filter((result) => result.status === "rejected");
    if (errors.length) throw new AggregateError(errors.map((error) => error.reason));
  }
  /**
  * Run listeners synchronously without waiting for returned promises.
  *
  * @param args — optional `this`, the event name, then listener arguments.
  */
  emit(...args) {
    this.dispatch("emit", args).map((cb) => cb(...args));
  }
  /**
  * Run listeners in order, awaiting each, until one returns a bail value.
  *
  * @param args — optional `this`, the event name, then listener arguments.
  * @returns the first bail value (see {@link isBailed}), if any.
  */
  async serial(...args) {
    for (const cb of this.dispatch("serial", args)) {
      const result = await cb(...args);
      if (isBailed(result)) return result;
    }
  }
  /**
  * Run listeners synchronously until one returns a bail value.
  *
  * @param args — optional `this`, the event name, then listener arguments.
  * @returns the first bail value (see {@link isBailed}), if any.
  */
  bail(...args) {
    for (const cb of this.dispatch("bail", args)) {
      const result = cb(...args);
      if (isBailed(result)) return result;
    }
  }
  /**
  * Compose listeners around the final `next` callback.
  *
  * The last dispatch argument is treated as the innermost `next`. Listeners
  * run outermost-first; a listener that does not call `next()` vetoes the
  * rest of the chain, including the built-in behavior.
  *
  * @param args — optional `this`, the event name, listener arguments, then `next`.
  * @returns the outermost listener's return value.
  */
  waterfall(...args) {
    const cbs = this.dispatch("waterfall", args);
    const inner = args.pop();
    const next = () => {
      return (cbs.shift() ?? inner)(...args);
    };
    args.push(next);
    return next();
  }
  /**
  * Store a listener record as an effect on the current fiber.
  *
  * @param label — effect label shown in fiber diagnostics.
  * @param hooks — the listener list for one event.
  * @param callback — the listener to store.
  * @param options — placement and filtering options.
  * @returns a disposer that unregisters the listener.
  */
  register(label, hooks, callback, options) {
    const method = options.prepend ? "unshift" : "push";
    return this.ctx.fiber.effect(() => {
      hooks[method]({
        ctx: this.ctx,
        callback,
        ...options
      });
      return () => this.unregister(hooks, callback);
    }, label);
  }
  /**
  * Remove a stored listener record.
  *
  * @param hooks — the listener list for one event.
  * @param callback — the listener to remove.
  * @returns `true` if the listener was found and removed.
  */
  unregister(hooks, callback) {
    const index = hooks.findIndex((hook) => hook.callback === callback);
    if (index >= 0) {
      hooks.splice(index, 1);
      return true;
    }
  }
  /**
  * Register an event listener owned by the current fiber.
  *
  * The listener is removed automatically when the fiber unloads. Throws
  * `CordisError('INACTIVE_EFFECT')` if the fiber is already disposed.
  *
  * @param name — the event name to listen for.
  * @param listener — called with the dispatch arguments.
  * @param options — listener options; a boolean is shorthand for `prepend`.
  * @returns a disposer removing the listener; `true` if it was still registered.
  */
  on(name2, listener, options) {
    if (typeof options !== "object") options = { prepend: options };
    this.ctx.fiber.assertActive();
    listener = this.ctx.reflect.bind(listener);
    const result = this.bail(this.ctx, "internal/listener", name2, listener, options);
    if (result) return result;
    const hooks = this._hooks[name2] ||= [];
    const label = `ctx.on(${typeof name2 === "string" ? JSON.stringify(name2) : name2.toString()})`;
    return this.register(label, hooks, listener, options);
  }
  /**
  * Register an event listener that disposes itself after the first call.
  *
  * @param name — the event name to listen for.
  * @param listener — called at most once with the dispatch arguments.
  * @param options — listener options; a boolean is shorthand for `prepend`.
  * @returns a disposer removing the listener; `true` if it was still registered.
  */
  once(name2, listener, options) {
    const dispose = this.on(name2, function(...args) {
      dispose();
      return listener.apply(this, args);
    }, options);
    return dispose;
  }
};
var defaultFormatters = {
  s: (value) => String(value),
  d: (value) => Math.trunc(Number(value)),
  i: (value) => Math.trunc(Number(value)),
  f: (value) => Number(value),
  o: (value) => JSON.stringify(value),
  O: (value) => JSON.stringify(value),
  c: () => "",
  C: (value, exporter, message) => {
    return Logger.color(exporter, Logger.code(message.name, exporter.colors), value);
  }
};
function isAggregateError(error) {
  return error instanceof Error && Array.isArray(error["errors"]);
}
var Logger = class {
  service;
  static color(exporter, code, value, decoration = "") {
    if (!exporter.colors) return "" + value;
    return `\x1B[3${code < 8 ? code : "8;5;" + code}${exporter.colors >= 2 ? decoration : ""}m${value}\x1B[0m`;
  }
  static code(name2, level) {
    let hash = 0;
    for (let i = 0; i < name2.length; i++) {
      hash = (hash << 3) - hash + name2.charCodeAt(i) + 13;
      hash |= 0;
    }
    const colors = !level ? [] : level >= 2 ? c256 : c16;
    return colors[Math.abs(hash) % colors.length];
  }
  static format(exporter, message) {
    const args = message.args.slice();
    if (args[0] instanceof Error) {
      args[0] = args[0].stack || args[0].message;
      args.unshift("%s");
    } else if (typeof args[0] !== "string") args.unshift("%o");
    let format = args.shift();
    format = format.replace(/%([a-zA-Z%])/g, (match, char) => {
      if (match === "%%") return "%";
      const formatter = exporter.formatters?.[char] ?? defaultFormatters[char];
      if (typeof formatter === "function") return formatter(args.shift(), exporter, message);
      return match;
    });
    const oFormatter = exporter.formatters?.o ?? defaultFormatters.o;
    for (let arg of args) {
      if (typeof arg === "object" && arg) arg = oFormatter(arg, exporter, message);
      format += " " + arg;
    }
    const { maxLength = 10240 } = exporter;
    return format.split(/\r?\n/g).map((line) => {
      return line.slice(0, maxLength) + (line.length > maxLength ? "..." : "");
    }).join("\n");
  }
  constructor(options, service) {
    this.service = service;
    Object.assign(this, options);
    this.error = this._method("error", 0);
    this.info = this._method("info", 1);
    this.warn = this._method("warn", 2);
    this.debug = this._method("debug", 3);
  }
  _method(type, level) {
    return (...args) => {
      if (args.length === 1 && args[0] instanceof Error) {
        if (args[0].cause) this[type](args[0].cause);
        else if (isAggregateError(args[0])) {
          args[0].errors.forEach((error) => this[type](error));
          return;
        }
      }
      const sn = ++this.service._snMessage;
      const ts = Date.now();
      for (const exporter of this.service.exporters.values()) {
        if ((exporter.levels?.[this.name] ?? exporter.levels?.default ?? this.level ?? 1) < level) continue;
        const message = {
          sn,
          ts,
          type,
          level,
          name: this.name,
          ...this.meta,
          args
        };
        exporter.export(message);
      }
    };
  }
};
var c16 = [
  6,
  2,
  3,
  4,
  5,
  1
];
var c256 = [
  20,
  21,
  26,
  27,
  32,
  33,
  38,
  39,
  40,
  41,
  42,
  43,
  44,
  45,
  56,
  57,
  62,
  63,
  68,
  69,
  74,
  75,
  76,
  77,
  78,
  79,
  80,
  81,
  92,
  93,
  98,
  99,
  112,
  113,
  129,
  134,
  135,
  148,
  149,
  160,
  161,
  162,
  163,
  164,
  165,
  166,
  167,
  168,
  169,
  170,
  171,
  172,
  173,
  178,
  179,
  184,
  185,
  196,
  197,
  198,
  199,
  200,
  201,
  202,
  203,
  204,
  205,
  206,
  207,
  208,
  209,
  214,
  215,
  220,
  221
];
var LoggerService = class LoggerService2 {
  bufferSize = 1e3;
  buffer = [];
  ctx;
  _snMessage = 0;
  _snExporter = 0;
  exporters = /* @__PURE__ */ new Map();
  constructor(ctx) {
    const tracker = {
      property: "ctx",
      noShadow: true
    };
    const self = createCallable("logger", joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker);
    Object.assign(self, this);
    self.ctx = ctx;
    defineProperty(self, symbols.tracker, tracker);
    self.exporter({
      colors: 3,
      export: (message) => {
        self.buffer.push(message);
        if (self.buffer.length > self.bufferSize) self.buffer = self.buffer.slice(-self.bufferSize);
      }
    });
    return self;
  }
  /**
  * Register an exporter and dispose it with the current fiber.
  *
  * @param exporter — the sink that receives structured log messages.
  * @returns a disposer that removes the exporter.
  */
  exporter(exporter) {
    return this.ctx.effect(() => {
      const id = ++this._snExporter;
      this.exporters.set(id, exporter);
      return () => this.exporters.delete(id);
    }, "ctx.logger.exporter()");
  }
  _resolveConfig() {
    let intercept = this.ctx[symbols.intercept];
    const configs = [];
    while ("logger" in intercept) {
      if (Object.hasOwn(intercept, "logger")) configs.unshift(intercept["logger"]);
      intercept = Object.getPrototypeOf(intercept);
    }
    return Object.assign({}, ...configs);
  }
  [symbols.invoke](name2) {
    const config = this._resolveConfig();
    const fiber = (this.ctx[symbols.shadow] ?? this.ctx).fiber;
    name2 ??= config.name;
    name2 ??= hyphenate(fiber.name);
    return new Logger({
      name: name2,
      level: config.level,
      meta: { fiber: new WeakRef(fiber) }
    }, this);
  }
  static {
    for (const type of [
      "error",
      "info",
      "warn",
      "debug"
    ]) LoggerService2.prototype[type] = function(...args) {
      return this()[type](...args);
    };
  }
};
function enhanceError(error) {
  const lines = error.stack.split("\n");
  lines.splice(0, 2, `Error: ${error.message}`);
  error.stack = lines.join("\n");
  return error;
}
var RESERVED_WORDS = ["prototype", "then"];
function isSpecialProperty(prop) {
  return typeof prop === "symbol" || RESERVED_WORDS.includes(prop) || parseInt(prop).toString() === prop || prop.startsWith("_");
}
var ReflectService = class {
  ctx;
  /** Proxy traps implementing service resolution for every context object. */
  static handler = {
    get: (target, prop, ctx) => {
      if (isSpecialProperty(prop)) return Reflect.get(target, prop, ctx);
      if (Reflect.has(target, prop)) return getTraceable(ctx, Reflect.get(target, prop, ctx));
      const error = /* @__PURE__ */ new Error(`cannot get property "${prop}" without inject`);
      try {
        const def = target.reflect.props[prop];
        if (def?.type === "accessor") return def.get.call(ctx, ctx[symbols.receiver], error);
        if (!ctx.fiber.runtime) return ctx.reflect.get(prop, false);
        return ctx.events.waterfall("internal/get", ctx, prop, error, () => {
          const key = target[symbols.isolate][prop];
          let fiber = (ctx[symbols.shadow] ?? ctx).fiber;
          while (true) {
            const impl = fiber.store?.[prop];
            if (impl) return getTraceable(ctx, impl.value);
            if (prop in fiber.inject) {
              error.message = `cannot get required service "${prop}" in inactive context`;
              throw error;
            }
            if (!fiber.runtime) throw error;
            if (fiber.parent[symbols.isolate][prop] !== key) throw error;
            fiber = fiber.parent.fiber;
          }
        });
      } catch (e) {
        throw e === error ? enhanceError(e) : e;
      }
    },
    set: (target, prop, value, ctx) => {
      if (isSpecialProperty(prop)) return Reflect.set(target, prop, value, ctx);
      const error = /* @__PURE__ */ new Error(`cannot set property "${prop}" without provide`);
      const def = target.reflect.props[prop];
      if (!def) {
        if (!ctx.fiber.runtime) return Reflect.set(target, prop, value, ctx);
        throw enhanceError(error);
      }
      try {
        if (def.type === "accessor") {
          if (!def.set) return false;
          return def.set.call(ctx, value, ctx[symbols.receiver], error);
        }
        return ctx.events.waterfall("internal/set", ctx, prop, value, error, () => {
          return ctx.reflect.set(prop, value, error);
        });
      } catch (e) {
        throw e === error ? enhanceError(e) : e;
      }
    },
    has: (target, prop) => {
      if (isSpecialProperty(prop)) return Reflect.has(target, prop);
      if (Reflect.has(target, prop)) return true;
      return !!target.reflect.props[prop];
    }
  };
  /** Service implementations, keyed by isolation label. */
  store = /* @__PURE__ */ Object.create(null);
  /** Declared context properties (services and accessors), by name. */
  props = /* @__PURE__ */ Object.create(null);
  constructor(ctx) {
    this.ctx = ctx;
    defineProperty(this, symbols.tracker, {
      property: "ctx",
      noShadow: true
    });
    this.mixin("reflect", [
      "get",
      "set",
      "provide",
      "accessor",
      "mixin"
    ]);
    this.mixin("fiber", ["runtime", "effect"]);
    this.mixin("registry", ["inject", "plugin"]);
    this.mixin("events", [
      "on",
      "once",
      "parallel",
      "emit",
      "serial",
      "bail",
      "waterfall"
    ]);
  }
  /**
  * Read a service from the store without the inject requirement.
  *
  * @param name — the service name.
  * @param strict — when `true`, only return implementations whose providing
  * fiber is currently active.
  * @returns the service value, or `undefined` when not (yet) provided.
  */
  get(name2, strict = true) {
    return getTraceable(this.ctx, this._getImpl(name2, strict)?.value);
  }
  _getImpl(name2, strict = true) {
    const key = this.ctx[symbols.isolate][name2];
    const impl = key && this.store[key];
    if (!impl) return;
    if (strict && impl.fiber.state !== 2) return;
    return impl;
  }
  /**
  * Overwrite a provided service's value.
  *
  * @param name — the service name.
  * @param value — the new service value.
  * @param error — carrier for the caller stack in diagnostics.
  * @returns `true` on success.
  * @throws when `name` was never provided, or was provided by another fiber.
  */
  set(name2, value, error) {
    const key = this.ctx[symbols.isolate][name2];
    const impl = this.store[key];
    if (!impl) throw new Error(`cannot set property "${name2}" without provide`);
    if (impl.fiber !== this.ctx.fiber) throw new Error(`cannot set property "${name2}" in multiple fibers`);
    impl.value = value;
    return true;
  }
  /**
  * Register a service implementation owned by the current fiber.
  *
  * See the `ctx.provide()` overload above for the full contract.
  *
  * @param name — the service name.
  * @param value — the service value.
  * @param check — optional availability predicate for dependents.
  * @returns a disposer that unregisters the service.
  */
  provide(name2, value, check) {
    return this.ctx.fiber.effect(() => {
      if (!this.props[name2]) this.props[name2] ??= { type: "service" };
      else if (this.props[name2].type !== "service") throw new Error(`property "${name2}" is already declared as ${this.props[name2].type}`);
      this.props[name2] = { type: "service" };
      this.ctx.root[symbols.isolate][name2] ??= Symbol(name2);
      const key = this.ctx[symbols.isolate][name2];
      const impl = {
        name: name2,
        value,
        fiber: this.ctx.fiber,
        check
      };
      if (this.store[key]) throw new Error(`service "${name2}" has been registered at <${this.store[key].fiber.name}>`);
      this.store[key] = impl;
      this.ctx.fiber.store[name2] = impl;
      if (this.ctx.fiber.state === 2) this.notify([name2]);
      return async () => {
        delete this.store[key];
        const fibers = this.notify([name2]);
        await Promise.allSettled(fibers.map((fiber) => fiber.await()));
        delete this.ctx.fiber.store[name2];
      };
    }, `ctx.provide(${JSON.stringify(name2)})`);
  }
  /**
  * Re-evaluate every fiber that requires one of the given services.
  *
  * @param names — the service names that changed.
  * @param filter — restricts notification to matching isolation scopes.
  * @returns the fibers whose dependency state was refreshed.
  */
  notify(names, filter = (ctx, name2) => ctx[symbols.isolate][name2] === this.ctx[symbols.isolate][name2]) {
    const fibers = [];
    for (const runtime of this.ctx.registry.values()) for (const fiber of runtime.fibers) {
      let hasUpdate = false;
      for (const name2 of names) {
        if (!(name2 in fiber.inject)) continue;
        if (!filter(fiber.ctx, name2)) continue;
        hasUpdate = true;
        fiber._checkImpl(name2);
      }
      if (!hasUpdate) continue;
      fiber._refresh();
      fibers.push(fiber);
    }
    for (const name2 of names) {
      const self = Object.create(this.ctx);
      self[symbols.filter] = (target) => filter(target, name2);
      this.ctx.events.emit(self, "internal/service", name2, this._getImpl(name2, false)?.value);
    }
    return fibers;
  }
  /**
  * Define a computed context property backed by get/set hooks.
  *
  * @param name — the context property name.
  * @param options — the `get` hook and optional `set` hook.
  * @returns a disposer that removes the accessor.
  */
  accessor(name2, options) {
    return this.ctx.fiber.effect(() => {
      if (name2 in this.props) throw new Error(`property "${name2}" is already declared as ${this.props[name2].type}`);
      this.props[name2] = {
        type: "accessor",
        ...options
      };
      return () => delete this.props[name2];
    }, `ctx.accessor(${JSON.stringify(name2)})`);
  }
  /**
  * Expose selected members of a service directly on `ctx`.
  *
  * See the `ctx.mixin()` overload above for the full contract.
  *
  * @param source — a context property name or a source object.
  * @param mixins — keys to forward, or a source-key → ctx-key map.
  * @returns a disposer that removes all created accessors.
  */
  mixin(source, mixins) {
    const self = this;
    return this.ctx.fiber.effect(function* () {
      const entries = Array.isArray(mixins) ? mixins.map((key) => [key, key]) : Object.entries(mixins);
      const getTarget = (ctx, error) => {
        return ctx[source];
      };
      for (const [key, value] of entries) yield self.accessor(value, {
        get(receiver, error) {
          const service = getTarget(this, error);
          if (isNullable(service)) return service;
          const mixin = receiver ? withProps(receiver, service) : service;
          const value2 = Reflect.get(service, key, mixin);
          if (typeof value2 !== "function") return value2;
          return value2.bind(mixin ?? service);
        },
        set(value2, receiver, error) {
          const service = getTarget(this, error);
          const mixin = receiver ? withProps(receiver, service) : service;
          return Reflect.set(service, key, value2, mixin);
        }
      });
    }, `ctx.mixin(${JSON.stringify(source)})`);
  }
  /**
  * Attach this context's tracing wrapper to a value.
  *
  * @param value — the value to wrap.
  * @returns the traceable wrapper (or the value itself when not applicable).
  */
  trace(value) {
    return getTraceable(this.ctx, value);
  }
  /**
  * Wrap a callback so calls trace `this` and arguments to this context.
  *
  * @param callback — the function to wrap.
  * @returns a proxy delegating to `callback` with traced values.
  */
  bind(callback) {
    return new Proxy(callback, {
      apply: (target, thisArg, args) => {
        return Reflect.apply(target, this.trace(thisArg), args.map((arg) => this.trace(arg)));
      },
      construct: (target, args, newTarget) => {
        return Reflect.construct(target, args.map((arg) => this.trace(arg)), newTarget);
      }
    });
  }
};
var kValidationError2 = Symbol.for("ValidationError");
var ValidationError2 = class extends TypeError {
  name = "ValidationError";
  /**
  * Build the aggregated message from schema issues.
  *
  * @param issues — the standard-schema issues, one message line each.
  */
  constructor(issues) {
    super(`invalid config:
` + issues.map((issue) => {
      if (issue.path) return `  - ${issue.message} (at ${issue.path.join(".")})`;
      else return `  - ${issue.message}`;
    }).join("\n"));
  }
};
Object.defineProperty(ValidationError2.prototype, kValidationError2, { value: true });
function resolveConfig(runtime, config) {
  if (!runtime.Config) return config;
  const result = runtime.Config["~standard"].validate(config);
  if ("then" in result) throw new TypeError("Async config validation is not supported");
  if (result.issues) throw new ValidationError2(result.issues);
  else return result.value;
}
var effectInertia = /* @__PURE__ */ new WeakMap();
function runDisposable(dispose) {
  const result = dispose();
  return effectInertia.get(dispose)?.() ?? result;
}
function emitPluginDisposed(context, fiber) {
  const args = ["internal/plugin", fiber];
  let callbacks;
  try {
    callbacks = context.events.dispatch("emit", args);
  } catch (error) {
    context.logger.error(error);
    return;
  }
  for (const callback of callbacks) try {
    const returned = callback(...args);
    Promise.resolve(returned).catch((error) => context.logger.error(error));
  } catch (error) {
    context.logger.error(error);
  }
}
var CordisError = class CordisError2 extends Error {
  code;
  /**
  * @param code — the stable error code; also the default message.
  * @param message — optional human-readable override.
  */
  constructor(code, message) {
    super(message ?? CordisError2.Code[code]);
    this.code = code;
  }
};
(function(CordisError3) {
  CordisError3.Code = { INACTIVE_EFFECT: "cannot create effect on inactive context" };
})(CordisError || (CordisError = {}));
var INACTIVE = "__INACTIVE__";
var Fiber = class {
  parent;
  inject;
  runtime;
  /** Unique id within the registry; 0 for the root fiber, `null` once disposed. */
  uid;
  /** The context this fiber's plugin runs in (extends the parent context). */
  ctx;
  /** The validated plugin config (updated by `update()`). */
  config;
  /** The raw plugin config, re-resolved before each activation. */
  _config;
  /** Current lifecycle state; transitions emit `internal/status`. */
  state = 0;
  /** Dispose this fiber: unload the plugin, then settle once cleanup finished. */
  dispose;
  /** Snapshot of required service implementations while loaded; `undefined` otherwise. */
  store;
  /** The in-flight load/unload transition, if one is currently running. */
  inertia;
  _hooks = /* @__PURE__ */ Object.create(null);
  _disposables = new DisposableList();
  context;
  _error;
  _runner;
  _store = /* @__PURE__ */ Object.create(null);
  /**
  * Create a fiber. Plugin authors normally obtain fibers from `ctx.plugin()`
  * rather than constructing them directly.
  *
  * @param parent — the context the plugin was loaded from.
  * @param config — raw config, validated against the runtime's schema.
  * @param inject — resolved dependency map (service name → intercept config).
  * @param runtime — the shared plugin runtime, or `null` for the root fiber.
  * @param getOuterStack — captures the caller stack for effect diagnostics.
  */
  constructor(parent, config, inject2, runtime, getOuterStack) {
    this.parent = parent;
    this.inject = inject2;
    this.runtime = runtime;
    this._config = config;
    const collect = (dispose) => {
      this._disposables.push(dispose);
    };
    if (runtime) {
      this.uid = parent.registry.counter;
      this.ctx = this.context = parent.extend({ fiber: this });
      const injectEntries = Object.entries(this.inject);
      if (injectEntries.length) {
        this.ctx[Context.intercept] = Object.create(parent[Context.intercept]);
        for (const [name2, config2] of injectEntries) {
          if (isNullable(config2)) continue;
          this.ctx[Context.intercept][name2] = config2;
        }
      }
      this._runner = {
        epoch: INACTIVE,
        getOuterStack,
        execute: function() {
          if (isConstructor(runtime.callback)) {
            const instance = new runtime.callback(this.ctx, this.config);
            for (const hook of instance?.[symbols.initHooks] ?? []) hook();
            return instance?.[symbols.init]?.();
          } else return runtime.callback(this.ctx, this.config);
        },
        collect
      };
      this.dispose = parent.fiber.effect(() => {
        const remove = runtime.fibers.push(this);
        return async () => {
          this.uid = null;
          emitPluginDisposed(this.context, this);
          if (this.ctx.registry.has(runtime.callback)) {
            remove();
            if (!runtime.fibers.length) this.ctx.registry.delete(runtime.callback);
          }
          this._setEpoch(INACTIVE);
          if (!this.inertia) this._updateState(() => {
            this.inertia = this._unload();
            return 5;
          });
          while (this.inertia) await this.inertia;
        };
      }, "ctx.plugin()");
      try {
        this.context.emit("internal/plugin", this);
      } catch (error) {
        Promise.resolve(this.dispose()).catch((reason) => this.ctx.logger.error(reason));
        throw error;
      }
      if (this.uid !== null && parent.fiber.state !== 5) {
        for (const name2 of Object.keys(this.inject)) this._checkImpl(name2);
        this._refresh();
      }
    } else {
      this.uid = 0;
      this.ctx = this.context = parent;
      this.state = 2;
      this.store = /* @__PURE__ */ Object.create(null);
      this._runner = {
        epoch: "",
        getOuterStack,
        execute: () => {
        },
        collect
      };
      this.dispose = () => this.restart();
    }
  }
  /** The plugin's display name, inherited from the nearest named ancestor, else `'root'`. */
  get name() {
    let fiber = this;
    do {
      if (fiber.runtime?.name) return fiber.runtime.name;
      fiber = fiber.parent.fiber;
    } while (fiber !== fiber.parent.fiber);
    return "root";
  }
  /**
  * Throw if the fiber has already been disposed.
  *
  * @returns nothing when the fiber is still active.
  * @throws {CordisError} `INACTIVE_EFFECT` when the fiber's uid has been cleared.
  */
  assertActive() {
    if (this.uid !== null) return;
    throw new CordisError("INACTIVE_EFFECT");
  }
  _execute(runner) {
    const oldEpoch = runner.epoch;
    return composeError((info) => {
      const safeCollect = (dispose) => {
        if (typeof dispose === "function") runner.collect(dispose);
        else if (!isNullable(dispose)) throw new TypeError("Invalid effect");
      };
      const effect = runner.execute.call(this);
      if (typeof effect === "function") return runner.collect(effect);
      else if (isNullable(effect)) {
      } else if (!isObject(effect)) throw new TypeError("Invalid effect");
      else if ("then" in effect) return effect.then(safeCollect);
      else if (Symbol.iterator in effect) {
        info.error = /* @__PURE__ */ new Error();
        const iter = effect[Symbol.iterator]();
        while (true) {
          const result = iter.next();
          safeCollect(result.value);
          if (result.done) return;
        }
      } else if (Symbol.asyncIterator in effect) {
        const iter = effect[Symbol.asyncIterator]();
        return (async () => {
          await Promise.resolve();
          info.error = /* @__PURE__ */ new Error();
          while (true) {
            if (runner.epoch !== oldEpoch) return;
            const result = await iter.next();
            safeCollect(result.value);
            if (result.done) return;
          }
        })();
      } else throw new TypeError("Invalid effect");
    }, runner.getOuterStack);
  }
  effect(execute, label = "anonymous") {
    this.assertActive();
    if (this.state === 5) throw new CordisError("INACTIVE_EFFECT");
    const disposables = [];
    let disposing = false;
    let disposalTask;
    const dispose = () => {
      if (disposing) return disposalTask;
      disposing = true;
      let task2;
      for (const disposable of disposables.splice(0).reverse()) if (task2) task2 = task2.then(() => runDisposable(disposable));
      else {
        const result = runDisposable(disposable);
        if (isObject(result) && "then" in result) task2 = result;
      }
      return disposalTask = task2;
    };
    const meta = {
      label,
      children: []
    };
    const runner = {
      execute,
      epoch: true,
      collect: (dispose2) => {
        disposables.push(dispose2);
        this._disposables.delete(dispose2);
        if (dispose2[symbols.effect]) meta.children.push(dispose2[symbols.effect]);
      },
      getOuterStack: buildOuterStack()
    };
    let task;
    let executing = true;
    let resolveSetup;
    let rejectSetup;
    let setupBarrier;
    let setupFailed = false;
    let inFlight;
    let removeWrapper = () => false;
    const waitForSetup = () => {
      setupBarrier ??= new Promise((resolve2, reject) => {
        resolveSetup = resolve2;
        rejectSetup = reject;
      });
      return setupBarrier;
    };
    const disposeAfter = (setup) => {
      return Promise.resolve(setup).then(() => dispose(), async (reason) => {
        await dispose();
        throw reason;
      });
    };
    const finalizeDisposal = (callback) => {
      let result;
      try {
        result = callback();
      } catch (error) {
        removeWrapper();
        throw error;
      }
      if (isObject(result) && "then" in result) {
        const pending = Promise.resolve(result).finally(() => {
          removeWrapper();
          if (inFlight === pending) inFlight = void 0;
        });
        return inFlight = pending;
      }
      removeWrapper();
      return result;
    };
    const wrapper = defineProperty(() => {
      if (!runner.epoch) return setupFailed ? inFlight : void 0;
      runner.epoch = false;
      return finalizeDisposal(() => {
        if (executing) return disposeAfter(waitForSetup());
        return task ? disposeAfter(task) : dispose();
      });
    }, symbols.effect, meta);
    effectInertia.set(wrapper, () => inFlight);
    removeWrapper = this._disposables.push(wrapper);
    try {
      task = this._execute(runner);
    } catch (reason) {
      executing = false;
      setupFailed = true;
      runner.epoch = false;
      let cleanup;
      try {
        cleanup = finalizeDisposal(dispose);
      } finally {
        rejectSetup?.(reason);
      }
      if (isObject(cleanup) && "then" in cleanup) cleanup.catch((error) => this.ctx.logger.error(error));
      throw reason;
    }
    executing = false;
    if (setupBarrier) Promise.resolve(task).then(resolveSetup, rejectSetup);
    task?.catch(() => {
      if (!runner.epoch) return dispose();
      return finalizeDisposal(dispose);
    }).catch((error) => this.ctx.logger.error(error));
    const disposeAsync = () => {
      if (!runner.epoch) return;
      runner.epoch = false;
      return finalizeDisposal(dispose);
    };
    wrapper.then = async (onFulfilled, onRejected) => {
      return Promise.resolve(task).then(() => disposeAsync).then(onFulfilled, onRejected);
    };
    return wrapper;
  }
  /**
  * Return metadata for currently registered effects.
  *
  * @returns one {@link EffectMeta} tree per labeled live effect.
  */
  getEffects() {
    return [...this._disposables].map((dispose) => dispose[symbols.effect]).filter(Boolean);
  }
  _getState() {
    if (this.uid === null) return 4;
    if (this._error) return 3;
    if (this._runner.epoch !== INACTIVE) return 2;
    return 0;
  }
  _updateState(callback) {
    const oldState = this.state;
    this.state = callback() ?? this._getState();
    if (oldState === this.state) return;
    this.context.emit("internal/status", this, oldState);
    if (oldState !== 2 && this.state !== 2) return;
    for (const key of Reflect.ownKeys(this.ctx.reflect.store)) {
      const impl = this.ctx.reflect.store[key];
      if (impl.fiber !== this) continue;
      this.ctx.reflect.notify([impl.name]);
    }
  }
  _checkImpl(name2) {
    const impl = this.ctx.reflect._getImpl(name2, true);
    if (!impl) return delete this._store[name2];
    try {
      if (impl.check && !impl.check.call(getTraceable(this.ctx, impl.value))) return delete this._store[name2];
    } catch (error) {
      impl.fiber.ctx.logger.error(error);
      return delete this._store[name2];
    }
    this._store[name2] = impl;
  }
  _refresh() {
    let epoch = false;
    epoch = "";
    for (const name2 of Object.keys(this.inject)) {
      const impl = this._store[name2];
      if (!impl) {
        epoch = INACTIVE;
        break;
      }
      epoch += ":" + impl.fiber.uid;
    }
    this._setEpoch(epoch);
  }
  _setEpoch(epoch) {
    const oldEpoch = this._runner.epoch;
    if (epoch === oldEpoch) return;
    this._runner.epoch = epoch;
    if (this.inertia) return;
    this._updateState(() => {
      if (epoch !== INACTIVE && oldEpoch === INACTIVE) {
        this.inertia = this._reload();
        return 1;
      } else {
        this.inertia = this._unload();
        return 5;
      }
    });
  }
  _resolveConfig(config) {
    config = this.context.waterfall(this, "internal/config", config, () => config);
    return this.runtime ? resolveConfig(this.runtime, config) : config;
  }
  async _reload() {
    this.store = { ...this._store };
    const oldEpoch = this._runner.epoch;
    try {
      await Promise.resolve();
      if (this._runner.epoch === oldEpoch) {
        this.config = this._resolveConfig(this._config);
        await this._execute(this._runner);
        this._error = void 0;
      }
    } catch (reason) {
      this.ctx.logger.error(reason);
      this._error = reason;
      this._runner.epoch = INACTIVE;
    }
    this._updateState(() => {
      if (this._runner.epoch === oldEpoch) this.inertia = void 0;
      else {
        this.inertia = this._unload();
        return 5;
      }
    });
  }
  async _unload() {
    await Promise.all(this._disposables.clear().map(async (dispose) => {
      try {
        await composeError(async (info) => {
          await Promise.resolve();
          info.error = /* @__PURE__ */ new Error();
          await runDisposable(dispose);
        }, this._runner.getOuterStack);
      } catch (reason) {
        this.ctx.logger.error(reason);
      }
    }));
    this.store = void 0;
    this._updateState(() => {
      if (this._runner.epoch === INACTIVE) this.inertia = void 0;
      else {
        this.inertia = this._reload();
        return 1;
      }
    });
  }
  /**
  * Wait for current lifecycle work and rethrow startup errors.
  *
  * @returns this fiber, once it has settled into a stable state.
  * @throws the config-validation or plugin-startup error, if any.
  */
  async await() {
    while (this.inertia) await this.inertia;
    if (this._error) throw this._error;
    return this;
  }
  /**
  * Dispose and immediately reload this plugin with its current config.
  *
  * @returns a promise resolving once the reload settled.
  * @throws {CordisError} `INACTIVE_EFFECT` when the fiber is already disposed.
  */
  async restart() {
    this.assertActive();
    this._setEpoch(INACTIVE);
    this._refresh();
    await this.await();
  }
  /**
  * Validate and apply new config, then restart the plugin.
  *
  * Runs the `internal/update` waterfall first, so update hooks (and HMR)
  * can veto or replace the restart.
  *
  * @param config — the new raw config; validated before anything restarts.
  * @param noSave — hint for persistence hooks not to write the change back.
  * @returns nothing; the restart runs behind the `internal/update` waterfall.
  * @throws {ValidationError} when the new config fails validation.
  */
  update(config, noSave = false) {
    this.assertActive();
    this._config = config;
    if (this.state !== 2) {
      this._error = void 0;
      this._setEpoch(INACTIVE);
      this._refresh();
      return;
    }
    config = this._resolveConfig(config);
    this.context.waterfall(this, "internal/update", config, noSave, () => {
      this.config = config;
      this._error = void 0;
      return this.restart();
    });
  }
};
function isApplicable(object) {
  return object && typeof object === "object" && typeof object.apply === "function";
}
function Inject(name2, config) {
  return function(value, decorator) {
    if (decorator.kind === "class") {
      if (!Object.hasOwn(value, "inject")) {
        defineProperty(value, "inject", Object.create(Object.getPrototypeOf(value).inject ?? null));
        defineProperty(value.inject, symbols.checkProto, true);
      }
      value.inject[name2] = config;
    } else if (decorator.kind === "method") {
      const inject2 = (value[symbols.metadata] ??= {}).inject ??= /* @__PURE__ */ Object.create(null);
      inject2[name2] = config;
      decorator.addInitializer(function() {
        const property2 = this[symbols.tracker]?.property;
        (this[symbols.initHooks] ??= []).push(() => {
          this.ctx.inject(inject2, (ctx) => {
            return value.call(property2 ? withProps(this, { [property2]: ctx }) : this);
          });
        });
      });
    } else throw new Error("@Inject() can only be used on class or class methods");
  };
}
(function(Inject2) {
  function resolve2(inject2, result = /* @__PURE__ */ Object.create(null)) {
    if (!inject2) return result;
    if (Array.isArray(inject2)) for (const name2 of inject2) result[name2] = null;
    else if (Reflect.has(inject2, symbols.checkProto)) {
      Object.assign(result, resolve2(Object.getPrototypeOf(inject2)));
      for (const name2 of Object.keys(inject2)) result[name2] = inject2[name2] ?? null;
    } else for (const name2 of Object.keys(inject2)) result[name2] = inject2[name2] ?? null;
    return result;
  }
  Inject2.resolve = resolve2;
})(Inject || (Inject = {}));
var RegistryService = class {
  ctx;
  _counter = 0;
  _internal = /* @__PURE__ */ new Map();
  constructor(ctx) {
    this.ctx = ctx;
    defineProperty(this, symbols.tracker, {
      property: "ctx",
      noShadow: true
    });
  }
  /** Allocate the next fiber uid (increments on every read). */
  get counter() {
    return ++this._counter;
  }
  /** Number of registered plugin runtimes. */
  get size() {
    return this._internal.size;
  }
  /**
  * Resolve a supported plugin shape to its executable callback.
  *
  * @param plugin — a function, class, or `{ apply }` object plugin.
  * @returns the callback identifying the plugin, or `undefined` if invalid.
  */
  resolve(plugin) {
    try {
      if (typeof plugin === "function") return plugin;
      if (isApplicable(plugin)) return plugin.apply;
    } catch {
    }
  }
  /**
  * Look up the runtime record for a plugin.
  *
  * @param plugin — any supported plugin shape.
  * @returns the runtime, or `undefined` when the plugin is not registered.
  */
  get(plugin) {
    const key = this.resolve(plugin);
    return key && this._internal.get(key);
  }
  /**
  * Check whether a plugin has a registered runtime.
  *
  * @param plugin — any supported plugin shape.
  * @returns `true` when at least one fiber of the plugin exists.
  */
  has(plugin) {
    const key = this.resolve(plugin);
    return !!key && this._internal.has(key);
  }
  /**
  * Dispose every running fiber for a plugin and remove its runtime record.
  *
  * @param plugin — any supported plugin shape.
  * @returns the removed runtime, or `undefined` when none was registered.
  */
  delete(plugin) {
    const key = this.resolve(plugin);
    const runtime = key && this._internal.get(key);
    if (!runtime) return;
    this._internal.delete(key);
    for (const fiber of runtime.fibers) fiber.dispose();
    return runtime;
  }
  /** Iterate the registered plugin callbacks. */
  keys() {
    return this._internal.keys();
  }
  /** Iterate the registered plugin runtimes. */
  values() {
    return this._internal.values();
  }
  /** Iterate `[callback, runtime]` pairs. */
  entries() {
    return this._internal.entries();
  }
  /**
  * Visit every registered runtime.
  *
  * @param callback — receives each runtime and its identifying callback.
  */
  forEach(callback) {
    return this._internal.forEach(callback);
  }
  /**
  * Start a callback once the requested dependencies are available.
  *
  * @param inject — required services, as an array or a name → config map.
  * @param callback — plugin body called with `(ctx, config)`.
  * @returns the fiber; awaiting it settles once loading finished.
  */
  inject(inject2, callback) {
    return this.plugin({
      inject: inject2,
      apply: callback,
      name: callback.name
    });
  }
  /**
  * Start a plugin in the current context and return its fiber.
  *
  * Creates (or reuses) the plugin's runtime record, then starts a new fiber
  * under the current context. Throws if `plugin` is not a supported shape or
  * if the current fiber is already disposed.
  *
  * @param plugin — a function, class, or `{ apply }` object plugin.
  * @param config — the plugin config, validated against its `Config` schema.
  * @param getOuterStack — captures the caller stack for effect diagnostics.
  * @returns the fiber; awaiting it settles once loading finished.
  */
  plugin(plugin, config, getOuterStack = buildOuterStack()) {
    const callback = this.resolve(plugin);
    if (!callback) throw new Error('invalid plugin, expect function or object with an "apply" method, received ' + typeof plugin);
    this.ctx.fiber.assertActive();
    let runtime = this._internal.get(callback);
    if (!runtime) {
      let name2 = plugin.name;
      if (name2 === "apply") name2 = void 0;
      runtime = {
        name: name2,
        callback,
        fibers: new DisposableList(),
        Config: plugin.Config
      };
      this._internal.set(callback, runtime);
    }
    const fiber = new Fiber(this.ctx, config, Inject.resolve(plugin.inject), runtime, getOuterStack);
    const wrapped = Object.create(fiber);
    wrapped.then = (onFulfilled, onRejected) => {
      return fiber.await().then(onFulfilled, onRejected);
    };
    return wrapped;
  }
};
var Context = class Context2 {
  /** Symbol key under which a disposer exposes its {@link EffectMeta} diagnostics tree. */
  static effect = symbols.effect;
  /** Symbol key for a context's listener filter, consulted on every event dispatch. */
  static filter = symbols.filter;
  /** Symbol key of the isolation map (see the `Context[symbols.isolate]` property). */
  static isolate = symbols.isolate;
  /** Symbol key of the intercept map (see the `Context[symbols.intercept]` property). */
  static intercept = symbols.intercept;
  /**
  * Returns true for Cordis context proxies and context prototypes.
  *
  * Works across realms and across multiple copies of cordis, because the
  * brand is keyed by a global symbol rather than by `instanceof`.
  *
  * @param value — the value to test.
  * @returns `true` if `value` is a Cordis context, narrowing its type.
  */
  static is(value) {
    return !!value?.[Context2.is];
  }
  static {
    Context2.is[Symbol.toPrimitive] = () => Symbol.for("cordis.is");
    Context2.prototype[Context2.is] = true;
  }
  /** Create the root context and install the built-in services. */
  constructor() {
    this[symbols.isolate] = /* @__PURE__ */ Object.create(null);
    this[symbols.intercept] = /* @__PURE__ */ Object.create(null);
    const self = new Proxy(this, ReflectService.handler);
    this.root = self;
    this.baseUrl = void 0;
    this.fiber = new Fiber(self, {}, /* @__PURE__ */ Object.create(null), null, () => []);
    this.reflect = new ReflectService(self);
    this.registry = new RegistryService(self);
    this.events = new EventsService(self);
    this.logger = new LoggerService(self);
    this.fiber._disposables.clear();
    return self;
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return `Context <${this.fiber.name}>`;
  }
  /**
  * Create a child context with extra metadata on top of the current scope.
  *
  * The child prototypally inherits every property of this context; own
  * properties of `meta` shadow the inherited ones. The parent is not mutated.
  *
  * @param meta — own properties (including symbol keys) to define on the child.
  * @returns a child context inheriting from this one.
  */
  extend(meta = {}) {
    const shadow = Reflect.getOwnPropertyDescriptor(this, symbols.shadow)?.value;
    const self = Object.create(getTraceable(this, this));
    for (const prop of Reflect.ownKeys(meta)) Object.defineProperty(self, prop, Reflect.getOwnPropertyDescriptor(meta, prop));
    if (!shadow) return self;
    return Object.assign(Object.create(self), { [symbols.shadow]: shadow });
  }
  /**
  * Create a child context with an independent service scope for `name`.
  *
  * Below the returned context, reads and writes of the service `name`
  * resolve against the new label instead of the parent's, so a different
  * implementation can be provided without affecting the parent scope.
  * Passing the same `label` to two `isolate()` calls joins their scopes.
  *
  * @param name — the service name to isolate.
  * @param label — scope label to join; defaults to a fresh unique symbol.
  * @returns a child context whose `name` service resolves in the new scope.
  */
  isolate(name2, label) {
    const shadow = Object.create(this[symbols.isolate]);
    shadow[name2] = label ?? Symbol(name2);
    return this.extend({ [symbols.isolate]: shadow });
  }
  intercept(name2, config) {
    const intercept = Object.create(this[symbols.intercept]);
    intercept[name2] = config;
    return this.extend({ [symbols.intercept]: intercept });
  }
};
var Service = class Service2 {
  ctx;
  /** Symbol key of an instance method run after construction (class plugins). */
  static init = symbols.init;
  /** Symbol key of the availability predicate passed to `ctx.provide()`. */
  static check = symbols.check;
  /** Symbol key of the phantom intercept-config type parameter. */
  static config = symbols.config;
  /** Symbol key of the call body making a service callable (e.g. `ctx.logger()`). */
  static invoke = symbols.invoke;
  /** Symbol key of the helper deriving an extended service instance. */
  static extend = symbols.extend;
  /** Symbol key of the tracker metadata used for context tracing. */
  static tracker = symbols.tracker;
  /** Symbol key of the intercept-config resolution helper below. */
  static resolveConfig = symbols.resolveConfig;
  /** The service name this instance is registered under. */
  name;
  /**
  * Register this instance as `name` in the current context.
  *
  * Calls `ctx.reflect.provide(name, this, this[Service.check])`, so the
  * service is unregistered automatically when the owning fiber unloads.
  * Services with a `[Service.invoke]` body return a callable instance.
  *
  * @param ctx — the context to register in (stored as `this.ctx`).
  * @param name — the service name; defaults to the static `provide` field.
  */
  constructor(ctx, name2) {
    this.ctx = ctx;
    name2 ??= this.constructor["provide"];
    let self = this;
    const tracker = {
      associate: name2,
      property: "ctx"
    };
    if (self[symbols.invoke]) self = createCallable(name2, joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker);
    self.ctx = ctx;
    self.name = name2;
    defineProperty(self, symbols.tracker, tracker);
    self.ctx.reflect.provide(name2, self, this[symbols.check]);
    return self;
  }
  [symbols.filter](ctx) {
    return ctx[symbols.isolate][this.name] === this.ctx[symbols.isolate][this.name];
  }
  [symbols.extend](props) {
    let self;
    if (this[Service2.invoke]) self = createCallable(this.name, this, this[symbols.tracker]);
    else self = Object.create(this);
    return Object.assign(self, props);
  }
  /**
  * Merge intercept config from ancestors with optional base and head values.
  *
  * Entries added closer to the root apply first; `base` is prepended and
  * `head` appended. Uses `Config.merge` when the service declares one,
  * otherwise a shallow `Object.assign`.
  *
  * @param base — lowest-precedence config merged before all intercepts.
  * @param head — highest-precedence config merged after all intercepts.
  * @returns the merged config.
  */
  [symbols.resolveConfig](base, head) {
    let intercept = this.ctx[Context.intercept];
    const configs = [];
    while (this.name in intercept) {
      if (Object.hasOwn(intercept, this.name)) configs.unshift(intercept[this.name]);
      intercept = Object.getPrototypeOf(intercept);
    }
    if (base) configs.unshift(base);
    if (head) configs.push(head);
    if (this["Config"]?.merge) return this["Config"].merge(...configs);
    else return Object.assign({}, ...configs);
  }
  static [Symbol.hasInstance](instance) {
    if (!instance) return false;
    let constructor = instance.constructor;
    while (constructor) {
      constructor = constructor.prototype?.constructor;
      if (constructor === this) return true;
      constructor &&= Object.getPrototypeOf(constructor);
    }
    return false;
  }
};

// node_modules/@deepseek-ai/dsh-compaction/lib/index.js
function CompactionId(id) {
  return id;
}
var balanceCacheBySession = /* @__PURE__ */ new WeakMap();
function eventDelta(event) {
  switch (event.type) {
    case "assistant/message":
      return event.data.message.content.filter((block) => block.type === "tool-call").length;
    case "tool/result":
      return -1;
    default:
      return 0;
  }
}
function extendCache(session, cache, seqs) {
  const processed = cache.cutBalanced.length - 1;
  const tail = seqs.slice(processed);
  const pendingCuts = [];
  let inProgressToolCalls = cache.inProgressToolCalls;
  for (const seq of tail) {
    const event = session.eventAt(seq);
    if (event === void 0 || event.seq !== seq) throw new Error(`tool-pairing balance: surface seq ${seq} has no matching session event (corrupt surface)`);
    inProgressToolCalls += eventDelta(event);
    if (inProgressToolCalls < 0) throw new Error(`tool-pairing balance: tool/result at surface seq ${seq} has no matching tool-call (corrupt surface)`);
    pendingCuts.push(inProgressToolCalls === 0);
  }
  tail.forEach((seq, offset) => cache.indexBySeq.set(seq, processed + offset));
  cache.cutBalanced = cache.cutBalanced.concat(pendingCuts);
  cache.inProgressToolCalls = inProgressToolCalls;
  return cache;
}
function balanceCache(session) {
  const surface = session.surface;
  const seqs = surface.nodes;
  const generation = surface.replaceGeneration;
  const cached = balanceCacheBySession.get(session);
  if (cached === void 0 || cached.generation !== generation || cached.cutBalanced.length - 1 > seqs.length) {
    const rebuilt = extendCache(session, {
      generation,
      cutBalanced: [true],
      indexBySeq: /* @__PURE__ */ new Map(),
      inProgressToolCalls: 0
    }, seqs);
    balanceCacheBySession.set(session, rebuilt);
    return rebuilt;
  }
  if (cached.cutBalanced.length - 1 < seqs.length) return extendCache(session, cached, seqs);
  return cached;
}
function cutBalance(cache, seq, offset) {
  const index = cache.indexBySeq.get(seq);
  const balanced = index === void 0 ? void 0 : cache.cutBalanced[index + offset];
  if (balanced === void 0) throw new Error(`tool-pairing balance: surface seq ${seq} not found`);
  return balanced;
}
function toolPairingBalancedBefore(session, seq) {
  return cutBalance(balanceCache(session), seq, 0);
}
function toolPairingBalancedAfter(session, seq) {
  return cutBalance(balanceCache(session), seq, 1);
}
var COMPACT_CHECKPOINT_MARKER = Object.freeze({ kind: "compact-checkpoint" });
function compactCheckpointSource(compactionId, sourceCommandId) {
  return Object.freeze({
    ...COMPACT_CHECKPOINT_MARKER,
    compactionId,
    ...sourceCommandId === void 0 ? {} : { sourceCommandId }
  });
}
var ManualCompactionError = class extends Error {
  code;
  name = "ManualCompactionError";
  /**
  * Create one classified compaction failure.
  * @param code - stable failure class; `busy` may originate from any compaction entry path.
  * @param message - backend diagnostic retained as the Error message.
  * @param options - optional original failure.
  */
  constructor(code, message, options) {
    super(message, options);
    this.code = code;
  }
};
var CompactionEngine = class extends Service {
  constructor(ctx) {
    super(ctx, "compaction");
  }
};

// node_modules/@deepseek-ai/dsh-llm/lib/index.js
import { createRequire } from "node:module";

// node_modules/@deepseek-ai/dsh-typert-protocol/lib/index.js
var RemoteError = class extends Error {
  code;
  details;
  /** Structural marker: cross-realm/bundle identification never uses instanceof. */
  isDSHRemoteError = true;
  /**
  * @param code - stable failure code declared in {@link RemoteErrorDetailsMap}.
  * @param message - human diagnostic carried across the wire.
  * @param details - structured payload typed by the code.
  * @param options - standard Error options (`cause` survives in-process only).
  */
  constructor(code, message, details, options) {
    super(message, options);
    this.code = code;
    this.details = details;
    this.name = "RemoteError";
  }
};
var TYPERT_OWNED_VALUE = Symbol.for("dsh.typert.owned-value");
var TYPERT_REMOTE_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
function isTypertRemoteSegment(value) {
  return value !== "." && value !== ".." && TYPERT_REMOTE_SEGMENT_PATTERN.test(value);
}
var REMOTE_METHOD_DESCRIPTOR = "@deepseek-ai/dsh-typert-protocol/remote-methods";
function bindTypertRemote(service, serviceKey, options = {}) {
  validateName("service key", serviceKey);
  const namespace = options.namespace ?? serviceKey;
  validateName("namespace", namespace);
  const ctx = Reflect.get(service, "ctx");
  if (Context.is(ctx)) provideInvocationAccessor(ctx);
  return Object.freeze({
    service,
    serviceKey,
    namespace
  });
}
var TypertRemoteService = class extends Service {
  /** Visible binding consumed by the Gateway's source-mode discovery. */
  typertRemote;
  /**
  * Register the Service and bind the same key to Typert Gateway.
  * @param ctx - owning Cordis Context.
  * @param serviceKey - exact Cordis service key and default wire namespace.
  * @param options - optional wire namespace.
  */
  constructor(ctx, serviceKey, options = {}) {
    super(ctx, serviceKey);
    this.typertRemote = bindTypertRemote(this, this.name, options);
  }
};
function provideInvocationAccessor(ctx) {
  if (Object.hasOwn(ctx.root.reflect.props, "invocation")) return;
  ctx.root.accessor("invocation", { get: () => void 0 });
}
function Remote(methodExportOrOptions, context) {
  if (typeof methodExportOrOptions === "string") {
    validateName("Remote export name", methodExportOrOptions);
    return remoteDecorator({ kind: "direct" }, { exportName: methodExportOrOptions });
  }
  if (typeof methodExportOrOptions === "object") return remoteDecorator({ kind: "direct" }, markerOptions(methodExportOrOptions, REMOTE_OPTION_KEYS, 'Remote options require name, mode: "stream", or resources'));
  if (context === void 0) throw new TypeError("typert-protocol: Remote decorator context is missing");
  addMarkerInitializer(context, { kind: "direct" });
}
var REMOTE_OPTION_KEYS = /* @__PURE__ */ new Set([
  "name",
  "mode",
  "resources"
]);
function markerOptions(options, accepted, requirement) {
  const keys = Reflect.ownKeys(options);
  if (keys.length === 0 || keys.some((key) => typeof key !== "string" || !accepted.has(key)) || Object.hasOwn(options, "mode") && options.mode !== "stream") throw new TypeError(`typert-protocol: ${requirement}`);
  const { mode, name: name2, resources } = options;
  if (name2 !== void 0) validateName("Remote export name", name2);
  return {
    ...mode === void 0 ? {} : { mode },
    ...name2 === void 0 ? {} : { exportName: name2 },
    ...resources === void 0 ? {} : { resources: resourceReaders(resources) }
  };
}
function resourceReaders(resources) {
  const readers = {};
  for (const [kind, reader] of Object.entries(resources)) {
    if (typeof reader !== "function") throw new TypeError(`typert-protocol: Remote resource reader "${kind}" must be a function`);
    readers[kind] = reader;
  }
  if (Object.keys(readers).length === 0) throw new TypeError("typert-protocol: Remote resources require at least one reader");
  return Object.freeze(readers);
}
function remoteDecorator(invocation, options = {}) {
  return function(_method, context) {
    addMarkerInitializer(context, invocation, options);
  };
}
function readRemoteMethodDescriptor(prototype) {
  const property2 = Object.getOwnPropertyDescriptor(prototype, REMOTE_METHOD_DESCRIPTOR);
  if (property2 === void 0) return void 0;
  const descriptor = property2.value;
  if (descriptor === null || typeof descriptor !== "object") throw new TypeError("typert-protocol: Remote method descriptor must be an object");
  const version2 = Reflect.get(descriptor, "version");
  if (version2 !== 1) throw new TypeError(`typert-protocol: unsupported Remote method descriptor version ${String(version2)}`);
  const methods = Reflect.get(descriptor, "methods");
  if (!Array.isArray(methods)) throw new TypeError("typert-protocol: Remote method descriptor methods must be an array");
  return descriptor;
}
function addMarkerInitializer(context, invocation, options = {}) {
  if (context.private || context.static || typeof context.name !== "string") throw new TypeError("typert-protocol: Remote decorators require a public instance method with a string name");
  const method = context.name;
  context.addInitializer(function() {
    const prototype = Object.getPrototypeOf(this);
    if (prototype === null) throw new TypeError(`typert-protocol: cannot mark Remote method "${method}" on an object without a prototype`);
    mark(prototype, method, invocation, options);
  });
}
function mark(prototype, method, invocation, { mode, exportName, resources }) {
  const descriptor = readRemoteMethodDescriptor(prototype);
  const marker = Object.freeze({
    method,
    ...exportName === void 0 || exportName === method ? {} : { exportName },
    ...mode === void 0 ? {} : { mode },
    invocation: Object.freeze(invocation),
    ...resources === void 0 ? {} : { resources }
  });
  const current = descriptor?.methods.find((candidate) => candidate.method === method);
  if (current !== void 0) {
    if (current.exportName === marker.exportName && current.mode === marker.mode && current.resources === marker.resources && sameInvocation(current.invocation, invocation)) return;
    throw new Error(`typert-protocol: Remote method "${method}" has conflicting invocation markers`);
  }
  Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze([...descriptor?.methods ?? [], marker])
    })
  });
}
function sameInvocation(left, right) {
  if (left.kind === "direct") return right.kind === "direct";
  if (right.kind === "direct") return false;
  return left.context === right.context;
}
function validateName(subject, value) {
  if (!isTypertRemoteSegment(value)) throw new TypeError(`typert-protocol: ${subject} must contain only RPC endpoint segment characters`);
}

// node_modules/@deepseek-ai/dsh-util-values/lib/index.js
var SIMPLE_ESCAPES = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "	"
};
var CONTENT_ESCAPE = /[\\\u0000-\u001f]/u;
function isWhitespace(c) {
  return c === " " || c === "\n" || c === "\r" || c === "	";
}
function isHex(c) {
  return c >= "0" && c <= "9" || c >= "a" && c <= "f" || c >= "A" && c <= "F";
}
var PartialArguments = class PartialArguments2 {
  /** The view of a call with no arguments available. */
  static EMPTY = PartialArguments2.fromObject({});
  /**
  * View finished argument text without scanning it until a reader asks.
  * @param text - the complete argument JSON text.
  * @returns a sealed view.
  */
  static fromText(text) {
    const view = new PartialArguments2();
    view.append(text);
    view.sealed = true;
    return view;
  }
  /**
  * View an already parsed argument payload, such as a PTC dispatch object.
  * @param value - the parsed argument value.
  * @returns a sealed view; a non-object payload has no fields.
  */
  static fromObject(value) {
    const view = new PartialArguments2();
    view.object = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
    view.sealed = true;
    return view;
  }
  /**
  * The source: text so far or a parsed object, plus whether it can still grow.
  * These are the only enumerable fields, so two views over the same source
  * compare equal structurally however far each has been read.
  */
  chunks = [];
  object;
  sealed = false;
  #ends = [];
  #size = 0;
  #consumed = 0;
  #mode = "root";
  #escape = false;
  #keyStart = 0;
  #keyEscaped = false;
  #key = "";
  #current = null;
  #nestedEnds = [];
  #nestedInString = false;
  #invalidAt;
  #invalidValue = false;
  #entries = /* @__PURE__ */ new Map();
  #order = [];
  #reads = /* @__PURE__ */ new Map();
  /** Whether this view rejects further appends; does not scan text or register reads. */
  get isSealed() {
    return this.sealed;
  }
  /** Whether indexing or a content read found invalid JSON; unread value contents are not validated. */
  get invalid() {
    this.scan();
    return this.#mode === "invalid" || this.#invalidValue;
  }
  /**
  * Retain streamed argument text without scanning or comparing observed answers.
  * @param fragment - the text following every fragment appended before.
  */
  append(fragment) {
    if (this.sealed) throw new Error("PartialArguments: cannot append to a sealed view");
    if (fragment.length === 0) return;
    this.chunks.push(fragment);
    this.#size += fragment.length;
    this.#ends.push(this.#size);
  }
  /**
  * Reconcile a streamed prefix with authoritative complete text without joining the fragments.
  * @param text - the final argument text, which replaces missing or conflicting deltas.
  * @returns this view sealed with its caches retained when every character matches; otherwise a new sealed view.
  */
  settle(text) {
    if (this.object !== void 0 || text.length !== this.#size) return PartialArguments2.fromText(text);
    let offset = 0;
    for (const chunk of this.chunks) {
      if (!text.startsWith(chunk, offset)) return PartialArguments2.fromText(text);
      offset += chunk.length;
    }
    this.chunks = text.length === 0 ? [] : [text];
    this.#ends = text.length === 0 ? [] : [text.length];
    this.sealed = true;
    return this;
  }
  /**
  * Compare observed answers and advance their publication baseline. Unread views remain unscanned.
  * @returns whether any observed answer changed since its first read or the preceding refresh.
  */
  refresh() {
    if (this.#reads.size === 0) return false;
    this.scan();
    let changed = false;
    let completions = false;
    for (const read of this.#reads.values()) {
      if (read.completion) {
        completions = true;
        continue;
      }
      changed = this.refreshRead(read) || changed;
    }
    if (completions) {
      for (const read of this.#reads.values()) if (read.completion) changed = this.refreshRead(read) || changed;
    }
    if (this.sealed) this.#reads.clear();
    return changed;
  }
  refreshRead(read) {
    const now = read.answer();
    if (Object.is(now, read.last)) return false;
    read.last = now;
    return true;
  }
  /**
  * Check whether no further fields can arrive.
  * @returns whether the outer object closed, indexing failed, or the view is sealed; unread values are not validated.
  */
  closed() {
    return this.remember("closed", "", () => this.closedNow());
  }
  /**
  * List discovered fields in first-appearance order.
  * @returns top-level keys seen so far, in first-appearance order.
  */
  keys() {
    return this.remember("keys", "", () => this.keysNow(), (keys) => keys.length);
  }
  /**
  * Check whether a top-level field has appeared.
  * @param key - argument name.
  * @returns whether the field has appeared (a string opened or another value began).
  */
  has(key) {
    return this.remember("has", key, () => this.hasNow(key));
  }
  /**
  * Check whether a field's closing delimiter has arrived, without validating its contents.
  * @param key - argument name.
  * @returns whether its delimiter arrived and no content reader has reported an error for this value.
  */
  complete(key) {
    return this.remember("complete", key, () => this.completeNow(key));
  }
  /**
  * Read string length without materializing its text.
  * @param key - argument name.
  * @param options - change granularity for a streaming string.
  * @returns decoded UTF-16 length of the string field so far; undefined when absent or not a string.
  */
  stringLength(key, options) {
    const step = Math.max(1, Math.floor(options?.step ?? 1));
    const offset = options?.offset ?? 0;
    return this.remember(`length:${step}:${offset}`, key, () => this.lengthNow(key), (length) => length === void 0 ? void 0 : Math.ceil((length + offset) / step));
  }
  /**
  * Check a string against a decoded UTF-16 length limit without materializing it.
  * @param key - argument name.
  * @param maxLength - decoded UTF-16 limit, floored to at least zero.
  * @returns whether the string is longer than the limit; false when absent or not a string.
  */
  stringExceeds(key, maxLength) {
    const limit = Math.max(0, Math.floor(maxLength));
    return this.remember(`exceeds:${limit}`, key, () => (this.lengthNow(key, limit + 1) ?? 0) > limit);
  }
  /**
  * Read a decoded string, including a streaming prefix.
  * @param key - argument name.
  * @returns the string field's decoded text so far; undefined when absent or not a string.
  */
  text(key) {
    return this.remember("text", key, () => this.textNow(key));
  }
  /**
  * Read at most the first decoded UTF-16 units of a string.
  * @param key - argument name.
  * @param maxLength - maximum decoded UTF-16 length, floored to at least one.
  * @returns the bounded string prefix; undefined when absent or not a string.
  */
  textPrefix(key, maxLength) {
    const limit = Math.max(1, Math.floor(maxLength));
    return this.remember(`prefix:${limit}`, key, () => this.textPrefixNow(key, limit));
  }
  /**
  * Read a completed non-string argument.
  * @param key - argument name.
  * @returns the parsed non-string value once it closed; undefined while open, absent, or a string.
  */
  value(key) {
    return this.remember("value", key, () => this.valueNow(key));
  }
  /** Answer a question and, on a streaming view, remember it for change detection. */
  remember(kind, key, read, comparison) {
    this.scan();
    const result = read();
    if (!this.sealed) {
      const id = `${kind}/${key}`;
      if (!this.#reads.has(id)) this.#reads.set(id, {
        completion: kind === "complete",
        answer: comparison === void 0 ? read : () => comparison(read()),
        last: comparison === void 0 ? result : comparison(result)
      });
    }
    return result;
  }
  closedNow() {
    return this.sealed || this.#mode === "closed" || this.#mode === "invalid";
  }
  keysNow() {
    return this.object === void 0 ? this.#order : Object.keys(this.object);
  }
  hasNow(key) {
    return this.object === void 0 ? this.#entries.has(key) : Object.hasOwn(this.object, key);
  }
  completeNow(key) {
    if (this.object !== void 0) return Object.hasOwn(this.object, key);
    const entry = this.#entries.get(key);
    return entry !== void 0 && entry.end >= 0 && (entry.kind === "string" ? entry.invalidAt === void 0 : !entry.invalid);
  }
  lengthNow(key, limit = Number.POSITIVE_INFINITY) {
    if (this.object !== void 0) {
      const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
      return typeof field === "string" ? field.length : void 0;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "string") return void 0;
    if (entry.text !== void 0 && entry.text.at === entry.end) return entry.text.length;
    const read = entry.length ??= {
      at: entry.start,
      length: 0,
      text: ""
    };
    this.readString(entry, read, limit, false);
    return read.length;
  }
  textNow(key) {
    if (this.object !== void 0) {
      const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
      return typeof field === "string" ? field : void 0;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "string") return void 0;
    if (entry.text === void 0 && entry.end >= 0 && entry.needsDecoding && entry.invalidAt === void 0) {
      let text;
      try {
        text = JSON.parse(`"${this.slice(entry.start, entry.end)}"`);
      } catch (_error) {
      }
      if (text !== void 0) entry.text = {
        at: entry.end,
        length: text.length,
        text
      };
    }
    const read = entry.text ??= {
      at: entry.start,
      length: 0,
      text: ""
    };
    this.readString(entry, read, Number.POSITIVE_INFINITY, true);
    return read.text;
  }
  textPrefixNow(key, maxLength) {
    if (this.object !== void 0) {
      const field = Object.hasOwn(this.object, key) ? this.object[key] : void 0;
      return typeof field === "string" ? field.slice(0, maxLength) : void 0;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "string") return void 0;
    const prefixes = entry.prefixes ??= /* @__PURE__ */ new Map();
    let read = prefixes.get(maxLength);
    if (read === void 0) {
      read = {
        at: entry.start,
        length: 0,
        text: ""
      };
      prefixes.set(maxLength, read);
    }
    this.readString(entry, read, maxLength, true);
    return read.text;
  }
  valueNow(key) {
    if (this.object !== void 0) {
      if (!Object.hasOwn(this.object, key)) return void 0;
      const field = this.object[key];
      return typeof field === "string" ? void 0 : field;
    }
    const entry = this.#entries.get(key);
    if (entry?.kind !== "value" || entry.end < 0 || entry.invalid) return void 0;
    if (entry.parsed === void 0) try {
      entry.parsed = JSON.parse(this.slice(entry.start, entry.end));
    } catch (_error) {
      entry.invalid = true;
      this.#invalidValue = true;
    }
    return entry.parsed;
  }
  chunkAt(at) {
    let low = 0;
    let high = this.#ends.length;
    while (low < high) {
      const mid = low + high >>> 1;
      if (this.#ends[mid] <= at) low = mid + 1;
      else high = mid;
    }
    return low;
  }
  /** Materialize only a requested range, never the cumulative source. */
  slice(start, end) {
    if (start >= end) return "";
    const first = this.chunkAt(start);
    const last = this.chunkAt(end - 1);
    const base = first === 0 ? 0 : this.#ends[first - 1];
    if (first === last) return this.chunks[first].slice(start - base, end - base);
    const parts = [this.chunks[first].slice(start - base)];
    for (let i = first + 1; i < last; i++) parts.push(this.chunks[i]);
    parts.push(this.chunks[last].slice(0, end - this.#ends[last - 1]));
    return parts.join("");
  }
  readString(entry, read, limit, materialize) {
    const end = Math.min(entry.end < 0 ? this.#consumed : entry.end, entry.invalidAt ?? Number.POSITIVE_INFINITY, this.#invalidAt ?? Number.POSITIVE_INFINITY);
    if (!entry.needsDecoding) {
      const length = Math.min(end - read.at, limit - read.length);
      if (length <= 0) return;
      if (materialize) read.text += this.slice(read.at, read.at + length);
      read.at += length;
      read.length += length;
      return;
    }
    let chunkIndex = this.chunkAt(read.at);
    while (read.at < end && read.length < limit) {
      const base = chunkIndex === 0 ? 0 : this.#ends[chunkIndex - 1];
      const chunk = this.chunks[chunkIndex];
      const remaining = chunk.slice(read.at - base, Math.min(chunk.length, end - base));
      const boundary = remaining.search(CONTENT_ESCAPE);
      const length = Math.min(boundary < 0 ? remaining.length : boundary, limit - read.length);
      if (length > 0) {
        if (materialize) read.text += remaining.slice(0, length);
        read.at += length;
        read.length += length;
        if (read.at === base + chunk.length) chunkIndex++;
        continue;
      }
      const type = remaining.length > 1 ? remaining[1] : read.at + 1 < end ? this.chunks[chunkIndex + 1][0] : void 0;
      let decoded;
      let width = 2;
      if (remaining[0] === "\\" && type === void 0 && entry.end < 0) return;
      if (remaining[0] === "\\" && type === "u") {
        const hex = this.slice(read.at + 2, Math.min(end, read.at + 6));
        let valid = true;
        for (let i = 0; i < hex.length; i++) if (!isHex(hex[i])) valid = false;
        if (valid) {
          if (hex.length < 4 && entry.end < 0) return;
          if (hex.length === 4) decoded = String.fromCharCode(Number.parseInt(hex, 16));
        }
        width = 6;
      } else if (remaining[0] === "\\" && type !== void 0) decoded = SIMPLE_ESCAPES[type];
      if (decoded === void 0) {
        entry.invalidAt = read.at;
        this.#invalidValue = true;
        return;
      }
      if (materialize) read.text += decoded;
      read.length++;
      read.at += width;
      while (chunkIndex < this.chunks.length && read.at >= this.#ends[chunkIndex]) chunkIndex++;
    }
  }
  /** Locate new field ranges without decoding or parsing their contents. */
  scan() {
    if (this.object !== void 0 || this.#consumed === this.#size) return;
    for (let i = this.chunkAt(this.#consumed); i < this.chunks.length && this.#invalidAt === void 0; i++) {
      const pending = this.chunks[i];
      const base = i === 0 ? 0 : this.#ends[i - 1];
      for (let index = this.#consumed - base; index < pending.length && this.#mode !== "invalid"; index++) {
        if (this.#mode === "string" || this.#mode === "nested" && this.#nestedInString) {
          const end = this.stringBoundary(pending, index);
          this.#consumed += end - index;
          index = end;
          if (index === pending.length) break;
        }
        this.step(pending[index], this.#consumed);
        this.#consumed++;
      }
    }
  }
  /** Only raw quotes and their preceding backslash runs can terminate a string. */
  stringBoundary(fragment, start) {
    let at = start;
    while (true) {
      const quote = fragment.indexOf('"', at);
      const end = quote < 0 ? fragment.length : quote;
      if (this.#mode === "string") {
        const entry = this.#current;
        if (!entry.needsDecoding && CONTENT_ESCAPE.test(fragment.slice(at, end))) entry.needsDecoding = true;
      }
      let slashStart = end;
      while (slashStart > at && fragment[slashStart - 1] === "\\") slashStart--;
      const escaped = (end - slashStart) % 2 === 1 !== (slashStart === at && this.#escape);
      this.#escape = quote < 0 && escaped;
      if (quote < 0 || !escaped) return end;
      at = quote + 1;
    }
  }
  step(c, at) {
    switch (this.#mode) {
      case "root":
        if (isWhitespace(c)) return;
        if (c === "{") {
          this.#mode = "key-or-end";
          return;
        }
        this.fail();
        return;
      case "key-or-end":
        if (isWhitespace(c)) return;
        if (c === "}") {
          this.#mode = "closed";
          return;
        }
        if (c === '"') {
          this.beginKey(at);
          return;
        }
        this.fail();
        return;
      case "key-only":
        if (isWhitespace(c)) return;
        if (c === '"') {
          this.beginKey(at);
          return;
        }
        this.fail();
        return;
      case "key":
        this.stepKey(c, at);
        return;
      case "colon":
        if (isWhitespace(c)) return;
        if (c === ":") {
          this.#mode = "value";
          return;
        }
        this.fail();
        return;
      case "value":
        this.beginValue(c, at);
        return;
      case "string": {
        const entry = this.#current;
        entry.end = at;
        this.#current = null;
        this.#mode = "comma-or-end";
        return;
      }
      case "scalar":
        this.stepScalar(c, at);
        return;
      case "nested":
        this.stepNested(c, at);
        return;
      case "comma-or-end":
        if (isWhitespace(c)) return;
        if (c === ",") {
          this.#mode = "key-only";
          return;
        }
        if (c === "}") {
          this.#mode = "closed";
          return;
        }
        this.fail();
        return;
      case "closed":
        if (isWhitespace(c)) return;
        this.fail();
        return;
      /* v8 ignore next 2 -- scan() stops stepping once the view is invalid. */
      case "invalid":
        return;
      /* v8 ignore next 2 -- Every scanner mode has a handler above. */
      default:
        assertNever(this.#mode);
    }
  }
  fail() {
    this.#invalidAt = this.#consumed;
    this.#mode = "invalid";
    this.#current = null;
  }
  beginKey(at) {
    this.#mode = "key";
    this.#keyStart = at + 1;
    this.#keyEscaped = false;
    this.#escape = false;
  }
  stepKey(c, at) {
    if (c < " ") {
      this.fail();
      return;
    }
    if (this.#escape) {
      this.#escape = false;
      return;
    }
    if (c === "\\") {
      this.#escape = true;
      this.#keyEscaped = true;
      return;
    }
    if (c !== '"') return;
    const raw = this.slice(this.#keyStart, at);
    if (this.#keyEscaped) try {
      this.#key = JSON.parse(`"${raw}"`);
    } catch (_error) {
      this.fail();
      return;
    }
    else this.#key = raw;
    this.#mode = "colon";
  }
  open(entry) {
    if (!this.#entries.has(this.#key)) this.#order.push(this.#key);
    this.#entries.set(this.#key, entry);
    this.#current = entry;
  }
  beginValue(c, at) {
    if (isWhitespace(c)) return;
    if (c === '"') {
      this.open({
        kind: "string",
        start: at + 1,
        end: -1,
        needsDecoding: false,
        invalidAt: void 0,
        length: void 0,
        text: void 0,
        prefixes: void 0
      });
      this.#escape = false;
      this.#mode = "string";
      return;
    }
    if (c === "}" || c === "," || c === ":" || c === "]") {
      this.fail();
      return;
    }
    this.open({
      kind: "value",
      start: at,
      end: -1,
      parsed: void 0,
      invalid: false
    });
    if (c === "{" || c === "[") {
      this.#mode = "nested";
      this.#nestedEnds = [c === "{" ? "}" : "]"];
      this.#nestedInString = false;
      this.#escape = false;
      return;
    }
    this.#mode = "scalar";
  }
  stepScalar(c, at) {
    if (c !== "," && c !== "}" && !isWhitespace(c)) return;
    this.closeValue(at);
    this.#mode = c === "," ? "key-only" : c === "}" ? "closed" : "comma-or-end";
  }
  stepNested(c, at) {
    if (this.#nestedInString) {
      this.#nestedInString = false;
      return;
    }
    if (c === '"') {
      this.#nestedInString = true;
      return;
    }
    if (c === "{" || c === "[") {
      this.#nestedEnds.push(c === "{" ? "}" : "]");
      return;
    }
    if (c === "}" || c === "]") {
      if (this.#nestedEnds.pop() !== c) {
        this.fail();
        return;
      }
      if (this.#nestedEnds.length === 0) {
        this.closeValue(at + 1);
        this.#mode = "comma-or-end";
      }
    }
  }
  closeValue(end) {
    const entry = this.#current;
    entry.end = end;
    this.#current = null;
  }
};
function assertNever(value, context) {
  const rendered = JSON.stringify(value) ?? String(value);
  throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);
}
function hasIntrinsicConstructor(prototype, name2) {
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  if (typeof constructor !== "function") return false;
  try {
    return constructor.name === name2 && constructor.prototype === prototype && Function.prototype.toString.call(constructor) === Function.prototype.toString.call(name2 === "Array" ? Array : Object);
  } catch {
    return false;
  }
}
function isIntrinsicObjectPrototype(value) {
  return Object.getPrototypeOf(value) === null && hasIntrinsicConstructor(value, "Object");
}
function hasPlainArrayPrototype(value) {
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(prototype) || !hasIntrinsicConstructor(prototype, "Array")) return false;
  const objectPrototype = Object.getPrototypeOf(prototype);
  return typeof objectPrototype === "object" && objectPrototype !== null && isIntrinsicObjectPrototype(objectPrototype);
}
function hasPlainObjectPrototype(value) {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || typeof prototype === "object" && isIntrinsicObjectPrototype(prototype);
}
function enumerableStringKeys(value) {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !Object.prototype.propertyIsEnumerable.call(value, key))) return void 0;
  return keys;
}
function walkJsonValue(value, detach) {
  const ancestors = /* @__PURE__ */ new Set();
  let root;
  const assign = (destination, item) => {
    if (destination === void 0) return;
    if (destination.kind === "root") root = item;
    else if (destination.kind === "array") destination.target[destination.index] = item;
    else Object.defineProperty(destination.target, destination.key, {
      value: item,
      enumerable: true,
      configurable: true,
      writable: true
    });
  };
  const tasks = [{
    kind: "visit",
    value,
    ...detach ? { destination: { kind: "root" } } : {}
  }];
  for (let task = tasks.pop(); task !== void 0; task = tasks.pop()) {
    if (task.kind === "leave") {
      ancestors.delete(task.source);
      continue;
    }
    if (task.kind === "array-item") {
      if (!Object.prototype.hasOwnProperty.call(task.source, task.index)) return void 0;
      tasks.push({
        kind: "visit",
        value: task.source[task.index],
        ...task.target === void 0 ? {} : { destination: {
          kind: "array",
          target: task.target,
          index: task.index
        } }
      });
      continue;
    }
    if (task.kind === "object-property") {
      tasks.push({
        kind: "visit",
        value: task.source[task.key],
        ...task.target === void 0 ? {} : { destination: {
          kind: "object",
          target: task.target,
          key: task.key
        } }
      });
      continue;
    }
    const current = task.value;
    if (current === null) {
      assign(task.destination, null);
      continue;
    }
    if (typeof current === "boolean" || typeof current === "string") {
      assign(task.destination, current);
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current) || Object.is(current, -0)) return void 0;
      assign(task.destination, current);
      continue;
    }
    if (typeof current !== "object") return void 0;
    if (ancestors.has(current)) return void 0;
    if (Array.isArray(current)) {
      if (!hasPlainArrayPrototype(current)) return void 0;
      const length = current.length;
      if (Reflect.ownKeys(current).length !== length + 1) return void 0;
      const target2 = detach ? [] : void 0;
      if (target2 !== void 0) assign(task.destination, target2);
      ancestors.add(current);
      tasks.push({
        kind: "leave",
        source: current
      });
      for (let index = length - 1; index >= 0; index--) tasks.push({
        kind: "array-item",
        source: current,
        index,
        ...target2 === void 0 ? {} : { target: target2 }
      });
      continue;
    }
    if (!hasPlainObjectPrototype(current)) return void 0;
    const keys = enumerableStringKeys(current);
    if (keys === void 0) return void 0;
    const target = detach ? {} : void 0;
    if (target !== void 0) assign(task.destination, target);
    ancestors.add(current);
    tasks.push({
      kind: "leave",
      source: current
    });
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      if (key === void 0) return void 0;
      tasks.push({
        kind: "object-property",
        source: current,
        key,
        ...target === void 0 ? {} : { target }
      });
    }
  }
  return detach ? root : true;
}
function snapshotJsonValue(value) {
  return walkJsonValue(value, true);
}
function deepFreeze(value) {
  const seen = /* @__PURE__ */ new WeakSet();
  const pending = [{
    kind: "visit",
    node: value
  }];
  while (pending.length > 0) {
    const task = pending.pop();
    if (task === void 0) continue;
    if (task.kind === "property") {
      pending.push({
        kind: "visit",
        node: task.source[task.key]
      });
      continue;
    }
    const node = task.node;
    if (node === null || typeof node !== "object") continue;
    if (node instanceof AbortSignal) continue;
    if (seen.has(node)) continue;
    seen.add(node);
    Object.freeze(node);
    const keys = Object.keys(node);
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      if (key === void 0) continue;
      pending.push({
        kind: "property",
        source: node,
        key
      });
    }
  }
  return value;
}

// node_modules/@deepseek-ai/dsh-util-crypto/lib/index.js
function randomUUID() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (byte, index) => {
    return (index === 6 ? byte & 15 | 64 : index === 8 ? byte & 63 | 128 : byte).toString(16).padStart(2, "0");
  }).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// node_modules/@deepseek-ai/dsh-brand/lib/index.js
function brandString(value) {
  return value;
}
function brandNumber(value) {
  return value;
}

// node_modules/@deepseek-ai/dsh-timeout/lib/index.js
var MAX_TIMER_DELAY_MS = 2147483647;

// node_modules/@deepseek-ai/dsh-llm/lib/index.js
function freezeMessage(message) {
  return deepFreeze(structuredClone(message));
}
function createMessage(input) {
  return deepFreeze(structuredClone({
    ...input,
    id: brandString(randomUUID())
  }));
}
function createUserMessage(input) {
  return createMessage({
    ...input,
    role: "user"
  });
}
function createAssistantMessage(input) {
  return createMessage({
    role: "assistant",
    content: input.content,
    source: {
      kind: "model",
      ...input.source
    }
  });
}
var HarnessError = class extends Error {
  /** Stable machine-routable failure class (e.g. `RATE_LIMIT`); route on this, never by parsing `message`. */
  code;
  constructor(message, code, options) {
    super(message, options);
    this.code = code;
    this.name = new.target.name;
  }
};
var CONTEXT_WINDOW_EXCEEDED_CODE = "CONTEXT_WINDOW_EXCEEDED";
var EMPTY_RESPONSE_CODE = "EMPTY_RESPONSE";
var STRUCTURED_CONTEXT_OVERFLOW = new RegExp(String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]` + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`, "i");
var TOO_LARGE_FOR_CONTEXT = new RegExp(String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?` + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?` + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`, "i");
var EXCEEDS_MODEL_CONTEXT = new RegExp(String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}` + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}` + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`, "i");
function errorChain(value) {
  const path = /* @__PURE__ */ new Set();
  const render = (current) => {
    if (path.has(current)) return "<circular cause>";
    path.add(current);
    try {
      if (!(current instanceof Error)) {
        if (typeof current === "object" && current !== null) {
          const descriptor = Object.getOwnPropertyDescriptor(current, "message");
          if (descriptor !== void 0 && "value" in descriptor && typeof descriptor.value === "string") return descriptor.value;
        }
        return String(current);
      }
      const message = current.message === "" ? current.name : current.message;
      const members = current instanceof AggregateError && current.errors.length > 0 ? ` [${current.errors.map(render).join("; ")}]` : "";
      const causeText = current.cause === void 0 || current.cause === null ? "" : render(current.cause);
      return `${message}${members}${causeText === "" || causeText === message ? "" : `: ${causeText}`}`;
    } catch {
      return "<unrenderable value>";
    } finally {
      path.delete(current);
    }
  };
  return render(value);
}
var DEFAULT_MAX_RETRIES = 5;
var DEFAULT_INITIAL_DELAY_MS = 500;
var DEFAULT_MAX_DELAY_MS = 1e4;
var DEFAULT_JITTER_RATIO = 0.1;
var DEFAULT_RETRYABLE_CODES = Object.freeze([
  EMPTY_RESPONSE_CODE,
  "RATE_LIMIT",
  "SERVER",
  "TIMEOUT",
  "TRANSPORT"
]);
var backoffSchema = Schema.object({
  initialDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
  maxDelayMs: Schema.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
  jitterRatio: Schema.number().min(0).max(1).default(DEFAULT_JITTER_RATIO)
});
var normalPolicySchema = Schema.object({
  mode: Schema.const("normal").required(),
  maxRetries: Schema.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES),
  retryableCodes: Schema.array(Schema.string()).default([...DEFAULT_RETRYABLE_CODES]),
  backoff: backoffSchema
});
var alwaysPolicySchema = Schema.object({
  mode: Schema.const("always").required(),
  backoff: backoffSchema
});
var RetryPolicySchema = Schema.union([normalPolicySchema, alwaysPolicySchema]);
var NORMAL_POLICY_KEYS = /* @__PURE__ */ new Set([
  "mode",
  "maxRetries",
  "retryableCodes",
  "backoff"
]);
var ALWAYS_POLICY_KEYS = /* @__PURE__ */ new Set([
  "mode",
  "maxRetries",
  "retryableCodes",
  "backoff"
]);
var BACKOFF_KEYS = /* @__PURE__ */ new Set([
  "initialDelayMs",
  "maxDelayMs",
  "jitterRatio"
]);
function validateKeys(value, allowed, path) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${path}: unknown key "${key}"`);
}
function resolveBackoff(config, path) {
  if (config !== void 0) validateKeys(config, BACKOFF_KEYS, path);
  const initialDelayMs = config?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = config?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const jitterRatio = config?.jitterRatio ?? DEFAULT_JITTER_RATIO;
  if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > MAX_TIMER_DELAY_MS) throw new Error(`${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > MAX_TIMER_DELAY_MS) throw new Error(`${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  if (initialDelayMs > maxDelayMs) throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`);
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) throw new Error(`${path}.jitterRatio must be between 0 and 1`);
  return Object.freeze({
    initialDelayMs,
    maxDelayMs,
    jitterRatio
  });
}
function resolveRetryPolicy(config, path) {
  if (config === void 0) return Object.freeze({
    mode: "normal",
    maxRetries: DEFAULT_MAX_RETRIES,
    retryableCodes: DEFAULT_RETRYABLE_CODES,
    ...resolveBackoff(void 0, `${path}.backoff`)
  });
  switch (config.mode) {
    case "normal": {
      validateKeys(config, NORMAL_POLICY_KEYS, path);
      const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
      const retryableCodes = config.retryableCodes ?? [...DEFAULT_RETRYABLE_CODES];
      if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) throw new Error(`${path}.maxRetries must be a non-negative safe integer`);
      if (retryableCodes.length === 0) throw new Error(`${path}.retryableCodes must not be empty`);
      if (retryableCodes.some((code) => typeof code !== "string" || code.length === 0)) throw new Error(`${path}.retryableCodes must contain only non-empty strings`);
      if (new Set(retryableCodes).size !== retryableCodes.length) throw new Error(`${path}.retryableCodes must not contain duplicates`);
      return Object.freeze({
        mode: "normal",
        maxRetries,
        retryableCodes: Object.freeze([...retryableCodes]),
        ...resolveBackoff(config.backoff, `${path}.backoff`)
      });
    }
    case "always":
      validateKeys(config, ALWAYS_POLICY_KEYS, path);
      return Object.freeze({
        mode: "always",
        ...resolveBackoff(config.backoff, `${path}.backoff`)
      });
    default:
      throw new Error(`${path}.mode must be "normal" or "always"`);
  }
}
function callConfigEquals(a, b) {
  if (a.provider !== b.provider || a.model !== b.model || a.reasoningEffort !== b.reasoningEffort || a.temperature !== b.temperature || a.maxTokens !== b.maxTokens) return false;
  if (a.stop === void 0 || b.stop === void 0) return a.stop === b.stop;
  return a.stop.length === b.stop.length && a.stop.every((s, i) => s === b.stop?.[i]);
}
function normalizeLlmFailure(value) {
  const error = value instanceof Error ? value : new HarnessError(thrownMessage(value), "UNKNOWN", { cause: value });
  const carried = ownFailureSnapshot(error);
  if (carried !== void 0 && carried.code === ownErrorCode(error)) return carried;
  return Object.freeze({
    message: errorMessage(error),
    code: harnessErrorCode(error)
  });
}
function thrownMessage(value) {
  try {
    const message = String(value);
    return message.length > 0 ? message : "LLM adapter failed";
  } catch (_hostileThrownValue) {
    return "LLM adapter failed";
  }
}
function ownErrorCode(error) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    return descriptor !== void 0 && "value" in descriptor ? descriptor.value : void 0;
  } catch (_sdkPropertyTrap) {
    return;
  }
}
function ownFailureSnapshot(error) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "failure");
    return descriptor !== void 0 && "value" in descriptor ? failureSnapshot(descriptor.value) : void 0;
  } catch (_sdkPropertyTrap) {
    return;
  }
}
function failureSnapshot(value) {
  if (typeof value !== "object" || value === null) return void 0;
  try {
    const candidate = value;
    const message = candidate.message;
    const code = candidate.code;
    const status = candidate.status;
    const providerRetryAfterMs = candidate.providerRetryAfterMs;
    const requestId = candidate.requestId;
    const offloadImages = candidate.offloadImages;
    if (typeof message !== "string" || message.length === 0 || typeof code !== "string" || code.length === 0 || status !== void 0 && (!Number.isInteger(status) || status < 100 || status > 599) || providerRetryAfterMs !== void 0 && (!Number.isFinite(providerRetryAfterMs) || providerRetryAfterMs <= 0) || requestId !== void 0 && (typeof requestId !== "string" || requestId.length === 0) || offloadImages !== void 0 && (!Number.isSafeInteger(offloadImages) || offloadImages <= 0)) return void 0;
    return Object.freeze({
      message,
      code,
      ...status === void 0 ? {} : { status },
      ...providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs },
      ...requestId === void 0 ? {} : { requestId },
      ...offloadImages === void 0 ? {} : { offloadImages }
    });
  } catch (_sdkFailureGetter) {
    return;
  }
}
function errorMessage(error) {
  try {
    const message = error.message;
    if (typeof message === "string" && message.length > 0) return message;
  } catch (_sdkMessageGetter) {
  }
  return "LLM adapter failed";
}
function harnessErrorCode(error) {
  return error instanceof HarnessError ? error.code : "UNKNOWN";
}
function quoted(value) {
  return JSON.stringify(value);
}
function textOnlyImageText(ref) {
  return `[image omitted because this model accepts text only; attachment sha256:${String(ref.attachmentId).slice(7, 15)}]`;
}
function contentHasImage(content) {
  return content.some((block) => block.type === "image");
}
function contentHasFile(content) {
  for (const block of content) if (block.type === "file") return true;
  return false;
}
function fileHandleText(ref, readonlyPath) {
  const digest = String(ref.attachmentId).slice(7, 15);
  const identity = `File ${quoted(ref.name)} (${ref.bytes} bytes, sha256:${digest})`;
  if (readonlyPath === void 0) return `[${identity} was uploaded, but the current execution environment cannot access a readable path. Report that limitation if its contents are needed; do not claim to have read it.]`;
  return `[${identity}: verbatim read-only copy saved at ${quoted(readonlyPath)}. Read that path with your file tools when its contents are needed; copy it to a writable location before modifying it. When delegating file work, include this saved path in the delegation prompt; only subagents sharing this execution environment can read it.]`;
}
function replaceFilesWithHandles(blocks, resolvePath) {
  let next;
  for (const [index, block] of blocks.entries()) {
    if (block.type === "file") {
      next ??= blocks.slice(0, index);
      next.push({
        type: "text",
        text: fileHandleText(block.attachment, resolvePath(block.attachment))
      });
      continue;
    }
    next?.push(block);
  }
  return next ?? blocks;
}
function projectFilesToText(messages, resolvePath) {
  if (!messages.some((message) => contentHasFile(message.content))) return messages;
  return messages.map((message) => {
    const content = replaceFilesWithHandles(message.content, resolvePath);
    return content === message.content ? message : {
      ...message,
      content
    };
  });
}
function replaceImagesForTextModel(blocks) {
  let next;
  for (const [index, block] of blocks.entries()) {
    if (block.type === "image") {
      next ??= blocks.slice(0, index);
      next.push({
        type: "text",
        text: textOnlyImageText(block.attachment)
      });
      continue;
    }
    next?.push(block);
  }
  return next ?? blocks;
}
function projectImagesForTextModel(messages) {
  if (!messages.some((message) => contentHasImage(message.content))) return messages;
  return messages.map((message) => {
    const content = replaceImagesForTextModel(message.content);
    return content === message.content ? message : {
      ...message,
      content
    };
  });
}
function withoutDeveloperMessages(messages) {
  const retained = messages.filter((message) => message.role !== "developer");
  return retained.length === messages.length ? messages : retained;
}
function toolDeclarations(tools, mode, history) {
  const declarations = new Map(history.tools.map((tool) => [tool.name, tool]));
  for (const update of history.updates) for (const tool of update.additions) if (!declarations.has(tool.name)) declarations.set(tool.name, {
    ...tool,
    deferLoading: true
  });
  switch (mode) {
    case "in-history":
      return declarations;
    case "addition-only": {
      const activeNames = new Set(tools?.map((tool) => tool.name));
      for (const name2 of declarations.keys()) if (!activeNames.has(name2)) declarations.delete(name2);
      return declarations;
    }
    /* v8 ignore next 2 -- closed-union exhaustiveness guard */
    default:
      return assertNever(mode);
  }
}
function projectToolUpdates(messages, tools, toolUpdate, history) {
  if (toolUpdate === void 0) {
    let immediateTools = tools;
    if (tools?.some((tool) => tool.deferLoading === true)) immediateTools = tools.map(({ deferLoading: _loading, ...tool }) => tool);
    return {
      messages: withoutDeveloperMessages(messages),
      tools: immediateTools
    };
  }
  if (history === void 0) return {
    messages: withoutDeveloperMessages(messages),
    tools
  };
  const messageIds = new Set(messages.flatMap((message) => message.role === "developer" ? [message.id] : []));
  if (history.updates.some((update) => !messageIds.has(update.messageId))) return {
    messages: withoutDeveloperMessages(messages),
    tools
  };
  const declarations = toolDeclarations(tools, toolUpdate, history);
  const updateIds = new Set(history.updates.map((update) => update.messageId));
  const offered = new Set(history.tools.filter((tool) => !tool.deferLoading).map((tool) => tool.name));
  const projectedMessages = [];
  for (const message of messages) {
    if (message.role !== "developer") {
      projectedMessages.push(message);
      continue;
    }
    if (!updateIds.has(message.id)) continue;
    const content = message.content.filter((block) => {
      switch (block.type) {
        case "tool-addition":
          if (!declarations.has(block.toolName) || offered.has(block.toolName)) return false;
          offered.add(block.toolName);
          return true;
        case "tool-removal":
          if (toolUpdate !== "in-history") return false;
          return offered.delete(block.toolName);
        default:
          return true;
      }
    });
    if (content.length === 0) continue;
    if (content.length === message.content.length) projectedMessages.push(message);
    else projectedMessages.push({
      ...message,
      content
    });
  }
  return {
    messages: projectedMessages.length === messages.length && projectedMessages.every((message, index) => message === messages[index]) ? messages : projectedMessages,
    tools: [...declarations.values()]
  };
}
var { version } = createRequire(import.meta.url)("../package.json");
var BlockAssembler = class {
  partials = /* @__PURE__ */ new Map();
  order = [];
  _usage;
  _finish;
  _replayState;
  /**
  * Feed one chunk into the assembly state.
  * @param chunk - the next raw chunk, in stream order.
  */
  push(chunk) {
    switch (chunk.type) {
      case "block-start":
        if (!this.partials.has(chunk.index)) {
          this.order.push(chunk.index);
          this.partials.set(chunk.index, {
            blockType: chunk.blockType,
            text: "",
            toolCallArguments: ""
          });
        }
        return;
      case "text-delta":
      case "reasoning-delta": {
        const partial = this.ensure(chunk.index, chunk.type === "text-delta" ? "text" : "reasoning");
        if (partial.block) return;
        partial.text += chunk.text;
        return;
      }
      case "tool-call-delta": {
        const partial = this.ensure(chunk.index, "tool-call");
        if (partial.block) return;
        partial.toolCallId = chunk.id;
        if (chunk.name) partial.toolCallName = chunk.name;
        partial.toolCallArguments += chunk.argumentsDelta;
        return;
      }
      case "block-end": {
        const partial = this.ensure(chunk.index, chunk.block.type);
        if (partial.block) return;
        partial.block = chunk.block;
        return;
      }
      case "usage":
        this._usage = chunk.usage;
        return;
      case "finish":
        this._finish = chunk.reason;
        this._replayState = chunk.replayState;
        return;
      default:
        return assertNever(chunk, "BlockAssembler.push");
    }
  }
  ensure(index, blockType) {
    let partial = this.partials.get(index);
    if (!partial) {
      partial = {
        blockType,
        text: "",
        toolCallArguments: ""
      };
      this.partials.set(index, partial);
      this.order.push(index);
    }
    return partial;
  }
  assemble(partial, index) {
    if (partial.block) return partial.block;
    switch (partial.blockType) {
      case "text":
        return {
          type: "text",
          text: partial.text
        };
      case "reasoning":
        return {
          type: "reasoning",
          text: partial.text
        };
      case "tool-call":
        return {
          type: "tool-call",
          id: partial.toolCallId ?? brandString(`call-${index}`),
          name: partial.toolCallName ?? "",
          arguments: partial.toolCallArguments
        };
      default:
        throw new Error(`cannot assemble incomplete block of type "${partial.blockType}"`);
    }
  }
  /** Invariant accessor: every index in `order` has a partial. */
  mustGet(index) {
    const partial = this.partials.get(index);
    if (!partial) throw new Error(`BlockAssembler invariant violated: no partial for index ${index}`);
    return partial;
  }
  /**
  * The one shared keep/drop decision over all seen blocks: max-token
  * truncation drops tool calls that cannot be executed safely. Emitted blocks
  * and replay metadata both derive from this result, so they cannot disagree.
  */
  assembled() {
    const all = this.order.map((index) => this.assemble(this.mustGet(index), index));
    const kept = this.finish.kind === "max-tokens" ? all.map((block) => block.type !== "tool-call") : void 0;
    const blocks = kept === void 0 ? all : all.filter((_, position) => kept[position]);
    const envelope = this._replayState;
    if (envelope?.blocks === void 0) return {
      blocks,
      replay: envelope
    };
    if (envelope.blocks.length !== all.length) return {
      blocks,
      replay: void 0
    };
    return {
      blocks,
      replay: kept === void 0 || blocks.length === all.length ? envelope : {
        response: envelope.response,
        blocks: envelope.blocks.filter((_, position) => kept[position])
      }
    };
  }
  /**
  * Assemble all blocks seen so far, in stream order.
  * @returns one block per seen index, except that max-token truncation drops
  *   tool calls that cannot be executed safely; an open block assembles from
  *   its accumulated deltas (an unknown block type never closed by `block-end` throws).
  */
  blocks() {
    return this.assembled().blocks;
  }
  /**
  * Assemble the prefix an interrupted stream can safely finalize: closed and
  * open text/reasoning blocks with non-whitespace content, in stream order.
  * Tool calls are omitted because interruption precedes dispatch; retaining
  * one would require a fabricated result. Open unknown blocks are also omitted.
  * @returns the kept blocks; empty when nothing streamed before the interruption.
  */
  interruptedBlocks() {
    return this.order.map((index) => {
      const partial = this.mustGet(index);
      const type = partial.block?.type ?? partial.blockType;
      if (type !== "text" && type !== "reasoning") return void 0;
      return this.assemble(partial, index);
    }).filter((block) => (block?.type === "text" || block?.type === "reasoning") && block.text.trim() !== "");
  }
  /** Usage from the `usage` chunk; undefined until one arrives. */
  get usage() {
    return this._usage;
  }
  /** Finish reason from the `finish` chunk; `{kind: 'stop'}` when the stream ended without one. */
  get finish() {
    return this._finish ?? { kind: "stop" };
  }
  /**
  * Replay metadata from the terminal finish chunk, if any, with per-block
  * entries pruned in step with {@link blocks}. Undefined when the envelope's
  * entries do not align with the emitted blocks.
  */
  get replayState() {
    return this.assembled().replay;
  }
  /**
  * The assembled assistant message.
  * @param source - provider/model attribution (without the `kind` tag) for the assembled message.
  * @returns a frozen assistant-role message over `blocks()` (same open-block assembly rules).
  */
  message(source) {
    return createAssistantMessage({
      content: this.blocks(),
      source
    });
  }
};
var __runInitializers = function(thisArg, initializers, value) {
  var useValue = arguments.length > 2;
  for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
  return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
  function accept(f) {
    if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
    return f;
  }
  var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
  var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
  var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
  var _, done = false;
  for (var i = decorators.length - 1; i >= 0; i--) {
    var context = {};
    for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
    for (var p in contextIn.access) context.access[p] = contextIn.access[p];
    context.addInitializer = function(f) {
      if (done) throw new TypeError("Cannot add initializers after decoration has completed");
      extraInitializers.push(accept(f || null));
    };
    var result = (0, decorators[i])(kind === "accessor" ? {
      get: descriptor.get,
      set: descriptor.set
    } : descriptor[key], context);
    if (kind === "accessor") {
      if (result === void 0) continue;
      if (result === null || typeof result !== "object") throw new TypeError("Object expected");
      if (_ = accept(result.get)) descriptor.get = _;
      if (_ = accept(result.set)) descriptor.set = _;
      if (_ = accept(result.init)) initializers.unshift(_);
    } else if (_ = accept(result)) if (kind === "field") initializers.unshift(_);
    else descriptor[key] = _;
  }
  if (target) Object.defineProperty(target, contextIn.name, descriptor);
  done = true;
};
var LlmError = class extends HarnessError {
  /** Serializable facts retained beside this live Error. */
  failure;
  /**
  * @param message - non-empty human-readable failure summary.
  * @param code - non-empty stable provider-neutral machine code.
  * @param options - optional cause and validated serializable provider facts.
  */
  constructor(message, code, options) {
    if (typeof message !== "string" || message.length === 0) throw new Error("LlmError message must be a non-empty string");
    if (typeof code !== "string" || code.length === 0) throw new Error("LlmError code must be a non-empty string");
    if (options?.status !== void 0 && (!Number.isInteger(options.status) || options.status < 100 || options.status > 599)) throw new Error("LlmError status must be an integer from 100 through 599");
    if (options?.providerRetryAfterMs !== void 0 && (!Number.isFinite(options.providerRetryAfterMs) || options.providerRetryAfterMs <= 0)) throw new Error("LlmError providerRetryAfterMs must be a positive finite number");
    if (options?.requestId !== void 0 && (typeof options.requestId !== "string" || options.requestId.length === 0)) throw new Error("LlmError requestId must be a non-empty string");
    super(message, code, options);
    this.name = "LlmError";
    this.failure = Object.freeze({
      message,
      code,
      ...options?.status === void 0 ? {} : { status: options.status },
      ...options?.providerRetryAfterMs === void 0 ? {} : { providerRetryAfterMs: options.providerRetryAfterMs },
      ...options?.requestId === void 0 ? {} : { requestId: options.requestId },
      ...options?.offloadImages === void 0 ? {} : { offloadImages: options.offloadImages }
    });
  }
};
var LlmRuntime = (() => {
  let _classSuper = TypertRemoteService;
  let _instanceExtraInitializers = [];
  let _listProviders_decorators;
  let _listConfigurableProviders_decorators;
  let _remoteDiscoverModels_decorators;
  return class LlmRuntime extends _classSuper {
    static {
      const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
      _listProviders_decorators = [Remote];
      _listConfigurableProviders_decorators = [Remote];
      _remoteDiscoverModels_decorators = [Remote("discoverModels")];
      __esDecorate(this, null, _listProviders_decorators, {
        kind: "method",
        name: "listProviders",
        static: false,
        private: false,
        access: {
          has: (obj) => "listProviders" in obj,
          get: (obj) => obj.listProviders
        },
        metadata: _metadata
      }, null, _instanceExtraInitializers);
      __esDecorate(this, null, _listConfigurableProviders_decorators, {
        kind: "method",
        name: "listConfigurableProviders",
        static: false,
        private: false,
        access: {
          has: (obj) => "listConfigurableProviders" in obj,
          get: (obj) => obj.listConfigurableProviders
        },
        metadata: _metadata
      }, null, _instanceExtraInitializers);
      __esDecorate(this, null, _remoteDiscoverModels_decorators, {
        kind: "method",
        name: "remoteDiscoverModels",
        static: false,
        private: false,
        access: {
          has: (obj) => "remoteDiscoverModels" in obj,
          get: (obj) => obj.remoteDiscoverModels
        },
        metadata: _metadata
      }, null, _instanceExtraInitializers);
      if (_metadata) Object.defineProperty(this, Symbol.metadata, {
        enumerable: true,
        configurable: true,
        writable: true,
        value: _metadata
      });
    }
    adapters = (__runInitializers(this, _instanceExtraInitializers), /* @__PURE__ */ new Map());
    directory = /* @__PURE__ */ new Map();
    discoveries = /* @__PURE__ */ new Map();
    constructor(ctx) {
      super(ctx, "llm");
    }
    /** Notify topology observers without letting one broken listener veto the commit. */
    emitAdaptersUpdated() {
      for (const listener of this.ctx.events.dispatch("emit", ["llm/adapters-updated"])) try {
        const returned = listener();
        if (returned != null && typeof returned.then === "function") Promise.resolve(returned).then(void 0, (error) => {
          this.warnAdaptersListenerFailure(error);
        });
      } catch (error) {
        this.warnAdaptersListenerFailure(error);
      }
    }
    /** Contained-listener diagnostic shared by the sync and async failure paths. */
    warnAdaptersListenerFailure(error) {
      this.ctx.logger.warn("llm: an llm/adapters-updated listener failed");
      this.ctx.logger.warn(error);
    }
    /**
    * Register an adapter for the given provider routes. Throws `LlmError` with code
    * `DUPLICATE_ADAPTER` if any provider already has an adapter (all-or-nothing).
    * Disposed with the fiber.
    * @param providers - every provider route this adapter should serve.
    * @param adapter - the adapter that streams calls for those providers.
    * @returns the disposer, carrying {@link AdapterRegistrationHandle.replace}.
    */
    registerAdapter(providers, adapter) {
      const owned = /* @__PURE__ */ new Set();
      let released = false;
      const dispose = this.ctx.effect(function* () {
        if (providers.length === 0) throw new LlmError("an adapter must register at least one provider", "INVALID_ADAPTER");
        this.commitRoutes(owned, this.prepareRoutes(providers, adapter, owned));
        yield () => {
          released = true;
          for (const provider of owned) this.adapters.delete(provider);
          owned.clear();
          this.emitAdaptersUpdated();
        };
      }.bind(this), "llm.registerAdapter()");
      const handle = (() => void dispose());
      handle.replace = (next) => {
        if (released) throw new LlmError("a disposed adapter registration cannot replace its routes", "REGISTRATION_DISPOSED");
        this.commitRoutes(owned, this.prepareRoutes(next, adapter, owned));
      };
      return handle;
    }
    /**
    * Validate one candidate route set for `adapter`, treating routes this
    * registration already holds as available. Nothing is mutated: a rejected
    * candidate leaves the registry exactly as it was.
    */
    prepareRoutes(providers, adapter, owned) {
      const unique = /* @__PURE__ */ new Set();
      const registrations = [];
      for (const provider of providers) {
        if (provider.length === 0) throw new LlmError("adapter provider names must be non-empty", "INVALID_ADAPTER");
        if (unique.has(provider) || this.adapters.has(provider) && !owned.has(provider)) throw new LlmError(`an adapter for provider "${provider}" is already registered`, "DUPLICATE_ADAPTER");
        const info = adapter.providerInfo(provider);
        if (typeof info.id !== "string" || info.id !== provider || typeof info.name !== "string" || info.name.length === 0) throw new LlmError(`adapter metadata for provider "${provider}" must preserve its id and have a non-empty name`, "INVALID_ADAPTER");
        unique.add(provider);
        const retryPolicy = adapter.providerRetryPolicy(provider) ?? resolveRetryPolicy(void 0, `llm: provider "${provider}" retryPolicy`);
        registrations.push({
          adapter,
          provider: {
            id: info.id,
            name: info.name
          },
          retryPolicy
        });
      }
      return registrations;
    }
    /**
    * Swap this registration's routes for the prepared ones in one synchronous
    * section, so no observer can see the registry between the release and the
    * re-registration. The route set's one mutation point is also where
    * `llm/adapters-updated` is published, so a `replace` announces itself
    * exactly like a first registration.
    */
    commitRoutes(owned, registrations) {
      for (const provider of owned) this.adapters.delete(provider);
      owned.clear();
      for (const registration of registrations) {
        this.adapters.set(registration.provider.id, registration);
        owned.add(registration.provider.id);
      }
      this.emitAdaptersUpdated();
    }
    /**
    * Describe provider routes with a registered adapter.
    * @returns detached provider metadata in registration order.
    */
    listProviders() {
      return [...this.adapters.values()].map(({ provider }) => ({ ...provider }));
    }
    /**
    * Declare provider routes an adapter plugin can activate through
    * configuration. Registration is all-or-nothing: an empty list, invalid
    * entry, or a provider already declared by any registration throws
    * `LlmError` without registering the rest. Disposed with the fiber.
    * @param entries - every configurable provider this plugin owns.
    * @returns a handle that withdraws all of them, and can atomically replace them.
    */
    registerConfigurableProviders(entries) {
      let held = [];
      let disposed = false;
      const commit = (candidates) => {
        const detached = [];
        const own = new Set(held.map((entry) => entry.provider));
        for (const entry of candidates) {
          if (entry.provider.length === 0 || entry.displayName.length === 0 || entry.settingsNs.length === 0) throw new LlmError("configurable providers need a non-empty provider, displayName, and settingsNs", "INVALID_DIRECTORY");
          if (entry.settingsPath.some((segment) => segment.length === 0)) throw new LlmError(`configurable provider "${entry.provider}" has an empty settingsPath segment`, "INVALID_DIRECTORY");
          if (this.directory.has(entry.provider) && !own.has(entry.provider) || detached.some((seen) => seen.provider === entry.provider)) throw new LlmError(`configurable provider "${entry.provider}" is already declared`, "DUPLICATE_DIRECTORY");
          detached.push(detachDirectoryEntry(entry));
        }
        for (const entry of held) this.directory.delete(entry.provider);
        for (const entry of detached) this.directory.set(entry.provider, entry);
        held = detached;
        this.emitAdaptersUpdated();
      };
      const dispose = this.ctx.effect(function* () {
        if (entries.length === 0) throw new LlmError("a configurable-provider registration must declare at least one provider", "INVALID_DIRECTORY");
        commit(entries);
        yield () => {
          disposed = true;
          for (const entry of held) this.directory.delete(entry.provider);
          held = [];
          this.emitAdaptersUpdated();
        };
      }.bind(this), "llm.registerConfigurableProviders()");
      const handle = (() => void dispose());
      handle.replace = (next) => {
        if (disposed) throw new LlmError("this configurable-provider registration was disposed", "REGISTRATION_DISPOSED");
        commit(next);
      };
      return handle;
    }
    /**
    * List every declared configurable provider, registered or dormant.
    * @returns detached directory entries in declaration order.
    */
    listConfigurableProviders() {
      return [...this.directory.values()].map(detachDirectoryEntry);
    }
    /**
    * Offer to interrogate provider endpoints on behalf of the settings
    * namespace this plugin owns. The namespace is the key because that is what
    * a configuration surface already holds from the configurable-provider
    * directory, and because a provider being *added* has no route to name yet.
    * Disposed with the fiber.
    * @param settingsNs - the namespace whose profiles this discovery serves.
    * @param discover - interrogates one endpoint and must honor the supplied signal.
    * @returns the disposer that withdraws the offer.
    */
    registerModelDiscovery(settingsNs, discover) {
      const dispose = this.ctx.effect(function* () {
        if (settingsNs.length === 0) throw new LlmError("model discovery needs a non-empty settings namespace", "INVALID_DISCOVERY");
        if (this.discoveries.has(settingsNs)) throw new LlmError(`model discovery for "${settingsNs}" is already registered`, "DUPLICATE_DISCOVERY");
        this.discoveries.set(settingsNs, discover);
        yield () => {
          this.discoveries.delete(settingsNs);
        };
      }.bind(this), "llm.registerModelDiscovery()");
      return () => void dispose();
    }
    /**
    * Interrogate one provider endpoint for the models it advertises. The
    * request describes a draft, not a stored route, so nothing here reads or
    * writes settings or credentials — the caller owns both, and the reply is
    * candidate metadata a surface may offer for adoption.
    * @param settingsNs - namespace whose registered discovery serves this draft.
    * @param request - the endpoint, protocol, and one-shot credential to use.
    * @param signal - caller cancellation.
    * @returns the advertised models, deduplicated in endpoint order.
    */
    async discoverModels(settingsNs, request, signal) {
      const discover = this.discoveries.get(settingsNs);
      if (discover === void 0) throw new LlmError(`no model discovery is registered for "${settingsNs}"`, "NO_DISCOVERY");
      if ((request.provider ?? "").length === 0 && (request.baseURL ?? "").length === 0) throw new LlmError("model discovery needs a provider route or a baseURL", "INVALID_DISCOVERY");
      const discovered = signal === void 0 ? await discover(request) : await discover(request, signal);
      const seen = /* @__PURE__ */ new Set();
      const models = [];
      for (const model of discovered) {
        if (typeof model.id !== "string" || model.id.length === 0 || seen.has(model.id)) continue;
        seen.add(model.id);
        models.push({
          id: model.id,
          ...model.name === void 0 ? {} : { name: model.name },
          ...model.contextWindow === void 0 ? {} : { contextWindow: model.contextWindow },
          ...model.maxTokens === void 0 ? {} : { maxTokens: model.maxTokens },
          ...model.inputModalities === void 0 ? {} : { inputModalities: [...model.inputModalities] }
        });
      }
      return models;
    }
    /**
    * Remote adapter for one draft provider interrogation.
    * @param settingsNs - namespace whose registered discovery serves this draft.
    * @param request - endpoint, protocol, and one-shot credential to use.
    * @param signal - caller cancellation supplied by the Remote carrier.
    * @returns advertised models in endpoint order.
    * @throws RemoteError with `llm/model-discovery-rejected` when discovery refuses or fails.
    */
    async remoteDiscoverModels(settingsNs, request, signal) {
      try {
        return await this.discoverModels(settingsNs, request, signal);
      } catch (error) {
        throw new RemoteError("llm/model-discovery-rejected", error instanceof Error ? error.message : String(error), {
          settingsNs,
          ...request.baseURL === void 0 ? {} : { baseURL: request.baseURL }
        }, { cause: error });
      }
    }
    /**
    * Resolve the retry policy captured when one provider route was registered.
    * @param provider - registered provider route to inspect.
    * @returns the provider-owned policy, with normal defaults already resolved.
    */
    providerRetryPolicy(provider) {
      return this.registration(provider).retryPolicy;
    }
    /**
    * Resolve provider-side request-image pricing for one exact route, or
    * `undefined` when the provider is unregistered or declares none. Unknown
    * providers degrade to `undefined` rather than throwing because callers
    * price durable history whose route may no longer be mounted.
    * @param provider - provider route named by a request header.
    * @param model - exact model id named by the same header.
    * @returns the owning adapter's image pricing for the route, when declared.
    */
    imageRequestPricing(provider, model) {
      return this.adapters.get(provider)?.adapter.imageRequestPricing(provider, model);
    }
    /**
    * Resolve the image projection for an exact registered model route.
    * @param provider - registered provider route.
    * @param model - exact model id.
    * @param image - normalized image reference.
    * @returns dimensions and byte target used by the adapter's request serializer.
    */
    imageRequestTarget(provider, model, image) {
      return this.registration(provider).adapter.imageRequestTarget(provider, model, image);
    }
    /**
    * Resolve the exact text one durable file occurrence contributes to every
    * provider request in the current execution environment.
    * @param ref - durable verbatim file reference from model history.
    * @returns the same deterministic handle text used at adapter dispatch.
    */
    fileRequestText(ref) {
      return fileHandleText(ref, this.fileReadPath(ref));
    }
    /** Detach typed adapter-owned modality metadata. */
    detachedModalities(modalities) {
      return modalities === void 0 ? void 0 : [...modalities];
    }
    /**
    * Discover models advertised by one registered provider. Catalog membership
    * does not constrain core routing. Catalog-driven entry points may restrict
    * selection and submission to the advertised models.
    * @param provider - registered provider route to inspect.
    * @returns detached model metadata in adapter-preferred order.
    */
    async listModels(provider) {
      const models = await this.registration(provider).adapter.listModels(provider);
      const seen = /* @__PURE__ */ new Set();
      return models.map((model) => {
        if (typeof model.provider !== "string" || model.provider !== provider || typeof model.id !== "string" || model.id.length === 0 || typeof model.name !== "string" || model.name.length === 0 || model.description !== void 0 && typeof model.description !== "string" || seen.has(model.id)) throw new LlmError(`adapter returned invalid or duplicate model metadata for provider "${provider}"`, "INVALID_CATALOG");
        seen.add(model.id);
        const inputModalities = this.detachedModalities(model.inputModalities);
        return {
          provider: model.provider,
          id: model.id,
          name: model.name,
          ...model.description === void 0 ? {} : { description: model.description },
          ...inputModalities === void 0 ? {} : { inputModalities }
        };
      });
    }
    /**
    * Resolve and validate all metadata from the adapter that owns one exact
    * route. The result is detached from adapter-owned objects; catalog
    * membership remains advisory and does not control request routing.
    * @param provider - registered provider route to inspect.
    * @param model - exact model id passed to the adapter.
    * @param signal - optional cancellation for adapter-owned asynchronous lookup.
    * @returns exact model identity plus available context and reasoning metadata.
    */
    async resolveModelInfo(provider, model, signal) {
      return this.resolveModelInfoFor(this.registration(provider), model, signal);
    }
    async resolveModelInfoFor(registration, model, signal) {
      const resolved = await registration.adapter.resolveModel(registration.provider.id, model, signal);
      return this.normalizeModelInfo(registration, model, resolved);
    }
    /** Validate and detach one adapter-returned exact model result. */
    normalizeModelInfo(registration, model, resolved) {
      const provider = registration.provider.id;
      if (typeof resolved.provider !== "string" || resolved.provider !== provider || typeof resolved.id !== "string" || resolved.id !== model || typeof resolved.name !== "string" || resolved.name.length === 0 || resolved.description !== void 0 && typeof resolved.description !== "string") throw new LlmError(`adapter returned invalid exact model metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_INFO");
      const context = resolved.context;
      if (context !== void 0 && (!Number.isInteger(context.contextWindow) || context.contextWindow <= 0)) throw new LlmError(`adapter returned invalid context metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_CONTEXT");
      const inputModalities = this.detachedModalities(resolved.inputModalities);
      const systemPromptUpdate = resolved.systemPromptUpdate;
      if (systemPromptUpdate !== void 0 && systemPromptUpdate !== "in-history") throw new LlmError(`adapter returned invalid system prompt update mode for provider "${provider}" model "${model}"`, "INVALID_MODEL_INFO");
      const toolUpdate = resolved.toolUpdate;
      if (toolUpdate !== void 0 && toolUpdate !== "in-history" && toolUpdate !== "addition-only") throw new LlmError(`adapter returned invalid tool update mode for provider "${provider}" model "${model}"`, "INVALID_MODEL_INFO");
      const defaultMaxTokens = resolved.defaultMaxTokens;
      if (defaultMaxTokens !== void 0 && (!Number.isSafeInteger(defaultMaxTokens) || defaultMaxTokens <= 0)) throw new LlmError(`adapter returned invalid default maxTokens for provider "${provider}" model "${model}"`, "INVALID_MODEL_MAX_TOKENS");
      const info = {
        provider,
        id: model,
        name: resolved.name,
        ...resolved.description === void 0 ? {} : { description: resolved.description },
        ...inputModalities === void 0 ? {} : { inputModalities },
        ...context === void 0 ? {} : { context: { contextWindow: context.contextWindow } },
        ...defaultMaxTokens === void 0 ? {} : { defaultMaxTokens },
        ...resolved.systemPromptUpdate === void 0 ? {} : { systemPromptUpdate: resolved.systemPromptUpdate },
        ...resolved.toolUpdate === void 0 ? {} : { toolUpdate: resolved.toolUpdate }
      };
      const reasoning = resolved.reasoning;
      if (reasoning === void 0) return info;
      if (reasoning.efforts.length === 0) throw new LlmError(`adapter returned invalid reasoning metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
      const seen = /* @__PURE__ */ new Set();
      const efforts = reasoning.efforts.map((effort) => {
        if (typeof effort.id !== "string" || effort.id.length === 0 || typeof effort.name !== "string" || effort.name.length === 0 || effort.description !== void 0 && typeof effort.description !== "string" || seen.has(effort.id)) throw new LlmError(`adapter returned invalid or duplicate reasoning effort metadata for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
        seen.add(effort.id);
        return {
          id: effort.id,
          name: effort.name,
          ...effort.description === void 0 ? {} : { description: effort.description }
        };
      });
      if (reasoning.defaultEffort !== void 0 && !seen.has(reasoning.defaultEffort)) throw new LlmError(`adapter returned an unknown default reasoning effort for provider "${provider}" model "${model}"`, "INVALID_MODEL_REASONING");
      return {
        ...info,
        reasoning: {
          efforts,
          ...reasoning.defaultEffort === void 0 ? {} : { defaultEffort: reasoning.defaultEffort }
        }
      };
    }
    /**
    * Validate a conversation call config against its exact model capability and
    * materialize adapter-configured defaults. Unsupported explicit efforts
    * reject before provider I/O; no clamping or aliasing is performed. This
    * standalone query does not bind a later dispatch; use {@link prepareCall}
    * when logging and streaming must share one adapter registration.
    * @param config - provider/model route and optional request controls.
    * @param signal - optional cancellation for adapter-owned capability lookup.
    * @returns a detached config only when a default must be materialized.
    */
    async resolveCallConfig(config, signal) {
      return (await this.resolveCallFor(this.registration(config.provider), config, signal)).config;
    }
    async resolveCallFor(registration, config, signal) {
      const info = await this.resolveModelInfoFor(registration, config.model, signal);
      return this.resolveCallWithInfo(config, info);
    }
    /** Validate request controls against one already-bound exact model result. */
    resolveCallWithInfo(config, info) {
      const defaulted = config.maxTokens === void 0 && info.defaultMaxTokens !== void 0 ? {
        ...config,
        maxTokens: info.defaultMaxTokens
      } : config;
      const reasoning = info.reasoning;
      const requested = defaulted.reasoningEffort;
      let resolvedConfig = defaulted;
      if (reasoning === void 0) {
        if (requested !== void 0) throw new LlmError(`provider "${config.provider}" model "${config.model}" does not support reasoning effort "${requested}"`, "UNSUPPORTED_REASONING_EFFORT");
      } else {
        const effective = requested ?? reasoning.defaultEffort;
        if (effective !== void 0) {
          if (!reasoning.efforts.some((effort) => effort.id === effective)) throw new LlmError(`provider "${config.provider}" model "${config.model}" does not support reasoning effort "${effective}"`, "UNSUPPORTED_REASONING_EFFORT");
          if (requested !== effective) resolvedConfig = {
            ...defaulted,
            reasoningEffort: effective
          };
        }
      }
      return {
        config: resolvedConfig,
        ...info.context === void 0 ? {} : { context: info.context },
        modelInfo: info
      };
    }
    /**
    * Resolve one call under its current adapter registration. The returned
    * one-shot handle keeps that registration across header logging and dispatch,
    * so HMR cannot combine one adapter's capability result with another adapter.
    * An optional synchronous callback selects concrete controls using captured
    * model metadata. Defaults and validation apply to its result. Callback
    * failures and cancellation reject preparation before dispatch.
    * @param config - provider/model route and optional concrete request controls.
    * @param signal - optional cancellation for adapter-owned capability lookup.
    * @param configure - pure control selection, called once before defaults and validation.
    * @returns a prepared config and its registration-bound stream entry point.
    */
    async prepareCall(config, signal, configure) {
      signal?.throwIfAborted();
      const { provider, model, ...controls } = config;
      const registration = this.registration(provider);
      const adapterCall = await registration.adapter.prepareCall(provider, model, signal);
      signal?.throwIfAborted();
      const modelInfo = this.normalizeModelInfo(registration, model, adapterCall.model);
      const proposed = configure === void 0 ? config : {
        ...configure(deepFreeze(structuredClone(controls)), deepFreeze(modelInfo)),
        provider,
        model
      };
      signal?.throwIfAborted();
      const resolved = this.resolveCallWithInfo(proposed, modelInfo);
      const resolvedConfig = deepFreeze(structuredClone(resolved.config));
      const context = resolved.context === void 0 ? void 0 : deepFreeze(structuredClone(resolved.context));
      const adapterDefaults = deepFreeze({
        ...proposed.reasoningEffort === void 0 && resolvedConfig.reasoningEffort !== void 0 ? { reasoningEffort: true } : {},
        ...proposed.maxTokens === void 0 && resolvedConfig.maxTokens !== void 0 ? { maxTokens: true } : {}
      });
      let dispatched = false;
      return Object.freeze({
        config: resolvedConfig,
        retryPolicy: registration.retryPolicy,
        adapterDefaults,
        ...context === void 0 ? {} : { context },
        ...modelInfo.inputModalities === void 0 ? {} : { inputModalities: Object.freeze([...modelInfo.inputModalities]) },
        ...modelInfo.systemPromptUpdate === void 0 ? {} : { systemPromptUpdate: modelInfo.systemPromptUpdate },
        ...modelInfo.toolUpdate === void 0 ? {} : { toolUpdate: modelInfo.toolUpdate },
        stream: (options) => {
          if (dispatched) throw new LlmError("a prepared LLM call can only be dispatched once", "INVALID_PREPARED_CALL");
          if (!callConfigEquals(options, resolvedConfig)) throw new LlmError("prepared LLM call config changed before adapter dispatch", "INVALID_PREPARED_CALL");
          dispatched = true;
          return this.streamWithRegistration(options, {
            registration,
            config: resolvedConfig,
            modelInfo,
            dispatch: (options2) => adapterCall.stream(options2)
          });
        }
      });
    }
    registration(provider) {
      const registration = this.adapters.get(provider);
      if (!registration) throw new LlmError(`no adapter registered for provider "${provider}"`, "NO_ADAPTER");
      return registration;
    }
    /** Remove replay state whose historical route is owned by another adapter. */
    forAdapter(options, adapter) {
      const messages = options.messages.map((message) => {
        if (message.role !== "assistant") return message;
        const source = message.source;
        if (source.replayState === void 0) return message;
        if (this.adapters.get(source.provider)?.adapter === adapter) return message;
        return freezeMessage({
          ...message,
          source: {
            kind: "model",
            provider: source.provider,
            model: source.model
          }
        });
      });
      if (messages.every((message, index) => message === options.messages[index])) return options;
      const filtered = {
        ...options,
        messages
      };
      return Object.isFrozen(options) ? deepFreeze(filtered) : filtered;
    }
    /**
    * Resolve the current execution-world read path of one durable file
    * reference through the mounted attachment and filesystem providers.
    */
    fileReadPath(ref) {
      let hostPath;
      try {
        hostPath = this.ctx.get("attachments")?.fileHostPath(ref);
      } catch {
        return;
      }
      if (hostPath === void 0) return void 0;
      return this.ctx.get("fs")?.processPathFromHostPath(hostPath);
    }
    /**
    * Final adapter boundary. Adapter selection, dispatch, iterator construction,
    * and iteration failures become one terminal failure chunk. Middleware and
    * downstream consumer failures remain thrown plugin or consumer errors.
    */
    async *adapterStream(options, prepared) {
      let iterator;
      try {
        const registration = prepared?.registration ?? this.registration(options.provider);
        const adapter = registration.adapter;
        let modelInfo;
        let resolvedConfig;
        let dispatch;
        if (prepared === void 0) {
          const adapterCall = await adapter.prepareCall(options.provider, options.model, options.signal);
          modelInfo = this.normalizeModelInfo(registration, options.model, adapterCall.model);
          resolvedConfig = this.resolveCallWithInfo(options, modelInfo).config;
          dispatch = (options2) => adapterCall.stream(options2);
        } else {
          modelInfo = prepared.modelInfo;
          resolvedConfig = prepared.config;
          dispatch = prepared.dispatch;
        }
        if (prepared !== void 0 && !callConfigEquals(options, resolvedConfig)) throw new LlmError("prepared LLM call config changed before adapter dispatch", "INVALID_PREPARED_CALL");
        const resolvedOptions = callConfigEquals(options, resolvedConfig) ? options : Object.isFrozen(options) ? deepFreeze({
          ...options,
          ...resolvedConfig
        }) : {
          ...options,
          ...resolvedConfig
        };
        let projectedMessages = resolvedOptions.messages;
        if (projectedMessages.some((message) => contentHasFile(message.content))) projectedMessages = projectFilesToText(projectedMessages, (ref) => this.fileReadPath(ref));
        if (modelInfo.inputModalities !== void 0 && !modelInfo.inputModalities.includes("image") && projectedMessages.some((message) => contentHasImage(message.content))) projectedMessages = projectImagesForTextModel(projectedMessages);
        const projectedTools = projectToolUpdates(projectedMessages, resolvedOptions.tools, modelInfo.toolUpdate, resolvedOptions.toolHistory);
        projectedMessages = projectedTools.messages;
        let projectedOptions = resolvedOptions;
        if (projectedMessages !== resolvedOptions.messages || projectedTools.tools !== resolvedOptions.tools) {
          projectedOptions = {
            ...resolvedOptions,
            messages: projectedMessages,
            ...projectedTools.tools === void 0 ? {} : { tools: projectedTools.tools }
          };
          if (Object.isFrozen(resolvedOptions)) deepFreeze(projectedOptions);
        }
        iterator = dispatch(this.forAdapter(projectedOptions, adapter))[Symbol.asyncIterator]();
      } catch (error) {
        yield adapterFailureChunk(error, options.signal);
        return;
      }
      let completed = false;
      try {
        while (true) {
          let item;
          try {
            const next = await iterator.next();
            item = next.done ? { done: true } : {
              done: false,
              value: next.value
            };
          } catch (error) {
            completed = true;
            yield adapterFailureChunk(error, options.signal);
            return;
          }
          if (item.done) {
            completed = true;
            return;
          }
          yield item.value;
        }
      } finally {
        if (!completed) {
          const close = iterator.return?.bind(iterator);
          if (close) await close();
        }
      }
    }
    /**
    * Stream one model call as raw chunks (token-level deltas). Replay state is
    * retained only when the same adapter instance owns its historical provider
    * and the target provider. Final adapter selection remains fixed through
    * asynchronous exact-model resolution and dispatch. Adapter selection,
    * dispatch, and iteration failures become terminal `error` or `aborted`
    * finish chunks; middleware, nested-call, cleanup, and consumer failures
    * remain thrown.
    * @param options - the full request; `options.provider` selects the adapter.
    * @returns the chunk stream, possibly wrapped by `llm/stream` listeners.
    */
    stream(options) {
      return this.streamWithRegistration(options);
    }
    streamWithRegistration(options, prepared) {
      return this.ctx.waterfall(this, "llm/stream", options, () => this.adapterStream(options, prepared));
    }
  };
})();
function adapterFailureChunk(error, signal) {
  const failure = normalizeLlmFailure(error);
  return {
    type: "finish",
    reason: signal?.aborted || failure.code === "ABORTED" ? {
      kind: "aborted",
      failure
    } : {
      kind: "error",
      failure
    }
  };
}
function detachDirectoryEntry(entry) {
  const { nativeAuth } = entry;
  return {
    ...entry,
    settingsPath: [...entry.settingsPath],
    ...entry.baseURLEnv === void 0 ? {} : { baseURLEnv: [...entry.baseURLEnv] },
    ...nativeAuth === void 0 ? {} : { nativeAuth: {
      ...nativeAuth,
      env: [...nativeAuth.env]
    } }
  };
}

// node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js
import { randomUUID as randomUUID2 } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

// node_modules/@deepseek-ai/dsh-session/lib/index.js
import { isAbsolute } from "node:path";

// node_modules/@deepseek-ai/dsh-scope/lib/index.js
var kScope = Symbol("dsh.scope");

// node_modules/@deepseek-ai/dsh-session/lib/index.js
function SessionSeq(value) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new TypeError(`SessionSeq must be a non-negative safe integer, got ${String(value)}`);
  return brandNumber(value);
}
function SessionLogOffset(value) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) throw new TypeError(`SessionLogOffset must be a non-negative safe integer, got ${String(value)}`);
  return brandNumber(value);
}
var KNOWN_SESSION_EVENT_TYPES = /* @__PURE__ */ new Set([
  "agent-preset/selected",
  "agent/inbox/spliced",
  "approval/asked",
  "approval/decided",
  "approval/policy",
  "assistant/attempt",
  "assistant/message",
  "command/done",
  "command/run",
  "compaction/end",
  "compaction/prune",
  "compaction/start",
  "compaction/summary",
  "deliverables/presented",
  "developer/message",
  "feedback/message-delete",
  "feedback/message-put",
  "feedback/record",
  "goal/change",
  "hook/invoked",
  "hook/result",
  "image/offload",
  "job/registered",
  "job/settled",
  "llm/retry",
  "llm/retry-started",
  "model/selection",
  "permission/preset",
  "plan/mode",
  "request/context",
  "request/header",
  "sandbox/mode",
  "schedule/change",
  "session-log-deepseek/delivery-accepted",
  "session/end-seed",
  "session/title",
  "session/title-llm-request",
  "step/end",
  "step/start",
  "subagent/catalog",
  "subagent/descriptor",
  "subagent/model-selection-policy",
  "system/message",
  "team/member",
  "team/message/delivered",
  "team/message/queued",
  "team/task",
  "todo/write",
  "tool-workflow/agent-end",
  "tool-workflow/agent-start",
  "tool-workflow/run-end",
  "tool-workflow/run-start",
  "tool/call",
  "tool/ptc-dispatch",
  "tool/ptc-dispatch-start",
  "tool/result",
  "turn/end",
  "turn/start",
  "user/message",
  "web/deepseek-search-llm-request",
  "working-directory/change",
  "workspace/changes"
]);
var MESSAGE_PROJECTION_EVENT_TYPES = /* @__PURE__ */ new Set(["image/offload"]);
var SURFACE_EVENT_TYPES = /* @__PURE__ */ new Set([
  "system/message",
  "developer/message",
  "user/message",
  "assistant/message",
  "tool/result"
]);
function isSurfaceEligibleType(type) {
  return SURFACE_EVENT_TYPES.has(type);
}
function deriveEventMessage(event, projectedMessages) {
  const projected = projectedMessages?.get(event.seq);
  if (projected !== void 0) return projected;
  switch (event.type) {
    case "user/message":
      return event.data;
    case "system/message":
    case "developer/message":
    case "assistant/message":
      if (event.data.message.content.length === 0) return null;
      return event.data.message;
    case "tool/result":
      return event.data.message;
    default:
      return null;
  }
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function validateSessionEventData(event, subject) {
  const data = event.data;
  if (SURFACE_EVENT_TYPES.has(event.type) && isRecord(data)) {
    const message = event.type === "user/message" ? data : data["message"];
    if (isRecord(message)) {
      if (event.type === "developer/message" !== (message["role"] === "developer")) throw new Error(`${subject} developer/message and developer role must occur together`);
      if (message["role"] !== "developer" && Array.isArray(message["content"]) && message["content"].some((block) => isRecord(block) && (block["type"] === "tool-addition" || block["type"] === "tool-removal"))) throw new Error(`${subject} tool-change blocks require developer role`);
      if (event.type === "developer/message" && Array.isArray(message["content"])) {
        let hasAdditions = false;
        for (const block of message["content"]) {
          if (!isRecord(block) || block["type"] !== "tool-addition" && block["type"] !== "tool-removal") continue;
          if (typeof block["toolName"] !== "string" || block["toolName"].length === 0) throw new Error(`${subject} ${block["type"]} requires a nonempty toolName`);
          if (block["type"] === "tool-addition") {
            hasAdditions = true;
            if (Object.hasOwn(block, "tool")) throw new Error(`${subject} tool-addition must omit inline tool definitions`);
          }
        }
        if (hasAdditions ? !isEventSeq(data["headerSeq"]) : Object.hasOwn(data, "headerSeq")) throw new Error(`${subject} requires headerSeq exactly when tool additions are present`);
      }
    }
  }
  if (event.type === "request/header") {
    if (!isRecord(data)) throw new Error(`${subject} data must be an object`);
    const header = data["header"];
    if (!isRecord(header)) throw new Error(`${subject} header must be an object`);
    if (Object.hasOwn(header, "system")) throw new Error(`${subject} must omit header.system; use system/message`);
    if (Array.isArray(header["tools"]) && header["tools"].length === 0) throw new Error(`${subject} must omit empty tools`);
    const defaults = header["adapterDefaults"];
    if (isRecord(defaults) && Object.keys(defaults).length === 0) throw new Error(`${subject} must omit empty adapterDefaults`);
  } else if (event.type === "tool/result") {
    if (!isRecord(data)) throw new Error(`${subject} data must be an object`);
    if (data["error"] === void 0) return;
    const message = data["message"];
    if (!isRecord(message) || message["isError"] !== true) throw new Error(`${subject} error requires message.isError === true`);
  }
}
function createFoldState() {
  return {
    nodes: [],
    replaceGeneration: 0,
    contentGeneration: 0,
    projectedMessages: /* @__PURE__ */ new Map(),
    projections: /* @__PURE__ */ new Set()
  };
}
function isEventSeq(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}
function isReplaceOp(value) {
  const op = value;
  return Object.keys(op).length === 3 && Object.hasOwn(op, "op") && Object.hasOwn(op, "startSeq") && Object.hasOwn(op, "endSeq") && op["op"] === "replace" && isEventSeq(op["startSeq"]) && isEventSeq(op["endSeq"]);
}
function surfaceOpOf(event) {
  const raw = event;
  if (!isSurfaceEligibleType(event.type)) {
    if (!KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable === true) return;
    if (raw.surfaceOp !== void 0) throw new Error(`session event "${event.type}" is not surface-eligible and cannot carry surfaceOp`);
    if (raw.sourceEventSeqs !== void 0) throw new Error(`session event "${event.type}" is not surface-eligible and cannot carry sourceEventSeqs`);
    return;
  }
  const op = raw.surfaceOp;
  if (op === void 0) throw new Error(`session event "${event.type}" is surface-eligible and requires a surfaceOp marker`);
  if (op === "append") return op;
  if (op === null || typeof op !== "object" || Array.isArray(op)) throw new Error(`session event "${event.type}" carries an invalid surfaceOp`);
  if (!isReplaceOp(op)) throw new Error(`session event "${event.type}" carries an invalid replace surfaceOp`);
  return op;
}
function assertSourceEventReferences(event, shadowedSeqs) {
  const raw = event.sourceEventSeqs;
  if (event.type === "assistant/message" && raw !== void 0) throw new Error("assistant/message embeds its source stream and cannot carry sourceEventSeqs");
  const sources = /* @__PURE__ */ new Set();
  if (raw !== void 0) {
    if (!Array.isArray(raw)) throw new Error(`sourceEventSeqs on event at seq ${event.seq} must be an array when present`);
    if (raw.length === 0) throw new Error("sourceEventSeqs must not be empty");
    let nonEarlierSource;
    for (const source of raw) {
      if (!isEventSeq(source)) throw new Error(`session event "${event.type}" sourceEventSeqs must densely contain non-negative safe integers`);
      sources.add(source);
      if (nonEarlierSource === void 0 && source >= event.seq) nonEarlierSource = source;
    }
    if (sources.size !== raw.length) throw new Error("sourceEventSeqs must not contain duplicates");
    if (nonEarlierSource !== void 0) throw new Error(`sourceEventSeqs must reference earlier events: ${nonEarlierSource} >= current seq ${event.seq}`);
  }
  const missing = shadowedSeqs.filter((seq) => !sources.has(seq));
  if (missing.length > 0) throw new Error(`surface replace: sourceEventSeqs must include every shadowed surface node; missing ${missing.join(", ")}`);
}
function assertDeveloperHeader(event, events, baseSeq) {
  if (event.type !== "developer/message") return;
  validateSessionEventData(event, `developer/message at seq ${event.seq}`);
  if (event.data.headerSeq === void 0) return;
  const headerSeq = event.data.headerSeq;
  const headerEvent = events[headerSeq - baseSeq];
  if (headerSeq >= event.seq || headerEvent?.type !== "request/header") throw new Error("developer/message headerSeq must reference an earlier request/header");
  for (const block of event.data.message.content) {
    if (block.type !== "tool-addition") continue;
    const definitions = headerEvent.data.header.tools?.filter((tool) => tool.name === block.toolName) ?? [];
    if (definitions.length !== 1) throw new Error(`developer/message tool-addition "${block.toolName}" must name exactly one tool in headerSeq ${headerSeq}`);
    const definition = definitions[0];
    if (typeof definition.description !== "string" || !isRecord(definition.parameters)) throw new Error(`developer/message tool-addition "${block.toolName}" requires a complete tool definition in headerSeq ${headerSeq}`);
    if (Object.hasOwn(definition, "deferLoading") && definition.deferLoading !== true) throw new Error("developer/message referenced tool deferLoading must be true when present");
  }
}
function validateSurfaceMetadata(event) {
  const op = surfaceOpOf(event);
  if (op !== void 0 && op !== "append" && (op.startSeq >= event.seq || op.endSeq >= event.seq)) throw new Error(`surface replace at seq ${event.seq}: startSeq and endSeq must reference earlier events`);
  if (op !== void 0) assertSourceEventReferences(event, []);
  return op;
}
function replacementRange(state, op) {
  const startIdx = state.nodes.indexOf(op.startSeq);
  if (startIdx === -1) throw new Error(`surface replace: start seq ${op.startSeq} not found in surface`);
  const endIdx = state.nodes.indexOf(op.endSeq);
  if (endIdx === -1) throw new Error(`surface replace: end seq ${op.endSeq} not found in surface`);
  if (startIdx > endIdx) throw new Error(`surface replace: start seq ${op.startSeq} (index ${startIdx}) is after end seq ${op.endSeq} (index ${endIdx})`);
  return {
    startIdx,
    endIdx,
    shadowedSeqs: state.nodes.slice(startIdx, endIdx + 1)
  };
}
function isDeepEqualJson(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => isDeepEqualJson(item, b[i]));
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const aKeys = Object.keys(a);
  const bRecord = b;
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => Object.hasOwn(b, key) && isDeepEqualJson(a[key], bRecord[key]));
}
function assertToolResultRewrite(event, shadowedSeqs, events, baseSeq) {
  if (event.type !== "tool/result") return;
  if (shadowedSeqs.length !== 1) throw new Error("tool/result surface replacement must rewrite exactly one current node");
  for (const originalSeq of shadowedSeqs) {
    const original = events[originalSeq - baseSeq];
    if (original?.type !== "tool/result") throw new Error("tool/result surface replacement must target a current tool/result");
    const originalRest = { ...original.data };
    const replacementRest = { ...event.data };
    originalRest["message"] = {
      ...original.data.message,
      content: null
    };
    replacementRest["message"] = {
      ...event.data.message,
      content: null
    };
    if (!isDeepEqualJson(originalRest, replacementRest)) throw new Error("tool/result surface replacement may change only content");
  }
}
function assertSystemHeadRewrite(event, state, startIdx, shadowedSeqs, events, baseSeq) {
  if (startIdx !== 0) return;
  if (events[state.nodes[0] - baseSeq]?.type !== "system/message") return;
  if (event.type !== "system/message" || shadowedSeqs.length !== 1) throw new Error("surface replace: node 0 holds the system prompt and may be rewritten only by a system/message over exactly that node");
}
function planSurfaceEvent(state, event, expectedSeq, events, baseSeq, projections) {
  if (event.seq !== expectedSeq) throw new Error(`session event seq ${event.seq} is not contiguous; expected ${expectedSeq}`);
  const surfaceOp = validateSurfaceMetadata(event);
  assertDeveloperHeader(event, events, baseSeq);
  const projection = projections.find((item) => item.type === event.type);
  if (projection !== void 0) return {
    kind: "project",
    projection,
    messages: projection.project(event, {
      nodes: state.nodes,
      events,
      baseSeq,
      messages: state.projectedMessages
    })
  };
  if (MESSAGE_PROJECTION_EVENT_TYPES.has(event.type)) throw new Error(`session event "${event.type}" requires a message projection; load its owning plugin or supply its projection definition`);
  if (surfaceOp === void 0) return;
  if (surfaceOp === "append") return {
    kind: "append",
    seq: event.seq
  };
  const range = replacementRange(state, surfaceOp);
  assertSourceEventReferences(event, range.shadowedSeqs);
  assertToolResultRewrite(event, range.shadowedSeqs, events, baseSeq);
  assertSystemHeadRewrite(event, state, range.startIdx, range.shadowedSeqs, events, baseSeq);
  return {
    kind: "replace",
    seq: event.seq,
    start: surfaceOp.startSeq,
    end: surfaceOp.endSeq,
    ...range
  };
}
function applySurfaceEvent(state, event, expectedSeq, events, baseSeq, projections) {
  return applySurfacePlan(state, planSurfaceEvent(state, event, expectedSeq, events, baseSeq, projections));
}
function applySurfacePlan(state, plan) {
  if (plan?.kind === "append") state.nodes.push(plan.seq);
  else if (plan?.kind === "replace") {
    state.nodes.splice(plan.startIdx, plan.endIdx - plan.startIdx + 1, plan.seq);
    state.replaceGeneration += 1;
    state.contentGeneration += 1;
  } else if (plan?.kind === "project") {
    for (const [seq, message] of plan.messages) state.projectedMessages.set(seq, message);
    state.projections.add(plan.projection);
    state.contentGeneration += 1;
  }
  if (plan?.kind !== "replace") return;
  return {
    seq: plan.seq,
    start: plan.start,
    end: plan.end,
    shadowedSeqs: plan.shadowedSeqs
  };
}
var SurfaceManager = class {
  log;
  baseSeq;
  projections;
  /** Shared transition state; replacement history is not retained. */
  _state = createFoldState();
  /** Last processed absolute seq. */
  _lastProcessedSeq;
  /** Candidate already validated by `validateNext`, pending exact log admission. */
  _pendingPlan;
  /**
  * @param log - Contiguous complete log or loaded event window.
  * @param baseSeq - Absolute sequence of the window's first event.
  * @param projections - live borrowed definitions; removing a used definition invalidates further reads.
  */
  constructor(log, baseSeq = SessionLogOffset(0), projections = []) {
    this.log = log;
    this.baseSeq = baseSeq;
    this.projections = projections;
    this._lastProcessedSeq = baseSeq === 0 ? -1 : SessionSeq(baseSeq - 1);
  }
  /**
  * Validate the next candidate without mutating the committed surface.
  * @param event - candidate event that has not entered the log yet.
  */
  validateNext(event) {
    this._assertProjections();
    if (this._lastProcessedSeq < this.baseSeq + this.log.length - 1) this._processDelta();
    const expectedSeq = SessionSeq(this.baseSeq + this.log.length);
    this._pendingPlan = {
      event,
      expectedSeq,
      plan: planSurfaceEvent(this._state, event, expectedSeq, this.log, this.baseSeq, this.projections)
    };
  }
  /** Monotonic count of folded positional replacements. */
  get replaceGeneration() {
    this._assertProjections();
    if (this._lastProcessedSeq < this.baseSeq + this.log.length - 1) this._processDelta();
    return this._state.replaceGeneration;
  }
  /** Monotonic count of committed changes to existing model-visible content. */
  get contentGeneration() {
    this._assertProjections();
    if (this._lastProcessedSeq < this.baseSeq + this.log.length - 1) this._processDelta();
    return this._state.contentGeneration;
  }
  /**
  * Project one message with every committed message projection applied.
  * @param event - message-producing or log-only event.
  * @returns its immutable projected message, or null when it produces none.
  */
  deriveEventMessage(event) {
    this._assertProjections();
    if (this._lastProcessedSeq < this.baseSeq + this.log.length - 1) this._processDelta();
    return deriveEventMessage(event, this._state.projectedMessages);
  }
  /** Surface event sequences in model-visible order. */
  get nodes() {
    this._assertProjections();
    if (this._lastProcessedSeq < this.baseSeq + this.log.length - 1) this._processDelta();
    return this._state.nodes;
  }
  /** Fold events appended since the previous access. */
  _processDelta() {
    const tailSeq = this.baseSeq + this.log.length - 1;
    for (let seq = this._lastProcessedSeq + 1; seq <= tailSeq; seq++) {
      const index = seq - this.baseSeq;
      const event = this.log[index];
      const pending = this._pendingPlan;
      if (pending?.event === event && pending.expectedSeq === seq) applySurfacePlan(this._state, pending.plan);
      else applySurfaceEvent(this._state, event, SessionSeq(seq), this.log, this.baseSeq, this.projections);
      if (pending !== void 0 && pending.expectedSeq <= seq) this._pendingPlan = void 0;
      this._lastProcessedSeq = SessionSeq(seq);
    }
  }
  /** Cached messages cannot outlive the definitions that interpreted their log. */
  _assertProjections() {
    const candidate = this._pendingPlan;
    const pending = candidate !== void 0 && this.log[candidate.expectedSeq - this.baseSeq] === candidate.event ? candidate.plan : void 0;
    const required = pending?.kind === "project" ? [...this._state.projections, pending.projection] : this._state.projections;
    for (const projection of required) if (!this.projections.includes(projection)) throw new Error(`session message projection "${projection.type}" was removed or replaced; restore the session with its owning plugin`);
  }
};
function canonicalHeader(header) {
  const adapterDefaults = header.adapterDefaults;
  return {
    config: header.config,
    ...adapterDefaults?.reasoningEffort === true || adapterDefaults?.maxTokens === true ? { adapterDefaults } : {},
    ...header.tools !== void 0 && header.tools.length > 0 ? { tools: header.tools } : {}
  };
}
function foldRequestHeader(events, from2) {
  let state = from2;
  for (const event of events) if (event.type === "request/header") state = canonicalHeader(event.data.header);
  return state;
}
var ToolHistoryProjection = class {
  /** Historical declarations indexed by the header sequence referenced by additions. */
  headers = /* @__PURE__ */ new Map();
  /** Definitions retained in the current declaration series, including removed tools. */
  declared = /* @__PURE__ */ new Map();
  /** Active definitions from the latest request header. */
  active = [];
  /** Active names reconstructed from the baseline and recorded updates. */
  available = /* @__PURE__ */ new Set();
  /** Header that starts the current declaration series; absent before the first header. */
  baselineSeq;
  /** Immutable request snapshot of the current baseline and resolved updates. */
  history = deepFreeze({
    tools: [],
    updates: []
  });
  /**
  * Consume the next committed event in log order.
  * @param event - a session event, including inherited events during restoration.
  */
  apply(event) {
    if (event.type === "request/header") {
      const tools = event.data.header.tools ?? [];
      this.headers.set(event.seq, tools);
      const redeclared = tools.some((tool) => {
        const before = this.declared.get(tool.name);
        return before !== void 0 && JSON.stringify(before) !== JSON.stringify(tool);
      });
      if (this.baselineSeq === void 0 || event.data.reason === "series" || event.data.startsSeries || redeclared) {
        this.baselineSeq = event.seq;
        this.declared = new Map(tools.map((tool) => [tool.name, tool]));
        this.history = deepFreeze({
          tools,
          updates: []
        });
        this.available = new Set(tools.map((tool) => tool.name));
      }
      this.active = tools;
    } else if (event.type === "developer/message") {
      const { message, headerSeq } = event.data;
      const definitions = headerSeq === void 0 ? [] : this.headers.get(headerSeq);
      const additions = message.content.flatMap((block) => {
        if (block.type !== "tool-addition") return [];
        const tool = definitions?.find((tool2) => tool2.name === block.toolName);
        if (tool === void 0) throw new Error(`tool history: missing definition for ${block.toolName}`);
        return [tool];
      });
      for (const tool of additions) this.declared.set(tool.name, tool);
      for (const block of message.content) if (block.type === "tool-addition") this.available.add(block.toolName);
      else if (block.type === "tool-removal") this.available.delete(block.toolName);
      this.history = deepFreeze({
        tools: this.history.tools,
        updates: [...this.history.updates, {
          messageId: message.id,
          additions
        }]
      });
    }
  }
  /**
  * Read an immutable snapshot; subsequent events do not mutate it.
  * @returns initial declarations and historically resolved additions for the current series.
  */
  snapshot() {
    if (this.active.length !== this.available.size || this.active.some((tool) => !this.available.has(tool.name))) return deepFreeze({
      tools: this.active,
      updates: []
    });
    return this.history;
  }
};
function validateSessionHeader(id, input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("session header is not a plain JSON record");
  const record = input;
  if (Object.hasOwn(record, "seedLength")) throw new Error('session header has invalid field "seedLength"');
  if (record.version !== 4) throw new Error(`session header version must be 4, got ${String(record.version)}`);
  if (record.id !== id) throw new Error(`session header id "${String(record.id)}" does not match session id "${id}"`);
  if (typeof record.createdAt !== "number" || !Number.isSafeInteger(record.createdAt) || record.createdAt < 0) throw new Error("session header createdAt must be a non-negative safe integer");
  if (record.cwd !== void 0) {
    if (typeof record.cwd !== "string") throw new Error("session header cwd must be a string");
    if (!isAbsolute(record.cwd)) throw new Error(`session header cwd must be an absolute path, got "${record.cwd}"`);
  }
  if (record.parentSession !== void 0 && typeof record.parentSession !== "string") throw new Error("session header parentSession must be a string");
  if (typeof record.isSeeded !== "boolean") throw new Error("session header isSeeded must be a boolean");
  if (record.origin !== void 0 && record.origin !== "subagent") throw new Error('session header origin must be "subagent"');
  if (record.delegationDepth !== void 0 && (typeof record.delegationDepth !== "number" || !Number.isSafeInteger(record.delegationDepth) || record.delegationDepth < 0)) throw new Error("session header delegationDepth must be a non-negative safe integer");
  if (record.agentPreset !== void 0 && typeof record.agentPreset !== "string") throw new Error("session header agentPreset must be a string");
  return deepFreeze(record);
}
function validateRestoredSessionHeader(id, input) {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    const prototype = Reflect.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("session header is not a plain JSON record");
  }
  return validateSessionHeader(id, input);
}
function snapshotSessionHeader(id, source) {
  const snapshot2 = snapshotJsonValue(source === void 0 ? {
    version: 4,
    id,
    createdAt: Date.now(),
    isSeeded: false
  } : source);
  if (snapshot2 === void 0) throw new Error("session header is not losslessly JSON-serializable");
  return validateSessionHeader(id, snapshot2);
}
function assertSessionEventEnvelope(value, index) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`seed event at index ${index} has an invalid event envelope`);
  const event = value;
  for (const key in event) switch (key) {
    case "type":
    case "seq":
    case "time":
    case "data":
    case "surfaceOp":
    case "sourceEventSeqs":
    case "ignorable":
      break;
    default:
      throw new Error(`seed event at index ${index} has an invalid event envelope`);
  }
  const type = event["type"];
  const seq = event["seq"];
  const time = event["time"];
  if (typeof type !== "string" || typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0 || Object.is(seq, -0) || typeof time !== "number" || !Number.isSafeInteger(time) || event["data"] === void 0 || event["ignorable"] !== void 0 && event["ignorable"] !== true) throw new Error(`seed event at index ${index} has an invalid event envelope`);
  validateSessionEventData(event, `seed ${type} at index ${index}`);
  switch (type) {
    case "request/header":
    case "developer/message":
    case "system/message":
    case "user/message":
    case "assistant/attempt":
    case "assistant/message":
    case "tool/result":
      assertCurrentLlmShape(event, index);
      break;
  }
}
function assertCurrentLlmShape(event, index) {
  const data = event["data"];
  const record = typeof data === "object" && data !== null ? data : void 0;
  if (event["type"] === "request/header") {
    const headerRecord = record?.["header"];
    const config = headerRecord["config"];
    if (!hasProviderModel(config)) throw new Error(`seed request/header at index ${index} lacks provider/model`);
    const configRecord = config;
    const reasoningEffort = configRecord["reasoningEffort"];
    if (reasoningEffort !== void 0 && (typeof reasoningEffort !== "string" || reasoningEffort.length === 0)) throw new Error(`seed request/header at index ${index} has an invalid reasoningEffort`);
    assertAdapterDefaults(headerRecord["adapterDefaults"], configRecord, index);
    const reason = record?.["reason"];
    if (reason !== "initial" && reason !== "resume" && reason !== "change" && reason !== "series") throw new Error(`seed request/header at index ${index} has an invalid reason`);
    if (record?.["startsSeries"] !== void 0 && record["startsSeries"] !== true) throw new Error(`seed request/header at index ${index} has an invalid startsSeries marker`);
  }
  const type = event["type"];
  if (type === "assistant/attempt") {
    assertAssistantSettlementShape(record, type, index);
    return;
  }
  if (!isMessageEventType(type)) return;
  assertMessageEventShape(event, `seed ${type} at index ${index}`);
  if (type === "assistant/message") assertAssistantSettlementShape(record, type, index);
}
function assertAssistantSettlementShape(data, type, index) {
  const turn = data?.["turn"];
  const step = data?.["step"];
  if (typeof turn !== "number" || !Number.isSafeInteger(turn) || turn < 0 || Object.is(turn, -0) || typeof step !== "number" || !Number.isSafeInteger(step) || step < 0 || Object.is(step, -0) || !Array.isArray(data?.["stream"])) throw new Error(`seed ${type} at index ${index} has invalid settlement fields`);
}
var allowedAdapterKeys = /* @__PURE__ */ new Set(["reasoningEffort", "maxTokens"]);
function assertAdapterDefaults(value, config, index) {
  if (value === void 0) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`seed request/header at index ${index} has invalid adapterDefaults`);
  const defaults = value;
  if (Object.keys(defaults).some((key) => !allowedAdapterKeys.has(key)) || Object.values(defaults).some((marker) => marker !== true) || defaults["reasoningEffort"] === true && config["reasoningEffort"] === void 0 || defaults["maxTokens"] === true && config["maxTokens"] === void 0) throw new Error(`seed request/header at index ${index} has invalid adapterDefaults`);
}
function isMessageEventType(type) {
  return type === "developer/message" || type === "system/message" || type === "user/message" || type === "assistant/message" || type === "tool/result";
}
var MESSAGE_ROLE_BY_TYPE = {
  "system/message": "system",
  "developer/message": "developer",
  "user/message": "user",
  "assistant/message": "assistant",
  "tool/result": "tool"
};
function assertMessageEventShape(event, subject) {
  const type = event["type"];
  if (!isMessageEventType(type)) return;
  const data = event["data"];
  const record = typeof data === "object" && data !== null ? data : void 0;
  const message = type === "user/message" ? record : record?.["message"];
  if (typeof message !== "object" || message === null || typeof message["id"] !== "string" || message["id"] === "") throw new Error(`${subject} lacks an identified message`);
  const messageRecord = message;
  const expectedRole = MESSAGE_ROLE_BY_TYPE[type];
  if (messageRecord["role"] !== expectedRole) throw new Error(`${subject} message must have role "${expectedRole}"`);
  const source = messageRecord["source"];
  if (typeof source !== "object" || source === null || typeof source["kind"] !== "string" || source["kind"] === "") throw new Error(`${subject} message has invalid source`);
  if (!Array.isArray(messageRecord["content"])) throw new Error(`${subject} message has invalid content`);
  const sourceRecord = source;
  if (type === "system/message") {
    if (sourceRecord["kind"] !== "system-prompt") throw new Error(`${subject} message must have system-prompt source`);
    return;
  }
  if (type === "assistant/message") {
    if (sourceRecord["kind"] !== "model" || !hasProviderModel(sourceRecord)) throw new Error(`${subject} message must have model source`);
    return;
  }
  if (type !== "tool/result") return;
  if (sourceRecord["kind"] !== "tool" || typeof sourceRecord["callId"] !== "string" || sourceRecord["callId"] === "") throw new Error(`${subject} message must have tool source`);
  if (messageRecord["toolCallId"] !== sourceRecord["callId"]) throw new Error(`${subject} message has mismatched tool call ids`);
}
function hasProviderModel(value) {
  if (typeof value !== "object" || value === null) return false;
  const pair = value;
  return typeof pair["provider"] === "string" && pair["provider"].length > 0 && typeof pair["model"] === "string" && pair["model"].length > 0;
}
function collectSessionCallbacks(ctx, args) {
  return [...ctx.events.dispatch("emit", args)];
}
function invokeContainedSessionObservers(ctx, name2, id, args, callbacks) {
  for (const callback of callbacks) try {
    const returned = callback(...args);
    Promise.resolve(returned).catch((error) => {
      ctx.logger.warn(`session "${id}": ${name2} listener rejected: ${String(error)}`);
    });
  } catch (error) {
    ctx.logger.warn(`session "${id}": ${name2} listener threw: ${String(error)}`);
  }
}
var attachments = /* @__PURE__ */ new WeakMap();
var PLUGIN_RECORD_TYPE = /^plugin:[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/u;
function isPluginRecordType(type) {
  return PLUGIN_RECORD_TYPE.test(type);
}
function assertPluginRecordEvent(value) {
  const { type } = value;
  if (!isPluginRecordType(type)) throw new Error(`plugin record type "${type}" must be "plugin:" followed by lowercase slash-separated segments`);
}
var commitPluginRecord;
var Session = class Session2 {
  log = [];
  /** Single incremental owner of surface acceptance and projection state. */
  surfaceManager;
  /** The ordered surface over this session's event log. */
  get surface() {
    return this.surfaceManager;
  }
  /**
  * Detached, deep-frozen creation metadata (format version, cwd, lineage,
  * and whether fork history exists). Supplied by the store via `ctx.sessions.create()`. When a
  * `Session` is created without a store-owned header, a minimal header is
  * synthesized (stamped with the current {@link SESSION_FORMAT_VERSION}) so
  * `session.header` is always present. Kept out of the event log — it is a
  * storage concern, not replayable conversation state.
  */
  header;
  /** Number of leading events inherited from this Session's fork parent. */
  inheritedEventCount;
  /** The session identity, derived from its durable header's single copy. */
  get id() {
    return this.header.id;
  }
  /**
  * The constructor seed length (0 without one), before any marker appended
  * during construction. Seed events never publish on `session/event`. A
  * marker appended before the store attaches occupies this seq without
  * publishing either; otherwise this seq is available for the next append.
  *
  * This in-process offset is not persisted. A fork seed can already contain
  * the child's inherited marker and synthetic closers, so its child-owned
  * history starts at {@link inheritedEventCount}, before this offset. A
  * resumed Session's seed contains its full stored log, while its inherited
  * count keeps the durable fork cut. Consumers needing complete canonical
  * history start at seq 0.
  */
  firstLiveSeq;
  /**
  * First event produced for this object lifecycle. A new fork includes its
  * child-owned seed marker and closers; a restored Session starts after its
  * complete stored prefix. This in-process capture offset is not persisted.
  */
  firstLifecycleSeq;
  /**
  * Create a detached session by validating and snapshotting borrowed seed
  * events and storage metadata.
  * @param id - session identity.
  * @param seed - optional borrowed replay or fork events.
  * @param header - optional borrowed storage metadata.
  * @param inheritedEventCount - exact fork-inherited prefix length for a seeded header.
  * @param projections - pure interpreters for plugin-owned message changes.
  * @returns a detached session.
  * @throws when a seed event requires a missing message interpreter or fails validation.
  */
  static create(id, seed, header, inheritedEventCount, projections) {
    return new Session2(id, seed, header, "snapshot", inheritedEventCount, projections);
  }
  /**
  * Restore a detached session by adopting an independently owned or deeply frozen seed.
  * Runtime-required event fields, event envelopes, sequence continuity, surface
  * transitions, and header fields are validated without copying or freezing events.
  * Embedded Assistant streams remain opaque until a stream consumer or storage
  * verifier reads them.
  * @param id - restored session identity.
  * @param seed - independently owned or deeply frozen events.
  * @param header - independently owned storage metadata.
  * @param inheritedEventCount - exact fork-inherited prefix length decoded from storage.
  * @param eventState - aliasing state carried from the operation that produced the seed.
  * @param projections - pure interpreters for plugin-owned message changes.
  * @returns a restored detached session.
  * @throws when a seed event requires a missing message interpreter or fails validation.
  */
  static fromRestore(id, seed, header, inheritedEventCount, eventState, projections) {
    return new Session2(id, seed, header, eventState, inheritedEventCount, projections);
  }
  constructor(id, seed, header, mode = "snapshot", suppliedInheritedEventCount, projections = []) {
    this.surfaceManager = new SurfaceManager(this.log, SessionLogOffset(0), projections);
    const restoredHeader = mode === "snapshot" ? void 0 : validateRestoredSessionHeader(id, header);
    if (seed !== void 0) for (const [index, source] of seed.entries()) {
      const snapshot2 = mode === "snapshot" ? snapshotJsonValue(source) : source;
      if (snapshot2 === void 0) throw new Error(`seed event at index ${index} is not losslessly JSON-serializable`);
      assertSessionEventEnvelope(snapshot2, index);
      if (snapshot2.seq !== index) throw new Error(`seed event at index ${index} has seq ${snapshot2.seq} (expected ${index}); seed must be contiguous from 0`);
      try {
        this.surfaceManager.validateNext(snapshot2);
      } catch (error) {
        throw new Error(`invalid seed event at index ${index}: ${error instanceof Error ? error.message : "invalid surface metadata"}`);
      }
      this.log.push(mode === "snapshot" ? deepFreeze(snapshot2) : snapshot2);
    }
    this.firstLiveSeq = SessionLogOffset(this.log.length);
    this.header = restoredHeader ?? snapshotSessionHeader(id, header);
    if (this.header.isSeeded && seed === void 0) throw new Error("seeded session requires an explicit constructor seed");
    if (this.header.isSeeded && suppliedInheritedEventCount === void 0) throw new Error("seeded session requires an inherited event count");
    const inheritedEventCount = SessionLogOffset(suppliedInheritedEventCount ?? 0);
    if (!this.header.isSeeded && inheritedEventCount !== 0) throw new Error("unseeded session inherited event count must be 0");
    if (inheritedEventCount > this.log.length) throw new Error("session inherited event count exceeds its event log");
    const seedMarker = this.log[inheritedEventCount];
    const markedSeed = seedMarker?.type === "session/end-seed" && seedMarker.data.inherited === true;
    if (mode === "snapshot" && this.header.isSeeded && inheritedEventCount !== this.log.length && !markedSeed) throw new Error("seeded session constructor seed must equal its inherited prefix or mark its inherited cut");
    if (markedSeed && this.log.slice(inheritedEventCount + 1).some((event) => event.type === "session/end-seed" && event.data.inherited === true)) throw new Error("session inherited event count must identify the final inherited marker");
    this.inheritedEventCount = inheritedEventCount;
    this.firstLifecycleSeq = mode === "snapshot" && this.header.isSeeded ? inheritedEventCount : this.firstLiveSeq;
    if (seed !== void 0 && mode === "snapshot" && this.header.isSeeded && !markedSeed) this.append("session/end-seed", { inherited: true });
    else if (seed !== void 0 && !(mode === "snapshot" && this.header.isSeeded) && this.log.at(-1)?.type !== "session/end-seed") this.append("session/end-seed", {});
  }
  /** Cached immutable full snapshot of the private append-only log. */
  eventsSnapshot;
  /**
  * Return the immutable event stored at one exact sequence number.
  * @deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.
  * See the [Agent Note](../../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md).
  * @param seq - event sequence number.
  * @returns the accepted event, or undefined when the log does not contain it.
  */
  eventAt(seq) {
    return this.log[seq];
  }
  /**
  * Materialize an immutable snapshot of a half-open event sequence range.
  * A full current snapshot is reused until the next append; every previously
  * returned snapshot remains stable after later appends.
  * @deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.
  * See the [Agent Note](../../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md).
  * @param fromSeq - non-negative inclusive sequence number; defaults to the log start.
  * @param toSeqExclusive - non-negative exclusive sequence number; defaults to the current end.
  * @returns a frozen array of the selected deeply frozen events.
  */
  snapshotEvents(fromSeq = SessionLogOffset(0), toSeqExclusive = this.seq) {
    if (fromSeq === 0 && toSeqExclusive === this.log.length) {
      this.eventsSnapshot ??= Object.freeze([...this.log]);
      return this.eventsSnapshot;
    }
    return Object.freeze(this.log.slice(fromSeq, toSeqExclusive));
  }
  /**
  * Return this Session's events after its fork-inherited prefix.
  * @deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.
  * See the [Agent Note](../../../../.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md).
  * @returns a fresh array containing child-owned events in log order.
  */
  ownEvents() {
    return this.snapshotEvents(this.inheritedEventCount);
  }
  /**
  * Whether one existing event position is outside the fork-inherited prefix.
  * @param seq - event position in this Session.
  * @returns true when the event belongs to this Session rather than its parent.
  */
  isOwnSeq(seq) {
    return seq >= this.inheritedEventCount && seq < this.seq;
  }
  /** The next event's sequence number — always the log length (the `seq = log.length` contiguity contract). */
  get seq() {
    return SessionLogOffset(this.log.length);
  }
  /**
  * Append one typed event to the log and synchronously notify observers via
  * the store-owned, module-private publication hooks. The hot path never blocks
  * on I/O — persistence plugins buffer asynchronously. Once the event enters
  * the log, the append is committed: observer failures are logged and
  * contained per listener, so they do not change the return value or prevent
  * later listeners from observing the same accepted event.
  *
  * @param type - The event type (key of {@link SessionEventMap}).
  * @param data - The event payload; must be JSON-serializable.
  * @param opts - Surface metadata: `surfaceOp` controls how the event enters
  *   the ordered surface; `sourceEventSeqs` lists the seq numbers of earlier
  *   events this one derives from. REQUIRED for
  *   {@link SurfaceEventType} events (every message-producing event must
  *   declare how it joins the surface, the sole source of derived model
  *   history) and
  *   rejected by the compiler for non-surface types like `turn/start` or
  *   `assistant/attempt`. Assistant messages embed their exact provider
  *   stream and cannot cite top-level source events.
  * @returns the logged event — its assigned `seq`/`time` plus the SNAPSHOT of
  *   `data` that entered the log, so reading `event.data` back sees the logged
  *   value, never the caller's still-mutable input.
  * @throws if `data` or surface metadata is not losslessly JSON-serializable
  *   (BigInt, function, symbol, undefined, negative zero, non-finite number,
  *   circular reference, sparse array, or an exotic object such as
  *   Map/Set/Date/class instance), or when the candidate violates the
  *   request-header empty-field or tool-error consistency rules, or the
  *   canonical surface contract (marker shape and eligibility, unique
  *   earlier source-event references, positional replacement validity, and complete
  *   shadowed-node coverage). One iterative pass reads, validates, and
  *   copies each nested value once, so a stateful getter cannot supply one value
  *   to validation and another to storage. The event log is the durable source
  *   of truth, so a bad event fails at the append site rather than later during
  *   a backend flush. A synchronous internal dispatch validation failure or an
  *   append reentered while this acceptance/publication boundary is open also
  *   rejects before the log changes.
  */
  append(type, data, ...opts) {
    const surfaceOpts = opts[0];
    const surfaceMetadata = {
      ...surfaceOpts?.sourceEventSeqs === void 0 ? {} : { sourceEventSeqs: surfaceOpts.sourceEventSeqs },
      ...surfaceOpts?.surfaceOp === void 0 ? {} : { surfaceOp: surfaceOpts.surfaceOp }
    };
    const dataSnapshot = snapshotJsonValue(data);
    if (dataSnapshot === void 0) throw new Error(`session event "${type}" carries non-JSON-serializable data`);
    const surfaceMetadataSnapshot = snapshotJsonValue(surfaceMetadata);
    if (surfaceMetadataSnapshot === void 0) throw new Error(`session event "${type}" carries non-JSON-serializable surface metadata`);
    const entry = this.publicationEntry();
    const event = deepFreeze({
      type,
      seq: SessionSeq(this.log.length),
      time: Date.now(),
      data: dataSnapshot,
      ...surfaceMetadataSnapshot
    });
    validateSessionEventData(event, `session event "${type}" at seq ${event.seq}`);
    this.commit(event, entry);
    return event;
  }
  static {
    commitPluginRecord = (session, type, data) => session.#appendRecord(type, data);
  }
  /**
  * Commit one plugin record; {@link appendPluginRecord} is the only caller.
  * @param type - record type, checked against the plugin record grammar.
  * @param data - JSON payload, snapshotted before it enters the log.
  * @returns the record's sequence number.
  */
  #appendRecord(type, data) {
    const dataSnapshot = snapshotJsonValue(data);
    if (dataSnapshot === void 0) throw new Error(`plugin record "${type}" carries non-JSON-serializable data`);
    const entry = this.publicationEntry();
    const record = deepFreeze({
      type,
      seq: SessionSeq(this.log.length),
      time: Date.now(),
      data: dataSnapshot,
      ignorable: true
    });
    assertPluginRecordEvent(record);
    this.commit(record, entry);
    return record.seq;
  }
  /**
  * Read the store attachment for one append, refusing an append that
  * reenters while another append is being published.
  * @returns the attachment, or undefined for a detached Session.
  */
  publicationEntry() {
    const entry = attachments.get(this);
    if (entry?.appending) throw new Error("session append cannot reenter while another append is being published");
    return entry;
  }
  /**
  * Accept one frozen candidate at the next sequence number, enter it into the
  * log, and notify `session/event` observers with per-listener containment.
  * @param event - the candidate built at the current log length.
  * @param entry - the attachment read before the candidate was built.
  */
  commit(event, entry) {
    this.surfaceManager.validateNext(event);
    if (entry !== void 0) entry.appending = true;
    try {
      let callbacks;
      const callbackArgs = [this, event];
      if (entry !== void 0) callbacks = collectSessionCallbacks(entry.emitCtx, [
        entry.carrier,
        "session/event",
        ...callbackArgs
      ]);
      this.log.push(event);
      this.eventsSnapshot = void 0;
      if (callbacks !== void 0 && entry !== void 0) invokeContainedSessionObservers(entry.emitCtx, "session/event", entry.id, callbackArgs, callbacks);
    } finally {
      if (entry !== void 0) {
        entry.appending = false;
        if (entry.detachRequested && !entry.announcing) entry.detach();
      }
    }
  }
  /** Cached fold of the request-header events — see {@link requestHeader}. */
  headerFold;
  /** Log position (events consumed) the header fold has reached. */
  headerFoldSeq = 0;
  /**
  * The {@link EpochHeader} in force after the log's last header event — the
  * header the NEXT request will be compared against — or undefined before
  * the first `request/header` snapshot. The live, incrementally-maintained
  * form of `foldRequestHeader(session.snapshotEvents())`: each header event is folded
  * once, when first seen, so a per-step read costs O(new events).
  * @returns the folded header, or undefined when no header event exists yet.
  */
  requestHeader() {
    if (this.headerFoldSeq < this.log.length) {
      this.headerFold = deepFreeze(foldRequestHeader(this.log.slice(this.headerFoldSeq), this.headerFold));
      this.headerFoldSeq = this.log.length;
    }
    return this.headerFold;
  }
  /** Cached fold of `request/context` events. */
  contextFold;
  contextFoldSeq = 0;
  /**
  * Return the latest resolved route metadata, or `undefined` before the first
  * `request/context` event. Each event is folded once.
  * @returns the latest immutable route metadata.
  */
  requestContext() {
    if (this.contextFoldSeq < this.log.length) {
      for (const event of this.log.slice(this.contextFoldSeq)) if (event.type === "request/context") this.contextFold = deepFreeze({ ...event.data });
      this.contextFoldSeq = this.log.length;
    }
    return this.contextFold;
  }
  /** Cached historical tool definitions and updates for request projection. */
  toolHistoryProjection = new ToolHistoryProjection();
  /** Index of the next committed event not yet consumed by the tool-history fold. */
  toolHistorySeq = 0;
  /**
  * Fold unseen committed events into capability-independent tool history.
  * Initial access reconstructs inherited history; later reads consume only new events.
  * @returns an immutable snapshot for LLM request projection, including historical addition definitions.
  */
  toolHistory() {
    for (const event of this.log.slice(this.toolHistorySeq)) this.toolHistoryProjection.apply(event);
    this.toolHistorySeq = this.log.length;
    return this.toolHistoryProjection.snapshot();
  }
  /** The derived-message cache: frozen projections, extended per unseen node. */
  derived = [];
  /** Surface position (nodes projected) the cache has reached. */
  derivedNodes = 0;
  /** {@link SurfaceManager.contentGeneration} the cache was built under. */
  derivedGeneration = 0;
  /**
  * Derive the LLM message history by walking the ordered sequences of
  * message-producing events maintained by `surfaceOp` markers. The
  * surface is the single source of derived history: every message-producing
  * append records its `surfaceOp`, so a raw event with no marker (a chunk, a
  * turn boundary) is correctly absent, and a compaction `replace` deletes the
  * shadowed nodes from the derivation. The projection rules are
  * {@link deriveEventMessage}, with logged message projections applied
  * without changing node membership or message identity.
  *
  * CACHED: pure tail growth costs O(new nodes); a replacement or message projection
  * ({@link SessionSurface.contentGeneration}) rebuilds. The returned array is
  * a fresh snapshot per call (later appends never grow an array a caller
  * already holds); the `Message` objects in it are SHARED and **deep-frozen**.
  * Unchanged content reuses frozen event data; projected blocks are frozen
  * derived copies. Consumers cannot mutate the log through either form.
  * @returns a fresh array of the shared, frozen derived history.
  */
  deriveMessages() {
    const surface = this.surface;
    const nodes = surface.nodes;
    const generation = surface.contentGeneration;
    if (generation !== this.derivedGeneration) {
      this.derived = [];
      this.derivedNodes = 0;
      this.derivedGeneration = generation;
    }
    for (const seq of nodes.slice(this.derivedNodes)) {
      const msg = this.deriveEventMessage(this.log[seq]);
      if (msg) this.derived.push(msg);
    }
    this.derivedNodes = nodes.length;
    return [...this.derived];
  }
  /**
  * Project one event with all committed message projections applied.
  * The original durable event remains unchanged.
  * @param event - the event to project.
  * @returns the derived message, or null when the event produces none.
  */
  deriveEventMessage(event) {
    return this.surfaceManager.deriveEventMessage(event);
  }
};

// node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js
var DEFAULT_THRESHOLD_RATIO = 0.8;
var DEFAULT_RETAIN_RATIO = 0.16;
var POLICY_CONFIG_KEYS = [
  "thresholdRatio",
  "headroomTokens",
  "retainRatio",
  "retainTokens",
  "summarizationProvider",
  "summarizationModel",
  "maxTokens",
  "compactionRetries",
  "maxOverflowRetries"
];
var BASIC_COMPACT_CONFIG_KEYS = /* @__PURE__ */ new Set([
  ...POLICY_CONFIG_KEYS,
  "modelPolicies",
  "auto"
]);
var MODEL_POLICY_KEYS = /* @__PURE__ */ new Set([
  "provider",
  "model",
  ...POLICY_CONFIG_KEYS
]);
var TargetPressureConfigError = class extends Error {
  targetKey;
  /**
  * @param targetKey - exact provider/model route used as the warning key.
  * @param message - actionable configuration failure detail.
  */
  constructor(targetKey, message) {
    super(message);
    this.targetKey = targetKey;
  }
};
function resolveConfig2(config = {}) {
  validateKeys2(config, BASIC_COMPACT_CONFIG_KEYS, "BasicCompactionConfig");
  validatePolicy(config, "BasicCompactionConfig");
  if (config.auto !== void 0 && typeof config.auto !== "boolean") throw new Error("BasicCompactionConfig: auto must be a boolean");
  const headroomTokens = config.headroomTokens ?? 65536;
  const maxTokens = config.maxTokens ?? headroomTokens;
  assertPositiveInteger("BasicCompactionConfig.maxTokens (explicit or from headroomTokens)", maxTokens);
  const thresholdRatio = config.thresholdRatio ?? DEFAULT_THRESHOLD_RATIO;
  const retention = resolveRetention(config, { retainRatio: DEFAULT_RETAIN_RATIO });
  validateRatioRetention(thresholdRatio, retention, "BasicCompactionConfig");
  const modelPolicies = resolveModelPolicies(config.modelPolicies);
  for (const [index, policy] of modelPolicies.entries()) {
    if (policy.maxTokens === void 0 && config.maxTokens === void 0 && policy.headroomTokens !== void 0) policy.maxTokens = policy.headroomTokens;
    assertPositiveInteger(`BasicCompactionConfig: modelPolicies[${index}].maxTokens (explicit or from headroomTokens)`, policy.maxTokens ?? maxTokens);
    validateRatioRetention(policy.thresholdRatio ?? thresholdRatio, resolveRetention(policy, retention), `BasicCompactionConfig: modelPolicies[${index}]`);
  }
  return deepFreeze({
    thresholdRatio,
    headroomTokens,
    ...retention,
    summarizationProvider: config.summarizationProvider ?? "",
    summarizationModel: config.summarizationModel ?? "",
    maxTokens,
    compactionRetries: config.compactionRetries ?? 1,
    maxOverflowRetries: config.maxOverflowRetries ?? 1,
    modelPolicies,
    auto: config.auto ?? true
  });
}
function resolveTargetPolicy(config, target) {
  const override = config.modelPolicies.find((policy) => policy.provider === target.provider && policy.model === target.model);
  const inheritedRetention = config.retainTokens === void 0 ? { retainRatio: config.retainRatio } : { retainTokens: config.retainTokens };
  return deepFreeze({
    target: {
      provider: target.provider,
      model: target.model
    },
    thresholdRatio: override?.thresholdRatio ?? config.thresholdRatio,
    headroomTokens: override?.headroomTokens ?? config.headroomTokens,
    ...resolveRetention(override ?? {}, inheritedRetention),
    summarizationProvider: override?.summarizationProvider ?? config.summarizationProvider,
    summarizationModel: override?.summarizationModel ?? config.summarizationModel,
    maxTokens: override?.maxTokens ?? config.maxTokens,
    compactionRetries: override?.compactionRetries ?? config.compactionRetries,
    maxOverflowRetries: override?.maxOverflowRetries ?? config.maxOverflowRetries
  });
}
function resolveCompactSpec(policy, contextWindow, reservedCompletionTokens2) {
  const targetKey = `${policy.target.provider}/${policy.target.model}`;
  if (!Number.isInteger(contextWindow) || contextWindow <= 0) throw new TargetPressureConfigError(targetKey, `BasicCompactionConfig: contextWindow (${contextWindow}) must be a positive integer`);
  if (!Number.isInteger(reservedCompletionTokens2) || reservedCompletionTokens2 < 0) throw new TargetPressureConfigError(targetKey, `BasicCompactionConfig: reservedCompletionTokens (${reservedCompletionTokens2}) must be a non-negative integer`);
  const messageBudgetTokens = contextWindow - reservedCompletionTokens2;
  if (messageBudgetTokens <= 0) throw new TargetPressureConfigError(targetKey, `compaction-basic: ${targetKey} reserves ${reservedCompletionTokens2} completion tokens of its ${contextWindow}-token context window, leaving no message budget; configure the adapter model's contextWindow above the effective request maxTokens`);
  const pressureBudgetTokens = messageBudgetTokens - policy.headroomTokens;
  if (pressureBudgetTokens <= 0) throw new TargetPressureConfigError(targetKey, `compaction-basic: ${targetKey} reserves ${reservedCompletionTokens2} completion tokens and ${policy.headroomTokens} headroom tokens of its ${contextWindow}-token context window, leaving no pressure budget; reduce the effective request maxTokens or compaction headroomTokens, or configure a larger adapter model contextWindow`);
  const thresholdTokens = Math.floor(Math.min(contextWindow * policy.thresholdRatio, pressureBudgetTokens));
  const retainTokens = policy.retainTokens === void 0 ? Math.floor(messageBudgetTokens * policy.retainRatio) : policy.retainTokens;
  if (retainTokens >= thresholdTokens) throw new TargetPressureConfigError(targetKey, `BasicCompactionConfig: ${policy.target.provider}/${policy.target.model} retainTokens (${retainTokens}) must be less than threshold tokens ${thresholdTokens}`);
  return deepFreeze({
    target: { ...policy.target },
    contextWindow,
    thresholdRatio: policy.thresholdRatio,
    thresholdTokens,
    retainTokens,
    summarizationProvider: policy.summarizationProvider,
    summarizationModel: policy.summarizationModel,
    maxTokens: policy.maxTokens,
    compactionRetries: policy.compactionRetries,
    maxOverflowRetries: policy.maxOverflowRetries
  });
}
function resolveRetention(config, fallback) {
  if (config.retainTokens !== void 0) return { retainTokens: config.retainTokens };
  if (config.retainRatio !== void 0) return { retainRatio: config.retainRatio };
  return fallback;
}
function validateRatioRetention(thresholdRatio, retention, name2) {
  if (retention.retainRatio !== void 0 && retention.retainRatio >= thresholdRatio) throw new Error(`${name2}: retainRatio (${retention.retainRatio}) must be less than the resolved thresholdRatio (${thresholdRatio})`);
}
function resolveModelPolicies(configured) {
  if (configured === void 0) return [];
  if (!Array.isArray(configured)) throw new Error("BasicCompactionConfig: modelPolicies must be an array");
  const seen = /* @__PURE__ */ new Set();
  return configured.map((source, index) => {
    assertModelPolicy(source, `BasicCompactionConfig: modelPolicies[${index}]`);
    const key = `${source.provider}\0${source.model}`;
    if (seen.has(key)) throw new Error(`BasicCompactionConfig: duplicate model policy for ${source.provider}/${source.model}`);
    seen.add(key);
    return { ...source };
  });
}
function assertModelPolicy(source, name2) {
  if (!isUnknownRecord(source)) throw new Error(`${name2} must be an object`);
  validateKeys2(source, MODEL_POLICY_KEYS, name2);
  assertNonEmptyString(`${name2}.provider`, source.provider);
  assertNonEmptyString(`${name2}.model`, source.model);
  validatePolicy(source, name2);
}
function validatePolicy(config, name2) {
  const thresholdRatio = config.thresholdRatio;
  const headroomTokens = config.headroomTokens;
  const retainRatio = config.retainRatio;
  const retainTokens = config.retainTokens;
  const maxTokens = config.maxTokens;
  const compactionRetries = config.compactionRetries;
  const maxOverflowRetries = config.maxOverflowRetries;
  if (thresholdRatio !== void 0) assertRatio(`${name2}.thresholdRatio`, thresholdRatio);
  if (headroomTokens !== void 0) assertNonNegativeInteger(`${name2}.headroomTokens`, headroomTokens);
  if (retainRatio !== void 0) assertRatio(`${name2}.retainRatio`, retainRatio);
  if (retainTokens !== void 0) assertNonNegativeInteger(`${name2}.retainTokens`, retainTokens);
  if (retainRatio !== void 0 && retainTokens !== void 0) throw new Error(`${name2}: retainRatio and retainTokens are mutually exclusive`);
  if (maxTokens !== void 0) assertPositiveInteger(`${name2}.maxTokens`, maxTokens);
  if (compactionRetries !== void 0) assertNonNegativeInteger(`${name2}.compactionRetries`, compactionRetries);
  if (maxOverflowRetries !== void 0) assertNonNegativeInteger(`${name2}.maxOverflowRetries`, maxOverflowRetries);
  validateSummarizationPair(config, name2);
}
function validateSummarizationPair(config, name2) {
  const provider = config.summarizationProvider;
  const model = config.summarizationModel;
  if (provider !== void 0 && typeof provider !== "string") throw new Error(`${name2}.summarizationProvider must be a string`);
  if (model !== void 0 && typeof model !== "string") throw new Error(`${name2}.summarizationModel must be a string`);
  if (provider === void 0 && model === void 0) return;
  if (provider === void 0 || model === void 0 || provider.length === 0 !== (model.length === 0)) throw new Error(`${name2}: summarizationProvider and summarizationModel must be set together as an empty or non-empty pair`);
}
function validateKeys2(config, keys, name2) {
  for (const key of Object.keys(config)) if (!keys.has(key)) throw new Error(`${name2}: unknown key "${key}"`);
}
function isUnknownRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertNonEmptyString(name2, value) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name2} must be a non-empty string`);
}
function assertPositiveInteger(name2, value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new Error(`${name2} (${String(value)}) must be a positive integer`);
}
function assertNonNegativeInteger(name2, value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`${name2} (${String(value)}) must be a non-negative integer`);
}
function assertRatio(name2, value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) throw new Error(`${name2} (${String(value)}) must be a number in (0, 1]`);
}
var SUMMARY_OPEN_TAG = "<compacted-summary>";
var SUMMARY_CLOSE_TAG = "</compacted-summary>";
var COMPACTION_INSTRUCTION = [
  "You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.",
  "",
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section \u2014 never drop a section.',
  "",
  "## Primary Request and Intent",
  "- [the user's original and evolving goals; quote verbatim where the exact wording matters]",
  "",
  "## Key Technical Concepts",
  "- [technologies, frameworks, patterns, and conventions in play]",
  "",
  "## Files and Code",
  "- [exact path: why it matters, key changes or snippets]",
  "",
  "## Errors and Fixes",
  "- [error: how it was resolved, plus any related user feedback]",
  "",
  "## Pending Jobs",
  "- [explicitly requested work not yet completed]",
  "",
  "## Current Work",
  "- [precisely what was in progress at this checkpoint]",
  "",
  "## Next Step",
  '- [the single next action, directly in line with the most recent request, or "(none)"]',
  "",
  "## Critical Context",
  "- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]",
  "",
  "Rules:",
  "- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.",
  "- Capture user feedback and explicit instructions faithfully, especially corrections.",
  "- Do NOT mention this summarization request or that the context was compacted.",
  "- Output only the checkpoint text: do not call any tool or take any other action.",
  `- If the conversation already contains a ${SUMMARY_OPEN_TAG} block, it is a PRIOR checkpoint. Do not copy it forward verbatim: preserve still-true facts, drop stale ones, and merge newer information into a single consolidated summary under the same structure.`
].join("\n");
var CHECKPOINT_PREAMBLE = "This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.";
async function summarizeWithLlm(ctx, config, input, agent, signal) {
  const latest = agent.session.requestHeader()?.config;
  const configured = config.summarizationProvider.length === 0 ? void 0 : {
    provider: config.summarizationProvider,
    model: config.summarizationModel
  };
  const agentTarget = agent.options.provider !== void 0 && agent.options.provider.length > 0 && agent.options.model !== void 0 && agent.options.model.length > 0 ? {
    provider: agent.options.provider,
    model: agent.options.model
  } : void 0;
  const target = configured ?? latest ?? agentTarget;
  if (target === void 0) throw new Error("no provider/model available for summarization: set both BasicCompactionConfig summarization fields, route one request, or set both AgentOptions fields");
  const assembler = new BlockAssembler();
  const messages = [...input.messages, deepFreeze({
    role: "user",
    content: [{
      type: "text",
      text: COMPACTION_INSTRUCTION
    }]
  })];
  const options = {
    provider: target.provider,
    model: target.model,
    messages,
    toolHistory: agent.session.toolHistory(),
    ...input.tools === void 0 ? {} : { tools: [...input.tools] },
    maxTokens: config.maxTokens,
    sessionId: agent.session.id,
    purpose: "compaction",
    ...signal === void 0 ? {} : { signal }
  };
  for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk);
  const error = finishError(assembler.finish);
  if (error !== void 0) throw error;
  const rawOutput = assembler.blocks();
  const summary = summaryText(rawOutput);
  if (!summary.some((block) => block.text.trim().length > 0)) throw new Error("summarization produced no text summary content");
  return {
    summary,
    rawOutput,
    llmStreamCall: true,
    provider: options.provider,
    model: options.model,
    maxTokens: config.maxTokens,
    ...assembler.usage === void 0 ? {} : { usage: assembler.usage }
  };
}
function frameSummary(summary) {
  return [
    {
      type: "text",
      text: `${CHECKPOINT_PREAMBLE}

${SUMMARY_OPEN_TAG}`
    },
    ...summary,
    {
      type: "text",
      text: SUMMARY_CLOSE_TAG
    }
  ];
}
function finishError(finish) {
  switch (finish.kind) {
    case "error":
    case "aborted":
      return new LlmError(finish.failure.message, finish.failure.code, finish.failure);
    case "max-tokens": {
      const error = /* @__PURE__ */ new Error("summarization truncated at the token cap (incomplete checkpoint)");
      error.code = "MAX_TOKENS";
      return error;
    }
    default:
      return;
  }
}
function summaryText(blocks) {
  if (contentHasImage(blocks)) throw new LlmError("compaction summary cannot contain image output", "UNSUPPORTED_CONTENT");
  return blocks.filter((block) => block.type === "text");
}
var SurfaceChangedError = class extends Error {
};
function systemHead(session, headSeq) {
  const head = session.eventAt(headSeq);
  return head.type === "system/message" ? head : void 0;
}
function selectCompactableRange(session, measurement, retainTokens) {
  const pricedNodes = measurement.nodes;
  if (pricedNodes.length === 0) return null;
  const surfaceNodes = session.surface.nodes;
  if (surfaceNodes.length !== pricedNodes.length || surfaceNodes.some((seq, index) => seq !== pricedNodes[index]?.seq)) throw new Error("compaction: token-meter surface does not match the current session surface");
  const firstIdx = systemHead(session, surfaceNodes[0]) === void 0 ? 0 : 1;
  let accumulated = 0;
  let keepFromIdx = pricedNodes.length;
  for (let index = pricedNodes.length - 1; index >= 0; index -= 1) {
    accumulated += pricedNodes[index].tokens;
    keepFromIdx = index;
    if (accumulated >= retainTokens) break;
  }
  if (keepFromIdx <= firstIdx) return null;
  while (keepFromIdx > firstIdx) {
    if (toolPairingBalancedBefore(session, surfaceNodes[keepFromIdx])) break;
    keepFromIdx -= 1;
  }
  if (keepFromIdx <= firstIdx) return null;
  return {
    start: surfaceNodes[firstIdx],
    end: surfaceNodes[keepFromIdx - 1]
  };
}
async function compactSurfaceRegion(dependencies, session, start, end, agent, options, signal) {
  if (options.owner === null) signal?.throwIfAborted();
  const selection = validateSurfaceRegion(session, start, end);
  const entryState = inspectCompactionEntryState(session);
  assertCompactionInactive(entryState.unmatchedCompactionStart, entryState.latestEndSeedSeq, "compaction");
  let owner;
  if (options.owner === null) {
    if (entryState.openTurn !== null) throw new ManualCompactionError("busy", "manual compaction: the session already has an open turn");
    owner = null;
  } else {
    if (entryState.openTurn === null) throw new Error("compactRegion: no open turn \u2014 automatic compaction events must be enclosed in a turn");
    owner = entryState.openTurn;
  }
  const compactionId = CompactionId(randomUUID2());
  const lifecycle = {
    compactionId,
    ...options.sourceCommandId === void 0 ? {} : { sourceCommandId: options.sourceCommandId },
    turn: owner
  };
  const startEvent = session.append("compaction/start", lifecycle);
  const assertStable = options.stability === "whole-surface" ? assertWholeSurfaceUnchanged : assertSelectedSpanStable;
  let failure;
  let flushFailure;
  let result;
  let closed = false;
  let closing = false;
  let stage = "summary";
  try {
    const summarized = await summarizeCompaction(dependencies, prepareCompaction(dependencies, session, selection), agent, compactionId, options.sourceCommandId, assertStable, signal);
    if (options.owner === null) signal?.throwIfAborted();
    assertStable(dependencies, session, summarized);
    stage = "commit";
    const pending = commitCompactionBody(session, startEvent, summarized);
    closing = true;
    const endEvent = session.append("compaction/end", lifecycle);
    closed = true;
    result = completeCompaction(pending, endEvent);
  } catch (error) {
    failure = {
      error,
      stage: closing ? "commit" : stage
    };
    if (!closing) {
      closing = true;
      try {
        session.append("compaction/end", {
          ...lifecycle,
          error: errorChain(error)
        });
        closed = true;
      } catch (closeError) {
        failure = {
          error: closeError,
          stage: "commit"
        };
      }
    }
  }
  if (closed && options.flush !== void 0) try {
    await options.flush();
  } catch (error) {
    flushFailure = error;
  }
  if (options.owner === null) signal?.throwIfAborted();
  if (failure !== void 0) {
    if (options.owner === null) throwManualFailure(failure);
    throw failure.error;
  }
  if (flushFailure !== void 0) throw new ManualCompactionError("persistence", "manual compaction durability checkpoint failed", { cause: flushFailure });
  if (result === void 0) throw new Error("compaction committed without a result");
  return result;
}
function throwManualFailure(failure) {
  if (failure.stage === "commit") throw new ManualCompactionError("commit", "manual compaction did not commit cleanly", { cause: failure.error });
  if (failure.error instanceof SurfaceChangedError) throw new ManualCompactionError("changed", "the compacted history changed during manual compaction", { cause: failure.error });
  throw new ManualCompactionError("summary", "manual compaction could not produce a smaller summary", { cause: failure.error });
}
function assertCompactionInactive(unmatchedCompactionStart, latestEndSeedSeq, stage) {
  if (unmatchedCompactionStart === void 0 || latestEndSeedSeq !== void 0 && latestEndSeedSeq > unmatchedCompactionStart.seq) return;
  throw new ManualCompactionError("busy", `${stage}: compaction already in progress; the session compaction lock is already active`);
}
function assertNoActiveCompaction(session, stage) {
  const entryState = inspectCompactionEntryState(session);
  assertCompactionInactive(entryState.unmatchedCompactionStart, entryState.latestEndSeedSeq, stage);
}
function validateSurfaceRegion(session, start, end) {
  const nodes = session.surface.nodes;
  const startIdx = nodes.indexOf(start);
  const endIdx = nodes.indexOf(end);
  if (startIdx === -1) throw new Error(`compactRegion: start seq ${start} not found in surface`);
  if (endIdx === -1) throw new Error(`compactRegion: end seq ${end} not found in surface`);
  if (startIdx > endIdx) throw new Error(`compactRegion: start seq ${start} (position ${startIdx}) is after end seq ${end} (position ${endIdx}) on the surface`);
  if (!toolPairingBalancedBefore(session, nodes[startIdx])) throw new Error(`compactRegion: start seq ${start} is not a balanced boundary (would split a step's tool-call/result pair)`);
  if (!toolPairingBalancedAfter(session, nodes[endIdx])) throw new Error(`compactRegion: end seq ${end} is not a balanced boundary (would split a step, or the step is still open)`);
  return {
    start,
    end,
    startIdx,
    endIdx,
    shadowedSeqs: nodes.slice(startIdx, endIdx + 1)
  };
}
function prepareCompaction(dependencies, session, selection) {
  const measurement = dependencies.meter.measure(session);
  const selectedNodes = measurement.nodes.slice(selection.startIdx, selection.endIdx + 1);
  if (selectedNodes.length !== selection.shadowedSeqs.length || selectedNodes.some((node, index) => node.seq !== selection.shadowedSeqs[index])) throw new SurfaceChangedError("compaction: selected surface changed before summarization began");
  return {
    ...selection,
    measurement,
    selectedNodes,
    shadowedTokenCount: selectedNodes.reduce((total, node) => total + node.heuristicTokens, 0),
    shadowedRouteTokenCount: selectedNodes.reduce((total, node) => total + node.tokens, 0),
    input: buildSummarizationInput(session, selection.shadowedSeqs)
  };
}
async function summarizeCompaction(dependencies, prepared, agent, compactionId, sourceCommandId, assertStable, signal) {
  let summaryResult;
  for (; ; ) {
    signal?.throwIfAborted();
    try {
      summaryResult = await dependencies.summarize(prepared.input, agent, signal);
      break;
    } catch (error) {
      if (signal?.aborted === true) throw error;
      assertStable(dependencies, agent.session, prepared);
      if (!dependencies.recover(error, agent, prepared.shadowedSeqs, signal)) throw error;
      prepared = prepareCompaction(dependencies, agent.session, validateSurfaceRegion(agent.session, prepared.start, prepared.end));
    }
  }
  const checkpointMessage = createUserMessage({
    content: frameSummary(summaryResult.summary),
    source: compactCheckpointSource(compactionId, sourceCommandId)
  });
  const framedSummaryTokenCount = dependencies.meter.estimateMessage(checkpointMessage);
  if (framedSummaryTokenCount >= prepared.shadowedRouteTokenCount) throw new Error(`summary is not smaller than the shadowed content (${framedSummaryTokenCount} estimated framed tokens >= ${prepared.shadowedRouteTokenCount})`);
  return {
    ...prepared,
    ...summaryResult,
    checkpointMessage
  };
}
function assertWholeSurfaceUnchanged(dependencies, session, prepared) {
  if (!isDeepStrictEqual(dependencies.meter.measure(session).nodes, prepared.measurement.nodes)) throw new SurfaceChangedError("compaction: session surface changed during summarization");
}
function assertSelectedSpanStable(dependencies, session, prepared) {
  let current;
  try {
    current = validateSurfaceRegion(session, prepared.start, prepared.end);
  } catch (error) {
    throw new SurfaceChangedError("compaction: the selected span is no longer a valid replacement target", { cause: error });
  }
  if (!isDeepStrictEqual([...current.shadowedSeqs], [...prepared.shadowedSeqs])) throw new SurfaceChangedError("compaction: the selected span changed during summarization");
  if (!isDeepStrictEqual(dependencies.meter.measure(session).nodes.slice(current.startIdx, current.endIdx + 1), prepared.selectedNodes)) throw new SurfaceChangedError("compaction: the selected span was rewritten during summarization");
}
function commitCompactionBody(session, startEvent, summarized) {
  const { start, end, shadowedSeqs, shadowedTokenCount, summary, provider, model, maxTokens, usage, checkpointMessage } = summarized;
  const callRecord = summarized.llmStreamCall === true ? {
    rawOutput: summarized.rawOutput,
    llmStreamCall: true
  } : summarized.rawOutput === void 0 ? {} : { rawOutput: summarized.rawOutput };
  const summaryEvent = session.append("compaction/summary", {
    compactionId: startEvent.data.compactionId,
    ...startEvent.data.sourceCommandId === void 0 ? {} : { sourceCommandId: startEvent.data.sourceCommandId },
    summary,
    ...callRecord,
    shadowedRange: {
      start,
      end
    },
    shadowedSeqs: [...shadowedSeqs],
    shadowedTokenCount,
    provider,
    model,
    ...maxTokens === void 0 ? {} : { maxTokens },
    ...usage === void 0 ? {} : { usage }
  });
  session.append("user/message", checkpointMessage, {
    surfaceOp: {
      op: "replace",
      startSeq: start,
      endSeq: end
    },
    sourceEventSeqs: [
      startEvent.seq,
      summaryEvent.seq,
      ...shadowedSeqs
    ]
  });
  return {
    compactionId: startEvent.data.compactionId,
    ...startEvent.data.sourceCommandId === void 0 ? {} : { sourceCommandId: startEvent.data.sourceCommandId },
    startSeq: startEvent.seq,
    summarySeq: summaryEvent.seq,
    summary,
    shadowedRange: {
      start,
      end
    },
    shadowedSeqs: [...shadowedSeqs],
    shadowedTokenCount
  };
}
function completeCompaction(pending, endEvent) {
  return {
    ...pending,
    endSeq: endEvent.seq
  };
}
function buildSummarizationInput(session, shadowedSeqs) {
  const header = session.requestHeader();
  const head = systemHead(session, session.surface.nodes[0]);
  const system = head === void 0 ? null : session.deriveEventMessage(head);
  const regionMessages = shadowedSeqs.map((seq) => session.deriveEventMessage(session.eventAt(seq))).filter((message) => message !== null);
  return {
    ...header?.tools === void 0 ? {} : { tools: header.tools },
    messages: system === null ? regionMessages : [system, ...regionMessages]
  };
}
function inspectCompactionEntryState(session) {
  let openTurn = null;
  let openTurnStateKnown = false;
  let unmatchedCompactionStart;
  let compactionEntryStateKnown = false;
  let latestEndSeedSeq;
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    const event = session.eventAt(SessionSeq(seq));
    if (latestEndSeedSeq === void 0 && event.type === "session/end-seed") latestEndSeedSeq = event.seq;
    if (!compactionEntryStateKnown) {
      if (event.type === "compaction/start") {
        unmatchedCompactionStart = event;
        compactionEntryStateKnown = true;
      } else if (event.type === "compaction/end") compactionEntryStateKnown = true;
    }
    if (!openTurnStateKnown) {
      if (event.type === "turn/start") {
        openTurn = event.data.turn;
        openTurnStateKnown = true;
      } else if (event.type === "turn/end") openTurnStateKnown = true;
    }
    if (openTurnStateKnown && compactionEntryStateKnown && latestEndSeedSeq !== void 0) break;
  }
  return {
    openTurn,
    unmatchedCompactionStart,
    latestEndSeedSeq
  };
}
function routedTarget(session) {
  const config = session.requestHeader()?.config;
  if (config === void 0 || config.provider.length === 0 || config.model.length === 0) return;
  return {
    provider: config.provider,
    model: config.model
  };
}
function reservedCompletionTokens(agent, defaultMaxTokens) {
  return agent.session.requestHeader()?.config.maxTokens ?? defaultMaxTokens ?? 0;
}
function conversationTarget(agent) {
  const routed = routedTarget(agent.session);
  if (routed !== void 0) return routed;
  if (agent.options.provider === void 0 || agent.options.provider.length === 0 || agent.options.model === void 0 || agent.options.model.length === 0) return void 0;
  return {
    provider: agent.options.provider,
    model: agent.options.model
  };
}
var thresholdRatioSchema = Schema.number();
var headroomTokensSchema = Schema.number().step(1).min(0);
var retainRatioSchema = Schema.number();
var retainTokensSchema = Schema.number().step(1).min(0);
var summarizationProviderSchema = Schema.string();
var summarizationModelSchema = Schema.string();
var maxTokensSchema = Schema.number().step(1).min(1);
var compactionRetriesSchema = Schema.number().step(1).min(0);
var maxOverflowRetriesSchema = Schema.number().step(1).min(0);
var modelPolicy = Schema.object({
  provider: Schema.string().required(),
  model: Schema.string().required(),
  thresholdRatio: thresholdRatioSchema,
  headroomTokens: headroomTokensSchema,
  retainRatio: retainRatioSchema,
  retainTokens: retainTokensSchema,
  summarizationProvider: summarizationProviderSchema,
  summarizationModel: summarizationModelSchema,
  maxTokens: maxTokensSchema,
  compactionRetries: compactionRetriesSchema,
  maxOverflowRetries: maxOverflowRetriesSchema
});
var BasicCompactionEngine = class extends CompactionEngine {
  static inject = [
    "llm",
    "tokenMeter",
    "sessions"
  ];
  static Config = Schema.object({
    thresholdRatio: thresholdRatioSchema,
    headroomTokens: headroomTokensSchema,
    retainRatio: retainRatioSchema,
    retainTokens: retainTokensSchema,
    summarizationProvider: summarizationProviderSchema,
    summarizationModel: summarizationModelSchema,
    maxTokens: maxTokensSchema,
    compactionRetries: compactionRetriesSchema,
    maxOverflowRetries: maxOverflowRetriesSchema,
    modelPolicies: Schema.array(modelPolicy),
    auto: Schema.boolean()
  });
  /** Resolved and validated compaction configuration. */
  config;
  warnedPressureConfigTargets = /* @__PURE__ */ new Set();
  overflowRetries = /* @__PURE__ */ new WeakMap();
  overflowAgents = /* @__PURE__ */ new WeakMap();
  constructor(ctx, config = {}) {
    super(ctx);
    this.config = resolveConfig2(config);
    if (this.config.auto) this._registerAutomaticCompaction();
  }
  /**
  * Register automatic between-step pressure and model-request overflow
  * recovery. `compactIfNeeded` stays dynamically dispatched so subclass
  * overrides are honored at event time.
  */
  _registerAutomaticCompaction() {
    const { ctx } = this;
    const logResult = (result, trigger) => {
      ctx.logger.info(`compaction (${trigger}): shadowed ${result.shadowedSeqs.length} surface nodes (seqs ${result.shadowedRange.start}-${result.shadowedRange.end}, ~${result.shadowedTokenCount} tokens)`);
    };
    ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
      if (!signal.aborted) try {
        const result = await this.compactIfNeeded(agent, "pressure", signal);
        if (result !== null) logResult(result, "step pressure");
      } catch (error) {
        if (error instanceof TargetPressureConfigError) {
          if (this.warnedPressureConfigTargets.has(error.targetKey)) return next();
          this.warnedPressureConfigTargets.add(error.targetKey);
        }
        const message = error instanceof Error ? error.message : String(error);
        ctx.logger.warn(`step compaction failed: ${message}; continuing the turn`);
      }
      return next();
    });
    ctx.on("agent/status", ({ agent, status }) => {
      if (status === "idle") this.overflowRetries.delete(agent);
    });
    ctx.on("session/event", (session, event) => {
      if (event.type !== "assistant/message") return;
      const agent = this.overflowAgents.get(session);
      if (agent !== void 0) this.overflowRetries.delete(agent);
    });
    ctx.on("agent/request-error", async ({ agent, failure, signal }, next) => {
      if (failure.code !== CONTEXT_WINDOW_EXCEEDED_CODE || signal.aborted) return next();
      this.overflowAgents.set(agent.session, agent);
      const target = routedTarget(agent.session);
      if (target === void 0) return next();
      const policy = resolveTargetPolicy(this.config, target);
      const retries = this.overflowRetries.get(agent) ?? 0;
      if (retries >= policy.maxOverflowRetries) return next();
      const generation = agent.session.surface.replaceGeneration;
      let result;
      try {
        result = await this.compactIfNeeded(agent, "context-overflow", signal);
      } catch (recoveryError) {
        const message = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
        if (!signal.aborted && agent.session.surface.replaceGeneration > generation) {
          ctx.logger.warn(`context-overflow compaction failed after durable surface progress: ${message}; retrying from the replacement surface`);
          this.overflowRetries.set(agent, retries + 1);
          return { kind: "retry" };
        }
        ctx.logger.warn(`context-overflow compaction failed: ${message}; ${signal.aborted ? "cancellation prevents retry" : "preserving the original request error"}`);
        return next();
      }
      if (signal.aborted || agent.session.surface.replaceGeneration <= generation) return next();
      if (result !== null) logResult(result, "context overflow recovery");
      this.overflowRetries.set(agent, retries + 1);
      return { kind: "retry" };
    });
  }
  /**
  * Summarize the replayed conversation region through a direct one-shot
  * `ctx.llm.stream()` call whose prefix reuses the conversation's own system
  * prompt, tools, and messages so the provider's KV cache is not invalidated.
  * Override this sole hook for a template or remote summarizer.
  * @param input - replayed conversation prefix (system, tools, and leading messages) to condense.
  * @param agent - supplies routed-model history, fallback model, and session id.
  * @param signal - optional cancellation forwarded to the adapter.
  * @returns safe text summary blocks and the exact auxiliary call envelope and output.
  */
  async summarize(input, agent, signal) {
    const target = conversationTarget(agent);
    const config = target === void 0 ? this.config : resolveTargetPolicy(this.config, target);
    return summarizeWithLlm(this.ctx, config, input, agent, signal);
  }
  /**
  * Compact for replayed step-boundary pressure or one provider-confirmed context
  * overflow. Both triggers price the latest durable routed request envelope;
  * overflow bypasses the normal threshold and retained-tail policy so it can
  * force one useful balanced reduction.
  * @param agent - agent whose latest durable routed request is measured.
  * @param trigger - normal step-boundary pressure or context-overflow recovery.
  * @param signal - live turn cancellation signal forwarded to summarization.
  * @returns the latest summary compaction result, or `null` when no summary ran.
  */
  async compactIfNeeded(agent, trigger, signal) {
    const target = routedTarget(agent.session);
    if (target === void 0) return null;
    const policy = resolveTargetPolicy(this.config, target);
    const meter = this.ctx.tokenMeter;
    let measurement = meter.measure(agent.session);
    switch (trigger) {
      case "context-overflow":
        break;
      case "pressure":
        break;
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        assertNever(trigger, "compaction trigger");
    }
    const prune = this.ctx.get("toolResultPruner");
    if (trigger === "context-overflow") {
      if (prune !== void 0) {
        prune.pruneSession(agent.session);
        measurement = meter.measure(agent.session);
      }
      const range = selectCompactableRange(agent.session, measurement, 0);
      if (range === null) return null;
      return this.compactRegion(range.start, range.end, agent, signal);
    }
    const info = await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal);
    assertNoActiveCompaction(agent.session, "automatic pressure compaction");
    const targetKey = `${target.provider}/${target.model}`;
    if (info.context === void 0) throw new TargetPressureConfigError(targetKey, `compaction-basic: no context capacity for ${targetKey}; configure contextWindow on that adapter model`);
    const spec = resolveCompactSpec(policy, info.context.contextWindow, reservedCompletionTokens(agent, info.defaultMaxTokens));
    if (measurement.totalTokens < spec.thresholdTokens) return null;
    if (prune !== void 0) {
      prune.pruneSession(agent.session);
      measurement = meter.measure(agent.session);
    }
    if (measurement.totalTokens < spec.thresholdTokens) return null;
    let result = null;
    for (let attempt = 0; attempt <= spec.compactionRetries; attempt += 1) {
      const range = selectCompactableRange(agent.session, measurement, spec.retainTokens);
      if (range === null) {
        if (result === null) return null;
        break;
      }
      result = await this.compactRegion(range.start, range.end, agent, signal);
      measurement = meter.measure(agent.session);
      if (measurement.totalTokens < spec.thresholdTokens) return result;
    }
    throw new Error(`compaction still above threshold after ${spec.compactionRetries + 1} compaction attempts (${measurement.totalTokens} estimated tokens >= threshold ${spec.thresholdTokens})`);
  }
  /**
  * Compact one inclusive positional range from the agent-owned surface using
  * the effective token meter for all retention and shrink pricing.
  * @param start - inclusive first surface-node seq.
  * @param end - inclusive last surface-node seq.
  * @param agent - owner of the target session, used by the summarizer.
  * @param signal - optional summarization cancellation signal.
  * @returns the successful durable compaction result.
  */
  async compactRegion(start, end, agent, signal) {
    return compactSurfaceRegion(this.regionDependencies(), agent.session, start, end, agent, {
      owner: "current-turn",
      stability: "whole-surface"
    }, signal);
  }
  /**
  * Force one useful idle-session compaction below the pressure threshold, and
  * resolve only after its standalone marker pair is durably checkpointed.
  * @param agent - idle agent whose next-turn admission this call reserves.
  * @param signal - cancellation scoped to this compaction request.
  * @param sourceCommandId - initiating command identity for presentation correlation.
  * @returns the committed result, or `null` when no safe useful range exists.
  */
  compactNow(agent, signal, sourceCommandId) {
    signal.throwIfAborted();
    try {
      return agent.runMaintenance(async (agentSignal) => {
        const operationSignal = AbortSignal.any([agentSignal, signal]);
        try {
          operationSignal.throwIfAborted();
          const range = selectCompactableRange(agent.session, this.ctx.tokenMeter.measure(agent.session), 0);
          if (range === null) return null;
          return await compactSurfaceRegion(this.regionDependencies(), agent.session, range.start, range.end, agent, {
            owner: null,
            stability: "selected-span",
            ...sourceCommandId === void 0 ? {} : { sourceCommandId },
            flush: async () => {
              await this.ctx.sessions.flush(agent.session);
            }
          }, operationSignal);
        } catch (error) {
          if (agentSignal.aborted && operationSignal.reason === agentSignal.reason) throw new ManualCompactionError("cancelled", "manual compaction was cancelled", { cause: error });
          operationSignal.throwIfAborted();
          throw error;
        }
      });
    } catch (error) {
      throw new ManualCompactionError("busy", "manual compaction requires an idle agent with no waking queued work", { cause: error });
    }
  }
  /** Bind the effective token meter and dynamically dispatched summarizer hook. */
  regionDependencies() {
    return {
      meter: this.ctx.tokenMeter,
      summarize: (input, owner, abort) => this.summarize(input, owner, abort),
      recover: (error, agent, sourceEventSeqs, signal) => this.ctx.waterfall("compaction/summary-error", {
        session: agent.session,
        sourceEventSeqs,
        error,
        ...signal === void 0 ? {} : { signal }
      }, () => false)
    };
  }
};

// lib/engine.js
var PINNED_HEADING = "## \u538B\u7F29\u540E\u4ECD\u6709\u6548\u7684\u8981\u6C42\uFF08\u9010\u5B57\u4FDD\u7559\uFF09";
function formatPinnedBlock(items) {
  if (items.length === 0) return void 0;
  const lines = [PINNED_HEADING];
  for (const item of items) {
    const where = item.turn === void 0 ? "" : `\uFF08\u7B2C ${item.turn} \u8F6E\uFF09`;
    lines.push(`- [${item.kind}] ${item.text}${where}`);
  }
  return { type: "text", text: `

${lines.join("\n")}` };
}
function withPinned(summary, commitments, options = {}) {
  const maxItems = options.maxItems ?? 24;
  const block = formatPinnedBlock(commitments.slice(-maxItems));
  if (block === void 0) return summary;
  return [...summary, block];
}
function createPinnedEngine(ctx, config, readCommitments) {
  return class PinnedCompactionEngine extends BasicCompactionEngine {
    constructor(context, engineConfig = config ?? {}) {
      super(context, engineConfig);
      this.readCommitments = readCommitments;
    }
    async summarize(input, agent, signal) {
      const summary = await super.summarize(input, agent, signal);
      let commitments = [];
      try {
        commitments = this.readCommitments(agent?.session?.id) ?? [];
      } catch {
        return summary;
      }
      return withPinned(summary, commitments);
    }
  };
}

// lib/index.js
var name = "compact-receipt";
var inject = ["commands", "tools", "llm", "tokenMeter", "sessions"];
var MAX_COMMITMENTS = 400;
var WRITE_TOOL = /(^|_)(write|edit|patch|replace|create|append|insert)(_|$)/i;
var PATH_KEYS = ["path", "file_path", "filePath", "target", "filename", "file"];
var sessions = /* @__PURE__ */ new Map();
var agents = /* @__PURE__ */ new Map();
function stateOf(sessionId) {
  let state = sessions.get(sessionId);
  if (state === void 0) {
    state = { commitments: [], receipts: [], turn: 0, nextId: 1, guard: true, bySeq: /* @__PURE__ */ new Map(), probe: void 0, pending: void 0 };
    sessions.set(sessionId, state);
  }
  return state;
}
function textOf(message) {
  const blocks = message?.content ?? [];
  let out = "";
  for (const block of blocks) {
    if (block?.type === "text" && typeof block.text === "string") out += `${block.text}
`;
  }
  return out.trim();
}
function isProhibition(text) {
  return /^(不要|别|不准|不许|禁止|严禁|勿|不可以|不能|don'?t|do not|never|avoid)/i.test(text.trim());
}
function onUserMessage(state, event) {
  const message = event.data;
  if (state.pending !== void 0 && message?.id === state.pending.id) {
    state.pending.verifiedAt = event.time;
    const receipt = state.receipts[state.pending.receiptIndex];
    if (receipt !== void 0) {
      receipt.delivered = true;
      receipt.deliveredAt = event.time;
    }
    state.pending = void 0;
  }
  if (message?.source?.kind !== "user") return;
  const text = textOf(message);
  if (text.length === 0) return;
  state.bySeq.set(event.seq, text);
  if (state.bySeq.size > 300) state.bySeq.delete(state.bySeq.keys().next().value);
  for (const found of extractCommitments(text)) {
    state.commitments.push({
      id: state.nextId++,
      kind: found.kind,
      text: found.text,
      seq: event.seq,
      turn: state.turn,
      status: "active",
      blocked: 0
    });
  }
  if (state.commitments.length > MAX_COMMITMENTS) {
    state.commitments.splice(0, state.commitments.length - MAX_COMMITMENTS);
  }
}
async function onCompaction(state, sessionId, event, ctx) {
  const data = event.data;
  const summaryText2 = textOf({ content: data.summary });
  const shadowed = new Set(data.shadowedSeqs ?? []);
  const agentForModel = agents.get(sessionId);
  const streamForClassify = agentForModel === void 0 ? void 0 : makeStreamText(ctx, agentForModel);
  if (streamForClassify !== void 0) {
    const batch = [...shadowed].map((seq) => ({ id: seq, text: state.bySeq.get(seq) })).filter((row) => typeof row.text === "string" && row.text.length > 0);
    try {
      const labels = await classifyBatch(streamForClassify, batch);
      if (labels !== void 0) {
        for (const row of batch) {
          const label = labels.get(row.id);
          if (label === void 0 || label === "chatter") continue;
          const key = normalize(row.text);
          const known = state.commitments.some((c) => normalize(c.text) === key);
          if (known) continue;
          state.commitments.push({
            id: state.nextId++,
            kind: label,
            text: row.text.slice(0, 200),
            seq: row.id,
            turn: state.turn,
            status: "active",
            blocked: 0,
            source: "model"
          });
        }
      }
    } catch {
    }
  }
  const affected = state.commitments.filter((item) => shadowed.has(item.seq));
  if (affected.length === 0) return;
  const shadowedText = [...shadowed].map((seq) => ({ seq, text: state.bySeq.get(seq) })).filter((row) => typeof row.text === "string" && row.text.length > 0);
  state.probe = { at: event.time, ...probeCompaction(shadowedText, extractCommitments) };
  let audit = auditAgainstSummary(summaryText2, affected);
  let confident = false;
  const agent = agents.get(sessionId);
  const streamText = agent === void 0 ? void 0 : makeStreamText(ctx, agent);
  if (streamText !== void 0) {
    try {
      const verdicts = await judgeWithModel(streamText, affected, summaryText2);
      if (verdicts !== void 0) {
        const judged = { survived: [], lost: [], unverifiable: [] };
        for (const item of affected) {
          const row = verdicts.get(item.id);
          if (row === void 0) {
            const fallback = audit.survived.find((x) => x.id === item.id) ? "survived" : audit.lost.find((x) => x.id === item.id) ? "lost" : "unverifiable";
            judged[fallback].push({ ...item, score: null, why: "rule fallback" });
            continue;
          }
          const bucket = row.verdict === "kept" ? "survived" : row.verdict === "lost" ? "lost" : "unverifiable";
          judged[bucket].push({ ...item, score: null, why: row.why });
        }
        audit = judged;
        confident = true;
      }
    } catch {
    }
  }
  const mark2 = (items, status) => {
    for (const item of items) {
      const target = state.commitments.find((c) => c.id === item.id);
      if (target !== void 0) target.status = status;
    }
  };
  mark2(audit.survived, "survived");
  mark2(audit.lost, "lost");
  mark2(audit.unverifiable, "unverifiable");
  const receipt = {
    at: event.time,
    compactionId: data.compactionId,
    shadowedCount: shadowed.size,
    shadowedTokens: data.shadowedTokenCount ?? 0,
    confident,
    total: affected.length,
    survived: audit.survived,
    lost: audit.lost,
    unverifiable: audit.unverifiable
  };
  state.receipts.push(receipt);
  announce(state, sessionId, receipt);
}
function announce(state, sessionId, receipt) {
  if (receipt.lost.length === 0) return;
  const agent = agents.get(sessionId);
  if (agent === void 0) return;
  const id = `compact-receipt-${receipt.at}-${sessionId}`;
  try {
    agent.inject({
      id,
      role: "user",
      source: { kind: "user" },
      content: [{ type: "text", text: formatNotice(receipt) }]
    });
    state.pending = { id, at: receipt.at, receiptIndex: state.receipts.length - 1 };
  } catch {
  }
}
function targetPath(args) {
  if (args === null || typeof args !== "object") return void 0;
  for (const key of PATH_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return void 0;
}
function guardReason(state, execution) {
  if (state.guard !== true) return void 0;
  if (!WRITE_TOOL.test(execution.name)) return void 0;
  const path = targetPath(execution.arguments);
  if (path === void 0) return void 0;
  const normalized = path.toLowerCase();
  for (const item of state.commitments) {
    if (item.status === "lost" || item.status === "unverifiable") continue;
    if (item.blocked > 0) continue;
    if (!isProhibition(item.text)) continue;
    const anchors = item.text.match(/[A-Za-z0-9_][A-Za-z0-9_.@/-]{1,}|[\u4e00-\u9fff]{2,}/g) ?? [];
    const hit = anchors.find((a) => a.length >= 2 && normalized.includes(a.toLowerCase()));
    if (hit === void 0) continue;
    return `Blocked by compact-receipt: commit #${item.id} says "${item.text}" (turn ${item.turn}), and this call targets "${path}".
Ask the user to confirm before changing it, or have them run /contract unblock ` + item.id + " to lift this rule.";
  }
  return void 0;
}
function runCommand(state, rawInput) {
  const words = String(rawInput ?? "").trim().split(/\s+/).filter(Boolean);
  const sub = words[0] ?? "";
  if (sub === "unblock") {
    const id = Number(words[1]);
    const item = state.commitments.find((c) => c.id === id);
    if (item === void 0) return { kind: "error", text: `No commitment #${words[1]}.` };
    item.blocked = (item.blocked ?? 0) + 1;
    return { kind: "success", text: `Commitment #${id} will no longer block tool calls: ${item.text}` };
  }
  if (sub === "probe") {
    return { kind: "success", text: formatProbeReport(state.probe) };
  }
  if (sub === "guard") {
    const mode = words[1] ?? "on";
    state.guard = mode !== "off";
    return { kind: "success", text: `Guard is now ${state.guard ? "on" : "off"}.` };
  }
  return { kind: "success", text: formatContractReport(state) };
}
function apply(ctx, config = {}) {
  if (config.engine === true) {
    const PinnedEngine = createPinnedEngine(ctx, config, (sessionId) => stateOf(sessionId).commitments.filter((c) => c.status === "active" || c.status === "survived"));
    new PinnedEngine(ctx, config);
  }
  ctx.on("session/event", (session, event) => {
    if (event.type === "turn/start") {
      stateOf(session.id).turn = event.data.turn;
      return;
    }
    if (event.type === "user/message") {
      onUserMessage(stateOf(session.id), event);
      return;
    }
    if (event.type === "compaction/summary") {
      onCompaction(stateOf(session.id), session.id, event, ctx).catch(() => {
      });
    }
  });
  ctx.tools.guard((execution) => {
    const session = execution.agent?.session;
    if (session === void 0) return void 0;
    agents.set(session.id, execution.agent);
    return guardReason(stateOf(session.id), execution);
  });
  ctx.commands.register({
    definitionId: "dsh-compact-receipt:contract",
    name: "contract",
    description: "Show what the last compaction dropped, or manage the guard",
    handler: (invocation) => {
      const session = invocation.agent?.session;
      if (session === void 0) return { kind: "error", text: "No active session." };
      agents.set(session.id, invocation.agent);
      return runCommand(stateOf(session.id), invocation.rawInput);
    }
  });
}
export {
  apply,
  inject,
  name
};
