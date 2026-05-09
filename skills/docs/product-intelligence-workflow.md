<!--
skills/docs/product-intelligence-workflow.md — Native Construct workflow for product evidence, synthesis, and product docs.

Use this to move from raw product evidence to PRDs, Meta PRDs, PRFAQs, signal briefs,
customer profiles, and backlog proposals without creating a separate sidecar system.
-->
# Product Intelligence Workflow

Use when: the request involves customer evidence, PM synthesis, product requirements, PRDs, PRFAQs, customer profiles, product signals, or backlog proposals.

Follow [rules/common/research.md](../../rules/common/research.md) for source order, verification, confidence, and reproducibility.

## Operating model

Product Intelligence is a Construct-native loop:

1. Capture evidence into `.cx/product-intel/sources/` or link existing sources.
2. Normalize evidence into field notes, customer profiles, and evidence briefs.
3. Synthesize themes, asks, pain points, product areas, and confidence.
4. Select the PM flavor: product, platform, enterprise, ai-product, or growth.
5. Select the artifact: signal brief, evidence brief, PRD, Meta PRD, PRFAQ, product intelligence report, or backlog proposal.
6. Gate external writes and approved-doc status through the primary persona.
7. Sync searchable artifacts through the hybrid file/Postgres/vector storage path.

## Source order

1. Existing internal evidence: customer profiles, evidence briefs, signal briefs, prior PRDs, prior research, ingested docs
2. Raw source material: notes, transcripts, tickets, exported docs, spreadsheets, decks
3. External corroboration when needed: official product docs, vendor docs, public changelogs, source code, standards

Do not skip prior internal evidence when drafting a new product artifact.

## PM flavor selection

- **product**: user workflow, adoption, JTBD, UX surface, success metrics.
- **platform**: APIs, SDKs, integrations, admin controls, compatibility, migration, operational burden.
- **enterprise**: buyer/admin/evaluator split, compliance, security review, procurement, rollout controls.
- **ai-product**: model behavior, evals, human review, traceability, trust and correction.
- **growth**: activation, conversion, packaging, pricing assumptions, lifecycle metrics.

Load the core product-manager role guidance and the selected overlay before drafting.

## Artifact selection

- Use `signal-brief` when evidence is real but below the PRD threshold.
- Use `evidence-brief` before committing requirements.
- Use `customer-profile` for durable account memory.
- Use `prd` for customer-facing product capabilities.
- Use `meta-prd` for product operating systems, agent workflows, templates, governance, and evaluation loops.
- Use `prfaq` for working-backwards launch narrative and FAQ.
- Use `backlog-proposal` before creating or updating external issues.
- Use `product-intelligence-report` for cross-source synthesis.

## Storage

Write working artifacts under `.cx/product-intel/` unless they are docs of record. Approved PRDs live in `docs/prd/`; approved Meta PRDs live in `docs/meta-prd/`.

The hybrid storage layer indexes `.cx/product-intel/`, `docs/prd/`, and `docs/meta-prd/`. When Postgres is configured, `construct storage sync` can persist these artifacts into shared SQL rows. The vector layer scores the same documents for local, remote, or file-backed semantic retrieval.

## Approval boundaries

Stop and ask the primary persona before:

- writing to Jira, Linear, GitHub Issues, or another external tracker
- marking a PRD, Meta PRD, or PRFAQ approved
- promoting a weak signal into committed requirements
- deleting or rewriting customer profile history
- importing product docs into implementation tasks

## Quality bar

Product Intelligence output must cite evidence, distinguish observation from inference, name confidence, and avoid a wall of bullets. Keep em dashes rare. Use paragraphs for reasoning, tables for comparisons, and bullets for scanability.

For time-sensitive or externally sourced claims, include the date basis. For load-bearing claims, prefer two independent sources unless one authoritative primary source is enough.
