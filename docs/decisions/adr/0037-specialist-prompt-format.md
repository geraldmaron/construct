# Obsolete: ADR-0037 — Specialist Prompt Format — Hybrid Markdown + Structured Frontmatter

> **Obsolete (Construct 2.0):** Specialist prompts under `specialists/prompts/cx-*.md` and `construct specialist create/edit` are retired. Live prompts are Worker Profile prompts under `registry/worker-profiles/prompts/`. Title `Obsolete:` marker is intentional. Body below is historical. See `docs/obsolete/legacy-surface-register.md`.

- **Date**: 2026-06-17
- **Status**: proposed
- **Deciders**: Construct maintainers (cx-architect)
- **Supersedes**: none

## Problem

Construct's 28 specialist prompts live as free-form markdown in `specialists/prompts/cx-*.md` and are consumed by the sync pipeline as an opaque blob. We are building a host-agnostic CLI harness that can scaffold, validate, and edit specialists programmatically, and a harness needs structure to target. The decision-forcing question: keep markdown, move to structured JSON, or something between — and the choice is not free either way. JSON unlocks machine-writability but serializing 1606 lines of nuanced role prose into string fields harms the human authoring that dominates the corpus's real cost; staying on opaque markdown leaves the harness nothing to target and lets a known drift go unmanaged.

## Context

- **Prompts are opaque to the pipeline.** `scripts/sync-specialists.mjs` → `lib/prompt-composer.js` only strips leading YAML and runs one regex for the `**Role guidance**` directive (`lib/role-preload.mjs`); recurring sections (anti-fabrication contract, suspicions, productive tension, opening question, failure mode, output format) are convention, not enforced or machine-targetable.
- **Metadata is already JSON, and it duplicates the prose.** `specialists/registry.json` carries a `perspective{}` block (`bias`/`tension`/`openingQuestion`/`failureMode`) per specialist that restates the prompt's prose sections — two un-reconciled writers, guaranteed to drift.
- **The platform emit layer is format-independent.** Sync re-serializes source into Claude `.md`+frontmatter, Codex `.toml`, OpenCode JSON-string, Copilot `.prompt.md`, MCP json. Source format is decoupled from delivery, so changing it buys nothing downstream while a prose-in-JSON move would tax authoring.
- **The hybrid's machinery already exists.** `skills/roles/*.md` already run YAML frontmatter + markdown body; `lib/contracts/validate.mjs` has section/frontmatter parsers; `construct scope create` is a working CLI scaffold (JSON manifest beside markdown). Validators are hand-rolled, zero-dep, fail-loud (`lib/specialists/schema.mjs`, `lib/config/schema.mjs`).
- **Scale.** 28 specialists, ~57 lines avg, edited in rare bulk sweeps — i.e. the dominant cost is occasional human authoring of voice prose, where JSON strings hurt most and machine-write convenience helps least.

## Decision

Adopt a **hybrid**: keep prose in markdown; make structure first-class via YAML frontmatter + canonical `##` sections (mirroring `skills/roles/*.md`), a JSON schema, a `construct lint:prompts` linter, and a `construct specialist create/edit` CLI. The prompt frontmatter `perspective{}` becomes the **source of truth**; while both copies exist the linter asserts they are equal, and after full conversion the registry copy is derived/removed. Host-agnostic — OpenCode stays one host among several; native-subagent dispatch is not special-cased here.

Frontmatter (required): `name`, `role`, `version`, `perspective{bias,tension,openingQuestion,failureMode}`. Optional: `roleGuidance`, `roleOverlays`, `templates`, `preloadRoleGuidance`. Required sections (warn-only until body normalization): `## Anti-fabrication contract`, `## Output format`; canonical optional sections are validated for exact heading when present.

The migration is gated by **emit-neutrality**: adding frontmatter must not change the body the pipeline reads, proven against committed golden fixtures via the real strip path (`readPromptBody`). Body-section normalization (changing prose to canonical headings) is a later, intentional, non-emit-neutral step — kept out of phase 1 so the two goals do not conflict.

## Options Considered

1. **Status-quo opaque markdown** — rejected. No structure for the harness to target; the registry/prompt `perspective` drift stays unmanaged.
2. **Full-JSON source** (prose moved into JSON string fields) — rejected. Prose-in-JSON harms readability, diff/`git blame`, and editor tooling for 1606 lines of voice prose; buys nothing at the already-format-independent emit layer; discards the `skills/roles/*.md` precedent.
3. **Hybrid markdown + structured frontmatter** — chosen. Reuses existing parsers and the `profile create` scaffold model, fixes the drift with one writer, and gives the harness a deterministic structure to scaffold and validate.

## Consequences

Easier: programmatic scaffold (`construct specialist create`), field-edit (`construct specialist edit`), and CI drift detection (`construct lint:prompts`); a single source of truth for each specialist's perspective.

Harder: a canonical-section contract and a golden-emit gate must be maintained; frontmatter YAML must stay inside the zero-dep sync reader's limits (nested `perspective{}` is fine because sync only *strips* frontmatter — the linter/scaffold parse it with `js-yaml`, off the sync hot path).

Two-way decision: the source format can revert and the emit is unchanged either way, so the evidence burden is moderate. Phase 1 converts `cx-architect` + `cx-test-automation` as proof; bulk conversion and registry-copy removal follow once the golden-emit gate has run across the corpus.

## Appendix: Context-window management review

Reviewed alongside this decision. Construct splits context **deliberately and well** by design: execution tracks (`immediate`/`focused`/`orchestrated`, `lib/orchestration-policy.mjs`), per-role context packets (`lib/context-router.mjs`: 6000-token budget, role-specific prefer/avoid, 8–12 artifact caps), typed handoff contracts (`specialists/contracts.json`), role guidance fetched at runtime rather than inlined (`lib/role-preload.mjs`), and bounded session injection (2 inline observations, context.md truncated to 1800 chars, the `context-watch` hook nudging as the window fills toward the warn and urgent thresholds [source: lib/hooks/context-watch.mjs]). The only single-window case is the `immediate` track for small-scope work. Three efficacy gaps are worth tracking as follow-ups (out of scope here):

- **Budgets are almost all static** (`PROMPT_WORD_CAP` 3600, the 6000-token packet, `num_ctx` 32k); only the context-router packet is caller-adaptive. Candidate: adapt the packet budget to the resolved model window.
- **Parallel checks are declared but executed sequentially** by the default inline runtime (`lib/orchestration/runtime.mjs`); only native-subagent hosts parallelize.
- **Native subagents are unused** — `hasNativeSubagents: true` for OpenCode is declared but all roles route through one MCP-orchestrated window. Out of scope per the cross-platform decision; recorded so the tradeoff is explicit if revisited.
