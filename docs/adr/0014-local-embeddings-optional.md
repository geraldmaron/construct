---
intake: none
intake_rationale: decision recorded directly from a downstream security report; not routed through an intake packet.
last_verified_at: 2026-06-02
verified_by: cx-architect · authored with the remediation
---

# ADR 0014: Local ONNX embeddings are an optional capability, not a core dependency

**Date:** 2026-06-02
**Status:** Accepted
**Deciders:** Construct·Architect
**Supersedes:** none

---

## Problem

Construct generates text embeddings for intake clustering and semantic search. The implementation loaded a transformers library that pulls a native ONNX runtime and, transitively, a protobuf parser. Those libraries were declared as runtime `dependencies`, so every `npm install` of the published CLI downloaded the full machine-learning stack — including, through one deprecated transformers package, a protobuf version with known high/critical advisories.

[ADR 0001](0001-zero-npm-core.md) commits the core (`lib/`, `bin/`) to Node.js built-ins plus a sanctioned two-package exception, precisely to keep the supply-chain surface small and installs reliable in constrained environments. A heavy native ML stack forced on every installer is the opposite of that commitment, and the audit burden it created is what let a vulnerable transitive chain reach consumers unnoticed.

## Context

The embedding layer already degrades gracefully: `lib/storage/embeddings-engine.mjs` routes between a local ONNX adapter, hosted-API adapters (OpenAI, Ollama), and a zero-dependency in-tree hashing embedder (`lib/storage/embeddings-legacy.mjs`). The model is lazy-loaded on first use, and any load failure falls back to the hashing embedder. Local ONNX embedding is therefore a quality enhancement over a working baseline, not a hard requirement — unlike the two ADR-0001 exceptions (`@modelcontextprotocol/sdk`, `postgres`), which provide protocol-level contracts with no built-in alternative.

## Decision

The local-embedding ML stack (`@huggingface/transformers`) is declared in `optionalDependencies`, never in runtime `dependencies`. The deprecated `@xenova/transformers` is removed entirely; the one remaining caller (`lib/embed/semantic.mjs`) uses `@huggingface/transformers`, the same library already used by the local embedding adapter.

## Rationale

A single maintained transformers library replaces two overlapping ones, removing the deprecated chain that carried the vulnerable protobuf version. Declaring it optional keeps the default install aligned with ADR 0001's "installs reliably in constrained environments" consequence: an environment that cannot or will not pull native ONNX binaries still gets a fully functional CLI via the in-tree hashing fallback. The choice to enable high-quality local embeddings becomes explicit rather than imposed.

## Rejected alternatives

- **Pin the transitive parser with `overrides`.** A published package's `overrides` apply only to the top-level project doing the install; consumers never receive them. The repo audit would pass while every downstream install stayed vulnerable — the exact failure being remediated. Rejected as ineffective for consumers and misleading as a signal.
- **Keep both transformers libraries as runtime `dependencies`, just patched.** Leaves two overlapping native stacks forced on every installer, doubling the audit surface and contradicting ADR 0001. Rejected for retaining the structural problem.
- **Remove local embeddings entirely, ship only the hashing embedder.** Loses semantic quality that intake clustering and knowledge search depend on. Rejected as a capability regression when an opt-in path preserves both goals.

## Consequences

- Default installs are lighter and cannot fail on native ONNX binary resolution.
- A consumer who wants local ONNX embeddings installs the optional dependency (npm installs optional deps by default; constrained installs opt out with `--omit=optional`) or selects a hosted adapter via `CONSTRUCT_EMBEDDING_MODEL`.
- Optional dependencies are still audited, so the consumer-perspective audit gate (`npm run audit:published`) continues to cover this stack.
- `tests/core-dependency-policy.test.mjs` enforces that the ML stack stays out of runtime `dependencies` and that `@xenova/transformers` is never reintroduced.

## Reversibility

Two-way door. Promoting the library back to a runtime `dependency` is a one-line manifest change, but would require a superseding ADR justifying the supply-chain and constrained-install cost under ADR 0001.

## References

- [ADR 0001: Zero npm dependencies in core](0001-zero-npm-core.md)
- [docs/reference/dependencies.md](../reference/dependencies.md) § Transitive vulnerability remediation
- `lib/storage/embeddings-engine.mjs`, `lib/storage/embeddings-legacy.mjs`, `lib/embed/semantic.mjs`
