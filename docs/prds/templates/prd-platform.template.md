# Platform PRD: {title}

- **Date**: {YYYY-MM-DD}
- **Owner**: {name}
- **Status**: draft | in-review | approved | shipped | deprecated

<!--
Use this for capabilities consumed by internal systems, developers, operators, or other
services — not directly by end users. Covers APIs, SDKs, admin surfaces, data contracts,
shared infrastructure, and operational tooling.

Use prd.md instead for customer-facing product capabilities.
Use meta-prd.md for requirements about the product operating system itself.

Name the platform actor precisely: platform builder, application developer, security admin,
operator. "Developer" is too broad.
-->

## Problem
<!-- What is broken, missing, or blocking a platform actor or downstream system? One paragraph. State the operational or integration pain, not the solution. -->

## Platform actors
<!-- Who consumes this capability? Name roles precisely (app developer, ops engineer, data analyst, etc.). Include scale and current workaround. Cite evidence: tickets, incidents, support load. -->

## Goals and non-goals
<!-- Goals: what success looks like for the consumers. Non-goals: explicitly scoped out. -->

## API and interface contract
<!-- The surface being defined: endpoints, schemas, SDK methods, event payloads, config shapes, permission models. Number each contract item (C-1, C-2, …). -->

## Functional requirements
<!-- What the system must do. Number them (FR-1, FR-2, …). -->

## Non-functional requirements
<!-- Performance SLOs, reliability targets, security, compliance, scalability limits. Include numeric targets. -->

## Backwards compatibility and versioning
<!-- Is this a new contract or a change to an existing one? If a change: breaking vs. non-breaking, versioning strategy, and how existing consumers are supported. -->

## Migration and rollout
<!-- How consumers move to the new contract. Include migration steps, tooling, timeline, and who is responsible. Flag any coordination with downstream teams. -->

## Operational requirements
<!-- Observability (metrics, logs, traces), auditability, rate limits, failure modes, fallback behavior, support diagnostics, admin controls. These are product requirements, not afterthoughts. -->

## Acceptance criteria
<!-- Observable, falsifiable conditions a reviewer can check. Include integration and contract tests where relevant. -->

## Success metrics
<!-- How we know this worked: adoption, error rate, latency, support ticket reduction. Leading vs. lagging. -->

## Consumer impact
<!-- What changes for existing consumers. What breaks, what degrades, what stays the same. Link to migration guide if needed. -->

## Dependencies
<!-- Upstream services, data contracts, team availability, vendor timelines. -->

## Open questions
<!-- Genuine unknowns. Each question names an owner and a decision deadline. -->

## References
<!-- Linked designs, prior PRDs, ADRs, incidents, runbooks, tickets. -->
