/**
 * tests/orchestration/provenance.test.mjs — full execution provenance in traces (LMCP-F1).
 *
 * Pins: a provider-executed task result and the persisted task record carry
 * specialistId, packId, promptVersion (a content fingerprint of the resolved
 * persona body), model, provider, toolGrants, and executionState, alongside
 * the personaAvailable flag LMCP-E2 already added. The same fields ride the
 * `.cx/traces` worker.completed event unconditionally, independent of
 * chainOfThought mode, so a reader never has to reconstruct provenance from a
 * separate source. Every reader (hostAdapterMetadata here; status/oracle/graph
 * are out of scope for this bead) tolerates a pre-F1 run record that carries
 * none of these fields.
 *
 * @enforces ADR-0056
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { runTaskViaProvider, _resetPackRegistryCache } from '../../lib/orchestration/worker.mjs';
import { planRun, executeRun, hostAdapterMetadata } from '../../lib/orchestration/runtime.mjs';
import { saveRun } from '../../lib/orchestration/run-store.mjs';
import { traceDir as resolveTraceDir } from '../../lib/worker/trace.mjs';
import { tempDir } from '../helpers.mjs';

// Trace reads resolve through the machine-scoped state root (ADR-0066), so
// CX_HOME_OVERRIDE is pinned for the whole file to keep them off the real
// developer machine's $HOME.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-provenance-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CX_MODEL_REASONING: MODEL, CX_MODEL_STANDARD: MODEL, CX_MODEL_FAST: MODEL, ANTHROPIC_API_KEY: 'sk-test' };

test.beforeEach(() => _resetPackRegistryCache());

const fetchOk = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'specialist output' }] }) });

// ── runTaskViaProvider: every new field present on a healthy persona ────────

test('runTaskViaProvider result carries specialistId, packId, promptVersion, model, provider, toolGrants, executionState', async () => {
  const task = { role: 'cx-engineer', reason: 'implement the change' };
  const run = { request: { summary: 'refactor the auth module' }, execution: { deploymentMode: 'solo' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, fetchImpl: fetchOk });

  assert.equal(result.specialistId, 'cx-engineer');
  assert.equal(typeof result.packId, 'string', 'a pack in the registry declares cx-engineer');
  assert.equal(typeof result.promptVersion, 'string');
  assert.match(result.promptVersion, /^[0-9a-f]{12}$/, 'promptVersion is a 12-char hex content fingerprint');
  assert.equal(result.model, MODEL);
  assert.equal(result.provider, 'anthropic');
  assert.ok(Array.isArray(result.toolGrants), 'toolGrants is an array');
  assert.ok(result.toolGrants.length > 0, 'cx-engineer declares claudeTools in the org registry');
  assert.equal(result.executionState, 'executed');
  assert.equal(result.personaAvailable, true);
});

test('promptVersion is a deterministic hash of the resolved persona body, not a random id', async () => {
  const task = { role: 'cx-engineer' };
  const run = { request: { summary: 'x' }, execution: { deploymentMode: 'solo' } };
  const r1 = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, fetchImpl: fetchOk });
  const r2 = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, fetchImpl: fetchOk });
  assert.equal(r1.promptVersion, r2.promptVersion, 'the same resolved persona body hashes identically across calls');
});

test('promptVersion changes when the resolved persona body changes (project-tier override)', async () => {
  const cwd = tempDir('cx-provenance-override-', test);
  const packsDir = path.join(cwd, '.construct', 'packs', 'override-pack');
  fs.mkdirSync(path.join(packsDir, 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(packsDir, 'pack.manifest.json'), JSON.stringify({
    id: '@project/override', version: '1.0.0', compatVersion: 1,
    prompts: { 'cx-engineer': 'prompts/cx-engineer.md' },
  }));
  fs.writeFileSync(
    path.join(packsDir, 'prompts', 'cx-engineer.md'),
    '---\nname: cx-engineer\nrole: engineer\n---\n\nPROJECT-OVERRIDE-MARKER persona body.\n',
  );

  const task = { role: 'cx-engineer' };
  const run = { request: { summary: 'x' }, execution: { deploymentMode: 'solo' } };
  const builtin = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, fetchImpl: fetchOk });

  _resetPackRegistryCache();
  const overridden = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, fetchImpl: fetchOk, cwd });

  assert.notEqual(builtin.promptVersion, overridden.promptVersion, 'a different resolved persona body must hash differently');
  assert.equal(overridden.packId, '@project/override');

  const expected = crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(packsDir, 'prompts', 'cx-engineer.md'), 'utf8'))
    .digest('hex')
    .slice(0, 12);
  assert.equal(overridden.promptVersion, expected, 'promptVersion is the sha256(persona body) 12-char prefix');
});

test('solo-mode persona fallback still carries specialistId/promptVersion/executionState (degraded-executed), packId null', async () => {
  const task = { role: 'cx-totally-unknown-specialist' };
  const run = { request: { summary: 'x' }, execution: { deploymentMode: 'solo' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: ENV, fetchImpl: fetchOk });

  assert.equal(result.personaAvailable, false);
  assert.equal(result.degraded, 'persona-fallback');
  assert.equal(result.specialistId, 'cx-totally-unknown-specialist');
  assert.equal(result.packId, null);
  assert.equal(typeof result.promptVersion, 'string');
  assert.equal(result.executionState, 'degraded-executed');
  assert.ok(Array.isArray(result.toolGrants), 'toolGrants defaults to an array (empty) for an unknown role');
});

// ── executeRun (provider backend): fields land on the persisted task + trace ─

test('executeRun (provider backend) writes every new field onto each persisted task', async () => {
  const cwd = tempDir('cx-provenance-run-', test);
  const planned = await planRun(
    { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd },
  );
  assert.ok(planned.tasks.length >= 1);

  const executed = await executeRun(cwd, planned.runId, { env: ENV, workerBackend: 'provider', fetchImpl: fetchOk });
  assert.equal(executed.status, 'completed');

  for (const task of executed.tasks) {
    assert.equal(typeof task.specialistId, 'string', 'specialistId present');
    assert.equal(task.specialistId, task.role);
    assert.ok(task.packId === null || typeof task.packId === 'string', 'packId present (string or explicit null)');
    assert.equal(typeof task.promptVersion, 'string', 'promptVersion present');
    assert.equal(task.model, MODEL, 'model present');
    assert.equal(task.provider, 'anthropic', 'provider present');
    assert.ok(Array.isArray(task.toolGrants), 'toolGrants present');
    assert.equal(task.executionState, 'executed', 'executionState present');
  }
});

test('executeRun (provider backend, failure) still records executionState:failed on the task', async () => {
  const cwd = tempDir('cx-provenance-fail-', test);
  const planned = await planRun(
    { request: 'refactor and review', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4 },
    { env: ENV, cwd },
  );
  const fetchFail = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  const executed = await executeRun(cwd, planned.runId, {
    env: { ...ENV, CONSTRUCT_PROVIDER_MAX_ATTEMPTS: '1' }, workerBackend: 'provider', fetchImpl: fetchFail,
  });

  assert.equal(executed.status, 'completed-with-failures');
  for (const task of executed.tasks) {
    assert.equal(task.status, 'failed');
    assert.equal(task.executionState, 'failed');
  }
});

test('executeRun (inline backend) records executionState:prepared, no specialist/pack/prompt provenance', async () => {
  const cwd = tempDir('cx-provenance-inline-', test);
  const run = await executeRun(
    cwd,
    (await planRun(
      { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
      { env: ENV, cwd },
    )).runId,
    { env: ENV },
  );
  assert.equal(run.workerBackend, 'inline');
  for (const task of run.tasks) {
    assert.equal(task.executionState, 'prepared');
    assert.equal(task.specialistId, undefined, 'inline never resolves a persona, so no specialistId is fabricated');
    assert.equal(task.packId, undefined);
    assert.equal(task.model, undefined);
  }
});

test('the .cx/traces worker.completed event carries every new provenance field', async () => {
  const cwd = tempDir('cx-provenance-trace-', test);
  const planned = await planRun(
    { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd },
  );
  await executeRun(cwd, planned.runId, { env: ENV, workerBackend: 'provider', fetchImpl: fetchOk });

  const traceDirPath = resolveTraceDir(cwd);
  const shard = fs.readdirSync(traceDirPath).find((f) => f.endsWith('.jsonl'));
  const lines = fs.readFileSync(path.join(traceDirPath, shard), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const completedEvents = lines.filter((e) => e.eventType === 'worker.completed' && e.metadata?.runId === planned.runId);
  assert.ok(completedEvents.length > 0);

  for (const event of completedEvents) {
    for (const field of ['specialistId', 'packId', 'promptVersion', 'model', 'provider', 'toolGrants', 'executionState']) {
      assert.ok(field in event.metadata, `worker.completed metadata carries ${field}`);
    }
    assert.equal(event.metadata.executionState, 'executed');
  }
});

// ── backward compatibility: readers tolerate a pre-F1 run record ───────────

test('hostAdapterMetadata tolerates a pre-F1 task record (no specialistId/packId/promptVersion/etc.)', () => {
  const legacyRun = {
    runId: 'run-legacy-1',
    traceId: 'trace-legacy-1',
    execution: { requestedStrategy: 'orchestrated', effectiveStrategy: 'construct-orchestrated', executionMode: 'construct-orchestrated', constructCapabilitiesActive: true, selectedProvider: 'anthropic', selectedModel: MODEL },
    workerBackend: 'provider',
    hostRole: 'cli-direct',
    status: 'completed',
    warnings: [],
    semantics: 'legacy',
    executionSemantics: 'legacy',
    tasks: [
      { id: 't1', role: 'cx-engineer', status: 'done', executor: 'provider:anthropic:claude', output: 'old output' },
    ],
  };

  const meta = hostAdapterMetadata(legacyRun);
  assert.equal(meta.tasks.length, 1);
  const [task] = meta.tasks;
  assert.equal(task.specialistId, null);
  assert.equal(task.packId, null);
  assert.equal(task.promptVersion, null);
  assert.equal(task.model, null);
  assert.equal(task.provider, null);
  assert.deepEqual(task.toolGrants, []);
  assert.equal(task.executionState, null);
  assert.equal(task.personaAvailable, null);
  assert.equal(task.output, 'old output', 'legacy fields still surface unchanged');
});

test('a legacy run.json on disk (no LMCP-F1 fields) still round-trips through the store and executeRun without crashing', async () => {
  const cwd = tempDir('cx-provenance-legacy-', test);
  const planned = await planRun(
    { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: ENV, cwd },
  );

  // Simulate a pre-F1 persisted run: strip anything this bead would have added
  // (there is nothing yet, since the run is only `planned`) and confirm executeRun
  // still succeeds and adds the new fields going forward — old records are read,
  // never rejected.
  saveRun(cwd, planned);
  const executed = await executeRun(cwd, planned.runId, { env: ENV, workerBackend: 'provider', fetchImpl: fetchOk });
  assert.equal(executed.status, 'completed');
  assert.ok(executed.tasks.every((t) => t.executionState === 'executed'));
});
