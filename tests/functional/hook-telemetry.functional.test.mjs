/**
 * hook-telemetry.functional.test.mjs — the real dispatcher records hook fires (construct-dcnb).
 *
 * Drives the actual `construct hook <name>` path in an isolated home and asserts a
 * row lands in ~/.construct/hook-calls.jsonl with the hook id, an outcome, and latency —
 * proving the central dispatcher (not each hook) carries the instrumentation.
 */
import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

test('construct hook <name> records a fire row in the isolated home', () => {
  const home = mkdtempSync(join(tmpdir(), 'cx-hook-telemetry-'));
  try {
    const r = spawnSync(process.execPath, [join(repoRoot, 'bin', 'construct'), 'hook', 'block-no-verify'], {
      input: '{}',
      env: { ...process.env, CONSTRUCT_HOME_OVERRIDE: home },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(r.status, 0, `hook should pass on empty input: ${r.stderr}`);

    const logPath = join(home, '.cx', 'hook-calls.jsonl');
    assert.ok(existsSync(logPath), 'hook-calls.jsonl is written under the isolated home');
    const rows = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const row = rows.find((x) => x.hookId === 'block-no-verify');
    assert.ok(row, 'the fired hook id appears in the log');
    assert.equal(row.outcome, 'ok');
    assert.ok(typeof row.latencyMs === 'number', 'latency is recorded');
  } finally {
    rmTmpDir(home);
  }
});
