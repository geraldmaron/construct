---
title: Capability Registry
description: Generated from registry/capabilities.json. Do not edit by hand.
---

> Generated from `registry/capabilities.json`. Re-run `construct registry:generate-docs` to refresh.

# Capability Registry (26 entries)

## capability

| ID | Name | Criticality | Surfaces | Human gate | Last validated |
|---|---|---|---|---|---|
| `chat.owned-loop` | Chat Owned Loop | P1 | cli:construct chat | proposal-only | never |
| `local.model.tier` | Local Model Tier Detection | P1 | cli:construct models resolve | proposal-only | never |
| `mcp.broker.connection` | MCP Broker Connectivity | P0 | mcp:primary, opencode, cursor, vscode, claude | autonomous | 2026-06-19 |
| `mcp.tool-budget.trim` | MCP Tool Surface Trim | P2 | opencode | proposal-only | never |
| `oracle.meta-review` | Oracle Meta-Review | P1 | cli:construct oracle review | approve-only | 2026-06-19 |
| `orchestration.routing` | Orchestration Intent Routing | P0 | mcp:primary:orchestration_policy, cli:construct orchestrate run, opencode, claude, cursor | proposal-only | 2026-06-19 |

## document-type

| ID | Name | Criticality | Surfaces | Human gate | Last validated |
|---|---|---|---|---|---|
| `document-type.adr` | Architecture Decision Record | — | none | proposal-only | never |
| `document-type.evidence-brief` | Evidence Brief | — | none | proposal-only | never |
| `document-type.ingested-markdown` | Ingested Markdown | — | mcp:primary:ingest_document, cli:construct ingest | autonomous | never |
| `document-type.prd` | Product Requirements Document | — | none | proposal-only | never |
| `document-type.research-brief` | Research Brief | — | mcp:get_template, cli:construct knowledge add | proposal-only | never |

## ingest-strategy

| ID | Name | Criticality | Surfaces | Human gate | Last validated |
|---|---|---|---|---|---|
| `ingest.adapter` | Adapter Ingest (default) | P0 | cli:primary:construct ingest, mcp:ingest_document | autonomous | 2026-06-19 |
| `ingest.docling` | Docling Sidecar Ingest | P1 | cli:construct ingest --legacy-extractor=false | autonomous | never |
| `ingest.docling-remote` | Docling Remote Ingest | P2 | cli:construct ingest | requires-human-approval | never |

## skill

| ID | Name | Criticality | Surfaces | Human gate | Last validated |
|---|---|---|---|---|---|
| `skill.roles-architect-ai-systems` | Role Skill: Architect AI Systems | — | mcp:primary:get_skill | proposal-only | never |
| `skill.roles-engineer` | Role Skill: Engineer | — | mcp:primary:get_skill | proposal-only | never |

## workflow

| ID | Name | Criticality | Surfaces | Human gate | Last validated |
|---|---|---|---|---|---|
| `workflow.architecture-review` | Architecture Review Workflow | P1 | mcp:primary:workflow_invoke, cli:construct workflow invoke | requires-human-approval | never |
| `workflow.data-structure` | Data Structure Workflow | P2 | mcp:primary:workflow_invoke, cli:construct workflow invoke | proposal-only | never |
| `workflow.evidence-ingest` | Evidence Ingest Workflow | P1 | mcp:primary:workflow_invoke, cli:construct workflow invoke | proposal-only | never |
| `workflow.memo-draft` | Memo Draft Workflow | P2 | mcp:primary:workflow_invoke, cli:construct workflow invoke | proposal-only | never |
| `workflow.prd-draft` | PRD Draft Workflow | P1 | mcp:primary:workflow_invoke, cli:construct workflow invoke | proposal-only | never |
| `workflow.proposal-review` | Proposal Review Workflow | P1 | mcp:primary:workflow_invoke, cli:construct workflow invoke | requires-human-approval | never |
| `workflow.research-synthesis` | Research Synthesis Workflow | P1 | mcp:primary:workflow_invoke, cli:construct ask, claude | proposal-only | never |
| `workflow.risk-review` | Risk Review Workflow | P1 | mcp:primary:workflow_invoke, cli:construct workflow invoke | requires-human-approval | never |
| `workflow.structure-notes` | Structure Notes Workflow | P2 | mcp:primary:workflow_invoke, cli:construct intake classify | proposal-only | never |
| `workflow.transcript-process` | Transcript Process Workflow | P2 | mcp:primary:workflow_invoke, cli:construct workflow invoke | proposal-only | never |

