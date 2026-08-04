/**
 * tests/hooks/repo-gate.test.ts — the gate warns and never wedges a commit.
 *
 * Run as a subprocess rather than imported, because the property under test IS
 * the exit code. A hook that returns the wrong number blocks a commit no matter
 * how correct its logic is, and importing the module would test everything
 * except the thing that can actually wedge someone's work.
 *
 * Every case runs against a disposable project so nothing here depends on the
 * real repo passing its own checks — a test that went red because the working
 * tree was mid-edit would be a worse gate than no test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sterile } from '../harness/sterile.ts';

const GATE = fileURLToPath(new URL('../../scripts/hooks/repo-gate.mjs', import.meta.url));

interface GateRun {
  readonly status: number | null;
  readonly stderr: string;
}

/** Run the gate against a throwaway project whose checks behave as told. */
function runGate(scripts: Record<string, string>, env: NodeJS.ProcessEnv = {}): GateRun {
  const fixture = sterile();
  try {
    writeFileSync(
      join(fixture.root, 'package.json'),
      JSON.stringify({ name: 'gate-fixture', version: '0.0.0', scripts }),
    );
    const result = spawnSync(process.execPath, [GATE], {
      cwd: fixture.root,
      encoding: 'utf8',
      env: {
        ...process.env,
        // Keeps the hook's own health counter out of the real repo.
        CONSTRUCT_HOOK_HEALTH_FILE: join(fixture.root, 'hook-health.json'),
        ...env,
      },
    });
    return { status: result.status, stderr: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  } finally {
    fixture.cleanup();
  }
}

test('a failing check is surfaced and the commit still goes through', () => {
  const run = runGate({
    lint: 'echo "glossary violation: src/kernel/run/outcome.ts" 1>&2; exit 1',
    typecheck: 'exit 0',
  });

  assert.equal(run.status, 0, 'the gate must never wedge a commit');
  assert.match(run.stderr, /npm run lint FAILED/);
  assert.match(run.stderr, /glossary violation/, 'the failing check speaks for itself');
  assert.match(run.stderr, /turn CI red/);
  assert.doesNotMatch(run.stderr, /npm run typecheck FAILED/, 'a passing check stays quiet');
});

test('both checks are run — the first failure does not hide the second', () => {
  const run = runGate({
    lint: 'echo lint-broke 1>&2; exit 1',
    typecheck: 'echo types-broke 1>&2; exit 1',
  });

  assert.equal(run.status, 0);
  assert.match(run.stderr, /npm run lint FAILED/);
  assert.match(run.stderr, /npm run typecheck FAILED/);
});

test('a clean tree says nothing', () => {
  const run = runGate({ lint: 'exit 0', typecheck: 'exit 0' });

  assert.equal(run.status, 0);
  assert.doesNotMatch(run.stderr, /FAILED/);
  assert.doesNotMatch(run.stderr, /turn CI red/);
});

test('a toolchain it cannot run is reported as unrunnable, not as a defect', () => {
  // No PATH, so `npm` cannot be found at all. This is the failure mode that
  // matters most: the predecessor taught people to disable hooks because a
  // broken one wedged their session, and a gate that blocked here would earn
  // exactly that.
  const run = runGate({ lint: 'exit 1', typecheck: 'exit 1' }, { PATH: '' });

  assert.equal(run.status, 0);
  assert.match(run.stderr, /could not run lint, typecheck/);
  assert.doesNotMatch(run.stderr, /FAILED/, 'a missing toolchain is not a code defect');
});
