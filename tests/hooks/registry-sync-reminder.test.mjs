/**
 * tests/hooks/registry-sync-reminder.test.mjs — reminder-only behavior.
 *
 * The old hook auto-executed `construct sync` whenever specialists/
 * registry.json was written, which raced test cleanup (tests legitimately
 * mutate registry.json) and regenerated platform state mid-suite. The
 * new hook emits a one-line reminder on stderr and exits 0. These tests
 * pin both the matcher (only fires for registry.json paths) and the
 * non-execution contract (no `construct sync` subprocess).
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..', '..');
const HOOK = path.join(ROOT, 'lib', 'hooks', 'registry-sync.mjs');

function runHook({ filePath = '', quiet = false } = {}) {
  return spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    input: '',
    env: {
      ...process.env,
      TOOL_INPUT_FILE_PATH: filePath,
      CONSTRUCT_QUIET_REGISTRY_REMINDER: quiet ? '1' : '',
    },
    timeout: 5000,
  });
}

describe('registry-sync hook', () => {
  it('exits clean and emits reminder for specialists/registry.json edits', () => {
    const r = runHook({ filePath: '/repo/specialists/registry.json' });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /registry\.json changed/);
    assert.match(r.stderr, /construct sync/);
  });

  it('emits reminder for installed agents/registry.json mirror', () => {
    const r = runHook({ filePath: path.join('/some/install', 'agents', 'registry.json') });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /registry\.json changed/);
  });

  it('is silent on unrelated file paths', () => {
    const r = runHook({ filePath: '/repo/src/foo.ts' });
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '');
  });

  it('honors CONSTRUCT_QUIET_REGISTRY_REMINDER=1', () => {
    const r = runHook({ filePath: '/repo/specialists/registry.json', quiet: true });
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), '');
  });
});
