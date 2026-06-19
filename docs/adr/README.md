---
cx_doc_id: 019ddb68-5aed-7979-8f84-32c426683a06
created_at: "2026-04-29T22:42:22.573Z"
updated_at: "2026-06-19T00:00:00.000Z"
generator: construct/init-docs
body_hash: "sha256:841cc5539956827500098cf3d7b479ef17aeecc3bc9a9c9ff0b7c05b03f28b95"
---
<!--
docs/adr/README.md: lane guide and status index for ADRs.
-->

# ADRs

Architecture decision records for decisions that have already been made.

## Status index

| ADR | Title | Status | Notes |
|---|---|---|---|
| [0001](./0001-zero-npm-core.md) | Zero npm dependencies in core | accepted | Foundational |
| [0002](./0002-layered-architecture.md) | Layered architecture with transport-agnostic provider abstraction | proposed | |
| [0003](./0003-provider-interface.md) | Transport-agnostic provider interface | accepted | |
| [0013](./0013-skills-on-disk-layout.md) | Skills on-disk layout | accepted | |
| [0014](./0014-local-embeddings-optional.md) | Local embeddings optional | accepted | |
| [0015](./0015-affirm-hybrid-architecture.md) | Affirm hybrid markdown + deterministic enforcement | proposed | |
| [0016](./0016-capability-parity-contract.md) | Capability parity contract | proposed | |
| [0017](./0017-source-credibility-taxonomy.md) | Source credibility taxonomy | proposed | |
| [0018](./0018-document-quality-standard.md) | Document quality standard | proposed | |
| [0019](./0019-execution-capability-descriptive-contract.md) | Execution-capability descriptive contract | proposed | |
| [0020](./0020-local-orchestration-runtime.md) | Local orchestration runtime | proposed | |
| [0021](./0021-provider-worker-backend-and-pluggable-run-stores.md) | Provider worker backend and pluggable run stores | proposed | |
| [0022](./0022-orchestration-daemon-api.md) | Orchestration daemon API | proposed | |
| [0023](./0023-acp-agent.md) | Construct as ACP server | proposed | Chat delegate path retired by ADR-0041; server scope deferred |
| [0024](./0024-document-io-optional-capability.md) | Document I/O optional capability | accepted | |
| [0025](./0025-explicit-activation-model.md) | Explicit activation model | accepted | |
| [0026](./0026-beads-git-native-sync.md) | Beads git-native sync | accepted | |
| [0027](./0027-host-project-footprint-and-non-destructive-scaffolding.md) | Host/project footprint | accepted | |
| [0028](./0028-js-yaml-frontmatter-exception.md) | JS YAML frontmatter exception | accepted | |
| [0029](./0029-install-scopes-and-hook-budgets.md) | Install scopes and hook budgets | proposed | |
| [0030](./0030-chain-of-thought-disclosure.md) | Chain-of-thought disclosure | accepted | |
| [0031](./0031-browser-automation-is-opt-in.md) | Browser automation is opt-in | proposed | |
| [0032](./0032-small-model-context-methodology.md) | Small-model context methodology | accepted | |
| [0033](./0033-platform-capability-registry.md) | Platform capability registry | accepted | |
| [0034](./0034-local-vs-cloud-methodology-split.md) | Local-vs-cloud methodology split | accepted | |
| [0035](./0035-test-strategy-extend-not-rebuild.md) | Test strategy — extend, not rebuild | accepted | |
| [0036](./0036-document-ingestion-docling-mcp-evaluation.md) | Document ingestion — docling sidecar | accepted | |
| [0037](./0037-specialist-prompt-format.md) | Specialist prompt format | proposed | |
| [0038](./0038-adaptive-local-prompt-composition.md) | Adaptive local-model prompt composition | accepted | |
| [0039](./0039-interaction-surface-model.md) | Interaction-surface model | accepted | |
| [0040](./0040-terminal-chat-delegated-loop.md) | Terminal chat — delegate loop | superseded | By ADR-0041 |
| [0041](./0041-terminal-chat-owned-loop.md) | Terminal chat — own the loop | accepted | |
| [0042](./0042-llm-credential-resolution.md) | LLM credential resolution | accepted | |
| [0043](./0043-oracle-meta-controller.md) | Oracle meta-controller | accepted | |
| [0044](./0044-tool-repo-root-layout.md) | Tool-repo root layout hygiene | accepted | |

## Starter templates

- [_template.md](./templates/_template.md)
