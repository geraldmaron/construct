<!--
examples/seed-observations/decisions.md — key architectural decisions for Construct memory seed corpus.

Each entry becomes one observation in the store with category "decision". Imported via
`construct bootstrap`.
-->

# Architectural Decisions

## Zero npm Dependencies in Core

`lib/` and `bin/` use only Node.js built-ins. This eliminates supply-chain risk, reduces install size, and ensures Construct works immediately after `git clone` without `npm install`. Services under `services/` may use dependencies with an ADR. In-tree implementations are promoted to libraries when 3+ defects appear in 6 months.

## Two-Phase Sync with Lockfile

`construct sync` writes to `.cx/sync-staging/` first, then atomically renames into place. A lockfile at `.cx/sync.lock` prevents concurrent runs from corrupting the output. This makes partial syncs impossible — either the full sync lands or nothing does.

## Hook Ceiling: 30

The hook budget is enforced at 30 files, not the original ≤20. Adding a hook requires retiring one or explicit approval. All hooks carry `@p95ms` and `@maxBlockingScope` SLA annotations so performance regressions are caught at code-review time.

## In-Tree BM25 + Cosine Hybrid

The memory layer uses a hashing bag-of-words cosine similarity for dense recall combined with BM25 for keyword precision. Both are implemented in pure JavaScript with no external dependencies. Known limitation: cosine embeddings have no semantic understanding; BM25 IDF is recomputed per query (O(n)). The hybrid outperforms either alone for the query patterns Construct sees (short, keyword-heavy).

## Tiered Session-Start Injection

Session-start injects context in three tiers: Tier 1 (always — header, branch, status), Tier 2 (when fresh and meaningful — workflow, observations, context.md), Tier 3 (hint-only — efficiency snapshot, skill scope). This caps injection size and avoids loading the model with stale or irrelevant context on every session.

## Declarative Policy Rules

Hook guards for workflow, drive, bootstrap, and task behavior are expressed as YAML rule files under `rules/policy/` and evaluated by a single `policy-engine.mjs` hook. Declarative rules are easier to audit and modify than scattered imperative checks across multiple hook files.

## Registry as Single Source of Truth

`agents/registry.json` is the canonical definition for all agents on all platforms (Claude Code, OpenCode, Codex, Copilot). `construct sync` regenerates all platform-specific files from the registry. Never edit generated files directly — edits are overwritten on the next sync.
