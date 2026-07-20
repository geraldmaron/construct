/**
 * tests/workspace-presets/apply-docs-pack.test.mjs — explicit docs-pack opt-in on preset apply.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runWorkspacePresetApply } from '../../lib/workspace-presets/cli.mjs';

function mkProject(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-apply-docs-'));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });
  fs.writeFileSync(
    path.join(dir, 'construct.config.json'),
    `${JSON.stringify({ version: 1, workspacePreset: 'rnd' }, null, 2)}\n`,
  );
  return dir;
}

test('apply without docs flag does not scaffold lane directories', async (t) => {
  const cwd = mkProject(t);
  const lines = [];
  const code = await runWorkspacePresetApply(['creative', '--yes'], {
    cwd,
    println: (line) => lines.push(line),
    errorln: () => {},
  });
  assert.equal(code, 0);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'adr')), false);
  assert.ok(lines.some((line) => line.includes('--docs-preset=lean|product|full')));
});

test('apply with --docs-preset=lean scaffolds the lean pack', async (t) => {
  const cwd = mkProject(t);
  const lines = [];
  const code = await runWorkspacePresetApply(['creative', '--yes', '--docs-preset=lean'], {
    cwd,
    println: (line) => lines.push(line),
    errorln: () => {},
  });
  assert.equal(code, 0);
  assert.ok(fs.existsSync(path.join(cwd, 'docs', 'adr')));
  assert.ok(fs.existsSync(path.join(cwd, 'docs', 'prds')));
  assert.ok(lines.some((line) => line.includes('Docs pack applied: lean')));
});

test('apply rejects unknown docs presets before mutating config', async (t) => {
  const cwd = mkProject(t);
  const errors = [];
  const code = await runWorkspacePresetApply(['creative', '--yes', '--docs-preset=bogus'], {
    cwd,
    println: () => {},
    errorln: (line) => errors.push(line),
  });
  assert.equal(code, 1);
  assert.ok(errors.some((line) => line.includes('Unknown docs pack: bogus')));
  const config = JSON.parse(fs.readFileSync(path.join(cwd, 'construct.config.json'), 'utf8'));
  assert.equal(config.workspacePreset, 'rnd');
});

test('dry-run with docs preset prints intent without writing lanes', async (t) => {
  const cwd = mkProject(t);
  const lines = [];
  const code = await runWorkspacePresetApply(['creative', '--dry-run', '--docs-preset=lean'], {
    cwd,
    println: (line) => lines.push(line),
    errorln: () => {},
  });
  assert.equal(code, 0);
  assert.equal(fs.existsSync(path.join(cwd, 'docs', 'adr')), false);
  assert.ok(lines.some((line) => line.includes('Would apply docs pack: lean')));
});
