---
title: Participation verticals
description: The dimension → rules → recruiter → surfaced-reasons pattern for condition-driven reviewer recruitment, with cost/financial as the worked reference vertical.
---

# Participation verticals

A participation vertical is one concern dimension wired end-to-end through the ADR-0070 participation pipeline: a keyword-declared signal dimension, registry-declared participation rules, the generalized recruiter, and reasons surfaced on every invocation result. The cost/financial vertical (construct-pteo2.7, cdsp.22) is the reference implementation this page walks through; legal, accessibility, and reliability copy the same four steps.

See [ADR-0070](../../decisions/adr/0070-participation-pipeline-and-rules-schema.md) for the pipeline decision and [`schemas/participation-rules.schema.json`](../../../schemas/participation-rules.schema.json) for the rule schema.

## The pattern, in four steps

### 1. Declare the dimension

A dimension is a `{ key, keywords }` entry in `lib/orchestration/signal-dimensions.mjs` (`CANONICAL_DIMENSIONS`), matched as lowercased substrings over text. Projects extend or override the set by dropping a JSON array into `.cx/orchestration/signal-dimensions.json` — no core edit required.

The `cost` dimension is declared as:

```
keywords: ['budget', 'cost', 'pricing', 'spend', 'expense', 'financial', 'revenue', 'roi', 'billing']
```

Two signal sources evaluate the same dimension vocabulary:

- **Request-level** — `requestSignals()` in `lib/orchestration/flow-selection.mjs` matches the incoming request text and emits one boolean per declared dimension.
- **Content-level** — `extractContentSignals()` in `lib/orchestration/content-signals.mjs` (construct-pteo2.4) re-matches the *produced draft*: a dimension keyword in a table header cell fires the dimension even when prose does not, and a currency amount inside any table row fires `cost` specifically. A cost table appearing in a PRD whose request had no cost language still recruits its reviewers before publish.

### 2. Bind recruits to the dimension

Two mechanisms in `lib/orchestration/recruiter.mjs` map a truthy dimension to participants; a vertical typically uses both:

- **Skill affinity** (`CANONICAL_AFFINITIES`) — the dimension names skill patterns, and the recruiter queries the assembled registry for specialists whose declared skills match; the specialist with the *fewest* declared skills wins (a narrow skill set that matches is a stronger specialization claim). For `cost` the patterns are `cost-optimization`, `pricing-positioning`, `raw-data-structuring`, which resolves to **cx-data-analyst** (3 declared skills) over cx-product-manager (13, matching `strategy/pricing-positioning`). Projects overlay affinities via `.cx/orchestration/recruitment-affinities.json`.
- **Participation rules** — a `participationRules` block on any registry entry (specialist or team JSON under `specialists/org/`), validated against `schemas/participation-rules.schema.json`. Each rule is `when(signalExpr | watchCondition) → recruit(specialists | teams)` plus `role` (author/reviewer/advisor), `gate` (advisory by default; `enforced` requires an `enforcementScope` naming a team decisionRight), and a `reason` string surfaced verbatim in trace output.

The cost vertical declares two rules:

- `cost-quant-review` on [`specialists/org/specialists/cx-data-analyst.json`](../../../specialists/org/specialists/cx-data-analyst.json): `signalExpr: "cost"` recruits **cx-data-analyst** as advisory reviewer, reason `cost/quant`.
- `cost-value-tradeoff-review` on [`specialists/org/specialists/cx-product-manager.json`](../../../specialists/org/specialists/cx-product-manager.json): `signalExpr: "cost"` recruits **cx-product-manager** as advisory reviewer, reason `cost signal — value-tradeoff framework review (cx-pm-value-tradeoff)`.

Rules recruit only roster specialists — the schema's `rosterSpecialist` enum is the fixed 12-role roster, so a vertical never invents a new role.

### 3. Attach the reasoning framework

A recruited reviewer reasons with the framework bound to its role, not generic judgment. Frameworks live in `specialists/org/frameworks/` and bind via frontmatter `appliesToRole` (ADR-0062); `resolveRoleFramework()` in `lib/embedded-contract/workflow-invoke.mjs` resolves the plan's primary role through pack tier precedence and puts the framework's ordered steps and `emits` tokens on the output contract.

For cost, the PM joins with [`specialists/org/frameworks/cx-pm-value-tradeoff.md`](../../../specialists/org/frameworks/cx-pm-value-tradeoff.md) (`appliesToRole: product-manager`): user-value → tradeoffs → prioritization → acceptance-criteria, emitting `value-statement`, `tradeoff-table`, `prioritization-call`, `acceptance-criteria`. On `prd-draft` the PM is already the chain's primary owner, so the framework equips the plan directly (`framework.frameworkId: cx-pm-value-tradeoff` in the result); on chains without the PM (e.g. `architecture-review`), the `cost-value-tradeoff-review` rule pulls the PM on as reviewer and its `reason` names the framework the review applies.

### 4. Surface the recruitment with reasons

Recruitment is never silent. Both invocation surfaces carry who joined and why:

- `construct workflow invoke --json` (`lib/embedded-contract/workflow-invoke.mjs`, construct-pteo2.9) appends recruits to the manifest role chain — the chain is a floor, never shrunk — and returns `recruitment: { recruited, addedRoles, rationale }`, where each rationale line reads `<specialist> recruited as <role> (<gate>): <reason>`.
- The `author_artifact` MCP tool (`lib/mcp/tools/artifact-author.mjs`, construct-pteo2.8) returns `recruited[]` with the same participant shape, evaluated both pre-plan from the request and post-draft from content signals (`lib/artifact-loop-core.mjs`).

## The worked example: a cost-heavy PRD

Request: `PRD for usage-based billing pricing: per-request cost budget, monthly spend caps, and ROI targets`.

1. `requestSignals()` fires `cost: true` (`billing`, `pricing`, `cost`, `budget`, `spend`, `roi`).
2. The recruiter returns **cx-data-analyst** (reviewer, via skill affinity + `cost-quant-review`) and **cx-product-manager** (reviewer, via `cost-value-tradeoff-review`), both advisory, each with its reason.
3. On `prd-draft`, the PM is already the authoring chain's primary owner, so `data-analyst` is appended and the `cx-pm-value-tradeoff` framework equips the plan; on `architecture-review`, both `data-analyst` and `product-manager` append as reviewers.
4. `recruitment.rationale` surfaces every recruit with its reason; trace provenance records the governing framework id.

The functional proof spawns the real binary in a tmpdir and asserts exactly this: [`tests/functional/cost-vertical-recruitment.functional.test.mjs`](../../../tests/functional/cost-vertical-recruitment.functional.test.mjs).

## Copy-points for the other verticals

Each vertical fills the same four slots. Current state of the substrate:

| Vertical | Dimension (signal-dimensions.mjs) | Quant/domain recruit | Rule(s) today | Framework binding |
|---|---|---|---|---|
| **Cost/financial** (reference) | `cost` | cx-data-analyst via affinity | `cost-quant-review` (cx-data-analyst), `cost-value-tradeoff-review` (cx-product-manager) | `cx-pm-value-tradeoff` |
| **Legal/compliance** | `compliance` | cx-security via affinity (`compliance/`, `regulatory-review`, `license-audit`) | `legal-compliance-participation` (governance-team, squad-expanding) | none bound to `security` yet; the schema's `legal-compliance` dimension structurally requires recruiting cx-security (no 13th role) |
| **Accessibility** | `accessibility` | cx-designer via affinity (`accessibility`, `screen-reader`) | no participation rule yet — affinity only | none bound to `designer` yet |
| **Reliability** | `reliability` | cx-operations via affinity (`incident-response`, `oncall-rotation`) | `reliability-root-cause` (cx-debugger, advisor) | `cx-ops-dependency-sequencing` exists in `specialists/org/frameworks/` for the operations role |

To complete a vertical, copy the cost template:

1. Confirm (or overlay) the dimension keywords in `lib/orchestration/signal-dimensions.mjs`.
2. Add a `participationRules` rule on the recruited specialist's registry JSON with `signalExpr` naming the dimension, `role: reviewer`, `gate: advisory`, and a `reason` that names the framework the reviewer applies. Rules can also be authored without editing JSON: `construct studio` (construct-pteo2.15) has a Participation canvas whose editor writes through `lib/registry/org-api.mjs`'s `upsertParticipationRule` — the same validation the coverage gate enforces — and a sample-request preview that shows the recruited set live via the real `requestSignals` + recruiter path.
3. If the role lacks a reasoning framework, author one in `specialists/org/frameworks/` following ADR-0062 (`appliesToRole` frontmatter) — derived from the role's existing skills and prompt, never invented.
4. Run `node bin/construct registry:validate --unified` and `node --test tests/participation-coverage.test.mjs`, then add a functional test modeled on `tests/functional/cost-vertical-recruitment.functional.test.mjs` asserting the recruited set and rationale end-to-end.
