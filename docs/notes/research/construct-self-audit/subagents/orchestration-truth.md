---
intake: none
---

# Subagent Evidence Report: Orchestration truth audit

> Agent G · model: Haiku · type: Explore (read-only) · Wave 1 · supervised by Opus.
> Structured output rendered by Opus; findings are the subagent's, not yet adjudicated.

## 1. Summary

The orchestration runtime distinguishes planning (what Construct can do) from execution (what actually ran), with test-enforced boundaries between inline-prepared and provider-executed tasks. The inline backend (default) marks tasks prepared with status "prepared", executor "inline:prepared", and output null—tests fail if these are violated. The provider backend executes via model calls, records real output, sets executor to "provider:<provider>:<model>", and marks status "done". Execution-capability contract (resolveExecution) reports planned capability and model-resolvability only; every response carries mandatory semantics disclaimer stating it does not observe host execution. Runs persist durably via pluggable stores (filesystem Mode-A default); degradation is tracked (same-family-fallback, config-error). Tests enforce: semantics field presence, no credential leakage, inline records no output, provider records output, failures continue not crash.

## 2. Evidence table

| Finding | Evidence (file · observation) | Confidence |
|---|---|---|
| Inline backend marks tasks 'prepared' with executor 'inline:prepared' and output null; tests assert every task satisfies this | `/Users/geralddagher/Developer/Projects/construct/tests/orchestration-runtime.test.mjs:116-117` — assert.ok(run.tasks.every((t) => t.status === 'prepared' && t.executor === 'inline:prepared')); assert.ok(run.tasks.every((t) => t.output === null), 'inline records no model output') | confirmed |
| Provider backend executes tasks with real model output, records status 'done', executor 'provider:<provider>:<model>', and task.output set to model output | `/Users/geralddagher/Developer/Projects/construct/lib/orchestration/runtime.mjs:224-232` — const result = await runTaskViaProvider({...}); task.output = result.output; task.executor = `provider:${result.provider}:${result.model}`; task.status = 'done'; | confirmed |
| Tests pin provider-executed tasks reach status 'done' and carry real output; tests fail if inline claims to execute | `/Users/geralddagher/Developer/Projects/construct/tests/orchestration-runtime.test.mjs:133-135` — assert.ok(run.tasks.every((t) => t.status === 'done'), 'every provider task done'); assert.ok(run.tasks.every((t) => /^specialist-output-/.test(t.output)), 'real model output recorded') | confirmed |
| Execution-capability contract (resolveExecution) carries mandatory semantics disclaimer on every response | `/Users/geralddagher/Developer/Projects/construct/lib/embedded-contract/execution.mjs:34-107` — semantics: EXECUTION_SEMANTICS ... EXECUTION_SEMANTICS = 'Reports Construct-planned capability and model-resolvability before/at workflow start; does not observe host execution.' | confirmed |
| Tests enforce semantics field is present and contains 'does not perform specialist LLM reasoning' | `/Users/geralddagher/Developer/Projects/construct/tests/embedded-contract-execution.test.mjs:34 & tests/orchestration-runtime.test.mjs:99` — assert.equal(r.semantics, EXECUTION_SEMANTICS, 'mandatory semantics disclaimer present'); assert.match(meta.semantics, /does not perform specialist LLM reasoning/i) | confirmed |
| Result schema distinguishes four execution modes: construct-orchestrated, construct-prompt-only, host-direct, same-family-fallback | `/Users/geralddagher/Developer/Projects/construct/lib/embedded-contract/execution.mjs:30` — export const EXECUTION_MODES = ['construct-orchestrated', 'construct-prompt-only', 'host-direct', 'same-family-fallback'] | confirmed |
| Same-family-fallback (host model unavailable) is marked degraded:true and reported as degraded mode, not clean orchestrated | `/Users/geralddagher/Developer/Projects/construct/lib/embedded-contract/execution.mjs:138-146` — if (resolutionSource === 'same-family-fallback') { return { executionMode: 'same-family-fallback', effectiveStrategy: 'orchestrated', degraded: true, degradationReason: `Host model unavailable...` } | confirmed |
| Prompt-only and host-direct requests own no specialist task sequence; runtime records tasks:[] rather than implying orchestration | `/Users/geralddagher/Developer/Projects/construct/lib/orchestration/runtime.mjs:171-172` — const orchestrates = execData.effectiveStrategy === 'orchestrated'; const tasks = orchestrates ? buildTasks(route) : []; | confirmed |
| Tests pin prompt-only requests own no specialist sequence and construct-prompt-only mode reports ['prompt-envelope'] capability only | `/Users/geralddagher/Developer/Projects/construct/tests/orchestration-runtime.test.mjs:70-75 & embedded-contract-execution.test.mjs:78-81` — assert.equal(run.execution.executionMode, 'construct-prompt-only'); assert.deepEqual(run.tasks, []); assert.deepEqual(r.constructCapabilitiesActive, ['prompt-envelope']) | confirmed |
| Provider backend failure is recorded (status 'failed', task.error) and run completes 'completed-with-failures' rather than crashing | `/Users/geralddagher/Developer/Projects/construct/lib/orchestration/runtime.mjs:239-307` — catch (err) { task.executor = 'provider:error'; task.error = { code: err.code \|\| 'PROVIDER_EXECUTION_FAILED', message: err.message }; task.status = 'failed'; ... run.status = ... (anyFailed ? 'completed-with-failures' : 'completed') | confirmed |
| Tests assert provider backend failure behavior: tasks marked 'failed', run status 'completed-with-failures' | `/Users/geralddagher/Developer/Projects/construct/tests/orchestration-runtime.test.mjs:145-147` — assert.equal(run.status, 'completed-with-failures'); assert.ok(run.tasks.every((t) => t.status === 'failed')); assert.ok(run.tasks.every((t) => t.error?.code === 'PROVIDER_EXECUTION_FAILED')) | confirmed |
| Runs persist durably via pluggable store interface (saveRun, loadRun, listRuns) with three backends: filesystem (Mode-A default), sqlite (Mode-B), postgres (Mode-C) | `/Users/geralddagher/Developer/Projects/construct/lib/orchestration/store.mjs:84-102` — export function resolveRunStore({ config = {}, env = process.env, cwd = process.cwd() } = {}) ... if (requested === 'sqlite') ... if (requested === 'postgres') ... return { store: filesystemStore(cwd), backend: 'filesystem', warnings } | confirmed |
| Unavailable backend (sqlite on Node <22.5, postgres with no DATABASE_URL) falls back to filesystem with recorded warning, never fails | `/Users/geralddagher/Developer/Projects/construct/lib/orchestration/store.mjs:88-92` — if (sqliteAvailable()) return { store: sqliteStore(cwd), backend: 'sqlite', warnings }; warnings.push('orchestration.store "sqlite" requires Node >=22.5...; falling back to filesystem.') | confirmed |
| Tests pin filesystem store round-trips a run and resolveRunStore returns correct backend | `/Users/geralddagher/Developer/Projects/construct/tests/orchestration-store-resolver.test.mjs:64-71` — const { store } = resolveRunStore({...}); await store.saveRun(run); const loaded = await store.loadRun('run-resolver-1'); assert.equal(loaded.runId, 'run-resolver-1') | confirmed |
| Credential value in env never leaks into run record or response; tests assert with canary string | `/Users/geralddagher/Developer/Projects/construct/tests/orchestration-runtime.test.mjs:103-109` — const canary = 'sk-orch-CANARY-7777'; ... assert.ok(!JSON.stringify(run).includes(canary)); assert.ok(!JSON.stringify(await getRuns(cwd, { env: ENV })).includes(canary)) | confirmed |
| Host-adapter metadata exports runtime-backed fields (runId, traceId, status, executionMode, workerBackend, degraded, selectedProvider, selectedModel, constructCapabilitiesActive, semantics) | `/Users/geralddagher/Developer/Projects/construct/lib/orchestration/runtime.mjs:347-368` — export function hostAdapterMetadata(run) { ... for (const k of ['runId', 'traceId', 'status', 'requestedStrategy', 'effectiveStrategy', 'executionMode', 'constructCapabilitiesActive', 'workerBackend', 'hostRole', 'degraded', 'selectedProvider', 'selectedModel', 'tasks', 'warnings', 'semantics']) | confirmed |
| MCP tool orchestration_run shapes output and returns runId, status, executionMode, degraded, degradationReason, specialists, tasks with per-task status/executor/output/error | `/Users/geralddagher/Developer/Projects/construct/lib/mcp/tools/orchestration-run.mjs:19-35` — function shapeRun(run) { return { runId: run.runId, status: run.status, executionMode: run.execution?.executionMode, degraded: run.execution?.degraded ?? false, ... tasks: (run.tasks \|\| []).map((t) => ({ id: t.id, role: t.role, status: t.status, executor: t.executor, output: t.output ?? null, error: t.error ?? null })) | confirmed |

## 3. Confirmed gaps

- No test explicitly verifies that inline backend FAILS to set task.output to anything other than null—test_only asserts it is null; a regression where inline set output would not be caught by the inverse direction
- No test verifies that changing inline executor from 'inline:prepared' to 'inline:executed' would break; tests assert equality only
- Chain-of-thought mode ('hidden', 'surface', 'telemetry_only') is resolved and passed to provider but no test verifies telemetry_only correctly suppresses task.reasoning from appearing on task (only on trace)
- No end-to-end test of remote/team orchestration service path (CONSTRUCT_ORCHESTRATION_URL) to verify the contract is preserved over HTTP
- runTaskViaProvider sets result.reasoning conditionally on chainOfThought !== 'hidden' but no test verifies 'hidden' mode zeroes reasoning in the result

## 4. Unconfirmed concerns

- Whether embedded-contract/model-resolve.mjs correctly reports resolutionSource for all fallback paths (config-error vs same-family-fallback vs host-model vs tier-default) — only spot-checked against mocked env
- Whether the prepare/execute distinction holds across all task roles and dispatches (only tested with cx-engineer, cx-reviewer, etc. in mocks)
- Whether a host adapter that receives a prepared task could accidentally treat it as executed output if it only reads task.output field without checking executor/status
- Whether the semantics disclaimer text is prominent enough to be unmissable to consumers reading the JSON schema inline

## 5. Registry / config / schema opportunities

- Worker backend selection (inline vs provider) is hardcoded per call; could be data-driven via config registry entry (orchestration.workerBackend already configurable, but no registry pattern)
- Chain-of-thought mode ('hidden', 'surface', 'telemetry_only') is configuration-driven but disclosure semantics are hardcoded in runtime.mjs:49; could be in a registry or config schema
- Execution modes (construct-orchestrated, construct-prompt-only, host-direct, same-family-fallback) are hardcoded enums in execution.mjs; could be externalized to registry if new modes are needed
- Degradation reasons are currently templated inline in execution.mjs (lines 145, 165, 168); could use a registry of standard degradation reason types
- Store backend selection precedence (explicit > env > deployment mode) is correct but the fallback-to-filesystem behavior is implicit logic; could be an explicit registry entry

## 6. Tests needed

- Test that inline backend rejects or ignores any attempt to set task.output (defensive test for future refactoring)
- Test that changing executor from 'inline:prepared' to any other value breaks the test suite
- Test for telemetry_only mode: task.reasoning must NOT appear on task, only in trace metadata
- End-to-end test of remote orchestration service path (CONSTRUCT_ORCHESTRATION_URL) to verify contract preservation over HTTP
- Test that resolveExecution correctly reports resolutionSource for all combinations: host-model, same-family-fallback, tier-default, config-error
- Test that semantics field is identical on execution.mjs and runtime.mjs (they are currently in sync but not centralized)
- Negative test: attempting to call provider backend without a key raises PROVIDER_KEY_MISSING with structured error

## 7. Docs needed

- Specification for task.reasoning field — when it appears on task vs in trace vs nowhere depending on chainOfThought mode; currently documented only in worker.mjs comments
- Architecture decision or runbook for when a host should check task.executor to distinguish prepared vs executed, and what to do if prepared (hand off to local executor, fail, etc.)
- Provider worker backend error handling and retry strategy — currently failures are recorded but no backoff/retry is implemented; document whether this is by design

## 8. Migration concerns

- If a future mode (Mode-D) adds new store backend, resolveRunStore precedence must be documented so it does not break config inheritance
- If chain-of-thought modes expand beyond 'hidden'/'surface'/'telemetry_only', tests must pin new modes do not leak reasoning unexpectedly
- If execution modes expand beyond the four current modes, embedded-contract/execution.mjs and all consuming code must be updated together

## 9. Questions for Opus

- Does the prepared/executed distinction need to be reflected in a formal schema or OpenAPI spec that hosts consume, or is the JSON structure and field naming sufficient documentation?
- Should inline backend tasks carry a 'handoffContract' field to downstream executors, and should tests verify this is populated?
- Is the telemetry_only mode working correctly (reasoning in trace but not on task) given the current emission logic in runtime.mjs:297-300?
- For provider backend failures, should the run continue processing remaining tasks (current behavior) or halt on first failure?

## 10. Suggested bead updates (proposals only — Opus owns Beads)

_none reported_

