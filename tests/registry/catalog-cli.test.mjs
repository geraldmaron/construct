/**
 * Registry catalog CLI UX: preset apply, not-found hints, worker-profile validate.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

import { runWorkspacePresetApply, runWorkspacePresetCommand } from '../../lib/workspace-presets/cli.mjs';
import { runWorkerProfileCreate, runWorkerProfileValidate } from '../../lib/registry/cli.mjs';
import { suggestIds } from '../../lib/registry/catalog-format.mjs';
import { runCatalogList, runCatalogShow } from '../../lib/registry/cli.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const BIN = path.join(ROOT, 'bin', 'construct');

function mkProject(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-cli-'));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });
  fs.writeFileSync(path.join(dir, 'construct.config.json'), `${JSON.stringify({ version: 1, workspacePreset: 'rnd' }, null, 2)}\n`);
  return dir;
}

test('suggestIds ranks prefix matches ahead of substring matches', () => {
  const ids = ['rnd', 'research', 'operations', 'creative'];
  assert.deepEqual(suggestIds('re', ids), ['research', 'creative']);
  assert.deepEqual(suggestIds('rnd', ids), ['rnd']);
});

test('workspace-preset apply persists a valid preset id', async (t) => {
  const cwd = mkProject(t);
  const lines = [];
  const code = await runWorkspacePresetApply(['creative'], { cwd, println: (line) => lines.push(line), errorln: () => {} });
  assert.equal(code, 0);
  const config = JSON.parse(fs.readFileSync(path.join(cwd, 'construct.config.json'), 'utf8'));
  assert.equal(config.workspacePreset, 'creative');
  assert.ok(lines.some((line) => line.includes('--docs-preset=lean|product|full')));
  assert.ok(lines.some((line) => line.includes('Docs: no pack added')));
});

test('workspace-preset apply rejects unknown ids with suggestions', async (t) => {
  const cwd = mkProject(t);
  const errors = [];
  const code = await runWorkspacePresetApply(['boguss'], {
    cwd,
    println: () => {},
    errorln: (line) => errors.push(line),
  });
  assert.equal(code, 1);
  assert.ok(errors.some((line) => line.includes('not found: boguss')));
  assert.ok(errors.some((line) => line.startsWith('Available:')));
});

test('workspace-preset list marks the active preset', async (t) => {
  const cwd = mkProject(t);
  const lines = [];
  const code = await runWorkspacePresetCommand(['list'], { cwd, println: (line) => lines.push(line) });
  assert.equal(code, 0);
  assert.ok(lines.some((line) => line.startsWith('Active preset: rnd')));
  assert.ok(lines.some((line) => line.startsWith('* rnd')));
});

test('worker-profile validate surfaces actionable errors for empty records', async (t) => {
  const cwd = mkProject(t);
  const file = path.join(cwd, 'empty-profile.json');
  fs.writeFileSync(file, '{}');
  const errors = [];
  const code = await runWorkerProfileValidate([`--file=${file}`], {
    rootDir: ROOT,
    println: () => {},
    errorln: (line) => errors.push(line),
  });
  assert.equal(code, 1);
  assert.ok(errors.some((line) => line.includes('validation failed')));
});

test('worker-profile show unknown id lists available profiles via CLI', () => {
  const result = spawnSync(process.execPath, [BIN, 'worker-profile', 'show', 'boguss'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Worker Profile not found: boguss/);
  assert.match(result.stderr, /Available:/);
});

test('workspace-preset apply is wired through the construct binary', (t) => {
  const cwd = mkProject(t);
  execFileSync(process.execPath, [BIN, 'workspace-preset', 'apply', 'operations'], { cwd });
  const config = JSON.parse(fs.readFileSync(path.join(cwd, 'construct.config.json'), 'utf8'));
  assert.equal(config.workspacePreset, 'operations');
});

test('worker-profile list supports grep filtering via CLI', () => {
  const out = execFileSync(process.execPath, [BIN, 'worker-profile', 'list', '--grep=security'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(out, /^security/m);
  assert.doesNotMatch(out, /^engineer/m);
});

test('worker-profile list renders short labels separately from tagline-style displayName', async () => {
  const lines = [];
  const code = await runCatalogList('worker-profile', [], {
    rootDir: ROOT,
    cwd: ROOT,
    println: (line) => lines.push(line),
  });
  assert.equal(code, 0);
  const engineerLine = lines.find((line) => line.startsWith('engineer'));
  assert.ok(engineerLine, 'expected engineer row in list output');
  assert.match(engineerLine, /^engineer\s+Engineer\s+/);
  assert.match(engineerLine, /Reads before writing/);
});

test('worker-profile create --help documents flags and output paths', () => {
  const out = execFileSync(process.execPath, [BIN, 'worker-profile', 'create', '--help'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(out, /--description=/);
  assert.match(out, /--skills=/);
  assert.match(out, /--scope=project\|user/);
  assert.match(out, /\.construct\/org\/worker-profiles\/<id>\.json/);
  assert.match(out, /\.construct\/org\/prompts\/<id>\.md/);
  assert.match(out, /~\/.construct\/org\/worker-profiles\/<id>\.json/);
});

test('worker-profile create then list and show include project-scoped custom profiles', async (t) => {
  const cwd = mkProject(t);
  const lines = [];
  const createCode = await runWorkerProfileCreate([
    'list-show-worker',
    '--description=Owns worker-profile list and show regression coverage',
    '--skills=development/typescript',
  ], {
    rootDir: ROOT,
    cwd,
    println: (line) => lines.push(line),
    errorln: (line) => lines.push(`ERR:${line}`),
  });
  assert.equal(createCode, 0, lines.join('\n'));

  const listLines = [];
  const listCode = await runCatalogList('worker-profile', ['--grep=list-show-worker'], {
    rootDir: ROOT,
    cwd,
    println: (line) => listLines.push(line),
  });
  assert.equal(listCode, 0);
  const listRow = listLines.find((line) => line.startsWith('list-show-worker'));
  assert.ok(listRow, `expected custom profile in list output:\n${listLines.join('\n')}`);
  assert.match(listRow, /\[project\]/);

  const showLines = [];
  const showCode = await runCatalogShow('worker-profile', ['list-show-worker'], {
    rootDir: ROOT,
    cwd,
    println: (line) => showLines.push(line),
    errorln: (line) => showLines.push(`ERR:${line}`),
  });
  assert.equal(showCode, 0, showLines.join('\n'));
  assert.ok(showLines.some((line) => line.startsWith('list-show-worker —')));
  assert.ok(showLines.some((line) => line.includes('Source: project (.construct/org/worker-profiles/list-show-worker.json)')));

  const jsonOut = execFileSync(process.execPath, [BIN, 'worker-profile', 'show', 'list-show-worker', '--json'], {
    cwd,
    encoding: 'utf8',
  });
  const shown = JSON.parse(jsonOut);
  assert.equal(shown.id, 'list-show-worker');
  assert.equal(shown.source, 'project');
});

test('worker-profile create scaffolds files that pass validate', async (t) => {
  const cwd = mkProject(t);
  const lines = [];
  const code = await runWorkerProfileCreate([
    'catalog-test-worker',
    '--description=Owns catalog CLI regression coverage for custom profiles',
    '--skills=development/typescript',
    '--allowed-paths=tests/**',
  ], {
    rootDir: ROOT,
    cwd,
    println: (line) => lines.push(line),
    errorln: (line) => lines.push(`ERR:${line}`),
  });
  assert.equal(code, 0, lines.join('\n'));
  const recordPath = path.join(cwd, '.construct/org/worker-profiles/catalog-test-worker.json');
  const promptPath = path.join(cwd, '.construct/org/prompts/catalog-test-worker.md');
  assert.ok(fs.existsSync(recordPath));
  assert.ok(fs.existsSync(promptPath));
  const validateCode = await runWorkerProfileValidate([`--file=${recordPath}`], {
    cwd,
    println: (line) => lines.push(line),
    errorln: (line) => lines.push(`ERR:${line}`),
  });
  assert.equal(validateCode, 0, lines.join('\n'));
});

test('worker-profile create is wired through the construct binary', (t) => {
  const cwd = mkProject(t);
  execFileSync(process.execPath, [
    BIN,
    'worker-profile',
    'create',
    'binary-test-worker',
    '--description=Owns binary-level worker profile create wiring checks',
    '--skills=development/typescript',
  ], { cwd });
  const recordPath = path.join(cwd, '.construct/org/worker-profiles/binary-test-worker.json');
  assert.ok(fs.existsSync(recordPath));
  const out = execFileSync(process.execPath, [BIN, 'worker-profile', 'validate', `--file=${recordPath}`], {
    cwd,
    encoding: 'utf8',
  });
  assert.match(out, /binary-test-worker.*is valid/);
});

test('canonical registry commands still list and show records', () => {
  for (const noun of ['worker-profile', 'procedure']) {
    const listed = execFileSync(process.execPath, [BIN, noun, 'list', '--json'], { cwd: ROOT, encoding: 'utf8' });
    const records = JSON.parse(listed);
    assert.ok(Array.isArray(records) && records.length > 0, `${noun} list should return records`);
    const shown = execFileSync(process.execPath, [BIN, noun, 'show', records[0].id], { cwd: ROOT, encoding: 'utf8' });
    if (noun === 'worker-profile') {
      assert.match(shown, new RegExp(records[0].id));
    } else {
      assert.equal(JSON.parse(shown).id, records[0].id);
    }
  }
});
