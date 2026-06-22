/**
 * tests/functional/claude-orchestration-prompt.functional.test.mjs — construct-ymp5.
 *
 * Claude Code receives the orchestration micro-prompt instead of the static
 * 29-line specialist roster. Specialists are lazy-loaded via orchestration_policy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHostSandbox, fingerprintRealConfigs, assertRealConfigsUnchanged } from '../helpers/sterile-host-env.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

test('claude construct agent uses micro-prompt, not the static roster', () => {
  const before = fingerprintRealConfigs();
  const sandbox = createHostSandbox({ stubOllama: false });
  try {
    mkdirSync(join(sandbox.root, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(sandbox.root, '.claude', 'settings.json'), JSON.stringify({ mcpServers: {} }));

    const r = spawnSync(process.execPath, [join(repoRoot, 'scripts', 'sync-specialists.mjs'), '--project'], {
      cwd: sandbox.root,
      env: { ...sandbox.env, CX_TOOLKIT_DIR: repoRoot, CONSTRUCT_SYNC_HOSTS: 'claude' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    assert.equal(r.status, 0, `sync failed: ${r.stderr}`);

    const prompt = readFileSync(join(sandbox.root, '.claude', 'agents', 'construct.md'), 'utf8');
    assert.match(prompt, /orchestration_policy/, 'micro-prompt names the orchestration tool');
    assert.doesNotMatch(prompt, /Available specialist agents:/, 'static roster must not ship in the prompt');

    assertRealConfigsUnchanged(before);
  } finally {
    sandbox.cleanup();
  }
});
