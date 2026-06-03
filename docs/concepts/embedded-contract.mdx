---
title: Embedded contract layer
description: The stable, versioned, secret-free surface another application uses to embed Construct as an orchestration layer — capability discovery, triage, model resolution, execution-capability resolution, and workflow invocation over CLI, MCP, and SDK.
---

The **Embedded Contract Layer (ECL)** lets another product use Construct's reusable roles, skills, and workflows without driving an interactive chat session, hosting the editor, or depending on Construct's internal prompt structure. It is distinct from Embed *mode* (the ingestion daemon); the ECL is the app-facing API.

It lives in `lib/embedded-contract/` and exposes five contracts over one shared core, on three interchangeable surfaces.

## The five contracts

- **Capability discovery** — read-only description of what an install can do: versions, interfaces, roles, skills, workflows, schemas, models/providers, policies, telemetry posture, plugins. Use it to discover Construct safely instead of reading internal registries.
- **Triage / planning** — classify an artifact and return a role-aware plan (owner, role chain with rationale, suggested skills, evidence requirements, expected outputs, approval requirements, risks, `canExecute`, `suggestedWorkflowType`) **without enqueuing or executing**. It is the preflight for workflow invocation. Input may be inline text or a file path; a file is extracted through Construct's pipeline (docling for PDF/Office, whisper for audio/video, transcript/plain-text incl. CSV), with the extraction method and any low-yield/truncation surfaced under `ingestion` and `warnings`.
- **Model resolution** — given the host's provider/model context, resolve which model an embedded workflow should use: host model → same-provider-family fallback → Construct tier default → structured config error.
- **Execution-capability resolution** — before/at workflow start, report whether a run will engage Construct orchestration or degrade to a prompt-only envelope, and why: `executionMode`, `constructCapabilitiesActive`, `degraded` + `degradationReason`, `requestedStrategy` vs `effectiveStrategy`. **Descriptive, not enforced** (see below).
- **Workflow invocation** — invoke a named workflow (a role/skill chain) non-interactively and get back a provenanced execution plan, gated by approval mode.

## Surfaces

Every contract is exposed on three transports that return the **same envelope**:

- **CLI-JSON** — `construct capability describe --json`, `construct intake classify --json`, `construct models resolve --json`, `construct execution resolve --json`, `construct workflow invoke --json`.
- **MCP tools** — `capability_describe`, `triage_recommend`, `model_resolve`, `construct_execution_resolve`, `workflow_invoke`.
- **SDK** — `import { describeCapabilities, recommendPlan, resolveEmbeddedModel, resolveExecution, invokeWorkflow } from '@geraldmaron/construct/embedded-contract'`.

CLI and MCP are thin adapters over the same core functions the SDK calls; a parity test asserts they return structurally identical envelopes.

## The response envelope

Every response is wrapped by `envelope.mjs`:

```json
{
  "contractVersion": "1.1.0",
  "minClientContractVersion": "1.0.0",
  "constructVersion": "1.0.16",
  "deploymentMode": "solo",
  "surface": "cli",
  "generatedAt": "…",
  "warnings": [],
  "data": { /* contract-specific payload */ }
}
```

`contractVersion` is semver and evolves independently of the package version — additive changes bump the minor, breaking changes the major. `isClientCompatible(clientVersion)` accepts an older-or-equal minor of the same major.

## Execution capability — descriptive, not enforced

A host can request orchestration but otherwise cannot tell whether a run engaged personas/skills/routing or fell back to a prompt-only envelope. `resolveExecution` answers that before/at workflow start. It is **descriptive**: in the embedded layer Construct returns an orchestration *plan* and the host runtime performs the reasoning, so the contract reports what Construct **planned and can resolve a model for** — never an observation that the host ran personas. Every response carries a `semantics` field stating that boundary; claiming observed orchestration would violate the no-fabrication rule. A same-family fallback (host model unavailable) and a config error (no runnable model) both surface as `degraded: true`. Decision recorded in **ADR-0019**.

`executionMode` is one of `construct-orchestrated`, `construct-prompt-only`, `host-direct`, or `same-family-fallback`; `constructCapabilitiesActive` is a subset of `personas`, `skills`, `workflow-routing`, `prompt-envelope`.

**Full orchestration** — recognized host model, orchestration requested:

```json
{ "requestedStrategy": "orchestrated", "effectiveStrategy": "orchestrated",
  "executionMode": "construct-orchestrated",
  "constructCapabilitiesActive": ["personas", "skills", "workflow-routing", "prompt-envelope"],
  "degraded": false, "degradationReason": null, "resolutionSource": "host-model" }
```

**Prompt-only degradation** — orchestration requested but no model resolves (the unsupported-provider path):

```json
{ "requestedStrategy": "orchestrated", "effectiveStrategy": "prompt-only",
  "executionMode": "construct-prompt-only",
  "constructCapabilitiesActive": ["prompt-envelope"],
  "degraded": true,
  "degradationReason": "Model could not be resolved; orchestration requires a runnable model — …",
  "resolutionSource": "config-error" }
```

**Host-direct** — host opts out of Construct (`use_construct=false`):

```json
{ "requestedStrategy": "auto", "effectiveStrategy": "host-direct",
  "executionMode": "host-direct", "constructCapabilitiesActive": [],
  "degraded": false, "degradationReason": null }
```

Each response also includes `semantics` (the descriptive-boundary disclaimer) and the nested `modelResolution`.

## Approval modes and provenance

Only workflow invocation can produce durable side effects, and only under the approval mode it is given:

| Mode | Durable writes | Status |
|---|---|---|
| `proposal-only` | none | `proposed` |
| `requires-human-approval` | none (records an approval request) | `awaiting-approval` |
| `allow-durable-write` | records the invocation to the observation store | `recorded` |

On `team`/`enterprise` deployments, durable writes are flagged as mandatorily audited. Each invocation carries a `traceId` for correlating downstream provenance. Construct returns the orchestration plan and the output contract; in the embedded layer the host agent runtime performs the specialist reasoning, so the contract never fabricates specialist output. (The standalone local orchestration runtime — see [Architecture](./architecture.mdx#local-orchestration-runtime-host-independent) — can additionally *execute* specialist tasks itself via the opt-in `provider` worker backend, recording real model output; the descriptive contract here is unchanged.)

## Safety invariants

- **No secrets.** Every response passes a redaction guard before serialization; credential state is a boolean (`requiresCredential`), never a value. Provider entries carry env-key *names* only.
- **No drift.** Capability discovery reads the live registries, so the published contract cannot diverge from what the install supports.
- **Honest health.** Provider `healthStatus` is `unknown` unless a real signal says otherwise — it is never asserted as healthy.

See [Embedded contract API](/reference/embed-api) for request/response field schemas.
