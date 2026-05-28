# AgenticHQ — Agent Runtime Platform

> **Test fixture.** Fictional content for validating Construct end-to-end. All customer names, metrics, incidents, and quotes are invented. Nothing here is from a real AgenticHQ company — this project exists to exercise Construct's intake, dispatch, contracts, artifact generation, and audit surfaces against a representative R&D codebase.


## What AgenticHQ ships

A multi-tenant agent runtime platform: customers point our SDK at their LLM provider, define agent specs in YAML, and we host the orchestration, tool-calling loop, memory layer, and evaluation harness. Solo developer tier is free; team and enterprise tiers add shared memory, custom tools, and audit log export.

## Layout

- `src/runtime/` — orchestration loop, tool dispatch, retry policy
- `src/memory/` — vector store, observation pruning, cross-tenant isolation
- `src/tools/` — built-in tools (web search, file IO, code exec)
- `src/eval/` — evaluation harness, regression fixtures, replay

## Active workstreams (read these first)

- [PRD-0001: Multi-turn tool-calling with intermediate scratchpad](./docs/prd/0001-tool-calling-scratchpad.md)
- [PRD-0002: Cross-tenant memory isolation](./docs/prd/0002-memory-isolation.md)
- [RFC-0001: Agent execution timeout policy](./docs/rfc/0001-execution-timeout.md)

## Past decisions

- [ADR-0001: OpenAI tool-calling format as canonical](./docs/adr/0001-openai-tool-format.md)
- [ADR-0002: Cohere embed-v3 over OpenAI for memory](./docs/adr/0002-embedding-model.md)

## Research

- [Q1 2026 agent failure modes](./docs/research/q1-failure-modes.md)

## Inbox

Signals (customer emails, postmortems, exec asks, security findings, eval results) land in `.cx/inbox/`. Construct classifies them and routes to the right specialist chain.
