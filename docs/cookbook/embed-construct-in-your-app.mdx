---
title: Embed Construct in your app
description: Use Construct's roles, skills, and workflows from another application via the embedded contract layer — discover capabilities, resolve a model, triage an artifact, and invoke a workflow in proposal-only mode.
---

This walks the embedded contract layer end to end from an embedding application: discover what Construct can do, resolve a model against your host context, triage an artifact, then invoke a workflow without writing anything durable. Every step works over CLI-JSON, MCP, or the SDK; the SDK is shown here.

```js
import {
  describeCapabilities, resolveEmbeddedModel, recommendPlan, invokeWorkflow,
} from '@geraldmaron/construct/embedded-contract';
```

## 1. Discover capabilities

Discover roles, skills, workflows, models, and policies instead of reading Construct's internal registries:

```js
const { data } = describeCapabilities();
console.log(data.contractVersion);          // negotiate compatibility
console.log(data.workflows.map((w) => w.type));
```

The CLI equivalent: `construct capability describe --json`.

## 2. Resolve a model against your host

Tell Construct which model your host is using; it returns the model an embedded workflow should run, preferring your host's provider family:

```js
const { data: model } = resolveEmbeddedModel({
  workflowType: 'prd-draft',
  hostModel: 'anthropic/claude-sonnet-4-6',
});
// model.resolutionSource: 'host-model' | 'same-family-fallback' | 'tier-default'
// model.requiresCredential is a boolean — never a key value
```

## 3. Triage an artifact (no durable write)

Classify an incoming artifact and get a role-aware plan. Nothing is enqueued or executed:

```js
const { data: plan } = recommendPlan({ input: meetingNotesText });
// plan.primaryOwner, plan.recommendedChain, plan.evidenceRequirements
// plan.canExecute + plan.suggestedWorkflowType bridge to step 4
```

CLI: `construct intake classify --json --file notes.md` (or pipe via stdin).

## 4. Invoke a workflow in proposal-only mode

Invoke the suggested workflow. In `proposal-only` mode Construct returns a provenanced execution plan and writes nothing:

```js
const { data: run } = await invokeWorkflow({
  workflowType: plan.suggestedWorkflowType ?? 'proposal-review',
  input: meetingNotesText,
  approvalMode: 'proposal-only',
});
// run.status === 'proposed', run.durableWritesPerformed === []
// run.selectedRoles, run.skillsApplied, run.outputs, run.traceId
```

To let the workflow persist provenance, pass `approvalMode: 'allow-durable-write'`; to queue a human gate first, pass `requires-human-approval`. Specialist reasoning runs in your host's agent runtime — Construct returns the plan, the output contract, and the provenance trail.

See [Embedded contract layer](/concepts/embedded-contract) and the [Embedded contract API](/reference/embed-api) for full schemas.
