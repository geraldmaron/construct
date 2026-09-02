# Workflows and dependency resolution

A workflow is a versioned manifest: typed inputs, ordered DAG steps with
stable ids and `needs`, per-step skill and version range, capability
requirements, source and freshness requirements, an action tier, input
mapping from the run input or upstream outputs, declared outputs,
validators, retry and timeout, triggers, no-data and stale-data policies,
concurrency and deduplication, cancellation, a deliverable contract, and
what the workflow may propose afterwards.

## Resolving before running

```bash
construct workflow list
construct workflow show design-conformance
construct workflow resolve design-conformance --input=target=src
construct workflow validate
```

Resolution fails before execution for a missing skill, workflow, capability,
or source; an incompatible version; a dependency cycle; a missing step
input; an output-to-input mismatch; an unknown action tier; a capability the
host does not provide; a step above the executor's tier; a load-bearing
output with no validator; a stale or unreachable mandatory source; an
ambiguous executor; or a diverged lock. Every result explains why the
workflow is runnable, blocked, outdated, or divergent, with a remedy per
reason. Nothing chooses a "close enough" skill, source, or version.

## Running

```bash
construct workflow run design-conformance --input=target=src --dry-run
construct workflow run design-conformance --input=target=src
construct run list
construct run show run-0001   # exits 1
```

A run is created once per idempotency key derived from the workflow's
dedupe fields. Its steps are leased to whoever executes them, the person's
session through the broker or a configured runner, with a fencing token; a
lost lease is reclaimed after expiry without repeating finished work. Every
step is gated through the policy engine; a step that needs an approval
raises one question scoped to exactly that action and the run waits. Every
submission runs the step's validators; a failure comes back with what to
fix and the step is retried by its policy. Steps that declare the kernel's
own drift capability are run by Construct itself.

The `run show` line above expects exit code 1 because no run with that id
exists in a fresh project; a real id comes from `workflow run --json`.

```bash
construct run cancel run-0001   # exits 1
construct run resume run-0001   # exits 1
```

## Deliverables and trust

A finished step leaves a draft. The final step's validators move it to
validated; a challenge, acceptance, and finality are recorded transitions
the person's judgment drives through the host. A task being done never
implies its deliverable is trusted.

## Built-in workflows

Project bootstrap and constitution review, minimal remember, managed
outcome with verification, design-principle conformance review, source
freshness and drift review, adversarial deliverable review,
strategy-to-execution and capacity review, the standing review wrapper, and
one review per professional pack. See [catalog.md](catalog.md).
