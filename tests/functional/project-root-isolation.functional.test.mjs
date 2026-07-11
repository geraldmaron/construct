/**
 * tests/functional/project-root-isolation.functional.test.mjs — regression
 * tests proving construct dev writes .construct to the project directory, not to
 * the construct package directory.
 *
 * Guards the invariant introduced in lib/roots.mjs: resolveProjectRoot(cwd)
 * always returns cwd, which must differ from packageRoot when construct is
 * used from outside its own directory. Verifies that startServices path
 * builders honour rootDir and never fall back to the package directory.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { packageRoot, resolveProjectRoot } from '../../lib/roots.mjs';
import { buildRuntimeRecoverySummary, startServices } from '../../lib/service-manager.mjs';
import { resolveStateDir } from '../../lib/state-root.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

test('resolveProjectRoot returns the supplied cwd unchanged (resolved)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-root-isolation-'));
  try {
    const result = resolveProjectRoot(tmpDir);
    assert.equal(result, path.resolve(tmpDir));
  } finally {
    rmTmpDir(tmpDir);
  }
});

test('resolveProjectRoot of an external project differs from packageRoot', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-root-isolation-'));
  try {
    const projectRoot = resolveProjectRoot(tmpDir);
    assert.notEqual(
      projectRoot,
      packageRoot,
      `resolveProjectRoot must differ from packageRoot when called from outside the construct package; got ${projectRoot} === ${packageRoot}`,
    );
  } finally {
    rmTmpDir(tmpDir);
  }
});

test('packageRoot is the construct package directory, not a temp path', () => {
  assert.ok(
    fs.existsSync(path.join(packageRoot, 'package.json')),
    `packageRoot (${packageRoot}) must contain package.json`,
  );
  assert.ok(
    !packageRoot.startsWith(os.tmpdir()),
    `packageRoot must not be inside tmpdir; got ${packageRoot}`,
  );
});

test('resolveProjectRoot does not resolve to packageRoot for a temp fixture project', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-root-isolation-'));
  try {
    const projectRoot = resolveProjectRoot(tmpDir);
    assert.ok(
      !projectRoot.startsWith(packageRoot),
      `project root (${projectRoot}) must not be inside packageRoot (${packageRoot})`,
    );
  } finally {
    rmTmpDir(tmpDir);
  }
});

test('buildRuntimeRecoverySummary with rootDir=tmpDir reads durable paths under tmpDir', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-root-isolation-'));
  try {
    fs.mkdirSync(path.join(tmpDir, '.construct'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.construct', 'context.md'), '# context\n');
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), '# plan\n');

    const summary = buildRuntimeRecoverySummary({ rootDir: tmpDir, results: [] });

    assert.equal(summary.durable.context, '.construct/context.md', 'context.md should be found under tmpDir');
    assert.equal(summary.durable.plan, 'plan.md', 'plan.md should be found under tmpDir');
    assert.ok(summary.canResumeFromFiles, 'canResumeFromFiles must be true when durable files exist');
  } finally {
    rmTmpDir(tmpDir);
  }
});

test('buildRuntimeRecoverySummary with rootDir=packageRoot does NOT pick up tmpDir files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-root-isolation-'));
  try {
    fs.mkdirSync(path.join(tmpDir, '.construct'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.construct', 'context.md'), '# context\n');

    // Pass packageRoot instead of tmpDir — the context.md inside tmpDir must be invisible.
    const summary = buildRuntimeRecoverySummary({ rootDir: packageRoot, results: [] });

    // The summary's context path, if present, must point at packageRoot's .construct/context.md,
    // not the one we just created in tmpDir.
    if (summary.durable.context) {
      const resolvedContext = path.resolve(packageRoot, summary.durable.context);
      assert.ok(
        resolvedContext.startsWith(packageRoot),
        `context path (${resolvedContext}) must be inside packageRoot, not tmpDir`,
      );
      assert.ok(
        !resolvedContext.startsWith(tmpDir),
        `context path must not point into tmpDir (${tmpDir})`,
      );
    }
  } finally {
    rmTmpDir(tmpDir);
  }
});

test('telemetry url from startServices uses the machine-scoped state root, not packageRoot', async () => {
  // Calls the real startServices with an isolated rootDir/homeDir and injected
  // probes/spawners (its designed test seams) so no real process is spawned.
  // startDoctor/startOracle have no injection seam, so CONSTRUCT_DOCTOR and
  // CONSTRUCT_ORACLE are forced 'off' for the call to keep it hermetic.
  // Telemetry's url resolves through resolveStateDir (ADR-0066), which reads
  // CX_HOME_OVERRIDE off process.env directly rather than from the homeDir
  // option threaded through startServices — that override is pinned here to
  // an isolated home so the assertion neither depends on nor writes into the
  // real developer machine's state root.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-root-isolation-'));
  const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-root-isolation-home-'));
  const prevDoctor = process.env.CONSTRUCT_DOCTOR;
  const prevOracle = process.env.CONSTRUCT_ORACLE;
  const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
  process.env.CONSTRUCT_DOCTOR = 'off';
  process.env.CONSTRUCT_ORACLE = 'off';
  process.env.CX_HOME_OVERRIDE = homeOverride;
  try {
    const { results } = await startServices({
      rootDir: tmpDir,
      homeDir: tmpDir,
      selected: new Set(['telemetry']),
      describeRuntimeSupportFn: async () => ({ tmux: false, cm: false, opencode: false, gh: false }),
      getRuntimePortsFn: async () => ({ memory: 0, bridge: 0, copilotBridge: 0 }),
      loadConstructEnvFn: () => ({}),
      spawnDetachedFn: () => ({ child: null }),
      memoryProbeFn: async () => false,
      openCodeProbeFn: async () => false,
      runPressureReleaseFn: () => ({ killed: [] }),
    });

    const telemetry = results.find((r) => r.name === 'Telemetry');
    assert.ok(telemetry, 'startServices must report a Telemetry result');
    const expectedUrl = resolveStateDir(tmpDir, 'traces', { ensureDir: false });
    assert.equal(telemetry.url, expectedUrl);
    assert.ok(
      !telemetry.url.startsWith(packageRoot),
      `telemetry url (${telemetry.url}) must not point into packageRoot (${packageRoot})`,
    );
  } finally {
    if (prevDoctor === undefined) delete process.env.CONSTRUCT_DOCTOR;
    else process.env.CONSTRUCT_DOCTOR = prevDoctor;
    if (prevOracle === undefined) delete process.env.CONSTRUCT_ORACLE;
    else process.env.CONSTRUCT_ORACLE = prevOracle;
    if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
    else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
    rmTmpDir(tmpDir);
    rmTmpDir(homeOverride);
  }
});
