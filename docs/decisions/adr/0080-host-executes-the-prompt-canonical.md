# ADR-0080: Host-executes-the-prompt is the canonical worker model; MCP sampling is not built upon

- **Date**: 2026-07-14
- **Status**: proposed
- **Deciders**: Gerald Dagher
- **Supersedes**: none
- **Resolves (decision only)**: the sampling-deprecation / host-canonical question that `construct-rf26.20` flagged ("the host-execution backend should not build new code on deprecated surfaces"); that bead's broader v2 SDK migration (split `@modelcontextprotocol/server` package, MRTR adoption, protocol-doctor-v2) remains open implementation work

## Problem

Construct can reach a host's model two ways, and it has never formally decided which is canonical. The **host worker backend** (`worker_backend: host`, already the default for MCP-originated runs) materializes each specialist's prompt envelope with `materializeTaskPrompt` and hands it to the calling host to execute in its own session, with its own subscription keys and model, returning the result via `orchestration_task_result`. Separately, an **MCP `sampling`** path (`lib/orchestration/host-sampling.mjs`) drives that same loop itself when the connected client advertises the `sampling` capability — a server→host→LLM round-trip. Carrying both as co-equal, and leaving `construct-rf26.20` open pending the MCP spec's direction, meant the design could still tilt toward building more on sampling.

## Context

The R1 external-framework survey (`docs/notes/research/2026-07-org-capability-audit/synthesis/fit-matrix.md` §6) resolved the direction: **MCP `sampling` is deprecated** (spec `2026-07-28`, SEP-2577). The specification now tells implementers to "migrate to integrating directly with LLM provider APIs" instead of the server→host sampling round-trip.

That deprecation *validates* the design Construct already defaults to. Construct's host backend does exactly what the standard now recommends: it produces a prompt envelope and lets the host integrate directly with its own model — no sampling round-trip required. The two paths are not co-equal after all; one is the recommended direction and the other is a deprecated transport Construct happens to also support.

There is a piece of the sampling design worth keeping regardless of transport: its **human-gate controls** — review / edit the prompt before it runs, review / deny the response after. That is a HITL pattern, not a transport dependency, and it aligns with the serialize→approve→resume shape ADR-0078 adopts.

## Decision

1. **Host-executes-the-prompt is the canonical worker model.** The prompt-envelope contract (`materializeTaskPrompt` → host executes with its own keys/model → `orchestration_task_result`) is the primary, documented path for reaching a host's model, and the default for MCP runs stays `host`. New host-integration work targets this model.
2. **Do not build further on MCP `sampling`.** The existing `host-sampling.mjs` path is retained only as a compatibility convenience for clients that advertise `sampling` and prefer the in-call loop; it is frozen, not extended, and documented as sitting on a deprecated spec surface. `provider` (real keys, real spend) and `inline` (prepare-only) are unaffected.
3. **Keep the sampling HITL controls as a transport-independent human-gate pattern.** Review/edit-prompt and review/deny-response become the human-gate shape for the host-execution path too, folded into the approval-as-checkpoint work (ADR-0078), not tied to the sampling transport.

## Rationale

The canonical path is the one the standard now endorses *and* the one Construct already ships as default — making it canonical is ratifying reality, not changing behavior. Freezing rather than deleting the sampling path avoids breaking any client that uses it today while ensuring no new surface accretes on a deprecated spec. Preserving the HITL controls keeps the genuinely valuable idea from sampling (a human gate on prompt and response) while shedding its dependency on the deprecated round-trip.

## Rejected alternatives

- **Keep sampling and host-execution co-equal.** Rejected: it leaves the design ambiguous and invites new work on a deprecated spec surface, the exact drift `construct-rf26.20` was meant to resolve.
- **Remove the sampling path entirely now.** Rejected as needlessly breaking — a client advertising `sampling` still works today; freeze-and-document is lower-risk than delete.
- **Wait for further MCP spec movement.** Rejected: SEP-2577 is explicit ("migrate to integrating directly with LLM provider APIs"); waiting keeps `construct-rf26.20` open with no new information coming.

## Consequences

- Positive: one canonical worker model, matching the standard's recommended direction and Construct's existing default; the sampling/host-canonical decision `construct-rf26.20` flagged is now made with evidence, so its remaining v2 SDK migration proceeds without an open design question hanging over the host-execution backend; the HITL controls survive on the canonical path. Zero behavior change (host is already the default).
- Negative / cost: the frozen sampling path must be labeled deprecated in docs so no one extends it; the HITL controls need a home on the host-execution path (a bounded follow-up, shared with ADR-0078).
- Follow-up: this is a proposal; the implementing work is documentation (mark `host-sampling` deprecated-surface in `docs/guides/reference/mcp-tools.md` and the module header) plus the shared HITL-on-checkpoint bead.

## Reversibility

High: no code changes here — the decision ratifies the existing default and freezes an existing path. If MCP sampling were un-deprecated, un-freezing is a doc change.

## References

- `docs/notes/research/2026-07-org-capability-audit/synthesis/fit-matrix.md` §6 (MCP sampling deprecation, SEP-2577) and §recommendation
- MCP spec `2026-07-28`, SEP-2577 (sampling deprecated — "migrate to integrating directly with LLM provider APIs")
- `lib/orchestration/worker.mjs` (`materializeTaskPrompt`, host backend), `lib/orchestration/host-sampling.mjs` (the frozen sampling path), `lib/mcp/tools/orchestration-run.mjs` (host default)
- ADR-0063 (host subscription / execution pickup / sampling) — the lineage this refines
- ADR-0078 (durable-handoff checkpointer) — home for the retained HITL controls
