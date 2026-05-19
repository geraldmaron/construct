# Construct Org Chart

> **Org-in-a-box framing:** Construct is your AI R&D organization. You are the founder/CEO — you give outcomes, the org figures out execution.

## Reporting Structure

```
Construct (Your AI R&D Organization)
│
├── R&D (Research & Development) — TOP LEVEL
│   │
│   ├── Product Department
│   │   ├── cx-product-manager — Product strategy, PRDs, backlog
│   │   ├── cx-designer — UI/UX design, wireframes, flows
│   │   └── cx-ux-researcher — User interviews, usability studies
│   │
│   ├── Engineering Department
│   │   ├── cx-architect — System design, ADRs, RFCs, tech strategy
│   │   ├── cx-engineer — Implementation, features, bug fixes
│   │   ├── cx-debugger — Root cause analysis, complex debugging
│   │   ├── cx-qa — Test strategy, quality gates, coverage
│   │   ├── cx-sre — Reliability, incidents, runbooks, SLOs
│   │   └── cx-platform-engineer — Infrastructure, CI/CD, devex
│   │
│   └── Intelligence Department
│       ├── cx-researcher — Market research, competitive analysis, SOTA
│       ├── cx-data-analyst — Metrics, experiments, product intelligence
│       ├── cx-ai-engineer — AI/ML workflows, agent design, evals
│       ├── cx-evaluator — Quality scoring, rubric design, judge systems
│       └── cx-trace-reviewer — Trace analysis, performance patterns
│
├── Governance (independent oversight)
│   ├── cx-security — Threat modeling, security reviews, CVE response
│   ├── cx-legal-compliance — GDPR, CCPA, SOC2, licensing
│   ├── cx-reviewer — Code review, design review, critical feedback
│   └── cx-devil-advocate — Challenges assumptions, stress-tests plans
│
├── Operations (shipping & documentation)
│   ├── cx-release-manager — Release coordination, versioning, changelogs
│   └── cx-docs-keeper — Documentation strategy, knowledge management
│
└── Strategy (business alignment)
    ├── cx-business-strategist — Market positioning, business models
    └── cx-operations — Logistics, dependencies, sequencing
```

## Key Principle: R&D Is The Top Level

**R&D (Research & Development)** is the **entire product-building organization**, not a department. It contains:

1. **Product** — defines what to build
2. **Engineering** — builds it
3. **Intelligence** — discovers what's possible and measures what's broken

This mirrors real-world tech orgs where the CTO/VP Engineering organization is called "R&D" and encompasses all product development.

## Department Missions

### Product Department (within R&D)
**Mission:** Define what to build and why. Own the user outcome.

| Role | Focus | Key Artifacts |
|------|-------|---------------|
| cx-product-manager | Product strategy, prioritization | PRDs, backlogs, one-pagers |
| cx-designer | Visual + interaction design | Wireframes, flows, mockups |
| cx-ux-researcher | User understanding | Interview transcripts, usability reports |
| cx-accessibility | WCAG compliance, inclusive design | Accessibility audits, screen reader tests |

### Engineering Department (within R&D)
**Mission:** Build it right. Own the implementation.

| Role | Focus | Key Artifacts |
|------|-------|---------------|
| cx-architect | Technical direction | ADRs, RFCs, system designs |
| cx-engineer | Feature implementation | Code, tests, documentation |
| cx-debugger | Complex problem solving | Root cause analysis, fixes |
| cx-qa | Quality assurance | Test plans, coverage reports |
| cx-sre | Reliability | Runbooks, incident reports, SLOs |
| cx-platform-engineer | Developer experience | CI/CD, infra, tooling |

### Intelligence Department (within R&D)
**Mission:** Discover what's possible and what's broken. Own the learning loop.

| Role | Focus | Key Artifacts |
|------|-------|---------------|
| cx-researcher | External intelligence | Research briefs, evidence briefs |
| cx-data-analyst | Product intelligence | Dashboards, experiment results |
| cx-ai-engineer | AI system design | Agent workflows, eval frameworks |
| cx-evaluator | Quality measurement | Rubrics, eval datasets, scores |
| cx-trace-reviewer | Performance analysis | Trace summaries, optimization recs |

### Governance (independent from R&D)
**Mission:** Keep it safe and sound. Own the risk surface.

| Role | Focus | Key Artifacts |
|------|-------|---------------|
| cx-security | Security posture | Threat models, security reviews |
| cx-legal-compliance | Regulatory compliance | Compliance checklists, audits |
| cx-reviewer | Quality gate | Review feedback, approval decisions |
| cx-devil-advocate | Assumption challenging | Counter-arguments, risk analysis |

### Operations (supports R&D)
**Mission:** Ship it smoothly. Own the release process.

| Role | Focus | Key Artifacts |
|------|-------|---------------|
| cx-release-manager | Release coordination | Release plans, changelogs |
| cx-docs-keeper | Knowledge management | Documentation strategy, audits |

### Strategy (guides R&D)
**Mission:** Align with business goals. Own the market fit.

| Role | Focus | Key Artifacts |
|------|-------|---------------|
| cx-business-strategist | Business model | Market analysis, positioning |
| cx-operations | Execution planning | Project plans, dependency maps |

## Consolidated Roles (28 → 12)

For simpler projects, the 28 specialists can be **consolidated into 12** without losing capability:

| Consolidated Role | Absorbs | When to Use |
|-------------------|---------|-------------|
| **product-lead** | product-manager + designer + ux-researcher | Small teams, early-stage products |
| **tech-lead** | architect + engineer + debugger | Startups, MVP development |
| **quality-lead** | qa + accessibility + reviewer | Projects with compliance needs |
| **reliability-lead** | sre + platform-engineer + release-manager | Production systems |
| **intelligence-lead** | researcher + data-analyst + evaluator | Data-driven products |
| **ai-lead** | ai-engineer + trace-reviewer | AI/ML products |
| **security-lead** | security + legal-compliance | Regulated industries |
| **strategy-lead** | business-strategist + operations | Growth-stage companies |
| **docs-lead** | docs-keeper | Documentation-heavy projects |
| **orchestrator** | orchestrator + rd-lead | Complex multi-team initiatives |
| **critic** | devil-advocate + evaluator | High-stakes decisions |
| **generalist** | engineer (default) | General purpose |

**Note:** The org-in-a-box framing remains intact. You still talk to `construct` (the chief of staff), who dispatches to the right department heads.
