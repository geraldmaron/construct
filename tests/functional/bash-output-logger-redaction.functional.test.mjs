/**
 * bash-output-logger-redaction.functional.test.mjs — resolved secrets in Bash
 * output never survive to the on-disk log, and the log itself is not
 * world-readable (construct-hardening).
 *
 * Spawns the real lib/hooks/bash-output-logger.mjs against synthetic PostToolUse
 * input carrying a hyphenated-format key (sk-or-v1-…, the provider-tag shape
 * the api-key pattern's body class must accept alongside a flat alphanumeric
 * run) and asserts on the durable log file: no raw key, a redaction marker
 * present, and 0700/0600 permissions.
 */
import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from '../helpers/cleanup.mjs';
import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const HOOK = join(repoRoot, 'lib', 'hooks', 'bash-output-logger.mjs');

test('redacts a hyphenated-format secret and locks down the log', () => {
  const doctorRoot = mkdtempSync(join(tmpdir(), 'cx-bash-log-redaction-'));
  try {
    const fakeKey = `sk-or-v1-${'a'.repeat(64)}`;
    const stdout = 'line '.repeat(1000) + ` API_KEY=${fakeKey} end`;
    const input = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'echo test' },
      tool_response: { stdout, stderr: '' },
    });

    const r = spawnSync(process.execPath, [HOOK], {
      input,
      encoding: 'utf8',
      env: sterileSpawnEnv({ CONSTRUCT_DOCTOR_ROOT: doctorRoot }),
      timeout: 10_000,
    });
    assert.equal(r.status, 0, `hook should exit 0: ${r.stderr}`);

    const logDir = join(doctorRoot, 'bash-logs');
    const [logName] = readdirSync(logDir);
    assert.ok(logName, 'a log file was written');
    const logPath = join(logDir, logName);
    const logged = readFileSync(logPath, 'utf8');

    assert.equal(logged.includes(fakeKey), false, 'the raw key must not appear in the log');
    assert.ok(logged.includes('<redacted:api-key>'), 'a redaction marker must appear in its place');

    const dirMode = statSync(logDir).mode & 0o777;
    const fileMode = statSync(logPath).mode & 0o777;
    assert.equal(dirMode, 0o700, 'log directory must be 0700');
    assert.equal(fileMode, 0o600, 'log file must be 0600');
  } finally {
    rmTmpDir(doctorRoot);
  }
});
