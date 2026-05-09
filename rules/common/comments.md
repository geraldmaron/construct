<!--
rules/common/comments.md — Construct comment convention for JS/TS/MJS source files.

Defines the two allowed comment forms (file header, section context block) and
what is never allowed (inline narration, trailing comments, mid-function notes).
Enforced by lib/hooks/comment-lint.mjs and tests/hooks-budget.test.mjs.
-->
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

- **Inline trailing comments** — `const x = 1; // increment` — delete them
- **Mid-function narration** — a comment in the middle of a function body that describes what the next line does — delete it; rename the variable or extract a function instead
- **Between-group labels** — `// Language patterns`, `// Dashboard`, `// Step 1:` — delete them
- **Narrative voice** — `// We weight BM25`, `// Now test the keys`, `// This correctly scores` — delete them
- **Point-in-time notes** — `// X removed`, `// previously`, `// no longer` — belongs in git log
- **Noise sentinels** — `// ok`, `// best effort`, `// skip` — delete them; use `/* non-critical */` inline only when the catch clause would otherwise look like a bug

## SLA annotations (hooks only)

`@p95ms` and `@maxBlockingScope` are required on every hook file header. They are metadata, not narration, and are exempt from the above rules.

```js
// @p95ms 40  @maxBlockingScope PreToolUse
```

## Rule of thumb

Delete the comment. If the section becomes harder to understand, the comment earns its place — as a block before it, with a blank line after. If it reads just as clearly without, it stays deleted.

