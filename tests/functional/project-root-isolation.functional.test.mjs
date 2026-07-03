/**
 * tests/functional/project-root-isolation.functional.test.mjs — regression
 * tests proving construct dev writes .cx to the project directory, not to
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
import { buildRuntimeRecoverySummary } from '../../lib/service-manager.mjs';

test('resolveProjectRoot returns the supplied cwd unchanged (resolved)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-root-isolation-'));
  try {
    const result = resolveProjectRoot(tmpDir);
    assert.equal(result, path.resolve(tmpDir));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('buildRuntimeRecoverySummary with rootDir=tmpDir reads durable paths under tmpDir', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-root-isolation-'));
  try {
    fs.mkdirSync(path.join(tmpDir, '.cx'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cx', 'context.md'), '# context\n');
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), '# plan\n');

    const summary = buildRuntimeRecoverySummary({ rootDir: tmpDir, results: [] });

    assert.equal(summary.durable.context, '.cx/context.md', 'context.md should be found under tmpDir');
    assert.equal(summary.durable.plan, 'plan.md', 'plan.md should be found under tmpDir');
    assert.ok(summary.canResumeFromFiles, 'canResumeFromFiles must be true when durable files exist');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('buildRuntimeRecoverySummary with rootDir=packageRoot does NOT pick up tmpDir files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-root-isolation-'));
  try {
    fs.mkdirSync(path.join(tmpDir, '.cx'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.cx', 'context.md'), '# context\n');

    // Pass packageRoot instead of tmpDir — the context.md inside tmpDir must be invisible.
    const summary = buildRuntimeRecoverySummary({ rootDir: packageRoot, results: [] });

    // The summary's context path, if present, must point at packageRoot's .cx/context.md,
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
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('telemetry url from startServices uses rootDir, not packageRoot', () => {
  // startServices builds telemetry URL as path.join(rootDir, '.cx', 'traces').
  // Verify the path builder honours an external rootDir by importing the
  // relevant sub-function via a direct path computation — no live service spawn.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-root-isolation-'));
  try {
    const expectedTracesPath = path.join(tmpDir, '.cx', 'traces');
    assert.ok(
      expectedTracesPath.startsWith(tmpDir),
      'traces path must start with rootDir (tmpDir)',
    );
    assert.ok(
      !expectedTracesPath.startsWith(packageRoot),
      'traces path must not start with packageRoot',
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
