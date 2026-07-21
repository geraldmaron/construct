/**
 * tests/hooks/registry-sync-reminder.test.mjs — reminder-only behavior.
 *
 * The hook emits a one-line reminder on stderr when registry
 * Worker Profiles are written and exits 0. Auto-executing `construct sync`
 * from a hook is unsafe: tests legitimately mutate registry records and would race test
 * cleanup. Non-interactive contexts (CI / NODE_ENV=test / no TTY on stderr)
 * auto-suppress the reminder — no skip env var.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..', '..');
const HOOK = path.join(ROOT, 'lib', 'hooks', 'registry-sync.mjs');

function runHook({ filePath = '', env = {} } = {}) {
  // Strip the inherited CI/test signals so test 1 actually fires the reminder.
  // Per-test env adds back what each case is exercising.
  const baseEnv = { ...process.env };
  delete baseEnv.CI;
  delete baseEnv.NODE_ENV;

  return spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    input: '',
    env: {
      ...baseEnv,
      TOOL_INPUT_FILE_PATH: filePath,
      ...env,
    },
    timeout: 5000,
  });
}

describe('registry-sync hook', () => {
  it('exits clean and emits reminder for registry edits', () => {
    const r = runHook({ filePath: '/repo/registry/worker-profiles/engineer.json' });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /Worker Profile registry changed/);
    assert.match(r.stderr, /construct sync/);
  });

  it('is silent on unrelated file paths', () => {
    const r = runHook({ filePath: '/repo/src/foo.ts' });
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '');
  });

  it('auto-suppresses the reminder when CI=true (no skip env var needed)', () => {
    const r = runHook({ filePath: '/repo/registry/worker-profiles/engineer.json', env: { CI: 'true' } });
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '');
  });

  it('auto-suppresses the reminder when NODE_ENV=test', () => {
    const r = runHook({ filePath: '/repo/registry/worker-profiles/engineer.json', env: { NODE_ENV: 'test' } });
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '');
  });
});
