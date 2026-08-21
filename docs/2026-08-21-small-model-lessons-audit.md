# 2026 small-model lessons: audit against the envelope

Three community-validated lessons, sourced from a multi-model MCP agentic
evaluation dated 2026-08-15: (1) inject the spine's schemas into the prompt
envelope explicitly rather than trusting host/SDK tool plumbing; (2) record a
dense-over-MoE preference note per family where measured; (3) harness checks
verify side effects, never tool-call traces. This audit reads the producer
envelope and repair-retry modules under `src/kernel`, the host prompt-builders
under `src/hosts`, and the probe/harness scripts under `scripts/`, and states
per lesson whether the codebase already carries it.

## Lesson 1 — schemas injected into the prompt envelope explicitly

**Already present.** Every seam that asks a model for structured output writes
the exact reply shape into the prompt text itself, not into a request-level
schema or tool-call parameter:

- `src/hosts/namer.ts:63` and `src/hosts/densifier.ts:49` — `'Reply with JSON
  only — no prose, no markdown fences, no <think> blocks,'` followed by the
  literal object shape.
- `src/hosts/compose.ts` — six separate call sites (`shapeChoicePrompt` and
  five deliverable/review prompts) end with `'Reply with JSON only, no prose
  outside it:'` plus the literal `{...}` shape the caller expects back.
- `src/hosts/contextloop.ts` (`producerPrompt`, `challengerPrompt`,
  `reviewerPrompt`, `applierPrompt`) — same pattern; `producerPrompt` spells
  out every field of every one of its four output lists in prose immediately
  before the literal JSON skeleton.

This is not incidental — it is a stated finding. `src/hosts/opencode/pin.ts`,
under the probed expectation `run-carries-no-response-format`, records that
neither `opencode run --help` nor the packaged provider config exposes a
response-format, json-schema, or structured-output flag reachable from `run`,
and that the OpenAI-compatible chat provider's `response_format` field is
never populated because nothing on the `run` command surface sets it. The
comment names the consequence directly: *"namer.ts and densifier.ts ask a
model for JSON in the prompt text alone, with no request-level JSON mode or
schema ever reaching the provider."* `jsonrepair.ts`'s corrective retry
(`invokeWithRepair`, exercised by `scripts/probe-model-contract.mjs`) is the
fallback for exactly the case host-level schema enforcement would otherwise
cover. Nothing in `src/kernel` or `src/hosts` relies on a `tools`/`tool_choice`
/`response_format`/`json_schema` call parameter anywhere (`grep` across `src/`
for those tokens returns no host adapter hits).

## Lesson 2 — dense-over-MoE preference note per family, where measured

**Missing — adopted.** `src/hosts/tuning.ts` records tuned-vs-best-effort
status per family and `src/hosts/floors.ts` records throughput floors, but
neither module (nor anywhere else in `src/` or `docs/`) carried an
architecture-labeled preference, despite the evidence already sitting in
`fixtures/org-harness/runs/`:

- `fixtures/org-harness/runs/2026-08-05-gpt-oss-20b.score.json` —
  `ollama/gpt-oss:20b` (mixture-of-experts, OpenAI open-weight release) on the
  composed dispatch-shape depth harness: rung0 (citation gate) clean, rungs
  1–3 (plant recall, cross-reference, conflict/proposal/delta) **fail**.
  `pass: false` overall.
- `fixtures/org-harness/runs/2026-08-06-nemotron3-super-free-composed.score.json`
  — `nvidia/nemotron-3-super-120b-a12b:free` (mixture-of-experts; the `a12b`
  suffix is NVIDIA's own active-parameter notation) on the same harness shape:
  same pattern, rung0 clean, rungs 1–3 **fail**. Recorded in prose at
  `docs/model-family-promotion.md` under "Record so far (2026-08-06)".

Two independently-sourced MoE families, same failure shape, on the project's
own composed-dispatch-shape harness — the JSON contract holds, the depth does
not. No dense open-weight family has cleared the harness either
(`qwen3.6:35b` also fails rungs 1–2 per the same doc), so this is not
evidence that a dense model of comparable size would pass; it is a caution
that generalizes only as far as it was measured: MoE-labeled families in this
project's local/open-weight tier have not cleared depth, and a caller
choosing between untuned candidates should weigh that.

Adopted as `src/hosts/architecture.ts` (`ARCHITECTURE_NOTES`,
`architectureNoteFor`), mirroring `floors.ts`'s pattern exactly — dated,
per-model, named evidence path, silent (not "unknown") for anything
unmeasured. Wired into the same dispatch-time warning block as
`dispatchFloorFor` in `src/cli/index.ts` (`construct work`), so the note
surfaces before the dispatch spends a call, not after. Test:
`tests/hosts/architecture.test.ts`.

## Lesson 3 — harness checks verify side effects, never tool-call traces

**Already present.** The pass/fail path for a role's deliverable runs entirely
against the deliverable's own content, never against the mechanism that
produced it:

- `src/kernel/run/coordinator.ts`'s `draftText()` extracts the literal
  deliverable text (unwrapping one JSON envelope at most) and is the only
  input the structural challenges (`src/kernel/challenge/catalog.ts`) ever
  see. The function's own comment records the failure mode this guards
  against: a role called `submit_draft` with an object whose keys were the
  challenge ids from its own assignment, coercion produced the literal string
  `"[object Object]"`, and the citation check *passed* it — "a verdict about a
  coerced object is the worst thing this layer can produce: it reports
  success about nothing." `summarize()` in the same file records `toolCalls`
  and `failedToolCalls` counts, but only as work-log metadata alongside
  `chars`/`usage` — never as an input to a pass/fail decision.
- `scripts/score-org-harness.mjs` scores the run's `claims` (cross-reference,
  conflict, risk) and `notesDrop` (proposals, deltas) against a pre-committed
  answer key by content — document citations and claim text — not by what
  tools were invoked to produce them. Its own header states the scoring is
  "structural: keyword sets and document pairs, not judgment," over the
  deliverable's content.
- `scripts/smoke-packaged-install.sh` asserts on CLI stdout content
  (`expect_contains`) and on the sqlite store actually existing and being
  reachable after real commands run — a side effect (the database file, the
  printed run id) — not on any tool-call trace.

The one place `toolCalls` participates in a pass/fail judgment is
`scripts/probe-opencode-conformance.mjs`, which is a different kind of check:
it verifies the *host adapter's* transport claim (that OpenCode's tool-calling
plumbing itself works, per the pin's probed expectations), not whether a role
finished its task. That is conformance testing of the host seam, not a
harness scoring agent work — it does not conflict with the lesson.

## Summary

| Lesson | Verdict | Where |
|---|---|---|
| 1. Explicit schema injection | Already present | `src/hosts/namer.ts`, `densifier.ts`, `compose.ts`, `contextloop.ts`; documented absence of host-level schema support in `src/hosts/opencode/pin.ts` |
| 2. Dense-over-MoE preference note | Missing, adopted | `src/hosts/architecture.ts` (new), wired into `src/cli/index.ts`, tested in `tests/hosts/architecture.test.ts` |
| 3. Side effects, not tool-call traces | Already present | `src/kernel/run/coordinator.ts` (`draftText`/`summarize`), `src/kernel/challenge/catalog.ts`, `scripts/score-org-harness.mjs`, `scripts/smoke-packaged-install.sh` |
