/**
 * tests/orchestration-context-bindings.test.mjs — unit coverage for the
 * per-run context-target binding resolver (bead construct-760c.4).
 *
 * Covers the pure resolution layer under the functional test: unknown-id hard
 * error, free-form role threading, content-root resolution for a directory
 * target, dedup, and the omission → empty-list default.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveContextBindings, ContextTargetError } from '../lib/orchestration/context-bindings.mjs';
import { rmTmpDir } from './helpers/cleanup.mjs';

const tmp = [];
test.after(() => { for (const d of tmp) { try { rmTmpDir(d); } catch {} } });
function freshDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmp.push(dir);
  return dir;
}

function configWith(targets) {
  return { sources: { targets } };
}

test('omission resolves to an empty list (today\'s implicit resolution, unchanged)', () => {
  assert.deepEqual(resolveContextBindings(null, { config: configWith([]) }), []);
  assert.deepEqual(resolveContextBindings([], { config: configWith([]) }), []);
});

test('a directory target resolves a reachable contentRoot and threads the free-form role', () => {
  const docs = freshDir('cx-ctx-dir-');
  const config = configWith([{ id: 'proj-app', provider: 'directory', selector: { path: docs } }]);
  const bindings = resolveContextBindings([{ id: 'proj-app', role: 'reference' }], { config, cwd: docs });
  assert.equal(bindings.length, 1);
  assert.deepEqual(bindings[0], {
    id: 'proj-app', provider: 'directory', role: 'reference',
    resolution: 'resolved', contentRoot: docs, ref: null,
  });
});

test('a non-content target (jira) resolves with a null contentRoot', () => {
  const config = configWith([{ id: 'jira-core', provider: 'jira', selector: { project: 'CORE' } }]);
  const bindings = resolveContextBindings(['jira-core'], { config });
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].provider, 'jira');
  assert.equal(bindings[0].contentRoot, null);
  assert.equal(bindings[0].role, null, 'string form implies no role');
});

test('an unknown id throws ContextTargetError naming the id and the known targets', () => {
  const config = configWith([{ id: 'proj-app', provider: 'directory', selector: { path: os.tmpdir() } }]);
  assert.throws(
    () => resolveContextBindings(['proj-nope'], { config, cwd: os.tmpdir() }),
    (err) => err instanceof ContextTargetError && err.code === 'CONTEXT_TARGET_UNKNOWN'
      && /proj-nope/.test(err.message) && /proj-app/.test(err.message),
  );
});

test('duplicate ids collapse to one binding', () => {
  const docs = freshDir('cx-ctx-dup-');
  const config = configWith([{ id: 'proj-app', provider: 'directory', selector: { path: docs } }]);
  const bindings = resolveContextBindings(['proj-app', { id: 'proj-app', role: 'x' }], { config, cwd: docs });
  assert.equal(bindings.length, 1, 'first occurrence wins, later dupes dropped');
  assert.equal(bindings[0].role, null);
});
