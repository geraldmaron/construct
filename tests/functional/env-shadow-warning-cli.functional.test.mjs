/**
 * tests/functional/env-shadow-warning-cli.functional.test.mjs — construct-6y6w.3.
 *
 * bin/construct's fill-missing-only merge loop lets a conflicting shell export
 * win over config.env, the opposite of the MCP server's file-wins merge
 * (lib/mcp/server.mjs). loadConstructEnv's shadow warning names whichever
 * value the caller says wins via `shadowWinner`; bin/construct must pass
 * `shadowWinner: 'shell'` so the printed warning matches its own behavior.
 * That argument shipped in 2284206c (construct-xj96.12) but a later commit
 * (5ad34e0a) dropped it while touching an adjacent line, and
 * tests/env-config/shadow-warning.test.mjs only exercises
 * shadowWarningMessage() directly — it never spawns bin/construct, so the
 * regression was invisible. This test spawns the real binary so the claim is
 * checked against the actual CLI process, not the helper in isolation.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { sterileSpawnEnv } from '../helpers/sterile-env.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'cx-shadow-warn-'));
  const home = join(root, 'home');
  const project = join(root, 'project');
  mkdirSync(join(home, '.config', 'construct'), { recursive: true });
  mkdirSync(join(project, '.construct'), { recursive: true });
  writeFileSync(join(home, '.config', 'construct', 'config.env'), 'CONSTRUCT_INSTANCE_ID=from-config\n', 'utf8');
  return {
    home,
    project,
    cleanup() { rmTmpDir(root); },
  };
}

test('CLI: the shadow warning names the shell value as the winner, matching the fill-missing merge', () => {
  const env = sandbox();
  try {
    const res = spawnSync(process.execPath, [BIN, 'config', 'mode'], {
      cwd: env.project,
      encoding: 'utf8',
      timeout: 15_000,
      env: sterileSpawnEnv({
        HOME: env.home,
        USERPROFILE: env.home,
        CONSTRUCT_HOME_OVERRIDE: env.home,
        XDG_CONFIG_HOME: join(env.home, '.config'),
        CI: 'true',
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
        CONSTRUCT_INSTANCE_ID: 'from-shell',
      }),
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /process\.env\.CONSTRUCT_INSTANCE_ID differs from the config file value/, res.stderr);
    assert.match(res.stderr, /The shell value will be used/, `warning must name the shell value as the winner; got: ${res.stderr}`);
    assert.doesNotMatch(res.stderr, /The config file will be used/, `warning must not claim the config file wins on the CLI surface; got: ${res.stderr}`);
  } finally {
    env.cleanup();
  }
});
