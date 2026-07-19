import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadAllProcedures, loadProceduresFromDir, mergeProcedures, resolveProcedureDirs } from '../../lib/procedures/loader.mjs';

const record = (overrides = {}) => ({
  id: 'sample', version: '1.0.0', type: 'linear', workerProfiles: ['architect'],
  approvalMode: 'proposal-only', modelTier: 'standard', state: 'active', ...overrides,
});

test('built-in Procedures load only from registry/procedures', () => {
  const dirs = resolveProcedureDirs();
  assert.match(dirs.builtin, /registry\/procedures$/);
  assert.match(dirs.project, /\.construct\/procedures$/);
  assert.ok(dirs.pack.every((dir) => dir.endsWith('/procedures')));
  const { manifests, errors } = loadProceduresFromDir(dirs.builtin, { strict: true });
  assert.deepEqual(errors, []);
  assert.equal(manifests.length, 15);
});

test('strict loading rejects retired fields and unknown noise', () => {
  const dir = mkdtempSync(join(tmpdir(), 'construct-procedure-'));
  try {
    writeFileSync(join(dir, 'bad.json'), JSON.stringify(record({ roleChain: ['architect'] })));
    const result = loadProceduresFromDir(dir, { strict: true });
    assert.equal(result.manifests.length, 0);
    assert.ok(result.errors.some((error) => error.includes("unknown field 'roleChain'")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('project Procedure overrides pack and built-in records by id', () => {
  const merged = mergeProcedures(
    [record({ modelTier: 'cheap', _source: 'builtin' })],
    [record({ modelTier: 'standard', _source: 'pack' })],
    [record({ modelTier: 'strong', _source: 'project' })],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].modelTier, 'strong');
  assert.equal(merged[0]._shadowedBy.length, 2);
});

test('project extension directory is .construct/procedures', () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-procedure-project-'));
  try {
    const dir = join(root, '.construct', 'procedures');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'triage.json'), JSON.stringify(record({ id: 'triage', modelTier: 'strong' })));
    const { procedures, errors } = loadAllProcedures({ rootDir: root });
    assert.deepEqual(errors, []);
    assert.equal(procedures.find((procedure) => procedure.id === 'triage').modelTier, 'strong');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
