/**
 * tests/functional/state-root-footprint.functional.test.mjs
 *
 * End-to-end coverage for ADR-0066 (config-layer project footprint): a fresh
 * `construct init` produces a project tree with no heavy state directories
 * under `.construct/`, and an operation that would normally write traces or
 * orchestration runs instead lands under the machine-scoped state root at
 * `~/.construct/projects/<key>/`. Also covers `construct status` reading a
 * persisted orchestration run back from that same state root (pinning the
 * split-brain regression where a reader duplicated the writer's
 * project-relative path independently of it) and `construct doctor` flagging
 * legacy in-project heavy state left over from a pre-refit install.
 *
 * HOME and CONSTRUCT_HOME_OVERRIDE are both pinned to a disposable tmp dir for every
 * spawn so the state root resolves inside the fixture, never the real
 * developer machine's home (tests/functional/README.md's isolation contract).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { isolationEnv, assertPathUnderRoot } from '../helpers/isolation-contract.mjs';
import { deriveProjectKey } from '../../lib/state-root.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

const HEAVY_STATE_DIRNAMES = new Set(['runtime', 'traces', 'lancedb']);

function makeFixture() {
  const project = mkdtempSync(join(tmpdir(), 'state-root-fp-project-'));
  const home = mkdtempSync(join(tmpdir(), 'state-root-fp-home-'));
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: project });
  spawnSync('git', ['config', 'user.email', 'state-root@example.com'], { cwd: project });
  spawnSync('git', ['config', 'user.name', 'State Root Test'], { cwd: project });
  return {
    project,
    home,
    cleanup: () => {
      rmTmpDir(project);
      rmTmpDir(home);
    },
  };
}

function walkEntries(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = full.slice(base.length + 1);
    const stat = statSync(full);
    out.push({ rel, isDirectory: stat.isDirectory() });
    if (stat.isDirectory()) out.push(...walkEntries(full, base));
  }
  return out;
}

test('construct init produces only text under .construct/ — no heavy state directories', (t) => {
  const { project, home, cleanup } = makeFixture();
  t.after(cleanup);

  const env = isolationEnv(home, { CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1', BOOTSTRAP_CHECKED: '1' });
  const result = spawnSync(process.execPath, [BIN, 'init', '--yes', '--no-start'], {
    cwd: project,
    encoding: 'utf8',
    timeout: 120_000,
    env,
  });
  assert.equal(result.status, 0, `init exited ${result.status}: ${result.stderr}`);

  const constructDir = join(project, '.construct');
  assert.ok(existsSync(constructDir), '.construct/ must exist after init');

  const entries = walkEntries(constructDir);
  const heavyDirs = entries.filter((e) => e.isDirectory && HEAVY_STATE_DIRNAMES.has(e.rel));
  assert.deepEqual(
    heavyDirs.map((e) => e.rel),
    [],
    `fresh init must not scaffold heavy state dirs under .construct/; found: ${heavyDirs.map((e) => e.rel).join(', ')}`,
  );

  // Every remaining .construct/ entry an init can produce (context.md, context.json,
  // brand-voice.json, and profile-driven config like intake/manifest.json) is
  // a small text/JSON file, never a heavy multi-file tree.

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const size = statSync(join(constructDir, entry.rel)).size;
    assert.ok(size < 100_000, `.construct/${entry.rel} is ${size} bytes — expected committed-text-sized, not heavy state`);
  }
});

test('a trace write after init lands under the machine-scoped state root, not .construct/traces', (t) => {
  const { project, home, cleanup } = makeFixture();
  t.after(cleanup);

  const initEnv = isolationEnv(home, { CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1', BOOTSTRAP_CHECKED: '1' });
  const initResult = spawnSync(process.execPath, [BIN, 'init', '--yes', '--no-start'], {
    cwd: project,
    encoding: 'utf8',
    timeout: 120_000,
    env: initEnv,
  });
  assert.equal(initResult.status, 0, `init exited ${initResult.status}: ${initResult.stderr}`);

  const traceModuleUrl = pathToFileURL(join(REPO_ROOT, 'lib', 'worker', 'trace.mjs')).href;
  const script = join(project, '_emit-trace.mjs');
  writeFileSync(
    script,
    `import { emitTraceEvent } from ${JSON.stringify(traceModuleUrl)};\n`
    + `const event = emitTraceEvent({ rootDir: process.cwd(), eventType: 'intake.received', metadata: { probe: true } });\n`
    + `process.stdout.write(JSON.stringify(event));\n`,
  );
  const traceEnv = isolationEnv(home);
  const traceResult = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8', env: traceEnv });
  assert.equal(traceResult.status, 0, `trace emit failed: ${traceResult.stderr}`);
  const event = JSON.parse(traceResult.stdout);
  assert.equal(event.eventType, 'intake.received');

  // .construct/traces/ must not exist — the write never touched the project tree.

  assert.equal(existsSync(join(project, '.construct', 'traces')), false, '.construct/traces/ must not be created by the write');

  // The durable copy lives under <home>/.construct/projects/<key>/traces/.

  const key = deriveProjectKey(project);
  const stateTracesDir = join(home, '.construct', 'projects', key, 'traces');
  assert.ok(existsSync(stateTracesDir), `expected trace shard under ${stateTracesDir}`);
  assertPathUnderRoot(stateTracesDir, home, 'trace shard directory');

  const shardFiles = readdirSync(stateTracesDir).filter((f) => f.endsWith('.jsonl'));
  assert.equal(shardFiles.length, 1, `expected exactly one trace shard; got ${shardFiles.join(', ')}`);
  const [line] = readFileSync(join(stateTracesDir, shardFiles[0]), 'utf8').trim().split('\n');
  assert.match(line, /"probe":true/);
});

test('construct status reads a persisted orchestration run back from the state root, not .construct/runtime', (t) => {
  const { project, home, cleanup } = makeFixture();
  t.after(cleanup);

  const initEnv = isolationEnv(home, { CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1', BOOTSTRAP_CHECKED: '1' });
  const initResult = spawnSync(process.execPath, [BIN, 'init', '--yes', '--no-start'], {
    cwd: project,
    encoding: 'utf8',
    timeout: 120_000,
    env: initEnv,
  });
  assert.equal(initResult.status, 0, `init exited ${initResult.status}: ${initResult.stderr}`);

  const runStoreModuleUrl = pathToFileURL(join(REPO_ROOT, 'lib', 'orchestration', 'run-store.mjs')).href;
  const script = join(project, '_save-run.mjs');
  writeFileSync(
    script,
    `import { saveRun } from ${JSON.stringify(runStoreModuleUrl)};\n`
    + `saveRun(process.cwd(), {\n`
    + `  runId: 'run-fixture-degraded-1',\n`
    + `  createdAt: new Date().toISOString(),\n`
    + `  status: 'degraded',\n`
    + `  executionState: 'degraded-executed',\n`
    + `  tasks: [{ id: 't1', personaAvailable: false, degraded: 'persona-fallback' }],\n`
    + `});\n`
    + `process.stdout.write('ok');\n`,
  );
  const saveEnv = isolationEnv(home);
  const saveResult = spawnSync(process.execPath, [script], { cwd: project, encoding: 'utf8', env: saveEnv });
  assert.equal(saveResult.status, 0, `saveRun failed: ${saveResult.stderr}`);

  // The run file never touches the project tree.

  assert.equal(existsSync(join(project, '.construct', 'runtime')), false, '.construct/runtime/ must not be created by the write');

  const key = deriveProjectKey(project);
  const stateRunsDir = join(home, '.construct', 'projects', key, 'runtime', 'orchestration', 'runs');
  assert.ok(existsSync(join(stateRunsDir, 'run-fixture-degraded-1.json')), `expected run file under ${stateRunsDir}`);
  assertPathUnderRoot(stateRunsDir, home, 'orchestration run store directory');

  // `construct status` reads the same directory back — it must surface the
  // persona-fallback run and its executionState, not report zero runs (the
  // split-brain regression this test pins: a reader duplicating the writer's
  // path outside lib/orchestration/run-store.mjs's runtimeDir()).

  const statusEnv = isolationEnv(home, { CONSTRUCT_SKIP_POSTINSTALL: '1' });
  const statusResult = spawnSync(process.execPath, [BIN, 'status', '--json'], {
    cwd: project,
    encoding: 'utf8',
    timeout: 90_000,
    env: statusEnv,
  });
  assert.equal(statusResult.status, 0, `status exited ${statusResult.status}: ${statusResult.stderr}`);
  const status = JSON.parse(statusResult.stdout);

  assert.equal(status.personaDegradedRuns.total, 1, `expected one persona-degraded run; got ${JSON.stringify(status.personaDegradedRuns)}`);
  assert.ok(status.personaDegradedRuns.runs.includes('run-fixture-degraded-1'));
  assert.equal(status.recentRunExecutionStates.total, 1, `expected one recent run; got ${JSON.stringify(status.recentRunExecutionStates)}`);
  assert.equal(status.recentRunExecutionStates.byState['degraded-executed'], 1);
});

test('construct doctor flags legacy in-project heavy state left over from a pre-refit install', (t) => {
  const { project, home, cleanup } = makeFixture();
  t.after(cleanup);

  const initEnv = isolationEnv(home, { CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1', BOOTSTRAP_CHECKED: '1' });
  const initResult = spawnSync(process.execPath, [BIN, 'init', '--yes', '--no-start'], {
    cwd: project,
    encoding: 'utf8',
    timeout: 120_000,
    env: initEnv,
  });
  assert.equal(initResult.status, 0, `init exited ${initResult.status}: ${initResult.stderr}`);

  // Simulate a pre-refit install: a project-local .construct/traces/ left behind by
  // an older Construct version.

  mkdirSync(join(project, '.construct', 'traces'), { recursive: true });
  writeFileSync(join(project, '.construct', 'traces', '2026-01-01.jsonl'), '{"eventType":"legacy"}\n');

  const doctorEnv = isolationEnv(home, { CONSTRUCT_SKIP_POSTINSTALL: '1' });
  const doctorResult = spawnSync(process.execPath, [BIN, 'doctor'], {
    cwd: project,
    encoding: 'utf8',
    timeout: 90_000,
    env: doctorEnv,
  });
  assert.match(
    doctorResult.stdout,
    /Legacy in-project heavy state found:.*\.construct\/traces/,
    `doctor must flag the legacy .construct/traces/ dir; stdout:\n${doctorResult.stdout}`,
  );
  assert.match(doctorResult.stdout, /~\/\.construct\/projects\/<key>\//, 'finding must point at the new state root');
});
