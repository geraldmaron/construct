---
intake: none
intake_rationale: capability decision recorded while wiring orchestration.chainOfThought from an inert config field to a working feature. Primary evidence is repository code (file:line cites below) and provider/standards primary-source docs reviewed 2026-06-08.
last_verified_at: 2026-06-08
verified_by: construct · implementation + tests on branch feat/e2e-owner-validation (lib/orchestration/worker.mjs, lib/orchestration/runtime.mjs, tests/orchestration-chain-of-thought.test.mjs)
---

# ADR 0030: Chain-of-thought disclosure for provider-executed specialists

- **Date**: 2026-06-08
- **Status**: accepted
- **Deciders**: construct maintainers
- **Supersedes**: none

## Problem

When the orchestration runtime executes a specialist task through the provider worker backend (ADR-0021), the model can produce reasoning — Anthropic extended-thinking blocks, OpenRouter reasoning — in addition to its answer. The runtime discarded it: `worker.mjs` extracted only `type === 'text'` content blocks and dropped everything else. A `orchestration.chainOfThought` config key existed in the schema with three modes, but no code read it and no surface rendered reasoning. That is dead surface: a documented setting that does nothing, which both misleads users and, if described as functional, violates the no-fabrication rule. Either the reasoning is a capability or the field should not ship.

## Context

Reasoning content is sensitive and large, and not every deployment wants it in the chat stream — some want it only for debugging, most want it off. The orchestration runtime already has the right seams: a per-task record persisted through a pluggable store, a lifecycle trace (`worker.completed`), and several display surfaces (CLI `orchestrate run`/`status`, the `orchestration_run` MCP tool, the daemon SSE stream). Worker-backend and store selection already follow a `resolve*({ explicit, run, config })` precedence pattern (`runtime.mjs`). The inline backend never calls a model, so it has no reasoning to disclose.

## Decision

`orchestration.chainOfThought` is a real, config-driven disclosure control with three modes, gated at capture time in the runtime and reflected by every display surface:

- **`hidden`** (default) — the worker requests no reasoning (no Anthropic `thinking` param, no OpenRouter `reasoning`) and captures none.
- **`surface`** — the worker requests reasoning and the runtime attaches it to `task.reasoning`, so the CLI, the `orchestration_run` MCP tool, the daemon SSE snapshot, and `hostAdapterMetadata` all render it.
- **`telemetry_only`** — the worker requests reasoning and the runtime writes it to the `worker.completed` trace metadata, but never attaches it to a task, so no display surface shows it.

Capture lives in `lib/orchestration/worker.mjs`; mode resolution and routing in `lib/orchestration/runtime.mjs` (`resolveChainOfThought`). Display surfaces stay mode-agnostic — they render `task.reasoning` when present, which only `surface` populates.

## Rationale

The design follows how the provider and observability ecosystems actually divide this problem (reviewed 2026-06-08):

- Providers separate **effort** (how much to think) from **disclosure** (what is returned). On the disclosure axis the de-facto levels are: excluded → encrypted-carry → summary → raw. Anthropic returns reasoning as `thinking` / `redacted_thinking` content blocks. The request shape is model-specific: current models (Opus 4.6/4.7/4.8, Sonnet 4.6) require **adaptive thinking** (`thinking: {type:"adaptive", display:"summarized"}`) — the legacy `{type:"enabled", budget_tokens}` form returns a 400 on Opus 4.8/4.7 — while older models (Sonnet 4.5 and earlier) still take the budget form (`budget_tokens < max_tokens`). `display:"summarized"` is required on adaptive models or the thinking block comes back empty. OpenRouter normalizes reasoning into a plaintext `reasoning` string plus a structured `reasoning_details[]` array, enabled with `reasoning: {enabled:true}` (an empty `{}` is a no-op) and suppressed with `reasoning: {exclude:true}`. OpenAI never returns raw reasoning — only a summary. `surface` therefore renders the highest-fidelity reasoning a provider safely returns rather than promising raw chain-of-thought.
- **`telemetry_only`** maps to the observability pattern, not a provider feature: OpenTelemetry's GenAI conventions record reasoning as opt-in span/event content (off by default for size and privacy) alongside `gen_ai.usage.reasoning.output_tokens`; LangSmith/Langfuse capture reasoning as a trace observation, never as an end-user display. Writing reasoning to the run trace and nowhere else matches that posture.
- Defaulting to **`hidden`** matches where providers trend (OpenAI never surfaces raw; Anthropic's newest models default to omitted/summarized; OTel content capture is off by default).

Gating at capture time keeps every display surface a pure reflection of `task.reasoning`, so adding a new surface needs no mode logic.

## Rejected alternatives

- **Two orthogonal fields (`reasoning.disclosure` + `reasoning.trace`).** This mirrors the provider/observability split most precisely and would allow "surface AND trace" simultaneously. Rejected for this iteration because the single enum already shipped in the schema and `DEFAULT_PROJECT_CONFIG`, the three modes cover the real use cases, and the simpler surface is easier to document and validate. The split remains a clean future migration if "surface and record" is demanded.
- **Drop the field entirely and re-add when consumed.** Honest, but it discards a deliberate config surface and the obvious user value (debuggable, optionally visible specialist reasoning) when the seams to implement it already exist.
- **Always capture reasoning and let surfaces decide.** Rejected: requesting reasoning has token cost and latency, and capturing sensitive content the operator did not ask for is the wrong default. `hidden` must request nothing.

## Consequences

- The provider worker returns `{ output, reasoning, ... }`; `surface`/`telemetry_only` add a reasoning budget to Anthropic calls (higher `max_tokens`) and request reasoning from OpenRouter — real token cost the operator opts into.
- Display surfaces gain a `reasoning` field on tasks (`null` unless `surface`); the run records its `chainOfThought` mode.
- The inline backend is unchanged and never discloses reasoning. ACP (inline-only) shows none by design.
- Multi-turn round-tripping of Anthropic `redacted_thinking` / encrypted signatures is out of scope: specialist tasks are single-shot, so encrypted carriers are not displayed or persisted.

## Reversibility

Two-way door. The capture is additive and the default (`hidden`) reproduces the prior behavior exactly, so reverting is setting the mode back (or removing the worker/runtime hooks) without data migration. Revisit if a deployment needs simultaneous display-and-trace, per-role disclosure, or summary-vs-raw control — at which point the two-field design in Rejected alternatives is the migration target.

## References

- Anthropic — Building with extended thinking (`thinking` object, `budget_tokens`, `thinking`/`redacted_thinking` blocks, `display`): https://platform.claude.com/docs/en/build-with-claude/extended-thinking (accessed 2026-06-08)
- OpenRouter — Reasoning Tokens (`reasoning` request object, `exclude`, `reasoning`/`reasoning_details` response): https://openrouter.ai/docs/guides/best-practices/reasoning-tokens (accessed 2026-06-08)
- OpenAI — Reasoning models (`reasoning.effort`, `reasoning.summary`; raw CoT not exposed): https://developers.openai.com/api/docs/guides/reasoning (accessed 2026-06-08)
- OpenTelemetry — GenAI semantic conventions (`gen_ai.usage.reasoning.output_tokens`; content capture opt-in/off by default): https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/ (accessed 2026-06-08)
- ADR-0021 (provider worker backend), ADR-0022 (orchestration daemon API)
- Implementation: `lib/orchestration/worker.mjs`, `lib/orchestration/runtime.mjs`, `lib/mcp/tools/orchestration-run.mjs`, `lib/server/index.mjs`, `bin/construct`; tests `tests/orchestration-chain-of-thought.test.mjs`
