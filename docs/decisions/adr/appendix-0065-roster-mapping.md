<!--
cx_doc_id and body_hash are stamped by construct on commit; omitted in this draft.
-->
# ADR-0065 Appendix: Legacy specialist → core roster mapping (proposal)

- **Parent decision**: ADR-0065 (orchestrator-worker consolidation)
- **Status**: proposal for human review — nothing in this document has been applied. No file under `specialists/org/` or `skills/` was edited, deleted, or renamed to produce it.
- **Purpose**: ADR-0065's Decision section names "construct-rf26.11's appendix to this ADR" as the place the 29-specialist → thin-roster mapping lives. This is that appendix.
- **Scope**: research and analysis only. Contract redesign (converting `specialists/org/contracts/*.json` into delegation specs) is explicitly out of scope here per ADR-0065's Consequences section (tracked separately); this document estimates which contracts would collapse to intra-role checks under the roster below, but does not rewrite any of them.

## How to read this document

Every claim about what a specialist does traces to its JSON file under `specialists/org/specialists/`. Every claim about existing skill-bundle structure traces to `skills/roles/*.md` frontmatter (the `inherits`/`applies_to` fields), read directly, not inferred. Where a specialist's file was sparse or a field looked internally inconsistent, that is stated explicitly rather than resolved by guessing.

The single strongest piece of evidence in this investigation is that **`skills/roles/` already encodes most of the target consolidation**. Of the 29 specialists, 13 already have a skill file with `inherits: null` (a base identity), and the other 14 already have a skill file that declares `inherits: <base-role-name>` (an additive overlay on a base identity) — see the inheritance table in the next section. Two specialists — `cx-oracle` and `cx-rd-lead` — have **no file at all** in `skills/roles/`, base or overlay. This document's roster follows that existing structure rather than inventing a new one, because it is the most re-verifiable source available: it is what the repo's own skill-authoring already committed to before this ADR was written.

---

## 1. Existing skill-inheritance structure (ground truth from `skills/roles/*.md`)

Read from every file's YAML frontmatter (`role`, `inherits`, `applies_to`) in `skills/roles/`:

| Base role file (`inherits: null`) | `applies_to` (from the base file itself) | Overlay files that declare `inherits: <base>` |
|---|---|---|
| `architect.md` | `cx-architect` (description text also names `cx-rd-lead`, but `applies_to` does not list it — an inconsistency in the source file, noted here verbatim) | `architect.ai-systems.md`, `architect.data.md`, `architect.enterprise.md`, `architect.integration.md`, `architect.platform.md` (all `applies_to: cx-architect` only) |
| `business-strategist.md` | `cx-business-strategist` | (none) |
| `data-analyst.md` | `cx-data-analyst` | `data-analyst.experiment.md`, `data-analyst.product.md`, `data-analyst.product-intelligence.md` (`applies_to` also lists `cx-product-manager`), `data-analyst.telemetry.md` (`applies_to` also lists `cx-sre`) |
| `debugger.md` | `cx-debugger` | (none) |
| `designer.md` | `cx-designer`, **and `cx-accessibility` in the same file's `applies_to`** | `designer.accessibility.md` (`applies_to: cx-accessibility`, `inherits: designer`) |
| `engineer.md` | `cx-engineer` | `ai-engineer.md` (`inherits: engineer`), `data-engineer.md` (`inherits: engineer`, itself with sub-overlays `data-engineer.pipeline.md`, `data-engineer.vector-retrieval.md`, `data-engineer.warehouse.md`), `platform-engineer.md` (`inherits: engineer`) |
| `operations.md` | `cx-operations` (description text also names `cx-sre`, `cx-release-manager`, `cx-docs-keeper`) | `docs-keeper.md` (`inherits: operations`), `release-manager.md` (`inherits: operations`), `sre.md` (`inherits: operations`) |
| `orchestrator.md` | `cx-orchestrator` | (none) |
| `product-manager.md` | `cx-product-manager` | `product-manager.ai-product.md`, `.enterprise.md`, `.growth.md`, `.platform.md`, `.product.md` (all `inherits: product-manager`, all `applies_to: cx-product-manager` only) |
| `qa.md` | `cx-qa`, **and `cx-test-automation` in the same file's `applies_to`** | `test-automation.md` (`inherits: qa`), `qa.ai-eval.md` (`applies_to`: `cx-qa`, `cx-test-automation`, **`cx-evaluator`**), `qa.api-contract.md`, `qa.data-pipeline.md`, `qa.web-ui.md` (all `inherits: qa`) |
| `researcher.md` | `cx-researcher`, **and `cx-ux-researcher`, `cx-explorer` in the same file's `applies_to`** | `explorer.md` (`inherits: researcher`), `ux-researcher.md` (`inherits: researcher`) |
| `reviewer.md` | `cx-reviewer`, **and `cx-devil-advocate`, `cx-evaluator`, `cx-trace-reviewer` in the same file's `applies_to`** | `devil-advocate.md` (`inherits: reviewer`), `evaluator.md` (`inherits: reviewer`), `trace-reviewer.md` (`inherits: reviewer`) |
| `security.md` | `cx-security`, **and `cx-legal-compliance` in the same file's `applies_to`** | `security.ai.md`, `.appsec.md`, `.cloud.md`, `.privacy.md`, `.supply-chain.md` (all `inherits: security`), `security.legal-compliance.md` (`applies_to: cx-legal-compliance`, `inherits: security`) |

**Not present anywhere in `skills/roles/`, base or overlay**: `cx-oracle`, `cx-rd-lead`. Confirmed by direct file-existence check (`accessibility.md`, `legal-compliance.md`, `oracle.md`, `rd-lead.md` are all absent as standalone files — the first two are absent *because* they already live as overlays under `designer` and `security`; the latter two are absent with no overlay either).

This gives **13 existing base identities** (architect, business-strategist, data-analyst, debugger, designer, engineer, operations, orchestrator, product-manager, qa, researcher, reviewer, security) and **2 orphans with no skill-tree footprint at all** (oracle, rd-lead).

---

## 2. Per-specialist notes (all 29, from `specialists/org/specialists/*.json`)

| Specialist | Role/goal (from `displayName`) | modelTier / reasoningEffort | Fence (allowedPaths, abbreviated) | canEdit vs. claudeTools grants Edit/Write | Declared skills |
|---|---|---|---|---|---|
| cx-accessibility | Tests with a screen reader and keyboard, not just the spec | standard / medium | `docs/accessibility/**`, `docs/a11y/**` | `canEdit: false`; tools have no Edit/Write (consistent) | `frontend-design/accessibility`, `frontend-design/screen-reader-testing` |
| cx-ai-engineer | Designs for failure before designing for success | reasoning / high | `docs/ai/**`, `docs/specialists/**`, `specialists/**`, `skills/ai/**` | `canEdit: true`; tools include Edit,Write (consistent) | 6 `ai/*` skills |
| cx-architect | Makes trade-offs explicit before implementation locks them in | reasoning / high | `docs/decisions/adr/**`, `docs/rfc/**`, `docs/system-design/**` | `canEdit: false`; tools have no Edit/Write (consistent) | 5 `architecture/*` skills |
| cx-business-strategist | Asks whether we're building the right thing for the right market | standard / medium | `docs/strategy/**`, `.cx/knowledge/decisions/strategy/**` | `canEdit: false`; consistent | 4 `strategy/*` skills |
| cx-data-analyst | Measures carefully because measurement shapes behavior | standard / medium | `docs/analytics/**`, `.cx/analytics/**` | `canEdit: false`; tools include Bash (read-only querying implied, not stated) | `devops/observability`, `devops/database`, `operating/raw-data-structuring` |
| cx-data-engineer | Builds pipelines that can be trusted | standard / medium | `docs/data/**`, `docs/etl/**` | `canEdit: true`; consistent | `devops/data-engineering`, `devops/database`, `devops/observability`, `operating/raw-data-structuring` |
| cx-debugger | Traces to root cause before proposing a fix | reasoning / high | `docs/debug/**`, `tests/**` | `canEdit: true`; consistent | `quality-gates/verify-change`, `devops/observability`, `devops/performance` |
| cx-designer | Treats visual decisions as interaction decisions | standard / medium | `docs/design/**`, `docs/wireframes/**`, `design/**` | `canEdit: true`; consistent | 6 `frontend-design/*` skills (already includes `frontend-design/accessibility`) |
| cx-devil-advocate | Makes the plan survive contact with reality | reasoning / high | `docs/critiques/**` | `canEdit: false`; consistent | `quality-gates/review-work`, `quality-gates/premortem` |
| cx-docs-keeper | Owns the record of why, not just what | standard / medium | `docs/**`, `**/README.md`, `CHANGELOG.md` (widest fence of any specialist) | `canEdit: true`; consistent | 5 `docs/*` skills |
| cx-engineer | Reads before writing | standard / medium | `lib/**`, `bin/**`, `src/**`, `app/**`, `tests/**`, `docs/**` | `canEdit: true`; consistent | 19 skills across `development/*`, `frameworks/*`, `exploration/*`, `quality-gates/verify-change`, `utility/clean-code` |
| cx-evaluator | Defines what "better" means before the work is done | standard / medium | `docs/evals/**`, `.cx/evals/**`, `tests/evals/**` | `canEdit: false`; consistent | `ai/prompt-and-eval`, `quality-gates/verify-quality` |
| cx-explorer | Reads before concluding | **fast** / medium (only fast-tier specialist of the 29) | `docs/explorations/**`, `.cx/explorations/**` | `canEdit: false`; consistent | `docs/codebase-research-workflow`, 3 `exploration/*` skills |
| cx-legal-compliance | Catches compliance risk before the architecture locks | standard / medium | `docs/legal/**`, `docs/compliance/**`, `docs/security/**`, `.cx/knowledge/**` | `canEdit: false`; consistent; tools include WebSearch/WebFetch | 4 `compliance/*` skills |
| cx-operations | Maps dependencies, sequences, and ownership | standard / medium | `docs/ops/**`, `docs/operations/**` | **`canEdit: false`, but claudeTools list includes `Edit,Write` — internal inconsistency, noted verbatim** | `roles/operations` (explicit self-reference), `docs/init-project`, 3 `operating/*` skills |
| cx-oracle | Meta-controller synthesizing fleet-health gaps, routing remediation | reasoning / high | `{}` (empty — no allowedPaths at all) | no canEdit field; tools have no Edit/Write | Only 3 skills, **all borrowed**: `ai/orchestration-workflow` (Orchestrator's own), `exploration/dependency-graph-reading` (generic), **`roles/trace-reviewer`** (explicitly the Reviewer role's trace overlay) |
| cx-orchestrator | Sees the whole board, routes work in sequence | standard / medium | `docs/**`, `plan.md`, `.cx/context.md` | `canEdit` not set; tools have no Edit/Write | `ai/orchestration-workflow`, `operating/orchestration-reference`, `operating/change-management`, `operating/unstructured-triage` |
| cx-platform-engineer | Reduces the tax on the people doing the work | standard / medium | `docs/platform/**`, `docs/infra/**`, `infra/**`, `terraform/**`, `k8s/**` | `canEdit: true`; consistent | 6 `devops/*` skills |
| cx-product-manager | Translates user reality into technical deliverables | reasoning / high | `docs/specs/prd/**`, `docs/prd/**`, `docs/prfaq/**`, `.cx/knowledge/**` | `canEdit: false`; consistent; **tools lack WebSearch/WebFetch and Bash** | 9 `docs/*` workflow skills |
| cx-qa | Asks whether the tests test what matters | standard / medium | `docs/qa/**`, `docs/test-plans/**` | `canEdit: true`; consistent | `devops/testing`, `quality-gates/verify-change`, `quality-gates/verify-module` |
| cx-rd-lead | Slows the team down at the right moment | standard / medium | `docs/notes/research/**`, `docs/research/**`, `docs/experiments/**` | `canEdit: false`; consistent | `ai/agent-dev`, `ai/prompt-and-eval`, `docs/research-workflow` |
| cx-release-manager | Guards the gap between "verified" and "safe to ship" | standard / medium | `docs/operations/releases/**`, `docs/releases/**`, `CHANGELOG.md` | `canEdit: true`; consistent | `devops/git-workflow`, `quality-gates/verify-change`, `docs/memo-and-decision-capture` |
| cx-researcher | Never trusts recall alone | standard / medium | `docs/notes/research/**`, `docs/research/**`, `.cx/research/**` | `canEdit: false`; consistent; `liveWebAccess: true` | `docs/research-workflow`, `devops/dependency-management`, `docs/transcript-synthesis` |
| cx-reviewer | Finds bugs by looking at conditions the author didn't test for | reasoning / high | `docs/reviews/**` | **`canEdit: true`, but claudeTools list has no Edit/Write — internal inconsistency, noted verbatim** | `quality-gates/verify-quality`, `quality-gates/review-work`, `quality-gates/verify-module` |
| cx-security | Thinks like an attacker | reasoning / high | `docs/security/**`, `docs/threat-models/**` | **`canEdit: true`, but claudeTools list has no Edit/Write — same inconsistency pattern as cx-reviewer** | 6 `security/*` skills, `quality-gates/verify-security`, `architecture/security-arch` |
| cx-sre | Plans for failure before it happens | standard / medium | `docs/operations/runbooks/**`, `docs/incidents/**`, `docs/postmortems/**` | `canEdit: true`; consistent | 4 `devops/*` skills |
| cx-test-automation | Knows that bad automation is worse than no automation | standard / medium | `tests/**`, `docs/test-automation/**` | `canEdit: true`; consistent | `devops/testing`, `quality-gates/verify-change`, `quality-gates/verify-module` (identical list to cx-qa) |
| cx-trace-reviewer | Tracks fleet-level performance patterns | reasoning / high | `docs/traces/**`, `.cx/traces/**` | `canEdit: true`; tools include Write (not Edit) | `ai/prompt-optimizer`, `ai/trace-triage` |
| cx-ux-researcher | Brings user reality into the room | standard / medium | `docs/ux-research/**`, `.cx/ux-research/**` | `canEdit: false`; consistent; narrowest tool list of the 29 (no Bash, no WebSearch/WebFetch) | `docs/user-research-workflow`, `docs/evidence-ingest-workflow`, `strategy/jobs-to-be-done` |

---

## 3. Handoff graph (all 43 contracts, `specialists/org/contracts/*.json`)

Producer → consumer, with each side's proposed core role (Section 4) annotated. **Intra-role** means both sides land in the same proposed role (a strong candidate to collapse into a self-check rather than stay a cross-role delegation spec); **inter-role** means they stay genuinely separate.

| Contract | Producer → Consumer | Producer role → Consumer role | Intra/Inter |
|---|---|---|---|
| accessibility-to-qa | accessibility → qa | Designer → QA | Inter |
| any-to-business-strategist | * → business-strategist | * → Product Manager | Inter |
| any-to-debugger | * → debugger | * → Debugger | Inter |
| any-to-designer | * → designer | * → Designer | Inter |
| any-to-docs-keeper | * → docs-keeper | * → Operations | Inter |
| any-to-explorer | * → explorer | * → Researcher | Inter |
| any-to-sre-incident | * → sre | * → Operations | Inter |
| any-to-trace-reviewer | * → trace-reviewer | * → Reviewer | Inter |
| architect-to-ai-engineer | architect → ai-engineer | Architect → Engineer | Inter |
| architect-to-data-engineer | architect → data-engineer | Architect → Engineer | Inter |
| architect-to-devil-advocate | architect → devil-advocate | Architect → Reviewer | Inter |
| architect-to-engineer | architect → engineer | Architect → Engineer | Inter |
| architect-to-evaluator | architect → evaluator | Architect → Reviewer | Inter |
| architect-to-legal-compliance | architect → legal-compliance | Architect → Security | Inter |
| architect-to-operations | architect → operations | Architect → Operations | Inter |
| architect-to-platform-engineer | architect → platform-engineer | Architect → Engineer | Inter |
| business-strategist-to-product-manager | business-strategist → product-manager | Product Manager → Product Manager | **Intra** (validates the proposed PM merge directly) |
| construct-to-orchestrator | construct → orchestrator | (outside roster) → Orchestrator | Inter |
| construct-to-rd-lead | construct → rd-lead | (outside roster) → Architect (rd-lead retiring) | Inter, but rd-lead's retirement folds this into Architect's own framing discipline |
| data-analyst-to-product-manager | data-analyst → product-manager | Data Analyst → Product Manager | Inter |
| data-engineer-to-platform-engineer | data-engineer → platform-engineer | Engineer → Engineer | **Intra** |
| designer-to-accessibility | designer → accessibility | Designer → Designer | **Intra** (validates the proposed Designer+Accessibility merge directly) |
| engineer-to-qa | engineer → qa | Engineer → QA | Inter |
| engineer-to-reviewer | engineer → reviewer | Engineer → Reviewer | Inter |
| explorer-to-engineer | explorer → engineer | Researcher → Engineer | Inter |
| legal-compliance-to-release-manager | legal-compliance → release-manager | Security → Operations | Inter |
| operations-tpm-briefing (`operations-to-user.json`) | operations → user | Operations → (outside roster) | Inter |
| operations-triage-output | operations → user | Operations → (outside roster) | Inter |
| platform-engineer-to-engineer | platform-engineer → engineer | Engineer → Engineer | **Intra** |
| pm-requirements-candidates | product-manager → user | Product Manager → (outside roster) | Inter |
| product-manager-to-architect | product-manager → architect | Product Manager → Architect | Inter |
| product-manager-to-data-analyst | product-manager → data-analyst | Product Manager → Data Analyst | Inter |
| product-manager-to-ux-researcher | product-manager → ux-researcher | Product Manager → Researcher | Inter |
| qa-to-release-manager | qa → release-manager | QA → Operations | Inter |
| qa-to-test-automation | qa → test-automation | QA → QA | **Intra** |
| rd-lead-to-architect | rd-lead → architect | Architect (retiring) → Architect | **Intra**, contingent on the rd-lead retirement call in Section 5 |
| researcher-to-architect | researcher → architect | Researcher → Architect | Inter |
| researcher-to-product-manager | researcher → product-manager | Researcher → Product Manager | Inter |
| reviewer-to-security | reviewer → security | Reviewer → Security | Inter |
| sre-to-release-manager | sre → release-manager | Operations → Operations | **Intra** |
| test-automation-to-engineer | test-automation → engineer | QA → Engineer | Inter |
| trace-reviewer-to-sre | trace-reviewer → sre | Reviewer → Operations | Inter |
| user-to-construct | user → construct | (outside roster) | Inter |

**Estimate**: of the 43 contracts, **6 collapse cleanly to intra-role** (business-strategist→product-manager, data-engineer→platform-engineer, designer→accessibility, platform-engineer→engineer, qa→test-automation, sre→release-manager), plus a 7th (rd-lead→architect) if the rd-lead retirement call in Section 5 is accepted. The remaining **~36-37 stay genuine inter-role delegation specs** — the roster shrinks by more than half (29→12) but the coordination graph does not shrink proportionally, because most of today's handoffs cross what will still be separate roles even after consolidation. This is a rough estimate for grouping rationale only, not the delegation-spec rewrite itself (out of scope per the Constraints section above).

---

## 4. Proposed roster: Orchestrator + 12 core roles

Primary proposal, matching the existing `skills/roles/` inheritance structure directly (Section 1). Total named roles: **13** (1 orchestrator + 12 workers), which is one over the top of ADR-0065's "8-12" if that count includes the orchestrator, or exactly at the top of the range if the orchestrator is additional to the "core roster" count (the ADR's own phrasing — "an orchestrator plus a small core roster" — reads as the latter). Section 5 flags the specific merges that would tighten this further if a reviewer wants a strictly-8-12-including-orchestrator count.

### Orchestrator
**Maps in**: cx-orchestrator (anchor), cx-oracle (retired, folded in — see Section 5)
**Role description**: The dispatcher. Classifies incoming work, builds the dependency graph among whatever roles a task needs, sequences and bounds fan-out (parallel only for read-only breadth-first work, per ADR-0065's Decision), and now also absorbs oracle's fleet-health synthesis — noticing systemic gaps (parity drift, contract violations, stale alignment data) and routing remediation to the owning role, since oracle's own declared skills were already just orchestrator's own orchestration skill plus a borrowed reference to the trace-reviewer overlay (now under Reviewer).
**modelTier/fence resolution**: orchestrator alone is standard/medium; oracle alone was reasoning/high with an empty fence. Since fleet-health synthesis (the absorbed duty) is higher-stakes reasoning than routine dispatch, the merged role should run at standard/medium by default and escalate to reasoning/high specifically when doing fleet-health synthesis — a task-conditional tier, which is really a flow-engine (ADR-0067) per-step concern rather than something one fixed persona tier can express well. Fence: orchestrator's own (`docs/**`, `plan.md`, `.cx/context.md`) carries forward; oracle had none to reconcile.
**Skill bundles**: `ai/orchestration-workflow`, `operating/orchestration-reference`, `operating/change-management`, `operating/unstructured-triage`, `exploration/dependency-graph-reading` (from oracle).

### Architect
**Maps in**: cx-architect (anchor), cx-rd-lead (retired, folded in — see Section 5)
**Role description**: Owns trade-off analysis and ADR/RFC authorship before implementation locks in a direction. Absorbs rd-lead's pre-architecture framing-gate function (hypothesis, key unknowns, evidence threshold) as part of its own upfront discipline, since rd-lead never had its own skill file and `architect.md`'s own description already names `cx-rd-lead` as sharing this role.
**modelTier/fence resolution**: architect reasoning/high vs. rd-lead standard/medium — carry forward reasoning/high, since the merged role's job (locking in decisions that are expensive to reverse) is exactly the higher-stakes half of the two. Fence: architect's own (`docs/decisions/adr/**`, `docs/rfc/**`, `docs/system-design/**`) plus rd-lead's (`docs/research/**`, `docs/experiments/**`) as a union, since framing briefs now live inside the architect's own pipeline.
**Skill bundles**: `architecture/api-design`, `architecture/caching`, `architecture/cloud-native`, `architecture/message-queue`, `architecture/security-arch`, plus rd-lead's `ai/agent-dev`, `ai/prompt-and-eval`, `docs/research-workflow` when doing early framing.

### Reviewer
**Maps in**: cx-reviewer (anchor), cx-devil-advocate, cx-evaluator, cx-trace-reviewer — matching `reviewer.md`'s own `applies_to` list exactly.
**Role description**: The adversarial/critical-review lens across three phases: post-implementation code review (reviewer core), pre-implementation plan challenge (devil-advocate overlay), AI/eval-specific scoring rigor (evaluator overlay), and fleet-level trace-anomaly detection (trace-reviewer overlay). All four already inherit from the same `reviewer` base skill file, so this merge changes no skill content, only persona count.
**modelTier/fence resolution**: 3 of 4 (reviewer, devil-advocate, trace-reviewer) are reasoning/high; evaluator alone is standard/medium — carry forward reasoning/high as the default, with the AI-eval skill bundle able to run lighter for routine eval-set scoring. `canEdit` is genuinely mixed and internally inconsistent in the source data: reviewer's file says `canEdit: true` but its `claudeTools` list has no Edit/Write; devil-advocate and evaluator say `canEdit: false` (consistent with their tools); trace-reviewer says `canEdit: true` and its tools include `Write` (not `Edit`). Net resolution: default the merged role to **no direct Edit**, matching the majority behavior and the role's core nature as an analysis-and-report function, and flag the reviewer/trace-reviewer `canEdit:true` fields as pre-existing inconsistencies that this merge does not need to preserve. Fence: union of `docs/reviews/**`, `docs/critiques/**`, `docs/evals/**`, `.cx/evals/**`, `tests/evals/**`, `docs/traces/**`, `.cx/traces/**`.
**Skill bundles**: `quality-gates/verify-quality`, `quality-gates/review-work`, `quality-gates/verify-module`, `quality-gates/premortem` (devil-advocate), `ai/prompt-and-eval` (evaluator), `ai/prompt-optimizer`, `ai/trace-triage` (trace-reviewer).

### Engineer
**Maps in**: cx-engineer (anchor), cx-ai-engineer, cx-data-engineer, cx-platform-engineer — matching `engineer.md`'s inheritance tree exactly (all three declare `inherits: engineer`).
**Role description**: General implementation across application code, AI/agent code, data pipelines, and platform/infra tooling — the same "reads before writing" discipline applied to whichever surface the task's skill bundle targets.
**modelTier/fence resolution**: base engineer, data-engineer, platform-engineer are all standard/medium; ai-engineer alone is reasoning/high. Carry the base at standard/medium (matches 3 of 4 and matches `engineer.md` being the literal base identity), and let the AI-engineering skill bundle escalate the effective tier to reasoning/high when active, consistent with ai-engineer's own stated premise ("it works in the demo" risk needs harder reasoning about failure modes). Fence is a genuine point of tension: engineer's own fence already permits unapproved edits to `lib/**` and `bin/**` (they're in its `allowedPaths`), but ai-engineer, data-engineer, and platform-engineer each separately *require approval* before editing `lib/**`/`bin/**`. Resolution proposed here: keep engineer's permissive stance for `lib/**`/`bin/**` (that's the role's central job) and keep only the narrower approval list this project's own CLAUDE.md calls out as protected — `specialists/org`, `lib/setup.mjs`, `claude/settings.template.json` — regardless of which skill bundle is active. **This changes effective permissions for AI/data/platform work relative to today's separate personas and should get explicit reviewer sign-off**, not just a skill-bundle load.
**Skill bundles**: engineer's 19 skills (development/*, frameworks/*, exploration/*, quality-gates/verify-change, utility/clean-code) as the default load; `ai/agent-dev`, `ai/rag-system`, `ai/llm-security`, `ai/prompt-and-eval`, `ai/prompt-optimizer`, `ai/ml-ops` when the task is AI/agent work; `devops/data-engineering`, `devops/database` when the task is pipeline work; `devops/ci-cd`, `devops/monorepo`, `devops/containerization`, `devops/dependency-management`, `devops/devsecops`, `devops/cost-optimization` when the task is platform/infra work.

### Debugger
**Maps in**: cx-debugger only — no overlay exists in `skills/roles/` (its file has `inherits: null` and no other file declares `inherits: debugger`), and it has its own universal entry contract (`any-to-debugger`) distinct from the implementation contracts that feed Engineer.
**Role description**: Root-cause investigation before a fix is proposed — reproduces or traces the bug first, then hands a confirmed root cause to Engineer. Kept as its own role rather than folded into Engineer specifically because its precondition discipline (no symptom-only fixes) and its universal dispatch trigger are structurally different from "implement this task."
**modelTier/fence**: reasoning/high, unchanged; fence `docs/debug/**`, `tests/**`, unchanged.
**Skill bundles**: `quality-gates/verify-change`, `devops/observability`, `devops/performance`.
(Section 5 flags the alternative of folding this into Engineer as a debugging skill bundle instead — genuinely arguable, not adopted here.)

### QA
**Maps in**: cx-qa (anchor), cx-test-automation — matching `qa.md`'s own `applies_to` list, which already includes both.
**Role description**: Verifies that implementation work actually does what it claims, from manual/exploratory test-plan design through to automated-suite construction and flake management.
**modelTier/fence**: both standard/medium — no conflict. Fence union: `docs/qa/**`, `docs/test-plans/**`, `tests/**`, `docs/test-automation/**`.
**Skill bundles**: `devops/testing`, `quality-gates/verify-change`, `quality-gates/verify-module` (identical skill list already shared by both legacy specialists — direct evidence the merge changes nothing substantive).

### Security
**Maps in**: cx-security (anchor), cx-legal-compliance — matching `security.md`'s own `applies_to` list, which already includes both.
**Role description**: Attack-surface and compliance risk analysis together — thinking like an attacker on the technical side, and like a regulator/auditor on the legal/privacy side, since both are "catch it before it locks in" review functions gating the same release decision (`legal-compliance-to-release-manager` and `reviewer-to-security` both feed governance-adjacent handoffs).
**modelTier/fence resolution**: security reasoning/high vs. legal-compliance standard/medium — carry forward reasoning/high, since compliance risk assessment (per legal-compliance's own displayName, "catches compliance risk before the architecture locks") is exactly the higher-stakes half. Tool note: legal-compliance's tools include WebSearch/WebFetch (for looking up regulations) which security's tools lack — the merged role should carry that forward, since compliance research needs live lookup and security currently has none. Fence union: `docs/security/**`, `docs/threat-models/**`, `docs/legal/**`, `docs/compliance/**`, `.cx/knowledge/**`.
**Skill bundles**: `security/red-team`, `security/blue-team`, `security/pentest`, `security/code-audit`, `security/vuln-research`, `security/threat-intel`, `quality-gates/verify-security`, `architecture/security-arch`, plus `compliance/license-audit`, `compliance/data-privacy`, `compliance/ai-disclosure`, `compliance/regulatory-review` from legal-compliance.

### Operations
**Maps in**: cx-operations (anchor), cx-sre, cx-release-manager, cx-docs-keeper — matching `operations.md`'s description (which names all three overlays) and each overlay's own `inherits: operations`.
**Role description**: Delivery logistics end to end — dependency/ownership mapping (operations core), incident readiness and reliability (sre overlay), release choreography and rollback (release-manager overlay), and documentation currency (docs-keeper overlay). All four already sit in `operations-team`/`operations-group` and already inherit the same base skill file.
**modelTier/fence**: all four are standard/medium — no tier conflict. `canEdit` is genuinely mixed and inconsistent in the source: operations says `canEdit: false` but its `claudeTools` list includes `Edit,Write` (an inconsistency in the source file, noted verbatim); sre, release-manager, and docs-keeper all say `canEdit: true` and their tools match. Net: 3 of 4 plus operations's own tool grant argue for `canEdit: true` on the merged role. Fence: docs-keeper's is already the widest (`docs/**`, `**/README.md`, `CHANGELOG.md`) and effectively absorbs the other three's narrower `docs/ops/**`, `docs/operations/runbooks/**`, `docs/operations/releases/**`.
**Skill bundles**: `roles/operations` (operations's own self-reference), `docs/init-project`, `operating/incident-response`, `operating/oncall-rotation`, `operating/change-management`, plus sre's `devops/observability`, `devops/ci-cd`, `devops/performance`, `devops/incident-response`; release-manager's `devops/git-workflow`, `docs/memo-and-decision-capture`; docs-keeper's `docs/adr-workflow`, `docs/runbook-workflow`, `docs/init-docs`, `docs/document-ingest-workflow`.

### Product Manager
**Maps in**: cx-product-manager (anchor), cx-business-strategist (flagged ambiguous — see Section 5)
**Role description**: Translates strategic context and market/user evidence into PRDs and prioritized requirements. Absorbs business-strategist's strategic-memo function as the upstream-most step of its own PRD pipeline, since `business-strategist-to-product-manager` is the one contract in the entire graph whose producer and consumer would already be the same role under this merge (Section 3) — the strongest single piece of intra-role evidence found.
**modelTier/fence resolution**: product-manager reasoning/high vs. business-strategist standard/medium — carry forward reasoning/high. Tool note: business-strategist's tools include WebSearch/WebFetch which product-manager's own tools currently lack entirely (product-manager also lacks Bash) — carrying WebSearch/WebFetch forward is a genuine capability gain for PM's competitive/market-research work that today's split personas don't cleanly offer. Fence union: `docs/specs/prd/**`, `docs/prd/**`, `docs/prfaq/**`, `.cx/knowledge/**`, `docs/strategy/**`, `.cx/knowledge/decisions/strategy/**`.
**Skill bundles**: PM's 9 `docs/*` workflow skills, plus business-strategist's `strategy/competitive-landscape`, `strategy/market-research-methods`, `strategy/pricing-positioning`, `strategy/narrative-arc`.

### Data Analyst
**Maps in**: cx-data-analyst only, standalone — `data-analyst.md` has `inherits: null` and is not nested under any other base in the skill tree, and two of its own overlays cross-apply to *both* `cx-product-manager` (`data-analyst.product-intelligence.md`) *and* `cx-sre` (`data-analyst.telemetry.md`) — evidence it is a genuinely cross-cutting analytical function serving multiple downstream roles rather than belonging to just one of them.
**Role description**: Metrics and measurement design — defines what "better" means numerically, flags vanity metrics, and feeds both Product Manager (success metrics for a PRD) and Operations/SRE (telemetry analysis) without becoming either.
**modelTier/fence**: standard/medium, `docs/analytics/**`, `.cx/analytics/**`, unchanged.
**Skill bundles**: `devops/observability`, `devops/database`, `operating/raw-data-structuring`.
(Section 5 flags the alternative of folding this into Product Manager instead — the contract graph argues for it even though the skill tree argues against it.)

### Designer
**Maps in**: cx-designer (anchor), cx-accessibility — matching `designer.md`'s own `applies_to` list, which already includes both, and validated directly by the `designer-to-accessibility` contract being intra-role under this merge (Section 3).
**Role description**: Visual and interaction design across all states (not just the happy path), with accessibility testing (screen reader, keyboard) as an integral discipline rather than a separate downstream check.
**modelTier/fence resolution**: both standard/medium — no conflict. `canEdit`: designer `true`, accessibility `false` (consistent with its own tools) — resolving to `true` for the merged role, since a11y fixes are often small, direct edits once the two functions share one identity; this is a permission-scope increase for accessibility work relative to the standalone accessibility persona and should be called out to reviewers, not silently inherited. Fence union: `docs/design/**`, `docs/wireframes/**`, `design/**`, `docs/accessibility/**`, `docs/a11y/**`.
**Skill bundles**: designer's 6 `frontend-design/*` skills (already includes `frontend-design/accessibility`), plus `frontend-design/screen-reader-testing` from accessibility.

### Researcher
**Maps in**: cx-researcher (anchor), cx-explorer, cx-ux-researcher — matching `researcher.md`'s own `applies_to` list, which already includes all three.
**Role description**: Read-only, citation-disciplined investigation before anyone acts on a claim — of the codebase (explorer overlay), of the external world (researcher core, live web access), or of users (ux-researcher overlay). This is also the role ADR-0065 calls out as the legitimate target for parallel fan-out, since all three legacy specialists are explicitly no-edit and breadth-first.
**modelTier/fence resolution**: **the one genuine tension in this merge** — explorer is the *only* fast-tier specialist among all 29 (researcher and ux-researcher are both standard/medium). Collapsing explorer into a standard-tier Researcher risks losing the cost/speed profile that made it the right tool for cheap, parallelizable codebase reads — precisely the regime ADR-0065's Rationale says is worth the multi-agent cost. Proposed resolution: the base Researcher role defaults to fast tier for codebase-exploration tasks and escalates to standard tier for external-research or UX-research tasks — again a task-conditional tier that argues for the flow engine (ADR-0067) assigning tier per step rather than per persona. Fence union: `docs/notes/research/**`, `docs/research/**`, `.cx/research/**`, `docs/evidence-briefs/**`, `docs/signal-briefs/**`, `docs/explorations/**`, `.cx/explorations/**`, `docs/ux-research/**`, `.cx/ux-research/**`.
**Skill bundles**: `docs/research-workflow`, `devops/dependency-management`, `docs/transcript-synthesis` (researcher core); `docs/codebase-research-workflow`, `exploration/repo-map`, `exploration/unknown-codebase-onboarding`, `exploration/tracer-bullet-method`, `exploration/dependency-graph-reading` (explorer); `docs/user-research-workflow`, `docs/evidence-ingest-workflow`, `strategy/jobs-to-be-done` (ux-researcher).

---

## 5. Classification of all 29 legacy specialists

**(a) = maps to a core role as its anchor identity. (b) = becomes an additive skill bundle on a role of a different name. (c) = retirement candidate.**

| # | Legacy specialist | Classification | Target | Rationale (traced to source) |
|---|---|---|---|---|
| 1 | cx-accessibility | (b) | Designer | `designer.md` already lists `cx-accessibility` in `applies_to`; `designer.json` already loads `frontend-design/accessibility` itself; `designer-to-accessibility` contract is intra-role under this merge |
| 2 | cx-ai-engineer | (b) | Engineer | `ai-engineer.md` declares `inherits: engineer` |
| 3 | cx-architect | (a) | Architect | anchor; unchanged core identity |
| 4 | cx-business-strategist | (b), flagged ambiguous | Product Manager | `business-strategist-to-product-manager` contract is intra-role under this merge; but `business-strategist.md` itself has `inherits: null` (standalone in the skill tree today) — see Section 6 tension #1 |
| 5 | cx-data-analyst | (a) | Data Analyst | anchor; kept standalone because its own overlays cross-apply to both `cx-product-manager` and `cx-sre` — genuinely cross-cutting, not owned by either single downstream consumer; see Section 6 tension #2 |
| 6 | cx-data-engineer | (b) | Engineer | `data-engineer.md` declares `inherits: engineer`; `data-engineer-to-platform-engineer` contract is intra-role under this merge |
| 7 | cx-debugger | (a) | Debugger | anchor; no overlay exists for it in `skills/roles/`, kept standalone; see Section 6 tension #3 for the fold-into-Engineer alternative |
| 8 | cx-designer | (a) | Designer | anchor; unchanged core identity |
| 9 | cx-devil-advocate | (b) | Reviewer | `devil-advocate.md` declares `inherits: reviewer`; `reviewer.md`'s own `applies_to` already lists `cx-devil-advocate` |
| 10 | cx-docs-keeper | (b), flagged ambiguous | Operations | `docs-keeper.md` declares `inherits: operations`; but its trigger (`any-to-docs-keeper`) is universal (any producer), structurally different from operations/sre/release-manager's narrower triggers — see Section 6 tension #6 |
| 11 | cx-engineer | (a) | Engineer | anchor; unchanged core identity |
| 12 | cx-evaluator | (b) | Reviewer | `evaluator.md` declares `inherits: reviewer`; `qa.ai-eval.md` also names `cx-evaluator` alongside `cx-qa`/`cx-test-automation` — evaluator sits at the intersection of Reviewer and QA in the existing skill tree, evidence it was never a standalone base identity |
| 13 | cx-explorer | (b), flagged ambiguous | Researcher | `explorer.md` declares `inherits: researcher`; but is the only fast-tier specialist of the 29 — see Section 6 tension #7 |
| 14 | cx-legal-compliance | (b) | Security | `security.legal-compliance.md` exists and `security.md`'s own `applies_to` already lists `cx-legal-compliance`; no standalone `legal-compliance.md` file exists |
| 15 | cx-operations | (a) | Operations | anchor; unchanged core identity |
| 16 | cx-oracle | (c) retirement | folds into Orchestrator | no `oracle.md` file exists in `skills/roles/` at all; its own declared skills are `ai/orchestration-workflow` (Orchestrator's own), `exploration/dependency-graph-reading` (generic), and **`roles/trace-reviewer`** (explicitly borrowed from what is now the Reviewer role); fence is `{}` (empty) |
| 17 | cx-orchestrator | (a) | Orchestrator | anchor; unchanged core identity |
| 18 | cx-platform-engineer | (b) | Engineer | `platform-engineer.md` declares `inherits: engineer`; `platform-engineer-to-engineer` contract is intra-role under this merge |
| 19 | cx-product-manager | (a) | Product Manager | anchor; unchanged core identity |
| 20 | cx-qa | (a) | QA | anchor; unchanged core identity |
| 21 | cx-rd-lead | (c) retirement | folds into Architect | no `rd-lead.md` file exists in `skills/roles/` at all; `architect.md`'s own description text names `cx-rd-lead` as sharing the Architect role even though `applies_to` omits it; its trigger (`framingChallenge.required`) is the identical trigger key used by `architect-to-devil-advocate`, meaning today's system already gates the same condition through two separate specialists — see Section 6 tension #4 |
| 22 | cx-release-manager | (b) | Operations | `release-manager.md` declares `inherits: operations`; `sre-to-release-manager` contract is intra-role under this merge |
| 23 | cx-researcher | (a) | Researcher | anchor; unchanged core identity |
| 24 | cx-reviewer | (a) | Reviewer | anchor; unchanged core identity |
| 25 | cx-security | (a) | Security | anchor; unchanged core identity |
| 26 | cx-sre | (b) | Operations | `sre.md` declares `inherits: operations` |
| 27 | cx-test-automation | (b) | QA | `test-automation.md` declares `inherits: qa`; `qa.md`'s own `applies_to` already lists `cx-test-automation`; `qa-to-test-automation` contract is intra-role under this merge |
| 28 | cx-trace-reviewer | (b) | Reviewer | `trace-reviewer.md` declares `inherits: reviewer`; `reviewer.md`'s own `applies_to` already lists `cx-trace-reviewer` |
| 29 | cx-ux-researcher | (b) | Researcher | `ux-researcher.md` declares `inherits: researcher`; `researcher.md`'s own `applies_to` already lists `cx-ux-researcher` |

**Totals**: 12 mapped as anchors (a), 15 mapped as additive skill bundles (b), 2 retirement candidates (c). 12 + 15 + 2 = 29.

---

## 6. Ambiguous cases flagged for human decision

These are genuine tensions, not settled calls. Each has a defensible alternative; this document does not silently pick one.

1. **Business-strategist → Product Manager, or standalone?** The contract graph argues strongly for merging (`business-strategist-to-product-manager` is the one contract in the whole 43-contract graph that becomes fully intra-role under this proposal). But `business-strategist.md` in the existing skill tree has `inherits: null` — it was authored as its own base identity, not an overlay. If a reviewer weights the skill-tree evidence over the contract-graph evidence, business-strategist should stay a 13th standalone worker role, pushing the total roster to 13 (14 with orchestrator).

2. **Data Analyst: standalone, folded into Product Manager, or folded into Engineer (data-engineer) under one unified "Data" role?** This document keeps it standalone because two of its own overlays (`data-analyst.product-intelligence.md`, `data-analyst.telemetry.md`) cross-apply to both `cx-product-manager` and `cx-sre` — it is evidence-supported as genuinely cross-cutting. But its fence/tool profile (no-edit, analysis-only) is sharply different from data-engineer's (canEdit:true, pipeline-building), which argues against a unified "Data" role even though both carry the word "data." A reviewer could still choose to fold it into Product Manager on the strength of the `product-manager-to-data-analyst`/`data-analyst-to-product-manager` bidirectional contract pair, at the cost of losing its SRE-facing telemetry function or duplicating it elsewhere.

3. **Debugger: standalone, or folded into Engineer as a debugging skill bundle?** Kept standalone here because no `skills/roles/` overlay declares `inherits: debugger` (unlike ai-engineer/data-engineer/platform-engineer, which all explicitly inherit engineer) and because its dispatch trigger (`any-to-debugger`, a universal investigation-category trigger) is structurally different from the implementation-category triggers that feed Engineer. But its tool profile (canEdit:true, Read/Grep/Glob/LS/Bash/Edit) is otherwise nearly identical to Engineer's, and both sit in `engineering-group` — a reviewer could reasonably fold it in as a "debugging" skill bundle on Engineer instead.

4. **rd-lead: retire into Architect, or into Reviewer (via the devil-advocate overlay)?** This document retires rd-lead into Architect because `architect.md`'s own description names it. But rd-lead's actual output shape (framing-brief: problemStatement/hypothesis/keyUnknowns/evidenceThreshold) is arguably closer in *function* to devil-advocate's challenge-report (verdict/counterevidence/reframingProposals) than to anything architect itself produces — both are pre-implementation adversarial/framing gates fired by the same `framingChallenge.required` trigger. A reviewer could fold rd-lead's function into Reviewer's devil-advocate overlay instead of Architect.

5. **Oracle: retire into Orchestrator, or into Reviewer (via the trace-reviewer overlay)?** This document retires oracle into Orchestrator (routing/dispatch is oracle's stated primary function), but oracle's own skills array leans more heavily on `roles/trace-reviewer` (now under Reviewer) than on anything Orchestrator-specific. A reviewer could split oracle's two functions — fleet-anomaly detection to Reviewer, remediation routing to Orchestrator — rather than folding the whole thing into one place.

6. **Docs-Keeper: an Operations overlay, or its own standalone role, or not a persona at all?** `docs-keeper.md` already declares `inherits: operations`, and this document follows that. But docs-keeper's trigger (`any-to-docs-keeper`, firing whenever any producer changes core docs) is a universal, cross-cutting gate unlike sre/release-manager/operations's narrower triggers, and this repo's own CLAUDE.md treats "documentation is mandatory" as a discipline that applies to every role, not an operations-specific concern. A reviewer could keep Docs-Keeper standalone, or — once ADR-0067's flow engine exists — argue it should become an automatic flow-engine step (a "docs sync" gate) rather than a persona at all, which is a stronger version of "retire" than anything proposed in Section 5.

7. **Researcher's tier: uniform standard, or task-conditional fast/standard?** Explorer is the only fast-tier specialist among all 29. Folding it into a uniform standard-tier Researcher (as proposed) risks losing the cost/speed advantage that made codebase exploration cheap enough to be the parallel-fan-out-friendly case ADR-0065's Rationale specifically praises. The alternative is keeping Explorer split out as its own 13th/14th worker role specifically to preserve a categorically different tier, rather than treating tier as something a skill bundle can flip at dispatch time.

---

## 7. Summary

- Proposed roster: **Orchestrator + 12 core roles** — Architect, Reviewer, Engineer, Debugger, QA, Security, Operations, Product Manager, Data Analyst, Designer, Researcher (12 workers), plus Orchestrator itself (13 named roles total).
- This roster is not invented from scratch: it reproduces the base/overlay structure already present in `skills/roles/*.md` (13 base-identity files, 14 overlay files, 2 files entirely absent — oracle and rd-lead) almost exactly, which is why it is presented with high confidence.
- 12 of 29 legacy specialists map as role anchors, 15 become additive skill bundles on a role of a different name, and 2 (oracle, rd-lead) are retirement candidates whose function is already fully covered by other roles once this roster lands.
- 7 genuinely ambiguous calls are flagged in Section 6 for human decision; none of them is silently resolved above.
- Contract redesign is not attempted here. Section 3's estimate (6-7 of 43 contracts collapse to intra-role) is for grouping rationale only, per this document's Constraints.
