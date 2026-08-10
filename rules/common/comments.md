---
description: Construct comment convention for JS/TS/MJS source files.
enforced_by: lib/comment-lint.mjs
precedence_tier: style
---
# Comment Convention

Two forms are allowed. Everything else is deleted.

## File header

One `/** */` block at the top of every file. Describes module purpose, key behaviors, and non-obvious constraints. Written once; updated only when the module's contract changes.

```js
/**
 * lib/observation-store.mjs — hybrid BM25 + cosine ranking over in-tree vector index.
 *
 * Writes are append-only. Reads fan out to both stores and merge by max score.
 * IDF is recomputed per query — acceptable at current corpus size.
 */
```

## Section context block

A comment block immediately before a logical section, followed by a blank line, then the code. Used only when the section's purpose is not obvious from the function or variable names alone.

```js
// BM25 is unbounded; normalize against its own max so it merges fairly with cosine [0,1].

const bm25Max = bm25Scored[0]?.score || 1;
for (const item of bm25Scored) { ... }
```

The blank line between the comment and the code is required. It signals "this comment describes the block below", not "this comment describes the line above".

## What is never allowed

- **Inline trailing comments** (`const x = 1; // increment`) delete them
- **Mid-function narration** (a comment in the middle of a function body that describes what the next line does) delete it; rename the variable or extract a function instead
- **Between-group labels** (`// Language patterns`, `// Dashboard`, `// Step 1:`) delete them
- **Narrative voice** (`// We weight BM25`, `// Now test the keys`, `// This correctly scores`) delete them
- **Point-in-time notes** (`// X removed`, `// previously`, `// no longer`) belongs in git log
- **Dated decisions and observations** (`// decided 2026-05-14`, `// verified live 2026-07-17`, `// as of 2026-06-22`) delete them; a comment states what is true, not when someone last checked
- **Tracker ids** (`// construct-9oi4.15.3`, `// LMCP-A6`, `// ORCH-004`, `// closes #412`) delete them; the constraint belongs in the comment, the provenance in the commit message
- **Decision-document ids** (`// ADR-0027 §2`, `// RFC-0004`, `// PRD-0001`) delete them; state the rule the code follows, not the record that set it
- **Project document citations** (`// see docs/guides/concepts/hooks.md`) delete them; restate the constraint inline. The document moves and the comment does not, so the pointer rots while the reader still trusts it
- **Noise sentinels** (`// ok`, `// best effort`, `// skip`) delete them; use `/* non-critical */` inline only when the catch clause would otherwise look like a bug
- **Other-project comparisons** (`// per the LangGraph thread-vs-store split`) delete them; describe the behavior on its own terms. A prior-art comparison belongs in a decision document (`docs/decisions/**`, `docs/notes/**`) where it can carry a citation

## Who the reference rules bind

A person writing in their own codebase may cite whatever they like — their tracker, their ADRs, their internal shorthand. Construct never does. Everything Construct writes into a source file has to stand on its own for a reader who has no access to the tracker, has never opened the decision record, and is reading the file years later.

The test is re-verifiability from the source alone. `(ADR-0027 §2)` tells the reader a rule exists somewhere; `Construct mutates user-owned files only through replaceManagedBlock` tells them the rule. Write the second one.

External standards are not project documents and stay: `RFC 5545`, `RFC 9562`, `SEP-414`, `UTF-8`. Project records are zero-padded four-digit ids (`ADR-0027`, `RFC-0004`, `PRD-0001`), matching their file names under `docs/decisions/` and `docs/specs/`, and are covered by the ban. A three-digit id inside a format example (`ADR-005` in a roadmap-parser sample) is sample data, not a citation, and is left alone.

## Machine-read annotations

`@enforces <decision-id>` is metadata, not prose — `lib/decisions/registry.mjs` parses it to bind a test to the decision it guards, and a dangling marker fails `construct doctor`. It is exempt from the reference rules when it is the entire content of the comment line.

```js
// @enforces ADR-0015
```

A decision id anywhere else on the line is prose and is banned.

## SLA annotations (hooks only)

`@p95ms` and `@maxBlockingScope` are required on every hook file header. They are metadata, not narration, and are exempt from the above rules.

```js
// @p95ms 40  @maxBlockingScope PreToolUse
```

## Rule of thumb

Delete the comment. If the section becomes harder to understand, the comment earns its place: as a block before it, with a blank line after. If it reads just as clearly without, it stays deleted.

