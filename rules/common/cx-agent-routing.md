<!--
rules/common/cx-agent-routing.md — auto-trigger routing rules for cx-* specialist agents.

Defines when to route directly to a cx-* specialist vs through Construct orchestration.
Covers intent-based routing table, complexity gate, and routing rules.
Loaded by rule-loading systems that look for cx-agent-routing in the rules hierarchy.
-->
# cx-* Agent Routing — Auto-trigger Rules

When a request matches the trigger patterns below, automatically route to the corresponding cx-* specialist or persona before responding.

**Default: execute, don't plan.** Most tasks go directly to the right specialist. Route through Construct orchestration only for genuinely complex, multi-workstream work.

---

## Complexity Gate

**Simple/bounded → specialist directly:**
- Bug fix or regression (root cause diagnosable from description)
- Change scoped to known files with clear outcome
- Refactor within existing patterns

**Complex/uncertain → Construct orchestration (or cx-orchestrator):**
- New feature requiring new data models or cross-system API contracts
- Work spanning multiple workstreams
- Ambiguous scope where approaches produce meaningfully different outcomes

---

## By Intent Type

| Request shape | Route | Notes |
|---|---|---|
| "explain / what is / how does" | Research (cx-researcher) | handles both general research and library/API docs |
| "build / add / implement (simple)" | Implementation (cx-engineer) directly | no planning chain needed |
| "build / add / implement (complex)" | Plan → Implement → Validate | full pipeline |
| unclear scope, missing requirements | Planning (cx-product-manager, cx-ux-researcher) | requirements before implementation |
| "broken / failing / error" | Research (cx-debugger) → Implementation (cx-engineer) | debug first, then fix |
| "review / audit / check code" | Validation (cx-reviewer) | cx-security for auth/secrets/payments |
| "plan / design / architect" | Planning (cx-architect) | challenge with cx-devil-advocate for risky changes |
| "test / verify / coverage" | Validation (cx-qa) | |
| "release / deploy / rollout" | Operations (cx-release-manager) | |
| "metrics / measure / instrument" | Planning (cx-data-analyst) | |
| "performance / SLO / alert / monitor" | Operations (cx-sre) | |
| "prompt / model / RAG / agent workflow" | Implementation (cx-ai-engineer) | require cx-evaluator before shipping |
| "accessibility / a11y / screen reader" | Validation (cx-accessibility) | |
| "docs / runbook / decision record" | Research (cx-docs-keeper) | |
| "explore / trace / investigate code" | Research (cx-explorer) | read-only before changes |

---

## Routing Rules

1. **Match on intent, not exact string.** "Can we ship this?" triggers operations routing.
2. **Security and auth always get cx-security.** No exceptions for auth, payments, secrets.
3. **Broken things go to cx-debugger first.** Don't plan a fix before root cause is confirmed.
4. **Skip cx-devil-advocate for routine changes.** Only invoke for genuinely novel or risky decisions.
5. **Require cx-devil-advocate for persistent capability changes.** Any promotion of a temporary overlay/capability into a reusable Construct capability must include a devil's advocate challenge before approval.
6. **Explorer for unknown territory.** When the codebase area is unfamiliar, route to cx-explorer first.
7. **Unclear requirements always stop at planning.** If missing acceptance criteria or ambiguous scope, route to cx-product-manager or cx-ux-researcher before implementation.
8. **Read once per conversation.** No need to re-read this file if already loaded.
9. **Research follows the common research policy.** Research, evidence synthesis, and doc-grounding tasks should apply `rules/common/research.md` before treating claims as decision-ready.
