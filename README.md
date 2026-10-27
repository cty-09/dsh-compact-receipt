# dsh-compact-receipt

[中文](README.zh.md) | English

> Long conversations don't forget. Nobody tells you when they started.

Context compaction in DSH is **silent and lossy**: a range of history is replaced by one summary,
and from then on that summary is all the model can see. The "don't touch tests/" you said 40 turns
ago may have vanished in a compaction — with nothing to indicate it.

This plugin hands you a **receipt** after every compaction: how much was eaten, and which of your
requirements no longer appear in the summary.

```
This session compacted 1 time, most recent:

Receipt #1 · 18:42:07 · ate 24 history items (~8.2k tokens)
  5 commitments · 4 survived · 1 possibly lost

  ⚠️ Possibly lost (not found in the summary — please confirm):
   1. [constraint] don't touch tests/ · turn 7

Lifetime survival: 80% (4/5)
```

## Not another context dashboard

Existing tools measure **how big** the context is (`dsh-context`) or make it **smaller** (`billion-context`).
This one measures a different thing: after compaction, **are the things you asked for still there?**

- Others optimize token count; this audits semantic fidelity
- Others ask you to pin a passage by hand (`dsh-highlightpin`); this is automatic and zero-config
- The audit **never calls a model**: the summary is a string, your requirements are strings, so the
  comparison is string comparison — **zero token cost**, cheap enough to run on every compaction

## Install

```sh
dsh plugin --profile web add github:cty-09/dsh-compact-receipt
```

Restart DSH. No configuration, no toggles.

## Usage

| Command | Purpose |
|---|---|
| `/contract` | Latest receipt, commitments still in force, lifetime survival rate |
| `/contract guard off` | Disable blocking (on by default) |
| `/contract unblock <id>` | Lift one rule |

## It also does two more things

**1. It tells you inside the conversation.** When a compaction drops requirements, a receipt card appears
in the chat — visible in the Web UI without remembering any command. That card also hands the dropped
requirements back to the model, so it is both an alert and the cheapest possible repair.

**2. It blocks contradicting writes.** Once "don't touch X" is recorded, a write-family tool call targeting
`X` is denied, with a message telling the agent to confirm with you first, or you to run
`/contract unblock <id>`. Only file-writing tools are covered, and matching is path-string based:
missing a block is preferable to a false block.

## What counts as a requirement

Three kinds, matched by rules (Chinese and English):

| Kind | Examples |
|---|---|
| constraint | don't touch X, must use Y, 不要改 X, 必须用 Y |
| decision | we'll use X, 决定采用 Y |
| acceptance | acceptance: tests must pass, 验收标准是 X |

Extraction is deterministic: same input, same output. No cost, no network, reproducible.

## Honest limits

This plugin does not pretend to be smarter than it is:

1. **"Possibly lost" means possibly.** A summary that keeps the meaning but rewords it can trigger a
   false alarm. The threshold deliberately prefers false alarms over silence.
2. **Only the compacted range is audited.** Requirements still in context are not audited, because
   they were never dropped.
3. **Rule extraction misses things.** It recognizes common imperative phrasing and nothing else. It
   does not guess.
4. **It does not prevent compaction and cannot restore the original text.** It makes the loss visible and
   puts the dropped requirements back in front of the model.
5. **Blocking is path-string matching.** Only file-writing tool arguments are inspected; a different spelling
   of the same path (symlink, relative form) can slip through.
6. **The card costs tokens.** It only appears when something was actually lost — typically 4-6 lines, far
   less than the loss it prevents.

## How it works

DSH writes a `compaction/summary` event carrying the summary text and the seqs of shadowed history.
The plugin subscribes to the session event stream, extracts commitments from user messages as they
arrive, and on compaction scores each one against the summary text: exact match for Latin
identifiers, character-bigram overlap for Chinese, averaged. No model calls, no network, no extra tokens.

## Development

```sh
npm test    # 20 cases, including an end-to-end simulation
```

Zero dependencies, zero build step: the ESM in `lib/` is the published artifact.

> Why no imports at all: `@deepseek-ai/*` runtime packages exist only inside the DSH install,
> not in a profile, and DSH registers no ESM resolve hook. Any third-party plugin that imports them
> fails with `ERR_MODULE_NOT_FOUND` on a user's machine. This plugin therefore uses `ctx` only.

## License

MIT
