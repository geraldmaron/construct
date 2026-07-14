# ADR-0079: Align Construct's handoff / terminal-status vocabulary to the MCP-Tasks / A2A shared lifecycle

- **Date**: 2026-07-14
- **Status**: proposed
- **Deciders**: Gerald Dagher
- **Supersedes**: none

## Problem

Construct has an honest, hard-won terminal-status taxonomy for orchestration runs — `deriveHonestRunStatus` (`lib/orchestration/runtime.mjs`) distinguishes `completed`, `completed-prepare-only`, `awaiting-host`, and `degraded`, and `construct-72gqn.9`/`.16` (H9.2 typed output schemas, H9.3 terminal-contract tripwire) enforce that a run never reports a clean `completed` when nothing usable ran. But this vocabulary is Construct-internal and ad hoc: it maps to no external standard, so a host or a peer agent integrating with Construct must learn a bespoke set of states, and Construct cannot interoperate cleanly with the two async-agent protocols that have now standardized this exact concept.

## Context

The R1 external-framework survey (`docs/notes/research/2026-07-org-capability-audit/synthesis/fit-matrix.md` §5) found that the async task lifecycle has standardized under the Linux Foundation, and that two independent protocols landed the **identical** shape:

- **MCP Tasks** (SEP-1686, Final; spec `2025-11-25`, RC `2026-07-28`) — `submitted → working → input_required → {completed, failed, cancelled}`, with client-generated idempotent task IDs and a correlation key threading every related message, plus `keepAlive`.
- **A2A** (Agent2Agent, `1.0.0`, Linux-Foundation / Google-contributed) — the same lifecycle (`submitted → working → input_required → {completed, failed, cancelled}`), with `contextId` / `referenceTaskIds` correlation and `input_required` / `auth_required` pause states.

Two independently-governed standards converging on one lifecycle is strong evidence it is the right vocabulary. Critically, this alignment *validates* Construct's existing honest-status work rather than discarding it: Construct's states are a strict refinement of the standard, not a conflict. The gap is only that they are not *expressed* in the shared terms.

## Decision

Adopt the MCP-Tasks / A2A lifecycle as Construct's **canonical external status vocabulary** — the states a host, client, or peer agent observes — and express Construct's richer internal distinctions as qualifiers on that lifecycle rather than as parallel top-level states:

| Construct internal state | Canonical lifecycle state | Qualifier |
|---|---|---|
| `planned` / queued | `submitted` | — |
| `running` | `working` | — |
| `awaiting-host`, awaiting-approval | `input_required` | `reason: host-execution` / `approval` |
| `completed` | `completed` | — |
| `completed-prepare-only` | `completed` | `qualifier: prepare-only` (no output executed) |
| `degraded` | `completed` | `qualifier: degraded` + `degradationReason` |
| `error` | `failed` | `code` |
| cancelled (persisted-cancel, `construct-72gqn.22`) | `cancelled` | — |

The run record keeps `deriveHonestRunStatus`'s internal states intact; the MCP tool responses and any future A2A surface project them onto the canonical lifecycle. Correlation adopts the standard's shape: `runId` is the idempotent task id, `traceId` is the correlation key threading related events (both already on every run record).

## Rationale

Aligning to one lifecycle keeps Construct interoperable with **both** ecosystems at once — a host speaking MCP Tasks and a peer speaking A2A see the same states — for the cost of a projection layer, not a rewrite. The refinement-not-conflict relationship means no honesty is lost: `prepare-only` and `degraded` survive as qualifiers, so a caller that cares still sees "completed but nothing executed," while a caller that only speaks the standard sees a conformant `completed`/`input_required`/`failed`. This is the lowest-risk way to make the H9 terminal-status work externally legible.

## Rejected alternatives

- **Keep the bespoke vocabulary.** Rejected: it forecloses clean MCP-Tasks/A2A interop and forces every integrator to learn Construct-specific states for a concept the field has standardized.
- **Collapse to the standard's five states only (drop `prepare-only`/`degraded`).** Rejected: that would discard the honest distinctions H9 was built to make — a `completed` that hides "nothing executed" is exactly the failure `construct-72gqn.9`/`.16` fixed. Qualifiers preserve them.
- **Adopt A2A as the internal model wholesale.** Rejected here; A2A is `adapt-behind-adapter` (fit-matrix §, external federation) — the right standard *if/when* Construct federates specialists externally, not the internal runtime model. This ADR aligns *vocabulary*; a federation adapter is a separate decision.

## Consequences

- Positive: MCP tool status fields and any future A2A surface become standard-conformant; the H9 honesty work is preserved as qualifiers and gains external meaning; correlation IDs already exist (`runId`/`traceId`), so no new identifiers.
- Negative / cost: a projection layer must be maintained as the lifecycle spec evolves (MCP Tasks RC `2026-07-28`); the qualifier convention must be documented so integrators know where the richer signal lives. The `input_required` mapping couples to the ADR-0078 pause-as-checkpoint design (both describe the same pause), so the two should land together.
- Follow-up: this is a proposal; the implementing bead updates the MCP `orchestration_status`/`orchestration_run` output projection and documents the mapping in `docs/guides/reference/mcp-tools.md`.

## Reversibility

High: the projection is additive over the retained internal states; removing it reverts to the current bespoke fields with no data change.

## References

- `docs/notes/research/2026-07-org-capability-audit/synthesis/fit-matrix.md` §5 and the MCP-Tasks / A2A rows
- MCP Tasks SEP-1686 (Final); A2A v1.0.0 — the shared lifecycle
- `construct-72gqn.9` (H9.2 typed output schemas), `construct-72gqn.16` (H9.3 terminal-contract tripwire), `construct-72gqn.22` (persisted cancel) — the honest-status work this expresses in shared terms
- `lib/orchestration/runtime.mjs` `deriveHonestRunStatus`
- ADR-0078 (durable-handoff checkpointer) — shares the `input_required` / pause-state mapping
