# Specialist & skill audit

Generated: 2026-07-13T19:30:40.601Z. Re-run `construct audit specialists --json` for the live matrix.

## Evidence tiers

Each rung requires genuine evidence at every rung below it — computed from real role-card,
prompt/contract, and role-overlay checks plus certification-store runs
(`lib/certification/evidence-tiers.mjs`), never a static declaration.

| Tier | What it means |
|---|---|
| `declared` | Exists in the live registry — the floor. |
| `structurally-valid` | Role card, prompt/contract audit, and role overlay all pass their static checks. |
| `behaviorally-tested` | A certification-store run passed a behavioral gate (not merely fixture-shape validation). |
| `live-tested` | Same, but scored by a non-hermetic model, not a skipped-provider inconclusive. |
| `host-proven` | A real orchestrated handoff completed with a passing contract check. |

## Specialists

| Specialist | Human equivalent | Outputs | Skills | Role overlay | Research | Tone | Evidence tier | Reason |
|---|---|---|---|---|---|---|---|---|
| cx-architect | Staff software architect | adr, rfc, rfc-platform, architecture-overview, system-design | 8 | roles/architect | external | decision-forcing-direct | structurally-valid | no certification run has ever been recorded for this specialist |
| cx-data-analyst | Product data analyst | — | 3 | roles/data-analyst | external | direct | structurally-valid | no certification run has ever been recorded for this specialist |
| cx-debugger | Senior debugger / SRE investigator | — | 3 | — | codebase | direct | structurally-valid | no certification run has ever been recorded for this specialist |
| cx-designer | Product designer | — | 7 | — | user | friendly | structurally-valid | no certification run has ever been recorded for this specialist |
| cx-engineer | Senior software engineer | — | 35 | roles/engineer | codebase | direct | structurally-valid | no certification run has ever been recorded for this specialist |
| cx-operations | Technical program manager | runbook, incident-report, postmortem, memo, changelog | 16 | — | — | direct | structurally-valid | no certification run has ever been recorded for this specialist |
| cx-orchestrator | Engineering program manager | — | 7 | — | — | direct | structurally-valid | no certification run has ever been recorded for this specialist |
| cx-product-manager | Senior product manager | prd, meta-prd, prfaq, one-pager, backlog-proposal, prd-platform, prd-business, customer-profile, strategy | 13 | roles/product-manager | user | decision-forcing-direct | structurally-valid | no certification run has ever been recorded for this specialist |
| cx-qa | QA lead | test-plan, qa-strategy | 3 | roles/qa | codebase | direct | structurally-valid | no certification run has ever been recorded for this specialist |
| cx-researcher | Research analyst | research-brief, evidence-brief, signal-brief, product-intelligence-report | 11 | — | external | direct | structurally-valid | no certification run has ever been recorded for this specialist |
| cx-reviewer | Staff engineer reviewer | — | 7 | roles/reviewer | codebase | direct | structurally-valid | no certification run has ever been recorded for this specialist |
| cx-security | Application security engineer | security-review, threat-model | 12 | — | compliance | direct | structurally-valid | no certification run has ever been recorded for this specialist |

## Role overlays

| Overlay | Structurally valid | Errors |
|---|---|---|
| roles/ai-engineer | yes | — |
| roles/architect.ai-systems | yes | — |
| roles/architect.data | yes | — |
| roles/architect.enterprise | yes | — |
| roles/architect.integration | yes | — |
| roles/architect | yes | — |
| roles/architect.platform | yes | — |
| roles/business-strategist | yes | — |
| roles/data-analyst.experiment | yes | — |
| roles/data-analyst | yes | — |
| roles/data-analyst.product-intelligence | yes | — |
| roles/data-analyst.product | yes | — |
| roles/data-analyst.telemetry | yes | — |
| roles/data-engineer | yes | — |
| roles/data-engineer.pipeline | yes | — |
| roles/data-engineer.vector-retrieval | yes | — |
| roles/data-engineer.warehouse | yes | — |
| roles/debugger | yes | — |
| roles/designer.accessibility | yes | — |
| roles/designer | yes | — |
| roles/devil-advocate | yes | — |
| roles/docs-keeper | yes | — |
| roles/engineer | yes | — |
| roles/evaluator | yes | — |
| roles/explorer | yes | — |
| roles/operations | yes | — |
| roles/orchestrator | yes | — |
| roles/platform-engineer | yes | — |
| roles/product-manager.ai-product | yes | — |
| roles/product-manager.enterprise | yes | — |
| roles/product-manager.growth | yes | — |
| roles/product-manager | yes | — |
| roles/product-manager.platform | yes | — |
| roles/product-manager.product | yes | — |
| roles/qa.ai-eval | yes | — |
| roles/qa.api-contract | yes | — |
| roles/qa.data-pipeline | yes | — |
| roles/qa | yes | — |
| roles/qa.web-ui | yes | — |
| roles/release-manager | yes | — |
| roles/researcher | yes | — |
| roles/reviewer | yes | — |
| roles/security.ai | yes | — |
| roles/security.appsec | yes | — |
| roles/security.cloud | yes | — |
| roles/security.legal-compliance | yes | — |
| roles/security | yes | — |
| roles/security.privacy | yes | — |
| roles/security.supply-chain | yes | — |
| roles/sre | yes | — |
| roles/test-automation | yes | — |
| roles/trace-reviewer | yes | — |
| roles/ux-researcher | yes | — |

## Cross-check issues

None.
