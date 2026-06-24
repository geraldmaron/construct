---
intake: none
intake_rationale: activation-model decision recorded from research brief construct-i1mt and the construct-f66u host gap; not routed through an intake packet.
last_verified_at: 2026-06-05
verified_by: construct · implementation shipped (construct-f66u orchestration_run MCP tool, construct-hvms ACP server) and verified by tests/functional/orchestration-mcp.functional.test.mjs and acp-server.functional.test.mjs
---

# ADR 0025: Construct activation is explicit and host-initiated — aware, never ambient

**Date:** 2026-06-04
**Status:** Accepted
**Deciders:** Construct·Architect
**Supersedes:** none

---

## Problem

Construct can be installed in a project without being the active agent, and two requirements pull in opposite directions:

- A host that selected a non-Construct agent must not have Construct silently take over. Ambient activation — Construct doing orchestrated work merely because it is detected in the project — is a surprise the user did not ask for.
- A tool sitting on top of Construct (for example, a document-ingestion front-end that wants Construct to classify and route the result) needs a reliable, explicit way to say "enact Construct: do the work using the skills and specialists." Today that path is honor-system on the hosts that lack a native subagent primitive.

The gap is observed, not hypothetical: a user selected the `construct` agent in VS Code Copilot, but the Construct orchestration path did not run (`construct-f66u`) — the host had no enforced entrypoint that actually enacted the chain, so selection alone did nothing.

## Context

- `lib/host-capabilities.mjs` classifies every supported host into three tiers: **full-native** (Claude Code, OpenCode) run the multi-specialist chain themselves; **mcp-orchestrated** (Codex, VS Code, Cursor, Copilot) have no native subagent primitive and reach the same outcome by calling the `orchestration_run` MCP tool against the daemon; **prompt-only** (no supported 2026 host).
- [ADR 0022](0022-orchestration-daemon-api.md) provides the orchestration daemon as engine-as-service — the typed entrypoint an mcp-orchestrated host already targets.
- The research brief (`docs/notes/research/decision-input/doc-io-and-invocation-research.md`, 2026-06-04, Topic 4) establishes that MCP has no ambient primitive: tools are explicit and model-controlled (`tools/call`), prompts are user-controlled (slash commands), and "enact on demand" maps directly onto a single `tools/call`.

## Decision

**Construct activation is always explicit and host-initiated.** The single "enact Construct" entrypoint is the `orchestration_run` MCP tool (backed by the daemon, ADR 0022); a user-controlled prompt / slash-command is the human-facing equivalent. Construct never auto-activates: detecting Construct in a project surfaces its availability, but selecting a non-Construct agent never invokes it. A tool-on-top enacts Construct by calling `orchestration_run` with its request — the same entrypoint an mcp-orchestrated host uses, exposed as a contract rather than an internal convention.

## Rationale

The decision aligns Construct's activation with the protocol it already runs on: MCP models exactly two activation shapes, both explicit (a model-controlled tool call and a user-controlled prompt), and no ambient mode (research brief, Topic 4). Making `orchestration_run` the sanctioned and only activation path closes the mcp-orchestrated honor-system gap — selection or a tool-on-top's request now resolves to a concrete call the host must make, rather than an instruction it may ignore (`construct-f66u`). Treating the tool-on-top case as a first-class contract reuses the daemon entrypoint (ADR 0022) instead of inventing a parallel one. "Aware but not forced" respects the host's agent selection, which is the user's choice to make.

## Rejected alternatives

- **Ambient activation** — run Construct whenever it is detected in a project. Surprises users who selected another agent, and contradicts both MCP's no-ambient model and the host-capability tiers that already treat activation as host-initiated. Rejected as user-hostile and protocol-misaligned.
- **Persona-prompt-only activation** — rely on the selected agent reading Construct's instruction files and choosing to behave as Construct. This is the honor-system path that already failed in Copilot (`construct-f66u`): on mcp-orchestrated hosts, instructions without an enforced tool call do not reliably enact the chain. Rejected as demonstrably unreliable.
- **A bespoke non-MCP RPC for tools-on-top** — a second activation channel just for embedding tools. Duplicates the orchestration daemon API (ADR 0022) and fragments the entrypoint into two contracts to maintain. Rejected for fragmentation; the daemon tool already serves this caller.

## Consequences

- There is one documented, enforced entrypoint for both agent-driven and tool-on-top activation, so host behavior is predictable and the "embed Construct under another tool" use-case is supported by contract.
- mcp-orchestrated hosts must actually wire the `orchestration_run` call to honor a Construct selection (the fix `construct-f66u` needs), and activation requires the daemon to be running.
- The principle is locked in: activation is an explicit tool or prompt call, never inferred from presence.

## Reversibility

Two-way door on transport — a future ACP-native activation ([ADR 0023](0023-acp-agent.md)) can be added as another explicit entrypoint without changing the principle. The principle itself is closer to a one-way door: reintroducing ambient activation would reverse this decision and require a superseding ADR with a strong justification for overriding host agent selection.

## References

- [ADR 0020: Local orchestration runtime](0020-local-orchestration-runtime.md)
- [ADR 0022: Orchestration daemon API](0022-orchestration-daemon-api.md)
- [ADR 0023: ACP agent](0023-acp-agent.md)
- Research brief: `docs/notes/research/decision-input/doc-io-and-invocation-research.md` (2026-06-04)
- `lib/host-capabilities.mjs`
- Beads: `construct-6zqs` (activation model), `construct-f66u` (Copilot host gap), `construct-i1mt` (research)
