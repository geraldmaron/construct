# Learning loops

Construct should get better the more you use it. This page lists every learning loop, what state it's actually in, where the data lives, and how to turn pieces off if you need to.

## What learning means here

A loop is closed when:

1. Something gets observed during a session.
2. The observation is persisted to durable storage.
3. The next session can find it.
4. The next session is measurably better because of it.

Anything less is a stub, not a loop.

## Loops in place

### Session-end auto-reflect (A1)

Every Stop event triggers `lib/hooks/session-reflect.mjs`. It reads the transcript, runs a deterministic extractor in `lib/reflect/extractor.mjs`, and writes one `session-summary` observation into `.cx/observations/` via the shared observation store.

What gets captured: number of turns, tool counts (`Bash×3, Edit×2`), files touched, session duration, first line of the final assistant reply, and a structured `meta` block with session id and cwd.

Where it lives:

- `lib/hooks/session-reflect.mjs`. The Stop hook. 500ms hard budget. Exit 0 on any error.
- `lib/reflect/extractor.mjs`. Pure function. O(n) over transcript lines. No LLM call.
- `lib/reflect.mjs`. `runReflectAuto({ transcriptPath, cwd, sessionId, durationMs })` is the entry point.
- `.cx/observations/<id>.json`. Per-observation record.
- `.cx/observations/index.json`. Lightweight listing for fast filtering.
- `.cx/observations/vectors.json`. Local embeddings (256-dim hashing-bow) when Postgres is not available.

How the loop closes: `lib/hooks/session-start.mjs` calls `searchObservations` and `listObservations` filtered by project, then injects a "Prior observations" block into the next session start. Search uses pgvector when present, BM25 plus local embeddings otherwise.

Opt out: `CONSTRUCT_REFLECT_AUTO=off`.

Skipped automatically: sessions with no tool calls and very short final text. Avoids polluting the store with one-line acknowledgements.

### Manual reflect (existing)

`construct reflect --target=internal --summary="..."` still works for explicit captures. The auto hook does not replace it. Use it when you want to record a specific insight, not just a session rollup.

## Loops not yet wired

The auto-reflect hook is the first of four learning loops on the roadmap. The plan is at `~/.claude/plans/stateful-sleeping-hellman.md`. Tracker IDs in beads.

### Research persistence (A2, construct-32d)

`commands/understand/research.md` produces FINDINGS, INFERENCES, GAPS. Today those vanish at session end. A2 wires the output into `lib/document-ingest.mjs` so each research run becomes a durable file under `.cx/knowledge/external/research/<slug>.md` with frontmatter (topic, confidence, sources, expiresAt).

### Specialist outcome capture (A3, construct-bya)

When a specialist finishes (cx-security, cx-engineer, etc.), nothing currently records whether the work matched the predicted outcome. A3 adds `.cx/outcomes/<role>.jsonl` and feeds the running success rate back into `lib/intake/classify.mjs` as a soft tiebreaker (capped at plus or minus 0.05, so it cannot invert the primary signal).

### Prompt improvement (A4, construct-06o)

The chain in `lib/evaluator-optimizer.mjs` + `lib/hooks/session-optimize.mjs` references `~/.cx/performance-reviews/` and `construct optimize <agent>` but does not actually generate patches today. A4 finishes it. Low-scoring agents get a unified diff written to disk. Nothing auto-applies. `construct optimize <agent> --apply` promotes a version, `--rollback` restores. Versions live in `agents/registry.json` under `promptHistory[]`, capped at 5 entries.

### Telemetry dashboard (construct-mov)

`npm run learning:status` will produce a one-screen table: observations per day, research files indexed, outcomes per role with success rate, prompt-version churn, active profile. The single answer to "is this thing actually learning?" Blocked on A1-A4 plus B1.

## Where to dig

- Tracker: `bd show construct-h47` and the issues listed above.
- Roadmap: `~/.claude/plans/stateful-sleeping-hellman.md`.
- Search: `node bin/construct search "session"` returns observations from the auto-reflect hook.
- Inspect: `node bin/construct memory` shows the observation store.
