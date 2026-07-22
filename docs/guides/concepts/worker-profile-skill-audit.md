# Worker Profile & skill audit

Generated: 2026-07-18T22:36:36.925Z. Re-run `construct audit worker-profiles --json` for the current matrix.

## Evidence tiers

Each rung requires genuine evidence at every rung below it, computed from Worker Profile
cards, prompt contracts, perspectives, and certification-store runs.

| Tier | What it means |
|---|---|
| `declared` | Exists in the canonical registry. |
| `structurally-valid` | Worker Profile card, prompt contract, and perspective pass static checks. |
| `behaviorally-tested` | A certification run passed a behavioral gate. |
| `live-tested` | A non-hermetic model passed a behavioral gate. |
| `host-proven` | A real orchestrated handoff passed its contract check. |

## Worker Profiles

| Worker Profile | Human equivalent | Artifact classes | Skills | Perspective | Research | Tone | Evidence tier | Reason |
|---|---|---|---|---|---|---|---|---|
| architect | Staff software architect | adr, rfc, rfc-platform, architecture-overview, system-design | 10 | perspectives/architect | external | decision-forcing-direct | structurally-valid | no certification run has been recorded for this Worker Profile |
| data-analyst | Product data analyst | — | 6 | perspectives/data-analyst | external | direct | structurally-valid | no certification run has been recorded for this Worker Profile |
| debugger | Senior debugger / SRE investigator | — | 6 | — | codebase | direct | structurally-valid | no certification run has been recorded for this Worker Profile |
| designer | Product designer | — | 8 | — | user | friendly | structurally-valid | no certification run has been recorded for this Worker Profile |
| engineer | Senior software engineer | — | 36 | perspectives/engineer | codebase | direct | structurally-valid | no certification run has been recorded for this Worker Profile |
| operations | Technical program manager | runbook, incident-report, postmortem, memo, changelog | 18 | — | — | direct | structurally-valid | no certification run has been recorded for this Worker Profile |
| orchestrator | Engineering program manager | — | 8 | — | — | direct | structurally-valid | no certification run has been recorded for this Worker Profile |
| product-manager | Senior product manager | prd, meta-prd, prfaq, one-pager, backlog-proposal, prd-platform, prd-business, customer-profile, strategy | 15 | perspectives/product-manager | user | decision-forcing-direct | structurally-valid | no certification run has been recorded for this Worker Profile |
| qa | QA lead | test-plan, qa-strategy | 6 | perspectives/qa | codebase | direct | structurally-valid | no certification run has been recorded for this Worker Profile |
| researcher | Research analyst | research-brief, evidence-brief, signal-brief, product-intelligence-report | 12 | — | external | direct | structurally-valid | no certification run has been recorded for this Worker Profile |
| reviewer | Staff engineer reviewer | — | 7 | perspectives/reviewer | codebase | direct | structurally-valid | no certification run has been recorded for this Worker Profile |
| security | Application security engineer | security-review, threat-model | 12 | — | compliance | direct | structurally-valid | no certification run has been recorded for this Worker Profile |

## Perspectives

| Perspective | Structurally valid | Errors |
|---|---|---|
| perspectives/ai-engineer | yes | — |
| perspectives/architect.ai-systems | yes | — |
| perspectives/architect.data | yes | — |
| perspectives/architect.enterprise | yes | — |
| perspectives/architect.integration | yes | — |
| perspectives/architect | yes | — |
| perspectives/architect.platform | yes | — |
| perspectives/business-strategist | yes | — |
| perspectives/data-analyst.experiment | yes | — |
| perspectives/data-analyst | yes | — |
| perspectives/data-analyst.product-intelligence | yes | — |
| perspectives/data-analyst.product | yes | — |
| perspectives/data-analyst.telemetry | yes | — |
| perspectives/data-engineer | yes | — |
| perspectives/data-engineer.pipeline | yes | — |
| perspectives/data-engineer.vector-retrieval | yes | — |
| perspectives/data-engineer.warehouse | yes | — |
| perspectives/debugger | yes | — |
| perspectives/designer.accessibility | yes | — |
| perspectives/designer | yes | — |
| perspectives/devil-advocate | yes | — |
| perspectives/docs-keeper | yes | — |
| perspectives/engineer | yes | — |
| perspectives/evaluator | yes | — |
| perspectives/explorer | yes | — |
| perspectives/operations | yes | — |
| perspectives/orchestrator | yes | — |
| perspectives/platform-engineer | yes | — |
| perspectives/product-manager.ai-product | yes | — |
| perspectives/product-manager.enterprise | yes | — |
| perspectives/product-manager.growth | yes | — |
| perspectives/product-manager | yes | — |
| perspectives/product-manager.platform | yes | — |
| perspectives/product-manager.product | yes | — |
| perspectives/qa.ai-eval | yes | — |
| perspectives/qa.api-contract | yes | — |
| perspectives/qa.data-pipeline | yes | — |
| perspectives/qa | yes | — |
| perspectives/qa.web-ui | yes | — |
| perspectives/release-manager | yes | — |
| perspectives/researcher | yes | — |
| perspectives/reviewer | yes | — |
| perspectives/security.ai | yes | — |
| perspectives/security.appsec | yes | — |
| perspectives/security.cloud | yes | — |
| perspectives/security.legal-compliance | yes | — |
| perspectives/security | yes | — |
| perspectives/security.privacy | yes | — |
| perspectives/security.supply-chain | yes | — |
| perspectives/sre | yes | — |
| perspectives/test-automation | yes | — |
| perspectives/trace-reviewer | yes | — |
| perspectives/ux-researcher | yes | — |

## Cross-check issues

None.
