/**
 * tests/orchestration/execution-state.test.mjs — run-level executionState
 * aggregation (LMCP-F4).
 *
 * Pins: executeRun aggregates every task's LMCP-F1 executionState
 * (prepared|executed|degraded-executed|failed) into one `run.executionState`,
 * with `failed` beating `degraded-executed` beating `executed` beating
 * `prepared`, and a zero-task run (prompt-only/host-direct) aggregating to
 * null rather than a fabricated state. hostAdapterMetadata surfaces the same
 * aggregate and tolerates a pre-F4 legacy run record.
 *
 * @enforces ADR-0020
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { planRun, executeRun, runOrchestration, hostAdapterMetadata } from '../../lib/orchestration/runtime.mjs';
import { saveRun } from '../../lib/orchestration/run-store.mjs';
import { tempDir } from '../helpers.mjs';

// Every runOrchestration/planRun/executeRun/saveRun call resolves its run
// store through the machine-scoped state root (ADR-0066), which reads
// CONSTRUCT_HOME_OVERRIDE/os.homedir() directly rather than the `env` option bag
// passed to these calls. Pin it for the whole file so these runs never write
// into the real developer machine's ~/.construct/projects/.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-exec-state-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CONSTRUCT_MODEL_REASONING: MODEL, CONSTRUCT_MODEL_STANDARD: MODEL, CONSTRUCT_MODEL_FAST: MODEL };

// ── inline backend: prepare-only run ────────────────────────────────────────

test('a prepare-only run reports executionState=prepared at task AND run level', async () => {
  const cwd = tempDir('cx-exec-state-prepare-', test);
  const run = await runOrchestration(
    { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd },
  );
  assert.equal(run.workerBackend, 'inline');
  assert.equal(run.status, 'completed-prepare-only');
  assert.ok(run.tasks.length >= 2, 'multiple specialists sequenced');
  assert.ok(run.tasks.every((t) => t.executionState === 'prepared'), 'every task carries executionState=prepared');
  assert.equal(run.executionState, 'prepared', 'the run-level aggregate is prepared');
});

// ── provider backend: executed run ──────────────────────────────────────────

test('an all-succeeding provider run aggregates to executionState=executed at run level', async () => {
  const cwd = tempDir('cx-exec-state-executed-', test);
  const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'specialist output' }] }) });
  const run = await runOrchestration(
    { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, cwd, workerBackend: 'provider', fetchImpl },
  );
  assert.equal(run.status, 'completed');
  assert.ok(run.tasks.every((t) => t.executionState === 'executed'));
  assert.equal(run.executionState, 'executed');
});

// ── provider backend: failure precedence ────────────────────────────────────

test('any failed task makes the run-level executionState=failed, even alongside executed tasks', async () => {
  const cwd = tempDir('cx-exec-state-failed-', test);
  // Fail every attempt for the first distinct persona (system prompt) seen —
  // that specialist's provider is down for the whole task, not just one
  // attempt — while every other specialist succeeds on its first call.
  let downSystem = null;
  const fetchImpl = async (url, opts) => {
    const { system } = JSON.parse(opts.body);
    if (downSystem === null) downSystem = system;
    if (system === downSystem) return { ok: false, status: 500, text: async () => 'boom' };
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'specialist output' }] }) };
  };
  const planned = await planRun(
    { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd },
  );
  assert.ok(planned.tasks.length >= 2, 'need at least two tasks for a mixed outcome');
  const run = await executeRun(cwd, planned.runId, {
    env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test', CONSTRUCT_PROVIDER_MAX_ATTEMPTS: '1' },
    workerBackend: 'provider', fetchImpl,
  });

  assert.equal(run.status, 'completed-with-failures');
  assert.ok(run.tasks.some((t) => t.executionState === 'failed'));
  assert.ok(run.tasks.some((t) => t.executionState === 'executed'));
  assert.equal(run.executionState, 'failed', 'failed beats executed in the run-level aggregate');
});

// ── provider backend: degraded-executed precedence ──────────────────────────

test('a solo-mode persona fallback aggregates the run to executionState=degraded-executed', async () => {
  const cwd = tempDir('cx-exec-state-degraded-', test);
  const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'specialist output' }] }) });
  const planned = await planRun(
    { request: 'do something with an unregistered specialist role', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4 },
    { env: ENV, cwd },
  );
  // Force a persona-fallback task deterministically: swap in a role the pack
  // registry does not declare a prompt for, rather than relying on the
  // request text to route to an unknown specialist. executeRun reloads the
  // run from the store, so the mutated task must be persisted first.
  planned.tasks[0].role = 'cx-totally-unknown-specialist';
  saveRun(cwd, planned);
  const run = await executeRun(cwd, planned.runId, { env: { ...ENV, ANTHROPIC_API_KEY: 'sk-test' }, workerBackend: 'provider', fetchImpl });

  assert.ok(run.tasks.some((t) => t.executionState === 'degraded-executed'), 'at least one task fell back to the solo-mode persona');
  assert.equal(run.executionState, 'degraded-executed');
});

// ── zero-task runs: no fabricated state ─────────────────────────────────────

test('a zero-task run (prompt-only) aggregates to executionState=null, not a fabricated state', async () => {
  const cwd = tempDir('cx-exec-state-zero-', test);
  const run = await runOrchestration({ request: 'summarize this note', requestedStrategy: 'prompt-only', hostModel: MODEL }, { env: ENV, cwd });
  assert.deepEqual(run.tasks, []);
  assert.equal(run.executionState, null);
});

// ── hostAdapterMetadata surfaces the run-level aggregate ────────────────────

test('hostAdapterMetadata surfaces the run-level executionState', async () => {
  const cwd = tempDir('cx-exec-state-meta-', test);
  const run = await runOrchestration(
    { request: 'refactor and review', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4 },
    { env: ENV, cwd },
  );
  const meta = hostAdapterMetadata(run);
  assert.equal(meta.executionState, 'prepared');
});

test('hostAdapterMetadata re-derives executionState for a pre-F4 legacy run record', () => {
  const legacyRun = {
    runId: 'run-legacy-f4',
    traceId: 'trace-legacy-f4',
    execution: { requestedStrategy: 'orchestrated', effectiveStrategy: 'construct-orchestrated', executionMode: 'construct-orchestrated', constructCapabilitiesActive: true, selectedProvider: 'anthropic', selectedModel: MODEL },
    workerBackend: 'inline',
    hostRole: 'cli-direct',
    status: 'completed-prepare-only',
    warnings: [],
    semantics: 'legacy',
    executionSemantics: 'legacy',
    // Pre-F1 tasks: no executionState field at all.
    tasks: [
      { id: 't1', role: 'engineer', status: 'prepared', executor: 'inline:prepared' },
    ],
  };
  const meta = hostAdapterMetadata(legacyRun);
  assert.equal(meta.executionState, null, 'a pre-F1 task record carries no executionState to aggregate, so null rather than a guess');
});
