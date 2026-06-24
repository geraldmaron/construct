---
title: Embedded contract API
description: Request and response field schemas for the four embedded-contract surfaces — capability discovery, triage/planning, model resolution, and workflow invocation.
---

All four contracts return the standard envelope (`contractVersion`, `constructVersion`, `deploymentMode`, `surface`, `generatedAt`, `warnings`, `data`). Fields below describe the `data` payload. See [Embedded contract layer](/guides/concepts/embedded-contract) for the model.

SDK import:

```js
import {
  describeCapabilities, recommendPlan, resolveEmbeddedModel, resolveExecution, invokeWorkflow,
} from '@geraldmaron/construct/embedded-contract';
```

## Capability discovery

CLI `construct capability describe --json` · MCP `capability_describe` · SDK `describeCapabilities()`.

Response `data`: `product`, `constructVersion`, `contractVersion`, `minClientContractVersion`, `approvalModes`, `interfaces[]` (each `{ surface, contractVersion, … }`), `roles[]` (`{ id, name, description, modelTier, internal, canEdit, skills }`), `skills[]` (`{ id, description, inputs, artifactType }`), `workflows[]` (`{ type, tier, defaultApprovalMode, chain, outputSchema, description }`), `schemas[]` (`{ id, version, location }`), `models` (`{ tiers, tierSources, providers[] }`; each provider `{ id, label, local, requiresEnv, configured, healthStatus }` — env-key names only), `policies[]`, `telemetry` (`{ tracingEnabled, redaction, note }`), `plugins[]`, `warnings`.

## Triage / planning

CLI `construct intake classify --json` (alias `construct graph recommend --json`) · MCP `triage_recommend` · SDK `recommendPlan(request)`. Input from `--text`, `--file`, or stdin. Performs no durable write.

Request: `input` (artifact text) **or** `file_path`/`--file` (CLI/MCP) — a file path is extracted through Construct's pipeline (PDF/Office via docling, audio/video via whisper, transcripts, plain text incl. CSV); SDK callers use `extractFileForContract({ filePath })` then pass `{ input, ingestion }`. Plus `sourcePath?`, `artifactType?`, `domain?`, `desiredOutcome?`, `constraints?`, `availableRoles?`.

Response `data`: `classification` (`{ intakeType, rdStage }`), `ingestion` (`{ extractionMethod, characters, truncated, droppedInfo[], note?, error? }` when a file was resolved, else `null`), `confidenceKind: "classification"`, `classificationConfidence`, `primaryOwner`, `recommendedAction`, `recommendedChain`, `suggestedWorkflowType` (bridges to invocation; may be `null`), `roleRationale[]`, `suggestedSkills`, `evidenceRequirements`, `expectedOutputs`, `approvalRequirements`, `risks` (`{ level, factors }`), `nextStepOptions[]`, `canExecute`, `canExecuteReason`, `rationale`, `candidates[]`, `execution` (a planned execution-mode preview for `suggestedWorkflowType`; populated only when host context — `hostModel`/`hostProvider`/`constructStrategy` — is supplied, else `null`).

## Model resolution

CLI `construct models resolve --json` · MCP `model_resolve` · SDK `resolveEmbeddedModel(request)`.

Request: `workflowType?`, `requestedTier?` (`reasoning|standard|fast`), `host?`, `hostModel?`, `hostProvider?`, `capabilities?`, `allowCrossProviderFallback?` (default `false`).

Response `data`: `selectedModel`, `selectedProvider`, `providerFamily`, `resolutionSource` (`host-model|same-family-fallback|tier-default|config-error`), `requestedTier`, `fallbackReason`, `tierSource`, `capabilitiesMatched`, `healthStatus` (`healthy|unknown|cooldown`), `estimatedLimits`, `requiresCredential` (boolean, never a value), `error` (`{ code, reason, remediation }` or `null`).

## Execution-capability resolution

CLI `construct execution resolve --json` · MCP `construct_execution_resolve` · SDK `resolveExecution(request)`. Read-only; reports before/at workflow start whether a run will engage Construct orchestration or degrade to prompt-only, and why. **Descriptive, not enforced** (ADR-0019): reports what Construct planned and can resolve a model for, never observed host execution — see the `semantics` field.

Request: `workflowType?`, `requestedStrategy?` (`orchestrated|prompt-only|auto`, default `auto`), `useConstruct?` (default `true`; `false` ⇒ host-direct), `host?`, `hostModel?`, `hostProvider?`, `requestedTier?`, `capabilities?`, `allowCrossProviderFallback?`.

Response `data`: `executionMode` (`construct-orchestrated|construct-prompt-only|host-direct|same-family-fallback`), `constructCapabilitiesActive` (subset of `personas|skills|workflow-routing|prompt-envelope`), `degraded`, `degradationReason` (machine-readable or `null`), `requestedStrategy`, `effectiveStrategy`, `selectedProvider`, `selectedModel`, `resolutionSource`, `orchestrationPlanned`, `orchestrationAvailable`, `deploymentMode`, `modelResolution` (nested), `semantics` (the descriptive-boundary disclaimer).

## Workflow invocation

CLI `construct workflow invoke --json --workflow-type <t>` · MCP `workflow_invoke` · SDK `invokeWorkflow(request)`. Async.

Workflow types: `evidence-ingest`, `proposal-review`, `prd-draft`, `architecture-review`, `risk-review`, `research-synthesis`.

Request: `workflowType` (required), `input?` **or** `file_path`/`--file` (extracted through the same pipeline as triage), `context?`, `roleStrategy?` (`auto|explicit|constrained`), `requestedRoles?`, `approvalMode?` (`proposal-only|requires-human-approval|allow-durable-write`; default per workflow type), `trace?` (default `true`), `host?`, `hostModel?`, `hostProvider?`.

Request also accepts `constructStrategy` (`auto`|`orchestrated`|`prompt-only`) to select the execution mode.

Response `data`: `workflowId`, `workflowType`, `status` (`proposed|awaiting-approval|recorded|error`), `ingestion` (as in triage, when a file was resolved), `selectedRoles`, `roleStrategy`, `roleRationale[]`, `skillsApplied`, `modelResolution`, `execution` (the planned execution block — `executionMode`, `effectiveStrategy`, `requestedStrategy`, `constructCapabilitiesActive`, `degraded`, `degradationReason`, `semantics`; descriptive, not enforced — ADR-0019), `outputs` (`{ schema, expected, note }`), `recommendations[]`, `evidence` (`{ requirements, satisfied, missing, traceId }`), `risks`, `requiresApproval`, `approvalMode`, `durableWritesPerformed[]`, `traceId`, `errors[]`.

## Orchestration daemon (HTTP + SSE)

The orchestration runtime runs as a local service so thin clients (a VS Code/Copilot extension, OpenCode, CI, the `construct orchestrate … --remote` CLI) can trigger and stream real multi-specialist runs — the engine owns orchestration; the host is a client (ADR-0022). Served by the local server (`construct dashboard`, `127.0.0.1`, dashboard auth). Requests authenticate with `Authorization: Bearer <CONSTRUCT_DASHBOARD_TOKEN>` (CSRF-exempt for header auth). Responses use the standard versioned, secret-free envelope (`data` payload). The daemon persists runs under the user data root (`~/.cx/runtime/orchestration/`), shared across the daemon's lifetime regardless of which project the editor is in — distinct from the in-process `construct orchestrate run` CLI, which stores runs in the current project's `.cx/`.

| Method · Path | Purpose |
|---|---|
| `POST /api/orchestration/runs` | Start a run in the **background**; returns **202** with the planned run (`runId`, `status`, `execution`, `plan`, `tasks`). Body: `{ request (required), workflowType?, requestedStrategy?, workerBackend?, host?, hostModel?, hostProvider?, fileCount?, moduleCount? }`. Use `workerBackend:"provider"` (+ a provider key) to execute specialists and get real `task.output`; `inline` (default) prepares only. |
| `GET /api/orchestration/runs/:id` | The full run record — `status`, `tasks[]` with per-task `status`/`executor`/`output`/`error`, `execution`, `plan`. |
| `GET /api/orchestration/runs?limit=N` | Recent runs (summaries). |
| `GET /api/orchestration/runs/:id/events` | **SSE** lifecycle stream: a `snapshot` event, then deltas (`running`, per-task `task`, `completed`/`error`). Lightweight status only — fetch the run record for outputs. |
| `POST /api/orchestration/runs/:id/cancel` | Request a cooperative between-task stop (cannot abort an in-flight model call). |

MCP hosts (VS Code/Copilot, Cursor) drive the same daemon through two tools instead of raw HTTP: **`orchestration_run`** executes a run and returns per-specialist output (the executing counterpart to `workflow_invoke`, which only plans), and **`orchestration_status`** inspects runs. Both resolve the daemon URL from dashboard state and the token from `~/.construct/config.env`; an unreachable daemon fails fast with how to start it. See [connect your editor → orchestrated outcomes in VS Code](/guides/start/connect-your-editor).
