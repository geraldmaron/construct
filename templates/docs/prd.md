# PRD: {title}

- **Date**: {YYYY-MM-DD}
- **Owner**: {name}
- **Status**: draft | in-review | approved | shipped | deprecated

<!--
Use this for a product capability, user workflow, or customer-facing requirement set.
Use meta-prd.md instead when defining the requirements for a product system, agent,
process, template, evaluation loop, or operating model.

Before drafting, read rules/common/framing.md.

Owning specialist: cx-product-manager (see rules/common/doc-ownership.md).
Construct must route PRD authoring to cx-product-manager rather than drafting directly —
doing so is how requirements traceability, user grounding, and external research fire.

Write with a balance of short paragraphs, tables, and bullets. Bullets are for scans,
not the whole document. Keep em dashes rare; prefer commas, periods, or parentheses.
-->

## Problem
<!--
What user or business outcome is currently blocked? One paragraph. State
the pain, not the solution.

Must NOT reference:
- Jira/Linear ticket IDs or "this came from ticket X"
- Roadmap items or OKR line items
- "The team decided we should build this"

Should reference:
- Observed user behavior, quantitative signals, or qualitative evidence
- The specific outcome that is not currently achievable
- The constraint that makes this non-trivial today
-->

## Users
<!-- Who experiences the problem? Segments, scale, current workaround. Cite evidence (tickets, interviews, data). -->

## Goals and non-goals
<!-- Goals: what success looks like. Non-goals: explicitly scoped out to keep the work bounded. -->

## Functional requirements
<!-- What the system must do. Number them (FR-1, FR-2, …) so they can be referenced in reviews and tests. -->

## Non-functional requirements
<!-- Performance, reliability, security, accessibility, compliance. Include numeric targets where possible. -->

## Acceptance criteria
<!-- Observable, falsifiable conditions a reviewer can check without asking the author. -->

## Success metrics
<!-- How we will know this worked in production. Leading vs. lagging. Avoid vanity metrics. -->

## Constraints
<!-- Budget, timeline, platform, team, legal, technical debt that shapes the solution. -->

## Dependencies
<!-- Teams, services, contracts, data sources, vendor timelines. -->

## Open questions
<!-- Genuine unknowns. Each question should name an owner and a decision deadline. -->

## References
<!-- Linked research, prior PRDs, ADRs, tickets, designs. -->
