/**
 * tests/functional/binary-flow-state-smoke.functional.test.mjs — durable-state
 * smoke for the distributed binary (construct-rf26.22, extending
 * construct-rf26.19/construct-qvou coverage).
 *
 * Coverage already held elsewhere, deliberately not duplicated here:
 * .github/workflows/bun-binary-smoke.yml gates doctor + the sandbox lifecycle
 * on the compiled binary, and
 * tests/functional/bun-compiled-binary.functional.test.mjs pins
 * version/--help/doctor. All of those are read-mostly paths against the
 * install root. The gap this file closes: a command that WRITES durable
 * machine-scoped state (`construct flow resume`) and dynamically imports a
 * user-supplied module at runtime, both of which exercise exactly the
 * path-resolution surfaces a Bun-compiled binary breaks first — under
 * --compile every bundled module's import.meta.url collapses to a virtual
 * /$bunfs/ path, so the checkpoint landing under the real
 * <home>/.construct/projects/<key>/ tree and the flow module loading from the
 * real filesystem are the assertions that matter.
 *
 * The same assertion set runs twice: once against `node bin/construct`
 * (always — the default CI test job has no Bun, and the node variant keeps
 * the command surface pinned there) and once against a freshly Bun-compiled
 * binary (skipped when Bun is absent; the Bun-binary track is CI-gated by
 * .github/workflows/bun-binary-smoke.yml, which installs Bun and runs the
 * full suite including this file).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveProjectKey } from '../../lib/state-root.mjs';
import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = join(ROOT, 'bin', 'construct');
const BUILD_ENTRY = join(ROOT, 'bin', '.construct-flow-smoke-entry.test.mjs');

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'binary-flow-smoke-'));
  const HOME = join(root, 'HOME');
  const project = join(root, 'project');
  mkdirSync(HOME, { recursive: true });
  mkdirSync(project, { recursive: true });
  return { root, HOME, project, cleanup() { rmTmpDir(root); } };
}

function writeFlowModule(project, markerPath) {
  const flowPath = join(project, 'smoke-flow.mjs');
  writeFileSync(flowPath, `
    import fs from 'node:fs';
    function markStep(name) {
      fs.appendFileSync(${JSON.stringify(markerPath)}, name + '\\n');
    }
    export default {
      id: 'binary-smoke',
      stateSchema: { type: 'object', properties: { count: { type: 'integer' } } },
      startStep: 'a',
      steps: {
        a: { workerBackend: 'inline', run: (input, ctx) => { markStep('a'); return { state: { count: (ctx.state.count || 0) + 1 } }; }, router: () => 'b' },
        b: { workerBackend: 'inline', run: (input, ctx) => { markStep('b'); return { state: { count: (ctx.state.count || 0) + 1 } }; }, router: () => '@@flow/terminal' },
      },
    };
  `);
  return flowPath;
}

// One assertion set for both variants. `command` is the argv prefix to invoke
// the CLI: [node, bin/construct] or [<compiled binary>].

function assertFlowStateSmoke(command) {
  const env = sandbox();
  try {
    const markerPath = join(env.project, 'steps.log');
    const flowPath = writeFlowModule(env.project, markerPath);
    const spawnEnv = sterileSpawnEnv({ HOME: env.HOME, CONSTRUCT_HOME_OVERRIDE: env.HOME });

    const resume = spawnSync(command[0], [...command.slice(1), 'flow', 'resume', 'smoke-run-1', `--flow=${flowPath}`, '--state={"count":0}'], {
      cwd: env.project,
      env: spawnEnv,
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(resume.status, 0, `flow resume must exit 0; stdout=${resume.stdout} stderr=${resume.stderr}`);
    assert.match(resume.stdout, /Started run smoke-run-1/, 'a fresh run reports itself started, proving real command dispatch, not a silent no-op');
    assert.match(resume.stdout, /Status: completed/);

    assert.equal(
      readFileSync(markerPath, 'utf8'),
      'a\nb\n',
      'the user-supplied flow module was dynamically imported from the real filesystem and each step ran exactly once',
    );

    // The durable checkpoint must land under the machine-scoped state root
    // resolved from the redirected HOME — a /$bunfs-confused binary would
    // either crash (ENOENT, construct-qvou) or write somewhere unreachable.
    const key = deriveProjectKey(env.project);
    const checkpointFile = join(env.HOME, '.construct', 'projects', key, 'runtime', 'flows', 'runs', 'smoke-run-1.json');
    assert.ok(existsSync(checkpointFile), `expected the checkpoint at ${checkpointFile}`);
    const checkpoint = JSON.parse(readFileSync(checkpointFile, 'utf8'));
    assert.equal(checkpoint.flowId, 'binary-smoke');
    assert.equal(checkpoint.run.status, 'completed');
    assert.deepEqual(checkpoint.run.completed, ['a', 'b']);

    assert.equal(existsSync(join(env.project, '.construct')), false, 'the flow engine writes nothing into the project tree');

    const status = spawnSync(command[0], [...command.slice(1), 'flow', 'status', 'smoke-run-1'], {
      cwd: env.project,
      env: spawnEnv,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(status.status, 0, `flow status must exit 0; stderr=${status.stderr}`);
    assert.match(status.stdout, /Status: completed/);
    assert.match(status.stdout, /Completed steps: a, b/);
  } finally {
    env.cleanup();
  }
}

test('node bin/construct: flow resume writes its checkpoint under the machine-scoped state root (baseline for the no-Bun CI suite)', () => {
  assertFlowStateSmoke([process.execPath, ENTRY]);
});

function bunAvailable() {
  const probe = spawnSync('bun', ['--version'], { encoding: 'utf8' });
  return probe.status === 0;
}

function hostTargetId() {
  const plat = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : null;
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null;
  return plat && arch ? `bun-${plat}-${arch}` : null;
}

test('a Bun-compiled binary: flow resume resolves real state-root and flow-module paths, never /$bunfs', (t) => {
  if (!bunAvailable()) {
    t.skip('bun not installed on PATH — the Bun-binary track is CI-gated by .github/workflows/bun-binary-smoke.yml');
    return;
  }
  const target = hostTargetId();
  if (!target) {
    t.skip(`unsupported host platform/arch for a Bun-compiled smoke build (${process.platform}/${process.arch})`);
    return;
  }

  // Same dist/ placement and entry-extension trick as
  // tests/functional/bun-compiled-binary.functional.test.mjs (see its header
  // for why), with a distinct entry filename so the two test files can build
  // concurrently under the parallel test runner.
  const distDir = join(ROOT, 'dist');
  mkdirSync(distDir, { recursive: true });
  const outfile = join(distDir, `construct-flow-smoke-${randomUUID()}`);
  t.after(() => { try { rmSync(outfile, { force: true }); } catch {} });

  copyFileSync(ENTRY, BUILD_ENTRY);
  try {
    const build = spawnSync('bun', ['build', '--compile', `--target=${target}`, BUILD_ENTRY, '--outfile', outfile], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000,
    });
    assert.equal(build.status, 0, `bun build --compile failed:\n${build.stdout}\n${build.stderr}`);
    assert.ok(existsSync(outfile), 'compiled binary was not produced');

    assertFlowStateSmoke([outfile]);
  } finally {
    rmSync(BUILD_ENTRY, { force: true });
  }
});
