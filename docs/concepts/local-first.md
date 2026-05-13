---
title: Local-first
description: Construct works offline. Cloud services are accelerators, not requirements.
---

Construct is a local-first developer tool. Every cloud service it integrates with is an *accelerator*, not a requirement. If everything cloud-shaped disappeared tomorrow — Anthropic API, Langfuse SaaS, Atlassian, Slack, your forge — Construct would still operate from `.cx/`, beads, git, your file system, and a local LLM (Ollama or similar).

This is a design choice, not an accident. The product model is "developer tool that runs on your machine," not "enterprise SaaS." The architecture follows.

## What runs locally

| Capability | Local default | Cloud option |
|---|---|---|
| LLM inference | Ollama, llama.cpp, any OpenAI-compatible local server | Anthropic, OpenRouter, OpenAI |
| Embedding model | `@huggingface/transformers` running ONNX in-process | OpenAI embeddings |
| Vector retrieval | Postgres + pgvector (via Docker), or fallback to `.cx/observations/` JSON index | Hosted pgvector |
| Trace observability | Langfuse via local Docker | Langfuse Cloud |
| Issue tracking | `bd` (beads), Dolt-backed | GitHub Issues, Jira |
| Dashboard | localhost HTTP server (`construct serve`) | (none — local only) |
| MCP servers | local processes (memory, sequential-thinking, playwright) | remote MCP servers per provider |
| Knowledge ingest | files in your repo + `~/Downloads` | provider-fetched content |
| Session state | `.cx/context.md`, `.cx/handoffs/`, beads | (none — local only) |

## Degraded-mode guarantees

When a cloud or local-but-optional service is unreachable, Construct degrades gracefully and *tells you*.

- **No Docker:** managed Postgres + Langfuse are skipped; vector retrieval falls back to the JSON index. `construct setup` and `construct doctor` report which capabilities are degraded.
- **No `cm` (memory CLI):** the memory MCP server doesn't start; observations still write to `.cx/observations/` and are semantically retrievable from there.
- **No `OPENAI_API_KEY`:** if `CONSTRUCT_EMBEDDING_MODEL=openai`, hard error with the env var and the alternative; opt into automatic fallback with `CONSTRUCT_EMBEDDING_FALLBACK=1`.
- **No internet:** Construct refuses to fetch external resources. `construct evals retrieval` runs against the local fixture and works fine offline.

The principle: a degraded mode that silently masks the degradation is worse than a degraded mode that announces itself.

## Why this matters

Three concrete cases:

1. **Plane wifi.** You can still architect, plan, write code, run tests, and have a coherent agent conversation. The vector index has whatever you embedded locally; the LLM is whatever local model you wired up.
2. **A vendor goes down.** Anthropic has an outage. You don't lose the ability to ship — you fall back to a local model, or to OpenAI via the configured tier, or to a literally any OpenAI-compatible endpoint.
3. **You're working in a project with restricted egress.** Construct doesn't need outbound network for its core loop. The hooks that talk to GitHub for status checks are isolated and clearly named; you can disable them without breaking the orchestration.

## What requires the cloud

A few things genuinely don't work locally. Construct doesn't pretend otherwise:

- **Hosted Langfuse traces** — Langfuse local works, but if you want hosted long-term retention, that's the cloud product.
- **Provider integrations to remote systems** — Slack messages, Jira issues, Salesforce records. The providers themselves are local code; the systems they talk to are remote by definition.
- **GitHub Actions** — the CI safety-net layer requires GitHub (or equivalent CI). Construct's local Layer 2 gates are designed to catch what CI would catch, but the *required-status-checks* layer is GitHub branch protection.

These are *integrations*, not *core dependencies*. The orchestration loop — persona, specialists, contracts, gates, durable state — runs without any of them.

## How to verify

```bash
construct doctor
```

Reports degraded vs healthy across every cloud/local boundary. Anything red is a real problem; anything yellow is a degraded-but-working state with a one-line explanation.

```bash
CONSTRUCT_EMBEDDING_MODEL=hashing construct evals retrieval
```

Runs the retrieval eval with the deterministic, dependency-free embedding. Should report `Recall@1: 100.0%` against the local fixture. If this passes, you have a working retrieval system that doesn't require any external network call.

## Where to push back on the design

If you find yourself thinking "Construct should just call the cloud here," ask first whether the cloud call is an accelerator (fine — make it optional) or a requirement (a problem — the design is supposed to keep going without it). When in doubt, the answer that preserves local-first wins.
