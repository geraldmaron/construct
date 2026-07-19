---
title: Capability Registry
description: Generated from registry/capabilities.json. Do not edit by hand.
---

> Generated from `registry/capabilities.json`. Re-run `construct registry:generate-docs` to refresh.

# Capability Registry (27 entries)

## capability

| ID | Name | Criticality | Surfaces | Human gate | Last validated |
|---|---|---|---|---|---|
| `local.model.tier` | Local Model Tier Detection | P1 | cli:construct models resolve | proposal-only | 2026-06-26 |
| `mcp.broker.connection` | MCP Broker Connectivity | P0 | mcp:primary, opencode, cursor, vscode, claude | autonomous | 2026-06-26 |
| `mcp.tool-budget.trim` | MCP Tool Surface Trim | P2 | opencode | proposal-only | never |
| `oracle.meta-review` | Oracle Meta-Review | P1 | cli:construct oracle review | approve-only | 2026-06-26 |
| `orchestration.routing` | Orchestration Intent Routing | P0 | mcp:primary:orchestration_policy, cli:construct orchestrate run, opencode, claude, cursor | proposal-only | 2026-06-26 |
| `surfaces.opencode-primary` | OpenCode Primary Surface | P1 | opencode:primary, mcp:orchestration_policy, cli:construct sync | proposal-only | never |

## document-type

| ID | Name | Criticality | Surfaces | Human gate | Last validated |
|---|---|---|---|---|---|
| `document-type.adr` | Architecture Decision Record | — | none | proposal-only | 2026-06-26 |
| `document-type.evidence-brief` | Evidence Brief | — | none | proposal-only | 2026-06-26 |
| `document-type.ingested-markdown` | Ingested Markdown | — | mcp:primary:ingest_document, cli:construct ingest | autonomous | 2026-06-26 |
| `document-type.prd` | Product Requirements Document | — | none | proposal-only | 2026-06-26 |
| `document-type.research-brief` | Research Brief | — | mcp:get_template, cli:construct knowledge add | proposal-only | 2026-06-26 |

## ingest-strategy

| ID | Name | Criticality | Surfaces | Human gate | Last validated |
|---|---|---|---|---|---|
| `ingest.adapter` | Adapter Ingest (default) | P0 | cli:primary:construct ingest, mcp:ingest_document | autonomous | 2026-06-26 |
| `ingest.docling` | Docling Sidecar Ingest | P1 | cli:construct ingest --legacy-extractor=false | autonomous | 2026-06-26 |
| `ingest.docling-remote` | Docling Remote Ingest | P2 | cli:construct ingest | requires-human-approval | 2026-06-26 |

## skill

| ID | Name | Criticality | Surfaces | Human gate | Last validated |
|---|---|---|---|---|---|
| `skill.perspectives-architect-ai-systems` | Role Skill: Architect AI Systems | — | mcp:primary:get_skill | proposal-only | 2026-06-26 |
| `skill.perspectives-engineer` | Role Skill: Engineer | — | mcp:primary:get_skill | proposal-only | 2026-06-26 |

## workflow

| ID | Name | Criticality | Surfaces | Human gate | Last validated |
|---|---|---|---|---|---|
| `workflow.architecture-review` | Architecture Review Procedure | P1 | mcp:primary:procedure_invoke, cli:construct procedure invoke | requires-human-approval | 2026-06-26 |
| `workflow.data-structure` | Data Structure Procedure | P2 | mcp:primary:procedure_invoke, cli:construct procedure invoke | proposal-only | 2026-06-26 |
| `workflow.evidence-ingest` | Evidence Ingest Procedure | P1 | mcp:primary:procedure_invoke, cli:construct procedure invoke | proposal-only | 2026-06-26 |
| `workflow.memo-draft` | Memo Draft Procedure | P2 | mcp:primary:procedure_invoke, cli:construct procedure invoke | proposal-only | 2026-06-26 |
| `workflow.prd-draft` | PRD Draft Procedure | P1 | mcp:primary:procedure_invoke, cli:construct procedure invoke | proposal-only | 2026-06-26 |
| `workflow.proposal-review` | Proposal Review Procedure | P1 | mcp:primary:procedure_invoke, cli:construct procedure invoke | requires-human-approval | 2026-06-26 |
| `workflow.research-synthesis` | Research Synthesis Procedure | P1 | mcp:primary:procedure_invoke, cli:construct ask, claude | proposal-only | 2026-06-26 |
| `workflow.risk-review` | Risk Review Procedure | P1 | mcp:primary:procedure_invoke, cli:construct procedure invoke | requires-human-approval | 2026-06-26 |
| `workflow.structure-notes` | Structure Notes Procedure | P2 | mcp:primary:procedure_invoke, cli:construct intake classify | proposal-only | 2026-06-26 |
| `workflow.transcript-process` | Transcript Process Procedure | P2 | mcp:primary:procedure_invoke, cli:construct procedure invoke | proposal-only | 2026-06-26 |
| `workflow.triage` | Triage Procedure | P2 | mcp:primary:procedure_invoke, cli:construct procedure invoke | proposal-only | never |

