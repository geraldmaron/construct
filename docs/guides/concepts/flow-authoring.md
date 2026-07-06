---
title: Flow authoring
description: How to define a flow for the deterministic flow engine — typed state, steps, routers, join combinators, fan-out restrictions, and effort budgets.
---

The flow engine (`lib/flows/`) sequences work as a typed state machine instead of prose an agent is trusted to follow. A flow declares a state schema, a set of named steps, and a starting step; the engine validates the whole definition at load time and walks it deterministically at run time. See [ADR-0067](../../decisions/adr/0067-deterministic-flow-engine.md) for the design rationale.

## Defining a flow

```js
import { defineFlow, TERMINAL } from '../../lib/flows/index.mjs';

const flow = defineFlow({
  stateSchema: {
    type: 'object',
    required: ['topic'],
    properties: {
      topic: { type: 'string' },
      findings: { type: 'array' },
      summary: { type: 'string' },
    },
  },
  startStep: 'fetch',
  steps: {
    fetch: {
      workerBackend: 'inline',
      inputs: ['topic'],
      run: (state) => ({ state: { findings: [`researched ${state.topic}`] } }),
      router: () => 'summarize',
    },
    summarize: {
      workerBackend: 'inline',
      inputs: ['findings'],
      run: (state) => ({ state: { summary: state.findings.join('; ') } }),
      router: () => TERMINAL, // the only value that ends the flow
    },
  },
});
```

`defineFlow` throws `FlowDefinitionError` immediately if the schema is malformed, a step's `router` can return a step name that doesn't exist, or a fan-out step (below) is misconfigured. A flow that loads at all is structurally valid — failures surface at authoring time, not mid-run.

A step's `run(state)` only receives the state keys it declares in `inputs` — an omitted `inputs` array means `run` is called with an empty object, not the full state. This is deliberate: a step's declared inputs are a visible contract of what it actually reads, not an incidental side effect of however much state happens to exist by that point in the flow.

Flow definitions can also be loaded from JSON via `loadFlow`, with `run`/`router` behavior supplied separately through a `handlers` map (JSON can't hold functions).

## Steps

Each step declares:

- **`workerBackend`** — which execution backend (`inline` / `provider` / `host`) the step would delegate to. The engine records this on every step result; it does not call the backend itself — that integration is the caller's responsibility (or a later flow-engine capability, tracked separately).
- **`run(state)`** — returns `{ state: <delta> }` merged into the flow's typed state. The delta is validated against the schema before it's accepted; a delta that would produce invalid state halts the run with a structured error instead of corrupting state silently.
- **`router(state)`** — pure and synchronous. Returns the next step's name, an array of step names (fan-out), or a falsy value to end the flow. No LLM calls belong here — routing must be deterministic: the same state always produces the same routing decision.
- **`budget`** (optional) — a plain number ceiling on the step's usage. Exhausting it produces a step result with `status: 'budget-exhausted'` instead of a silent truncation or a re-run.

## Fan-out is restricted, not just discouraged

A step can only declare `fanOut: true` if it also declares `readOnly: true` and names a `synthesis` step that every fan-out branch joins into:

```js
research: {
  workerBackend: 'inline',
  readOnly: true,
  fanOut: true,
  synthesis: 'combine',
  router: () => ['searchA', 'searchB'],
  run: (state) => ({ state: {} }),
},
```

`defineFlow` rejects a `fanOut: true` step that isn't also `readOnly: true`, and rejects one with no `synthesis` target (or a target that doesn't exist as a step). This isn't an arbitrary restriction — it encodes the evidence in [ADR-0065](../../decisions/adr/0065-orchestrator-worker-consolidation.md): parallel decomposition only earns its cost for read-only, breadth-first work. A step that mutates state has no business fanning out.

## Join combinators

Use `andJoin`/`anyJoin` (from `lib/flows/joins.mjs`) to express a step that waits for every predecessor in a set (an *and*-join) versus a step reachable via any of several router paths (an *or*-reconvergence).

## Determinism

When more than one step is ready to run in the same tick (e.g. after a fan-out), the engine always runs whichever appears first in the flow's own `steps` declaration order — never arrival order from concurrent branches. This makes a run's execution order reproducible from the flow definition alone.

## Running a flow

```js
import { runFlow } from '../../lib/flows/index.mjs';

const result = await runFlow(flow, { topic: 'flow engines' });
// result.status, result.state, result.history — one entry per step executed
```

`createRun`/`advanceRun` expose the same machinery one tick at a time, for a caller that wants to drive the run itself (e.g. to checkpoint between steps).

## What isn't here yet

Checkpoint/resume (persisting a run's state and next-step pointer to the machine-scoped state root so it survives a restart) and artifact-passing-by-filesystem-reference are deliberately not implemented in the current engine — the `Run` shape (state, frontier, join progress, history) is a plain, clonable object specifically so a caller *could* persist it, but nothing does yet. Both are tracked as follow-on work, not silently deferred.
