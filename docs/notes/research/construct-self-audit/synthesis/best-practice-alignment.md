---
intake: none
---

# Best-Practice Alignment — Construct vs current agent-orchestration practice

Supervisor: Opus · Branch: `audit/best-practice-alignment` · Bead: `construct-rr63.10` · Date: 2026-06-29

Aligns Construct against current best practices for agent-orchestration platforms, drawn from the
program's own evidence (`../subagents/`, `consolidated-findings.md`). **Scope note:** an external,
web-sourced benchmark is NOT included — it depends on the governed web search not yet wired into MCP
(`construct-rr63.5.4`, blocked). Per the no-fabrication rule, no claim below rests on un-fetched
external sources; each is grounded in this repo.

## Practice-by-practice alignment

| Best practice | Construct's posture (evidence) | Status |
|---|---|---|
| **Truthful capability reporting** (tools declare what they actually do) | Execution-capability contract carries a mandatory semantics disclaimer; no surface fakes web search; typed degradation defined | ✅ aligned, now guarded |
| **Planning vs execution separation** | Inline backend prepares (`output:null`), provider backend executes — test-enforced (`orchestration-truth-negative`) | ✅ aligned |
| **Non-destructive lifecycle** (never silently overwrite user state) | Marker/staging/atomic writes; consented re-converge for `.cx/context.*`; dirty-repo warning now non-silent | ✅ aligned |
| **Registry-first / data-driven config** | Strong for doc-lanes/capabilities/specialists; gaps inventoried (MCP tools, services, host paths) with golden characterization | ◑ partial — extraction is Wave-3 work |
| **Typed, machine-branchable errors** | Contract defined (`schemas/mcp-tool-output.schema.json`); tools still emit ad-hoc `{error:string}` | ◑ partial — migration pending |
| **Capability-based host parity** (not file existence) | Gap pinned (`host-capability-matrix.md`); current parity is file-based | ◑ contract ready, impl pending |
| **Closed-loop learning** (capture → consume → improve) | A1 capture wired; tool-miss/failure now consumed + surfaced; A4 prompt-improvement still offline | ◑ improving |
| **Source-credibility discipline for research** | ADR-0017 taxonomy (claim-relative class + Admiralty grade); web_search enforces citations | ✅ contract + tool |
| **Self-verification / dogfooding** | This program (self-hosting certification) | ✅ certified (scoped) |

## Net assessment

Construct is **strongly aligned** on the load-bearing practices — capability truthfulness, execution
separation, non-destructive lifecycle, no-fabrication — and these are now *test-guarded* rather than
merely intended. The partial rows are not misalignment but **staged remediation**: contracts and
characterizations are in place (the gates), with extraction/migration deferred to Wave-3/4 implementation
beads. The one practice Construct cannot yet self-assess against the outside world — external
benchmarking — is honestly out of scope pending `construct-rr63.5.4`.

## Follow-on

When `construct-rr63.5.4` wires governed web search, re-run this alignment with an external benchmark
sweep (named sources, fetched + cited per ADR-0017) and append a comparison section here.
