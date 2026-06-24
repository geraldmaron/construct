<!--
cx_doc_id and body_hash are stamped by `construct` (init-docs/doc-stamp) on commit;
omitted here because this draft has not been committed.
-->
# ADR-0015: Affirm the hybrid markdown + deterministic-enforcement architecture

- **Date**: 2026-06-03
- **Status**: proposed
- **Deciders**: Gerald Dagher (owner)
- **Supersedes**: none

<!-- Owning specialist: cx-architect. This ADR records an assessment-driven architecture decision and carries its supporting completeness audit so a reader can re-verify every load-bearing claim against the tree. -->

## Problem

Construct steers agent work through two very different kinds of artifact at once: a large natural-language corpus (one orchestrator persona, 28 specialist prompts, 150 skill files, 46 rule files, 4 profiles) and a body of executable code that blocks or shapes tool calls (37 hooks, handoff contracts, role fences, linters). As that corpus grows, a recurring doubt surfaces: is steering agents with markdown the correct foundation, or should the system migrate to a "policy engine"? The doubt is decision-forcing because the answer dictates where future investment goes — into authoring more markdown, into rewriting the soft layer as code, or into closing specific gaps in what already exists. Left unresolved, the corpus keeps growing without a stated position on what markdown is *for* versus what code must guarantee, and the team cannot tell whether the system is fully implemented or merely documented.

## Context

Forces bounding the decision:

- **The two layers already coexist and are load-bearing.** This is not a greenfield "markdown vs. engine" choice; both are in production and tested. Any decision must account for sunk, working implementation rather than a clean slate.
- **The field has converged on hybrid, not on either pole.** Anthropic's own guidance — see *Building Effective AI Agents* (2024-12-19, [anthropic.com](https://www.anthropic.com/engineering/building-effective-agents)) and *Effective context engineering for AI agents* (2025-09-29, [anthropic.com](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)) — favors simple composable patterns plus just-in-time/progressive disclosure of context, not a monolithic framework and not unbounded prompt text. *Equipping agents for the real world with Agent Skills* ([anthropic.com](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)) makes progressive disclosure — metadata preloaded, bodies loaded on demand — the core design pattern, and Agent Skills became an open standard on 2025-12-18.
- **Prior ADRs constrain the shape.** ADR-0013 fixes the on-disk skills layout and ADR-0002 the layered architecture; the soft corpus is already designed to be compiled, not consumed raw.
- **The no-fabrication rule applies to this document.** Every claim below traces to a `file:line`, a named test, or a verified URL.

## Decision

Affirm the hybrid architecture as the long-term foundation. Markdown is the **human-authored, version-controlled, progressively-disclosed guidance and audit surface**; code hooks, contracts, fences, and linters are the **non-bypassable enforcement surface**. We do **not** migrate to a pure policy engine, and we do **not** stay markdown-only. Future work targets the seams between the two layers (named in the gap register), not a rewrite of either.

## Rationale

**1. The framing is a false binary — Construct is already a policy engine *and* a markdown system.** The deterministic layer is real and verified end-to-end, not aspirational:

- All hard tool-call gates block with `exit 2` and honor no skip-vars. Verified by test and by isolated live invocation: `tests/policy-engine.test.mjs` (bootstrap + Stop/drive gates), `tests/hook-scan-secrets.test.mjs`, `tests/hooks/config-protection.test.mjs`, `tests/hooks/pre-push-gate-prior-ci.test.mjs` (explicitly asserts `CONSTRUCT_SKIP_*`/`CONSTRUCT_ALLOW_*` are ignored), `tests/comment-lint.test.mjs`. Wiring confirmed in `claude/settings.template.json` (PreToolUse/PostToolUse/Stop matchers).
- Handoff contracts enforce at runtime: a failing executable postcondition returns `BLOCKED_CONTRACT` (`lib/contracts/validate.mjs:262`), invoked at dispatch via `lib/mcp/tools/workflow.mjs:117` and at write via `bin/construct:1668`. Covered by `tests/functional/w2-contract-enforcement.functional.test.mjs` and `tests/functional/binary-postcondition-enforcement.functional.test.mjs`.
- Intent classification is a deterministic pure function with no inline LLM (`lib/intake/classify.mjs:16`), calibrated to ECE < 0.10 (`tests/intake-classifier-calibration.test.mjs`).

A system with non-bypassable mutation gates, runtime-validated handoffs, RBAC-style role fences, and an append-only audit trail *is* a policy engine. The open question was never "build one"; it was "is the one we have complete." It is largely complete (see audit) with named, bounded gaps.

**2. Markdown is doing the job the field says it should — and only that job.** Progressive disclosure is enforced, not assumed: `PROMPT_WORD_CAP = 3600` words per prompt (`lib/role-preload.mjs:22`) is enforced at sync with a hard `exit(1)` on overshoot (`scripts/sync-specialists.mjs`); skills ship as separate `SKILL.md` entries fetched on demand via `get_skill`, with zero registry entries forcing preload. Inlining all skills into every agent would be roughly two orders of magnitude larger per agent — exactly the context-dilution failure the just-in-time pattern exists to avoid. This matches Anthropic's Agent Skills model directly. Replacing markdown with code would discard the audit/readability/version-control benefits that the field now treats as the point of the markdown layer.

**3. The soft/hard split maps cleanly onto what each layer is good at.** Code enforces what is mechanically checkable and safety-critical (secrets, destructive shell, config tampering, branch/CI discipline, artifact structure, handoff schema). Markdown carries judgment that resists mechanical checking (framing discipline, research quality, persona perspective). This is the same division of labor the Anthropic context-engineering guidance recommends.

## Completeness audit (evidence)

Each mechanism was traced to a test and/or a live isolated invocation. Status legend: **VERIFIED** (passing test or reproduced live block), **PARTIAL** (works but with a stated coverage limit), **UNVERIFIED**.

| Mechanism | Layer | Claimed behavior | Evidence | Status |
|---|---|---|---|---|
| Bootstrap gate | hook | Block Edit/Write until grounded | `tests/policy-engine.test.mjs`; live `exit 2` | VERIFIED |
| Drive-mode Stop gate | hook | Block Stop on unmet criteria | `tests/policy-engine.test.mjs`; live `exit 2` | VERIFIED |
| guard-bash | hook | Block `rm -rf /`, force-push to main, DDL, fork bombs | live `exit 2`; `claude/settings.template.json` | VERIFIED |
| block-no-verify | hook | Block `git commit/push --no-verify` | live `exit 2` | VERIFIED |
| pre-push-gate | hook | Block rejected-SHA repush; refuse `claude/*` push; ignore skip-vars | `tests/hooks/pre-push-gate-prior-ci.test.mjs` (7/7) | VERIFIED |
| config-protection | hook | Block edits to tracked lint/format configs | `tests/hooks/config-protection.test.mjs` (4/4); live `exit 2` | VERIFIED |
| edit-guard | hook | Block stale `old_string`; enforce role fence | live `exit 2`; `lib/roles/fence.mjs` | VERIFIED |
| scan-secrets | hook | Block real API keys/tokens | `tests/hook-scan-secrets.test.mjs` (11/11) | VERIFIED |
| comment-lint (code) | hook+lint | Block banned comment patterns in code | `tests/comment-lint.test.mjs` (23/23) | VERIFIED |
| json-validate | hook | Block malformed `.json` writes | inline in `settings.template.json`; live `exit 2` | VERIFIED |
| No-skip-vars invariant | policy | No `CONSTRUCT_SKIP_*` honored on gates | `tests/hooks/no-skip-vars.test.mjs`; `tests/hooks/pre-push-gate-prior-ci.test.mjs` | VERIFIED |
| Contract handoff (executable) | contract | Failing postcondition ⇒ `BLOCKED_CONTRACT` | `lib/contracts/validate.mjs:262`; `tests/functional/w2-contract-enforcement.functional.test.mjs` | VERIFIED |
| Contract postconditions (prose) | contract | 85 of 106 postconditions are prose | parsed `specialists/contracts.json` (40 contracts; 85 prose, 21 executable) | PARTIAL — prose is advisory, not code-enforced |
| Artifact no-fabrication | lint | Warn at write-time, block at release gate | `lib/hooks/comment-lint.mjs`; `bin/construct:4019` (`CONSTRUCT_ARTIFACT_LINT_MODE=block`); `tests/functional/release-gate.functional.test.mjs` | VERIFIED |
| Citation requirement | lint | Numeric/mind-reading claims need a citation | `lib/comment-lint.mjs:217` | PARTIAL — checks marker presence only, not source validity |
| Intent classifier | code | Deterministic, no LLM, calibrated | `lib/intake/classify.mjs:16`; `tests/intake-classifier-calibration.test.mjs` | VERIFIED |
| Orchestration routing | code | Deterministic dispatch from classification | `tests/orchestration-policy.test.mjs` | VERIFIED |
| Progressive disclosure | sync | Hard 3600-word cap; skills on-demand | `lib/role-preload.mjs:22`; `scripts/sync-specialists.mjs` `exit(1)` | VERIFIED |
| Telemetry loop | runtime | Vendor-agnostic; traces read back to optimize | `lib/telemetry/client.mjs`; `lib/evaluator-optimizer.mjs`; `tests/functional/loop-closure.functional.test.mjs`, `a4-optimize-gate.functional.test.mjs` | VERIFIED — loop closed; auto-trigger is manual/scheduled |
| RRF hybrid search | storage | Deterministic rank fusion | `tests/storage-rrf.test.mjs`, `tests/retrieval-fusion.test.mjs` | VERIFIED |

**Verdict on "fully implemented":** the enforcement layer fires as documented. The only mechanisms that fall short of their stated intent are the two marked PARTIAL — both are *enforcement-strength* limits, not broken features. Everything else is verified by a named test or a reproduced live block.

## Field comparison

| Project | Pattern | Overlap with Construct | What it does that Construct does not |
|---|---|---|---|
| Anthropic Agent Skills / Claude Code (hooks, subagents) | Markdown skills with progressive disclosure + deterministic hooks | Nearly 1:1 — this is the substrate Construct compiles to | Skills are now an open standard with a partner directory; Construct's corpus is bespoke |
| CrewAI | Role/Goal/Backstory personas in code | Persona specialization + handoffs | Python-native execution runtime |
| LangGraph | Explicit state graph + checkpointing | Multi-step orchestration | First-class durable checkpoint/resume of long-horizon state |
| OpenAI Agents SDK | Agents + handoffs + guardrails + built-in tracing | Handoffs + guardrails + telemetry | Tracing/observability is a built-in default surface |
| Cursor rules / AGENTS.md | Repo-local markdown behavior rules | Markdown-as-interface, version-controlled | Flat/shallow; Construct adds compilation, linting, search |
| NeMo Guardrails / OPA | Declarative policy DSL enforced at runtime | Deterministic, non-bypassable gates | Policy expressed declaratively and (for OPA) decoupled/reusable, vs. Construct's hand-written hooks |
| Spec-Kit / BMAD | Spec-first, full-lifecycle persona teams | Persona taxonomy + structured artifacts | Targets requirements→code lifecycle end to end |

Alignment is strong on the dimensions the field now treats as best practice: hybrid soft+hard, progressive disclosure, persona specialization, hybrid retrieval, deterministic gates, vendor-agnostic telemetry. Where comparables lead is in *generalized* mechanisms — declarative policy (OPA/NeMo), durable checkpointing (LangGraph), and tracing-as-default (OpenAI SDK).

## Rejected alternatives

- **Migrate to a pure policy engine (rewrite the soft corpus as code/DSL).** Rejected: it would discard the human-readable, version-controlled audit surface the field explicitly values, and most of what the corpus carries (framing judgment, persona perspective, research discipline) is not mechanically checkable — encoding it as policy would either lose fidelity or reinvent prompts inside a worse authoring format. The deterministic gates that *can* be code already are.
- **Stay markdown-only (lean on prompts, drop or freeze the hook/contract layer).** Rejected: prompts are bypassable by construction; the audit shows the hard gates (secrets, destructive shell, branch/CI discipline, handoff schema) catch exactly the failures prompts cannot be trusted to prevent. The field's documented failure mode for large prompt-only systems is instruction dilution; removing the enforcement layer would expose Construct to it.
- **Adopt a generic guardrails framework (NeMo Guardrails / OPA) wholesale.** Rejected as a *replacement*; retained as an *influence*. Construct's gates are tightly coupled to Claude Code's hook protocol and its own contract schema; swapping in a general engine now adds integration surface without removing a current pain. The declarative-policy idea is captured in the gap register as a possible evolution, not a migration.

## Consequences

- **Locked in:** the compile-from-markdown pipeline (`scripts/sync-specialists.mjs`), the hook protocol coupling to Claude Code, and the soft/hard division of labor. The team commits to authoring guidance in markdown and guarantees in code, and to keeping the two reconciled at sync time.
- **Easier:** reasoning about *where* a given behavior should live (judgment → markdown; guarantee → hook/contract), and onboarding (the audit table is a map of what is actually enforced).
- **Harder / new constraint:** every new "rule" now carries a placement decision and, if it is a guarantee, an enforcement obligation — prose in a contract is explicitly *not* enforcement (see gap register), so authors cannot assume writing it down makes it true.

### Gap register (follow-ups — not filed or implemented here)

1. **Citation validity, not just marker presence (highest priority).** `lib/comment-lint.mjs:217` accepts any `[source: …]`, URL, or `[^n]` marker near a claim without checking the source exists or supports the claim. An agent can satisfy the gate with a fabricated reference. This is the sharpest gap between the no-fabrication *rule* and its *enforcement*. Candidate fix: resolve `[source:]` paths and `[^n]` footnotes and fail when the target is missing.
2. **Prose postconditions are unenforced.** 85 of 106 contract postconditions are advisory text (`specialists/contracts.json`). Candidate: convert the mechanically-checkable ones to executable checks and extend `lib/contracts/validate.mjs` beyond its current three check types.
3. **No explicit instruction-conflict resolution.** No declared precedence when rules/skills conflict; linters detect, they do not arbitrate.
4. **Optimize loop is closed but manually triggered.** `lib/evaluator-optimizer.mjs` reads traces and proposes patches (gated, dry-run by default), but nothing schedules it. Candidate: a scheduled run.
5. **Declarative-policy evolution (optional).** Some hand-written hook logic could move to a declarative policy representation (OPA/NeMo-style) for reuse and testability — an evolution to weigh, not a migration to commit to.

## Reversibility

Two-way door on the gaps (each is an additive change to existing code). Effectively one-way on the core decision: the compiled-markdown + hook architecture is now load-bearing across every platform Construct syncs to, and reversing it would mean rewriting the soft corpus and re-homing every guarantee. Revisit only if the platform substrate (Claude Code hooks / Agent Skills standard) changes shape, or if instruction dilution becomes measurable despite the enforced word cap.

## References

- Anthropic, *Building Effective AI Agents*, 2024-12-19 — https://www.anthropic.com/engineering/building-effective-agents
- Anthropic, *Effective context engineering for AI agents*, 2025-09-29 — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic, *Equipping agents for the real world with Agent Skills* — https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- Comparable projects (canonical docs): CrewAI (docs.crewai.com), LangGraph (langchain-ai.github.io/langgraph), OpenAI Agents SDK (openai.github.io/openai-agents-python), AGENTS.md (agents.md), NVIDIA NeMo Guardrails (github.com/NVIDIA/NeMo-Guardrails), Open Policy Agent (openpolicyagent.org)
- Prior ADRs: ADR-0002 (layered architecture), ADR-0013 (skills on-disk layout)
- In-tree evidence: `specialists/contracts.json`, `lib/contracts/validate.mjs`, `lib/comment-lint.mjs`, `lib/role-preload.mjs`, `lib/intake/classify.mjs`, `claude/settings.template.json`, and the tests named in the completeness audit
