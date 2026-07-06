/**
 * tests/cli-service-inventory.test.mjs — public dispatch/reference inventory parity.
 *
 * Generated references and runtime routing must expose the same public surface.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildCliServiceInventory } from '../lib/cli-service-inventory.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('public CLI service inventory reconciles dispatch, generated reference, and subcommands', () => {
  const inventory = buildCliServiceInventory({ rootDir: REPO });
  const unavailable = inventory.filter((entry) => !entry.runnable || !entry.documented);
  assert.deepEqual(unavailable, [], `public CLI drift: ${JSON.stringify(unavailable)}`);
  const undocumentedSubcommands = inventory.flatMap((entry) => entry.subcommands
    .filter((sub) => !sub.documented)
    .map((sub) => `${entry.name} ${sub.name}`));
  assert.deepEqual(undocumentedSubcommands, []);
});

test('generated CLI reference contains rendered subcommands, not object coercions', () => {
  for (const file of readdirSync(resolve(REPO, 'docs/guides/reference/cli')).filter((name) => name.endsWith('.md'))) {
    assert.doesNotMatch(readFileSync(resolve(REPO, 'docs/guides/reference/cli', file), 'utf8'), /\[object Object\]/, file);
  }
});

test('artifact workflow is both documented and available at runtime', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'cli-service-inventory-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [resolve(REPO, 'bin/construct'), 'artifact', 'workflow', 'Create a runbook HTML.'], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1', BOOTSTRAP_CHECKED: '1', HOME: home, CX_HOME_OVERRIDE: home },
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.kind, 'artifact-workflow-run');
  assert.equal(report.status, 'planned');
});
