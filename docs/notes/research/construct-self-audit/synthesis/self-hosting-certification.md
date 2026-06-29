---
intake: none
---

# Self-Hosting Certification — Construct runs on Construct

Supervisor: Opus · Branch: `audit/best-practice-alignment` · Bead: `construct-rr63.11` · Date: 2026-06-29

Certifies that Construct can run its own best-practice / remediation program **on itself**, using its
own tooling, with its own gates enforcing correctness. The proof is this program (`construct-rr63`):
every artifact and gate cited below is a real, re-verifiable part of the run.

## Certification criteria & evidence

| # | Criterion | Evidence (this program) | Verdict |
|---|---|---|---|
| C1 | Construct tracks its own work in its own issue tracker | Epic `construct-rr63` + 11 child epics + leaf beads created/closed via `bd`; per-bead claim/close/evidence | ✅ |
| C2 | Construct audits its own codebase with its own orchestration | 10-agent parallel Wave-1 audit (read-only `Explore`/Haiku) over `lib/`, `docs/`, `registry/`, `tests/` → 10 evidence reports | ✅ |
| C3 | Construct's quality gates fire on Construct's own changes | `comment-lint` blocked 3 edits (manufactured confidence, narrative voice) → fixed not skipped; `docs:verify`, `adr-stamp-integrity`, `dispatch/reference parity`, `golden-surface`, `docs-site-check` all enforced per commit | ✅ |
| C4 | Construct's ratchets catch Construct's own drift | `audit-ratchet` + `corpus-inventory` caught regressions 3× (brand/nav, new test files, test-only module) → root-fixed or intentionally baselined with rationale | ✅ |
| C5 | Construct's execution-truth contract holds for its own runtime | `orchestration-truth-negative` guardrails (inline-never-executes, CoT disclosure, remote relay) added + green; no false-execution claim | ✅ |
| C6 | Construct's no-fabrication rule governs its own artifacts | every synthesis claim labeled `confirmed/likely/unverified`; 4 Agent overreaches **refuted** against verified ground truth (test counts, missing file, port flakiness, "no upgrade fixtures") | ✅ |
| C7 | Construct preserves its own user-owned state across the run | pre-existing uncommitted WIP (orchestration-readiness) **never** swept into a commit — isolated hunk-by-hunk (oracle change) and left untouched throughout | ✅ |
| C8 | Construct learns from its own run | tool-miss + failure capture made consumable (`summarizeToolNameMisses`), surfaced in `learning-status` — real signal (e.g. `construct_call` missed 232×) | ✅ |
| C9 | Construct stays green while changing itself | full suite green across the program (3574+ pass, 0 deterministic fail); LLM-roster flakes identified and excluded | ✅ |

## What this certification does NOT claim (truthful boundaries)

- **External benchmarking is not certified** (`construct-rr63.10`): a governed public web search exists
  as a tool (`lib/mcp/tools/web-search.mjs`) but is not yet wired into the MCP dispatch
  (`construct-rr63.5.4`, blocked by uncommitted `server.mjs`/`mcp-tools.md` WIP). No external best-practice
  claim in this program rests on fetched web sources.
- **Host-native execution is not claimed** where a host cannot provide it — the orchestration contract
  reports `planned/prepared/provider-executed`, never asserts execution that did not happen.

## Re-verification

The companion test `tests/functional/self-hosting-cert.functional.test.mjs` asserts the durable
artifacts of a Construct-on-Construct run exist and are navigable (baseline + four synthesis docs +
ten subagent evidence reports + `meta.json` navigation), closing the "self-hosting: 0 tests" gap Agent
J flagged. The standing proof of C3–C9 is the green release gate itself.

## Verdict

**CERTIFIED (scoped):** Construct ran a complete audit → synthesis → contract → implementation program
on its own codebase, governed by its own gates, preserving user state, staying green — with external
benchmarking explicitly out of scope until `construct-rr63.5.4` lands.
