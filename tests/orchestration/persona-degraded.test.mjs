/**
 * tests/orchestration/persona-degraded.test.mjs — persona resolution boundary (LMCP-E2).
 *
 * Pins: the worker resolves persona prompts ONLY through the pack registry
 * (lib/packs); a role every pack in the registry declares runs with
 * personaAvailable:true and no degraded flag; a role no pack declares runs
 * in solo mode with a visible degraded fallback (`degraded: 'persona-fallback'`,
 * `personaAvailable: false`) on both the task-result object and the run's
 * task/trace, never a silent generic substitution; the same miss in
 * team/enterprise mode is refused outright (PERSONA_UNAVAILABLE) rather than
 * executed under the wrong persona. `construct status` surfaces a count of
 * runs carrying a persona-fallback task.
 *
 * @enforces ADR-0055
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runTaskViaProvider, _resetPackRegistryCache } from '../../lib/orchestration/worker.mjs';
import { planRun, executeRun } from '../../lib/orchestration/runtime.mjs';
import { saveRun, runtimeDir } from '../../lib/orchestration/run-store.mjs';
import { buildStatus, formatStatusReport } from '../../lib/status.mjs';
import { traceDir as resolveTraceDir } from '../../lib/worker/trace.mjs';
import { tempDir } from '../helpers.mjs';

// Trace reads resolve through the machine-scoped state root (ADR-0066), so
// CX_HOME_OVERRIDE is pinned for the whole file to keep them off the real
// developer machine's $HOME.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-persona-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
test.after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

const MODEL = 'anthropic/claude-sonnet-4-6';
const ENV = { CX_MODEL_REASONING: MODEL, CX_MODEL_STANDARD: MODEL, CX_MODEL_FAST: MODEL, ANTHROPIC_API_KEY: 'sk-test' };

const dirs = [];
function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-persona-'));
  dirs.push(cwd);
  return cwd;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });
test.beforeEach(() => _resetPackRegistryCache());

const fetchOk = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'specialist output' }] }) });

test('a role every pack declares runs with personaAvailable:true, no degraded flag', async () => {
  const task = { role: 'cx-engineer', reason: 'implement the change' };
  const run = { request: { summary: 'refactor the auth module' }, execution: { deploymentMode: 'solo' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test' }, fetchImpl: fetchOk });
  assert.equal(result.personaAvailable, true);
  assert.equal('degraded' in result, false, 'no degraded flag on a healthy persona resolution');
});

test('solo miss sets personaAvailable:false and degraded:persona-fallback on the task result', async () => {
  const task = { role: 'cx-totally-unknown-specialist' };
  const run = { request: { summary: 'x' }, execution: { deploymentMode: 'solo' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test' }, fetchImpl: fetchOk });
  assert.equal(result.personaAvailable, false);
  assert.equal(result.degraded, 'persona-fallback');
  assert.equal(result.output, 'specialist output', 'the run still executes under the fallback persona');
});

test('a project-tier pack prompt takes precedence over the builtin core pack for the same specialist id (ADR-0055)', async () => {
  const cwd = project();
  const packsDir = path.join(cwd, '.construct', 'packs', 'override-pack');
  fs.mkdirSync(packsDir, { recursive: true });
  fs.writeFileSync(path.join(packsDir, 'pack.manifest.json'), JSON.stringify({
    id: '@project/override', version: '1.0.0', compatVersion: 1,
    prompts: { 'cx-engineer': 'prompts/cx-engineer.md' },
  }));
  fs.mkdirSync(path.join(packsDir, 'prompts'), { recursive: true });
  fs.writeFileSync(
    path.join(packsDir, 'prompts', 'cx-engineer.md'),
    '---\nname: cx-engineer\nrole: engineer\n---\n\nPROJECT-OVERRIDE-MARKER persona body.\n',
  );

  let capturedSystem = null;
  const captureFetch = async (_url, opts) => {
    capturedSystem = JSON.parse(opts.body).system;
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
  };

  const task = { role: 'cx-engineer' };
  const run = { request: { summary: 'x' }, execution: { deploymentMode: 'solo' } };
  const result = await runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test' }, fetchImpl: captureFetch, cwd });

  assert.equal(result.personaAvailable, true);
  assert.match(capturedSystem, /PROJECT-OVERRIDE-MARKER/, 'the project-tier pack prompt should win over the builtin core pack prompt');
});

test('team mode miss is refused outright (PERSONA_UNAVAILABLE), never executed', async () => {
  const task = { role: 'cx-totally-unknown-specialist' };
  const run = { request: { summary: 'x' }, execution: { deploymentMode: 'team' } };
  await assert.rejects(
    () => runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test' }, fetchImpl: fetchOk }),
    (err) => err.code === 'PERSONA_UNAVAILABLE',
  );
});

test('enterprise mode miss is refused outright (PERSONA_UNAVAILABLE)', async () => {
  const task = { role: 'cx-totally-unknown-specialist' };
  const run = { request: { summary: 'x' }, execution: { deploymentMode: 'enterprise' } };
  await assert.rejects(
    () => runTaskViaProvider({ task, run, model: MODEL, provider: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-test' }, fetchImpl: fetchOk }),
    (err) => err.code === 'PERSONA_UNAVAILABLE',
  );
});

test('executeRun (solo, provider backend) carries personaAvailable:false and degraded on the task and in the trace', async () => {
  const cwd = project();
  const planned = await planRun(
    { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: { ...ENV, CONSTRUCT_DEPLOYMENT_MODE: 'solo' }, cwd },
  );
  assert.ok(planned.tasks.length >= 1);

  // Force a miss deterministically: overwrite each task's role to one no pack
  // declares, before the single executeRun pass that follows.
  for (const task of planned.tasks) task.role = 'cx-totally-unknown-specialist';
  saveRun(cwd, planned);

  const executed = await executeRun(cwd, planned.runId, { env: { ...ENV, CONSTRUCT_DEPLOYMENT_MODE: 'solo' }, workerBackend: 'provider', fetchImpl: fetchOk });
  assert.equal(executed.status, 'degraded');
  assert.equal(executed.degradationReason, 'persona-fallback');
  assert.ok(executed.tasks.every((t) => t.personaAvailable === false));
  assert.ok(executed.tasks.every((t) => t.degraded === 'persona-fallback'));

  // The trace carries the same signal independent of chainOfThought mode.
  const traceDirPath = resolveTraceDir(cwd);
  const shard = fs.readdirSync(traceDirPath).find((f) => f.endsWith('.jsonl'));
  const lines = fs.readFileSync(path.join(traceDirPath, shard), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const completedEvents = lines.filter((e) => e.eventType === 'worker.completed' && e.metadata?.runId === planned.runId);
  assert.ok(completedEvents.length > 0);
  assert.ok(completedEvents.every((e) => e.metadata.personaAvailable === false && e.metadata.degraded === 'persona-fallback'));
});

test('executeRun (team, provider backend) fails the task rather than executing under a fallback persona', async () => {
  const cwd = project();
  const planned = await planRun(
    { request: 'refactor the auth module and review for security', requestedStrategy: 'orchestrated', hostModel: MODEL, fileCount: 4, moduleCount: 2 },
    { env: { ...ENV, CONSTRUCT_DEPLOYMENT_MODE: 'team' }, cwd },
  );
  for (const task of planned.tasks) task.role = 'cx-totally-unknown-specialist';
  saveRun(cwd, planned);

  const executed = await executeRun(cwd, planned.runId, { env: { ...ENV, CONSTRUCT_DEPLOYMENT_MODE: 'team' }, workerBackend: 'provider', fetchImpl: fetchOk });
  assert.equal(executed.status, 'completed-with-failures');
  assert.ok(executed.tasks.every((t) => t.status === 'failed'));
  assert.ok(executed.tasks.every((t) => t.error?.code === 'PERSONA_UNAVAILABLE'));
  assert.ok(executed.tasks.every((t) => t.output === null), 'a refused persona must never produce specialist output');
});

// ── construct status: persona-degraded runs count ──────────────────────────

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

// Mirrors the minimal buildStatus fixture in status-degradation-details.test.mjs:
// only the files buildStatus reads synchronously, so the test needs no network.
async function statusFixture() {
  const rootDir = tempDir('construct-persona-status-root-');
  const homeDir = tempDir('construct-persona-status-home-');
  const cwd = tempDir('construct-persona-status-cwd-');

  writeJson(path.join(rootDir, 'package.json'), { name: 'construct', version: '0.0.1-test' });
  writeJson(path.join(rootDir, 'agents', 'registry.json'), {
    models: {
      reasoning: { primary: 'claude-opus-4-1-20250805' },
      standard: { primary: 'claude-3-5-sonnet-20241022' },
      fast: { primary: 'claude-3-5-haiku-20241022' },
    },
    agents: [],
  });
  writeText(path.join(rootDir, '.env'), 'MEMORY_PORT=8765\nBRIDGE_PORT=5173\n');
  writeJson(path.join(homeDir, '.claude', 'settings.json'), { mcpServers: {}, hooks: {} });
  writeJson(path.join(cwd, '.construct', 'context.json'), {
    format: 'json',
    savedAt: new Date().toISOString(),
    contextSummary: 'test',
    markdown: '# test\n',
    activeWork: [],
  });

  return { rootDir, homeDir, cwd };
}

async function silentProbeService() {
  return { status: 'unavailable', message: 'test stub' };
}

// Writes through saveRun (lib/orchestration/run-store.mjs) so the fixture
// lands wherever the real writer resolves it — the machine-scoped state root
// (ADR-0066), not a hardcoded project-relative path — keeping this fixture
// from drifting out of sync with the production write path it stands in for.

function writeOrchestrationRun(cwd, run) {
  saveRun(cwd, run);
}

test('buildStatus: personaDegradedRuns is zero when no run carries a persona fallback', async () => {
  const { rootDir, homeDir, cwd } = await statusFixture();
  writeOrchestrationRun(cwd, { runId: 'run-clean', createdAt: new Date().toISOString(), tasks: [{ id: 't1', personaAvailable: true }] });

  const status = await buildStatus({ rootDir, homeDir, cwd, env: {}, probeService: silentProbeService });
  assert.equal(status.personaDegradedRuns.total, 0);
});

test('buildStatus: personaDegradedRuns counts a run with at least one persona-fallback task', async () => {
  const { rootDir, homeDir, cwd } = await statusFixture();
  writeOrchestrationRun(cwd, {
    runId: 'run-degraded-1',
    createdAt: new Date().toISOString(),
    tasks: [
      { id: 't1', personaAvailable: true },
      { id: 't2', personaAvailable: false, degraded: 'persona-fallback' },
    ],
  });
  writeOrchestrationRun(cwd, { runId: 'run-clean', createdAt: new Date().toISOString(), tasks: [{ id: 't1', personaAvailable: true }] });

  const status = await buildStatus({ rootDir, homeDir, cwd, env: {}, probeService: silentProbeService });
  assert.equal(status.personaDegradedRuns.total, 1);
  assert.ok(status.personaDegradedRuns.runs.includes('run-degraded-1'));
});

test('buildStatus: personaDegradedRuns counts multiple degraded runs independently', async () => {
  const { rootDir, homeDir, cwd } = await statusFixture();
  for (const runId of ['run-a', 'run-b', 'run-c']) {
    writeOrchestrationRun(cwd, {
      runId,
      createdAt: new Date().toISOString(),
      tasks: [{ id: 't1', personaAvailable: false, degraded: 'persona-fallback' }],
    });
  }

  const status = await buildStatus({ rootDir, homeDir, cwd, env: {}, probeService: silentProbeService });
  assert.equal(status.personaDegradedRuns.total, 3);
});

test('buildStatus: a corrupt run file is skipped, not fatal to the count', async () => {
  const { rootDir, homeDir, cwd } = await statusFixture();
  const dir = path.join(runtimeDir(cwd), 'runs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-broken.json'), 'not-json{{{');
  writeOrchestrationRun(cwd, {
    runId: 'run-degraded-2',
    createdAt: new Date().toISOString(),
    tasks: [{ id: 't1', personaAvailable: false, degraded: 'persona-fallback' }],
  });

  const status = await buildStatus({ rootDir, homeDir, cwd, env: {}, probeService: silentProbeService });
  assert.equal(status.personaDegradedRuns.total, 1);
});

test('formatStatusReport: emits the persona-degraded runs line when total > 0', () => {
  const syntheticStatus = {
    version: '0.0.1',
    lastSync: null,
    deployment: { mode: 'solo', resourceMode: { queue: 'fs', workers: 'local', telemetry: 'local' } },
    system: {
      overall: { status: 'healthy', summary: '1/1 core runtime surfaces reachable' },
      services: [],
      integrations: { summary: 'No integrations detected' },
      plugins: { status: 'configured', summary: '0 plugins' },
    },
    features: [],
    plugins: { status: 'configured', summary: '0 plugins', directories: [], errors: [], entries: [] },
    personas: null,
    specialists: [],
    hooks: [],
    skills: [],
    commands: [],
    cliCommands: [],
    mcpServers: [],
    publicHealth: { context: {}, coordination: {}, metadataPresence: {} },
    storage: null,
    executionContractModel: null,
    sessionEfficiency: null,
    efficiencyDigest: null,
    sessionUsage: null,
    telemetryRichness: null,
    overlays: [],
    promotionRequests: [],
    degradationDetails: [],
    personaDegradedRuns: { total: 2, runs: ['run-a', 'run-b'] },
  };

  const report = formatStatusReport(syntheticStatus);
  assert.ok(report.includes('Persona-degraded runs: 2'), 'report should include the persona-degraded runs count');
});

test('formatStatusReport: omits the persona-degraded runs line when total is zero', () => {
  const syntheticStatus = {
    version: '0.0.1',
    lastSync: null,
    deployment: { mode: 'solo', resourceMode: { queue: 'fs', workers: 'local', telemetry: 'local' } },
    system: {
      overall: { status: 'healthy', summary: '1/1 core runtime surfaces reachable' },
      services: [],
      integrations: { summary: 'No integrations detected' },
      plugins: { status: 'configured', summary: '0 plugins' },
    },
    features: [],
    plugins: { status: 'configured', summary: '0 plugins', directories: [], errors: [], entries: [] },
    personas: null,
    specialists: [],
    hooks: [],
    skills: [],
    commands: [],
    cliCommands: [],
    mcpServers: [],
    publicHealth: { context: {}, coordination: {}, metadataPresence: {} },
    storage: null,
    executionContractModel: null,
    sessionEfficiency: null,
    efficiencyDigest: null,
    sessionUsage: null,
    telemetryRichness: null,
    overlays: [],
    promotionRequests: [],
    degradationDetails: [],
    personaDegradedRuns: { total: 0, runs: [] },
  };

  const report = formatStatusReport(syntheticStatus);
  assert.ok(!report.includes('Persona-degraded runs:'), 'report should omit the line when there are no persona-degraded runs');
});
