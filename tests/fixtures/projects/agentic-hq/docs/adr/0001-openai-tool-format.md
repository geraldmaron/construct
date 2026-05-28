---
title: OpenAI tool-calling format as canonical
status: accepted
date: 2026-01-22
deciders: cx-architect, cx-engineer
---

# ADR-0001: OpenAI tool-calling format as canonical

## Context

Three tool-calling formats in the LLM ecosystem at time of decision:
1. OpenAI native (`tools: [{type: 'function', function: {...}}]`)
2. Anthropic native (`tools: [{name, description, input_schema}]`)
3. Custom DSL ("function-format") used by some open-source frameworks

Our SDK accepts agent specs in YAML and must dispatch to multiple providers.

## Decision

Internal canonical format mirrors OpenAI's tool-calling shape. Adapters translate to Anthropic + others.

## Rejected alternatives

- **Anthropic native as canonical.** Equivalent semantics, but OpenAI has more historical mindshare among our early adopters (per cx-business-strategist memo, March 2026). Migration cost for users is higher if we go Anthropic.
- **Provider-neutral DSL.** Cleaner conceptually but adds a translation layer at every call site and forces us to track ecosystem changes manually. Rejected as net-cost-negative.

## Consequences

- New providers must have an OpenAI-format adapter or fall back to a normalizer.
- We can pass OpenAI tools schemas through with zero transformation, reducing latency on the hottest path.
- Anthropic's caching benefits require an explicit cache-key derivation in our adapter; we accept the complexity.

## What we do not know

- Whether a future tool-calling format will dominate (`unknown`). Mitigated by the adapter layer.

## Source

- Provider docs at decision time (OpenAI Chat Completions + Anthropic Messages API)
- cx-business-strategist memo `bd-strategy-23` (March 2026)
