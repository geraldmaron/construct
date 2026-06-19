# Specialist & skill audit

Generated: 2026-06-19T04:26:52.159Z. Re-run `construct audit specialists --json` for the live matrix.

## Specialists

| Specialist | Human equivalent | Outputs | Skills | Role overlay | Research | Tone | Grade | Gap |
|---|---|---|---|---|---|---|---|---|
| cx-orchestrator | Engineering program manager | — | 4 | — | — | direct | strong | — |
| cx-oracle | Platform SRE / fleet health owner | — | 3 | — | external | direct | adequate | Read-model gaps need explicit remediation routing evidence |
| cx-rd-lead | Research lead / principal investigator | — | 3 | roles/architect | external | pedagogical | adequate | Add power analysis and effect-size estimation to role overlay |
| cx-product-manager | Senior product manager | backlog-proposal, customer-profile, meta-prd, one-pager, prd, prd-business, prd-platform, prfaq | 9 | roles/product-manager | user | decision-forcing-direct | strong | Mandatory devil-advocate gate on PRD ship |
| cx-ux-researcher | UX researcher | — | 3 | roles/researcher.ux | user | pedagogical | adequate | Split user-research workflow from external research; deepen validity methodology |
| cx-operations | Technical program manager | — | 4 | roles/operator | — | direct | adequate | Critical-path method and resource leveling in role overlay |
| cx-researcher | Research analyst | evidence-brief, product-intelligence-report, research-brief, signal-brief | 3 | roles/researcher | external | direct | strong | Narrow research-workflow to external sources only |
| cx-business-strategist | Strategy / bizops lead | — | 4 | roles/product-manager.business-strategy | market | executive-concise | adequate | Porter's Five Forces and scenario planning in overlay |
| cx-data-analyst | Product data analyst | — | 3 | roles/data-analyst | external | direct | strong | — |
| cx-evaluator | ML / product evaluator | — | 2 | roles/reviewer.evaluator | external | direct | strong | — |
| cx-ai-engineer | AI engineer | — | 6 | roles/engineer.ai | external | direct | strong | — |
| cx-architect | Staff software architect | adr, architecture-overview, rfc, rfc-platform, system-design | 5 | roles/architect | external | decision-forcing-direct | strong | ADR context diagram enforcement |
| cx-engineer | Senior software engineer | — | 19 | roles/engineer | codebase | direct | strong | — |
| cx-devil-advocate | Red-team reviewer | — | 2 | roles/reviewer.devil-advocate | — | direct | adequate | FMEA enumeration in role overlay; mandatory on high-risk artifacts |
| cx-reviewer | Staff engineer reviewer | — | 3 | roles/reviewer | codebase | direct | strong | — |
| cx-security | Application security engineer | security-review, threat-model | 8 | roles/security | compliance | direct | strong | Explicit STRIDE/PASTA steps in overlay |
| cx-qa | QA lead | qa-strategy, test-plan | 3 | roles/qa | codebase | direct | strong | — |
| cx-debugger | Senior debugger / SRE investigator | — | 3 | roles/debugger | codebase | direct | adequate | Causal-model root-cause enumeration in overlay |
| cx-sre | Site reliability engineer | incident-report, postmortem, runbook | 4 | roles/operator.sre | external | blameless | strong | Error-budget policy explicit in overlay |
| cx-platform-engineer | Platform engineer | — | 6 | roles/engineer.platform | codebase | direct | adequate | IaC maturity and SBOM in overlay |
| cx-legal-compliance | Legal / compliance counsel (technical) | — | 4 | roles/security.legal-compliance | compliance | direct | adequate | Risk taxonomy and technical-legal bridge in overlay |
| cx-release-manager | Release manager | — | 3 | roles/operator.release | — | direct | adequate | Canary failure-detection and SLO rollback trees |
| cx-docs-keeper | Staff technical writer | changelog, memo | 5 | roles/operator.docs | — | friendly | strong | Per-doc-type tone matrix not wired to manifest |
| cx-designer | Product designer | — | 6 | roles/designer | user | friendly | adequate | Design-system maturity in overlay |
| cx-accessibility | Accessibility specialist | — | 2 | roles/designer.accessibility | user | pedagogical | adequate | Cognitive accessibility rigor in overlay |
| cx-explorer | Staff engineer (onboarding / exploration) | — | 5 | roles/researcher.explorer | codebase | pedagogical | adequate | Dedicated codebase-research workflow |
| cx-trace-reviewer | Observability / eval analyst | — | 2 | roles/reviewer.trace | external | direct | adequate | Statistical process control in overlay |
| cx-data-engineer | Data engineer | — | 4 | roles/engineer.data | external | direct | adequate | Data lineage and SLA maturity in overlay |
| cx-test-automation | Test automation engineer | — | 3 | roles/qa.test-automation | codebase | direct | strong | — |

## Role overlays

| Overlay | Grade | Gap |
|---|---|---|
| roles/architect.ai-systems | strong | — |
| roles/architect.data | strong | — |
| roles/architect.enterprise | strong | — |
| roles/architect.integration | strong | — |
| roles/architect | strong | — |
| roles/architect.platform | strong | — |
| roles/data-analyst.experiment | strong | — |
| roles/data-analyst | strong | — |
| roles/data-analyst.product-intelligence | strong | — |
| roles/data-analyst.product | strong | — |
| roles/data-analyst.telemetry | strong | — |
| roles/data-engineer.pipeline | adequate | Lineage observability |
| roles/data-engineer.vector-retrieval | strong | — |
| roles/data-engineer.warehouse | strong | — |
| roles/debugger | adequate | Causal enumeration |
| roles/designer.accessibility | adequate | Cognitive a11y rigor |
| roles/designer | adequate | Design-system maturity |
| roles/engineer.ai | strong | — |
| roles/engineer.data | strong | — |
| roles/engineer | strong | — |
| roles/engineer.platform | strong | — |
| roles/operator.docs | strong | Tone matrix via manifest |
| roles/operator | strong | — |
| roles/operator.release | adequate | Canary rollback trees |
| roles/operator.sre | strong | Error-budget policy explicit |
| roles/orchestrator | strong | — |
| roles/product-manager.ai-product | strong | — |
| roles/product-manager.business-strategy | adequate | Scenario planning |
| roles/product-manager.enterprise | strong | — |
| roles/product-manager.growth | strong | — |
| roles/product-manager | strong | — |
| roles/product-manager.platform | strong | — |
| roles/product-manager.product | strong | — |
| roles/qa.ai-eval | strong | — |
| roles/qa.api-contract | strong | — |
| roles/qa.data-pipeline | strong | — |
| roles/qa | strong | — |
| roles/qa.test-automation | strong | — |
| roles/qa.web-ui | strong | — |
| roles/researcher.explorer | adequate | Codebase workflow split |
| roles/researcher | strong | — |
| roles/researcher.ux | adequate | User-research workflow split |
| roles/reviewer.devil-advocate | adequate | FMEA enumeration |
| roles/reviewer.evaluator | strong | — |
| roles/reviewer | strong | — |
| roles/reviewer.trace | adequate | SPC drift detection |
| roles/security.ai | strong | — |
| roles/security.appsec | strong | — |
| roles/security.cloud | strong | — |
| roles/security.legal-compliance | adequate | Risk taxonomy |
| roles/security | strong | STRIDE/PASTA explicit |
| roles/security.privacy | strong | — |
| roles/security.supply-chain | strong | — |

## Cross-check issues

None.
