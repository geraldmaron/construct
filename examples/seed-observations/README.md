<!--
examples/seed-observations/README.md — seed corpus for Construct's in-tree memory layer.

Run `construct bootstrap` to import these files into the local observation and entity stores.
The seed corpus gives the hybrid BM25 + cosine retrieval a meaningful starting signal
before any real session data accumulates. Without it, retrieval is near-random for the first
~20 sessions. Expect meaningful recall lift within 3–5 sessions after import.
-->

# Seed Observations

This corpus seeds the Construct memory layer with high-value starting knowledge.

## Files

| File | Content |
|---|---|
| `patterns.md` | Proven engineering patterns observed across Construct sessions |
| `anti-patterns.md` | Recurring mistakes and their corrections |
| `decisions.md` | Key architectural decisions and their rationale |

## Import

```bash
construct bootstrap
```

Imports all three files into the local observation store. Safe to re-run — duplicate
observations are deduplicated by content hash.

## Payoff Timeline

- **0 sessions** — retrieval is cold; seed corpus provides baseline recall
- **5 sessions** — personal patterns start surfacing; seed corpus still dominant
- **20 sessions** — personal patterns dominate; seed corpus recedes to backstop
- **50+ sessions** — retrieval is fully personalized; seed corpus rarely surfaces

Run `construct memory stats` to see whether memory is paying off.
