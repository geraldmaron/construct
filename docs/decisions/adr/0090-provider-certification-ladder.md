# ADR-0090: Provider certification ladder — six evidence tiers gate what a provider manifest may claim; the production-gate threshold is left open for the user

- **Date**: 2026-07-16
- **Status**: proposed
- **Deciders**: Gerald Dagher
- **Supersedes**: none
- **Resolves (decision only)**: `construct-4uxq0.4.6` (ADR-F: provider certification ladder + production gate level). The ladder vocabulary is the decision this ADR makes; the implementation (computing and persisting tiers) is `construct-4uxq0.13.2`, and the Jira migration that depends on an honest tier for the Jira adapter is `construct-4uxq0.4.15` (ADR-O) — both tracked separately and left open by this ADR.

## Problem

Construct's provider manifests (`lib/extensions/manifests/*.manifest.json`) declare a flat `capabilities`/`operations` list — e.g. `atlassian-jira.manifest.json:5-7` declares `"capabilities": ["read", "search"]` with no accompanying signal for *how well-evidenced* that capability is. A manifest that says a provider supports `search` looks identical whether that support was verified five minutes ago against a live sandbox or has never been exercised against a real endpoint at all.

That gap is not theoretical. The Jira adapter (`lib/providers/contract/adapters/jira/transport.mjs`) calls `GET /rest/api/3/issue/createmeta` at line 70 and `POST /rest/api/3/search` at line 105. Per `docs/notes/research/2026-07-continuous-work-audit/truth-matrix.md` rows 29-30 (read in full for this ADR):

- Row 29: "Uses `GET /rest/api/3/issue/createmeta` (confirmed deprecated 2024, not yet removed) and `POST /rest/api/3/search` (confirmed deprecated + **effectively removed Aug 2025**, many tenants now get 410 Gone)... Adapter may already be non-functional against current Jira Cloud tenants for search... status: **stale**."
- Row 30: "`accountId` mandatory for assignee (has been since 2019, adapter presumably compliant — **not independently re-verified**), ADF mandatory for description/comment in v3... status: **unknown-evidence-failed** (ADF compliance not independently re-verified against adapter code)."

I independently confirmed the code-level fact — the adapter does call those two endpoint paths at those lines — by reading `transport.mjs` directly. I did **not** independently re-verify the Atlassian deprecation/removal dates or tenant-level 410 behavior against Atlassian's changelog; that claim is carried from the truth-matrix, which attributes it to "Atlassian's own changelog/community announcements during WP1" per the bead description. That external claim is marked `[unverified]` by me in this ADR — I am relying on the truth-matrix's live-verification, not re-doing it.

The manifest for this same adapter (`atlassian-jira.manifest.json:5`) still declares plain `"capabilities": ["read", "search"]` with no field that could express "search was live-verified against a sandbox" versus "search has never been exercised past a schema check" versus "search is currently believed broken in production." Nothing in the manifest schema today can represent row 29's finding. A provider can show as supporting an operation that is, in production, already returning 410 Gone.

## Context

This repo already has a five-rung progressive evidence ladder, but for a different subsystem: specialist certification. `lib/certification/evidence-tiers.mjs:33-39` defines:

```
declared → structurally-valid → behaviorally-tested → live-tested → host-proven
```

`computeEvidenceTier()` (`evidence-tiers.mjs:120-151`) walks that ladder for one specialist: `declared` is the registry floor; `structurally-valid` requires the role card, specialist-contract audit, and role overlay to all pass static checks (`evidence-tiers.mjs:65-69`); `behaviorally-tested` requires a certification-store run whose scenario ID belongs to the specialist and whose gate is in `BEHAVIORAL_GATE_TYPES` (today only `specialist-behavior-live`, `evidence-tiers.mjs:47`) to have passed, even hermetically; `live-tested` requires that same passing run to be non-hermetic and not a skipped-provider verdict (`evidence-tiers.mjs:94-104`); `host-proven` requires a real orchestrated handoff with `contractStatus: 'ok'` — and `hostProven()` is hardcoded to `return false` today (`evidence-tiers.mjs:110-112`) because nothing yet populates that signal, so the file's own comment calls the `live-tested` ceiling "honest" until that changes.

The bead (`construct-4uxq0.4.6`) proposes a structurally similar but not identical ladder for providers:

```
declared → structurally-validated → contract-tested → process-boundary-tested → live-sandbox-tested → production-proven
```

**Comparing the two explicitly:**

Same shape: both are ordered, cumulative ladders where each rung requires genuine evidence at the rung below it (not just the rung's own check) — `evidence-tiers.mjs`'s header comment states this outright ("each rung requiring genuine evidence at the rung below it"), and the provider ladder is designed the same way per the bead. Both start at `declared` (exists / is registered) and both cap honestly at a lower rung when no run/evidence exists yet, rather than defaulting upward.

Different axis, not a relabeling: the specialist ladder measures **LLM behavioral fidelity** — does a certification-store scenario, scored against a rubric, pass when a model actually runs the specialist's prompt? Its inputs are role cards, specialist-contract audits, role overlays, and certification-store run records keyed by scenario-ID prefixes (`specialist.representative.*`, `specialist.live.*`, etc. — `evidence-tiers.mjs:76-92`). None of that exists for providers. The proposed provider ladder measures **external wire-protocol and process-integration correctness** — does an HTTP/API call to a real third-party service, across a real process boundary, still work the way the adapter assumes? That is a fundamentally different failure mode: a specialist doesn't silently break because a vendor deprecated an endpoint; a provider adapter does, which is exactly what truth-matrix row 29 documents. The provider ladder's `process-boundary-tested` and `live-sandbox-tested` rungs have no specialist-ladder analog at all — there is no "crossed a subprocess/IPC boundary" or "hit a sandbox tenant" concept in `evidence-tiers.mjs`, because specialists don't cross that boundary. And `production-proven` for a provider carries a staleness risk the specialist ladder's `host-proven` does not: a provider that was `production-proven` last quarter can silently regress (Atlassian removes an endpoint) without any local state change, whereas a specialist's certification run doesn't go stale just because time passes.

Practical consequence: `computeEvidenceTier()` cannot be called for providers as-is — its signature (`agent, roleOverlay, { rootDir }`), its `specialistId = 'cx-${agent.name}'` convention, its role-card/contract/overlay checks, and its `BEHAVIORAL_GATE_TYPES` scenario-prefix scan are all specialist-registry-specific. There is nothing to literally reuse at the function level. What **is** worth reusing is the *pattern*: a frozen ordered-tier array, a single `compute*Tier()` entry point that returns `{ tier, reason, evidence }`, an honest floor when no run exists, and a documented note (like `evidence-tiers.mjs:106-112`'s `hostProven()` comment) about which top rung is currently unreachable and why. `construct-4uxq0.13.2` should build a sibling module (e.g. `lib/certification/provider-evidence-tiers.mjs`) that mirrors that shape rather than inventing an unrelated ladder implementation from scratch, and rather than trying to bend `evidence-tiers.mjs` itself to cover two unrelated evidence domains through parameterization.

**What a manifest actually declares today.** I read three read-side manifests (`atlassian-jira.manifest.json`, `github.manifest.json`, `slack.manifest.json`) and the Jira write-side manifest (`lib/providers/contract/adapters/jira/manifest.json`). All four use the same flat shape: `"capabilities": [...]` and `"operations": [...]` as plain string arrays, no per-operation object, no support-level or evidence field anywhere in the schema. `lib/providers/contract/adapters/jira/manifest.json:16` even notes in its own `"notes"` field that this write manifest is "colocated" and deliberately excluded from the shared discovery registry (consistent with truth-matrix row 27's "partial" finding on the namespace mismatch this creates) — but that note is about *discovery*, not evidence level; nothing in either manifest schema today could express "this operation is only contract-tested" versus "this operation is production-proven." An enforcement rule of "no provider should show as supporting an operation above its actual evidence level" therefore has no existing field to gate against — the manifest schema itself needs a new per-operation tier field before any such rule can run, which is in scope for `construct-4uxq0.13.2`, not this ADR.

## Decision

1. **Adopt the six-level provider evidence ladder** the bead proposes, as the vocabulary for how much evidence backs a provider's claim to support a given operation:

   `declared → structurally-validated → contract-tested → process-boundary-tested → live-sandbox-tested → production-proven`

   Each rung requires genuine evidence at the rung below it, mirroring `evidence-tiers.mjs`'s existing discipline (`evidence-tiers.mjs:33-39` comment block): a provider with zero recorded evidence caps at the honest floor, not at whatever the manifest author typed into `capabilities`.

2. **This ladder is a new, purpose-built module — not a parameterization of `evidence-tiers.mjs`.** Per the comparison above, the two ladders share a pattern but not an axis, an input shape, or a data source. `construct-4uxq0.13.2` should implement a sibling module under `lib/certification/` (structural home matching `evidence-tiers.mjs`'s existing location) that follows the same shape (frozen tier array, single compute entry point returning `{ tier, reason, evidence }`, an honest floor, a documented note on any currently-unreachable top rung) rather than either (a) duplicating an unrelated one-off ladder with no shared discipline, or (b) forcing specialist-shaped machinery to also model provider wire-protocol evidence.

3. **The ladder is audit-decidable; the production-use gate level is not — that is left open for the user.** Which rung a provider's operation has reached (e.g., "Jira `search` last verified `live-sandbox-tested` on date X, now believed regressed per row 29") is a fact `construct-4uxq0.13.2` can compute from certification/test-run evidence, the same way `computeEvidenceTier()` computes a specialist's tier today. But *which rung is required before an operation is allowed to run against production* is a risk-tolerance decision, not a fact — the bead's own owner line states this split explicitly ("Owner: Audit ladder, User gate"). This ADR does not set that threshold. See Rejected alternatives for why no default is proposed here.

## Rationale

The row 29/30 evidence shows the failure mode this ladder exists to prevent: a manifest declaring `"capabilities": ["read", "search"]` gave no signal that `search` was quietly approaching (and, per the truth-matrix's live-verified claim, may have already crossed) a hard break in production. A tier vocabulary that distinguishes "passed a contract/schema test" from "verified against a live sandbox" from "proven in production and still fresh" gives that signal a place to live. Building it as a sibling to `evidence-tiers.mjs` rather than inside it keeps the specialist ladder's existing, working discipline untouched while giving providers a structurally consistent but evidentially independent ladder — reuse of the *pattern* without forcing a false equivalence between LLM-behavioral evidence and wire-protocol evidence, which the comparison above shows are genuinely different things measured by genuinely different mechanisms.

Leaving the production-gate threshold open matches the bead's own framing and this session's instruction: an audit can tell you a provider's operation is currently at `contract-tested`, but whether `contract-tested` is an acceptable bar for production traffic, or whether nothing short of `production-proven` (refreshed within some window) is acceptable, is a call about how much risk the user is willing to carry — not something derivable from the evidence itself. I found no evidence in this repo strong enough to recommend one universal numeric bar for all providers (the Jira case argues for a high bar *for Jira specifically*, given a confirmed-deprecated endpoint in active use, but does not establish what bar every other provider — most of which have no known regression — should be held to).

## Rejected alternatives

- **Literally reuse `computeEvidenceTier()` / `evidence-tiers.mjs` for providers, parameterized by subsystem.** Rejected: its inputs (`agent`, `roleOverlay`, role-card files, `specialistId = 'cx-${agent.name}'`, `BEHAVIORAL_GATE_TYPES` scenario-ID prefixes) are all specialist-registry-specific with no provider analog, and two of six proposed provider rungs (`process-boundary-tested`, `live-sandbox-tested`) have no corresponding concept in the specialist ladder at all. Forcing one function to cover both would require branching its entire body by subsystem, which is a worse outcome than two small sibling modules sharing a documented pattern.
- **Leave provider capability declarations flat, as they are today.** Rejected: this is the status quo that let row 29's finding go unrepresented in the manifest — a provider can claim `search` support with no way to distinguish "verified yesterday against a live tenant" from "never exercised past a schema check."
- **Set a specific numeric production-gate level in this ADR (e.g., "require `live-sandbox-tested` minimum").** Rejected per the task framing and the bead's own "Audit ladder, User gate" split: the ladder rungs are audit-decidable, but the production bar is a risk-tolerance call belonging to the user, and I do not have evidence-based grounds — beyond the single Jira case, which argues for that provider specifically, not a repo-wide default — to propose one number for every provider.

## Consequences

- Positive: gives `construct-4uxq0.13.2` a defined vocabulary to implement against, instead of inventing one mid-implementation. Unblocks `construct-4uxq0.4.15` (ADR-O, the Jira API migration plan), which needs an honest tier for the current Jira `search`/`createmeta` calls to reason about migration urgency rather than relying on the flat "capabilities": ["read", "search"] declaration that presently hides the row 29 regression. Establishes that "no provider should show as supporting an operation above its actual evidence level" is an enforceable target once `.13.2` adds a per-operation tier field to the manifest schema — today, per the manifests read for this ADR, no such field exists to enforce against.
- Negative / cost: the manifest schema (`lib/extensions/manifests/*.manifest.json` and the colocated write manifests such as `lib/providers/contract/adapters/jira/manifest.json`) needs a new per-operation field to carry the tier — none of the four manifests read for this ADR have anywhere to put it today. `construct-4uxq0.13.2` also needs a real evidence source for the two provider-specific rungs (`contract-tested`, `process-boundary-tested`) that, as far as this ADR's research found, does not yet exist as a distinctly labeled test category in this repo — it will need to be built or mapped onto existing tests, not merely computed from records that already exist (the same honest-ceiling risk `evidence-tiers.mjs:106-112` flags for its own `host-proven` rung, which is hardcoded unreachable today).
- Follow-up: this is a proposal only. `construct-4uxq0.13.2` implements the ladder module and manifest schema field; the production-gate threshold remains an open decision for the user to set, either globally or per provider, before enforcement can go live.

## Reversibility

High: this ADR fixes a vocabulary and a module-placement decision, not a runtime behavior. No manifest changes, no schema changes, and no enforcement exist yet — adopting a different rung structure later, before `.13.2` lands, costs nothing beyond re-editing this document and the not-yet-written module.

## References

- `docs/notes/research/2026-07-continuous-work-audit/truth-matrix.md` rows 29-30 (read in full for this ADR) — Jira deprecated/removed-endpoint evidence and the unverified ADF-compliance sub-claim
- `lib/providers/contract/adapters/jira/transport.mjs:70,84,93,105` — confirmed by direct read: `createmeta`, issue-create, comment-create, and `search` endpoint calls
- `lib/certification/evidence-tiers.mjs` (read in full) — the existing five-rung specialist evidence ladder (`:33-39` tier list, `:120-151` `computeEvidenceTier`, `:106-112` honest-ceiling note on `hostProven()`)
- `lib/extensions/manifests/atlassian-jira.manifest.json:5-7`, `lib/extensions/manifests/github.manifest.json:5-7`, `lib/extensions/manifests/slack.manifest.json:5-7`, `lib/providers/contract/adapters/jira/manifest.json:5-7` — current flat `capabilities`/`operations` declarations, no per-operation evidence field
- `bd show construct-4uxq0.4.6` (ADR-F) — the bead this ADR resolves; also blocks `construct-4uxq0.13.2` and `construct-4uxq0.4.15`
