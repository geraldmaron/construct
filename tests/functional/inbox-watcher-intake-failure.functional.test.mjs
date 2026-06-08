/**
 * tests/functional/inbox-watcher-intake-failure.functional.test.mjs —
 * The dedup manifest only records a SHA on successful intake-packet creation
 * (construct-k4bg). On packet-creation failure the file stays retriable: a
 * subsequent explicit `intake process` must not skip-as-duplicate.
 *
 * The bug: InboxWatcher recorded the SHA whether or not the packet was
 * created. Stranded files manifested as "Processed: 0, Skipped (unchanged): 1"
 * from explicit intake-process with an empty `intake list`. Fix gates the
 * recordFile call on a non-null intakeId.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { InboxWatcher } from '../../lib/embed/inbox.mjs';
import { loadManifest } from '../../lib/intake/manifest.mjs';

const tmpDirs = [];

after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-k4bg-'));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, '.cx', 'inbox'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.cx', 'intake', 'pending'), { recursive: true });
  // Enable the project inbox scan; without intake-config the watcher's source
  // list is empty and poll() is a no-op.
  fs.writeFileSync(
    path.join(dir, '.cx', 'intake-config.json'),
    JSON.stringify({ includeProjectInbox: true, parentDirs: [], maxDepth: 2 }),
    'utf8',
  );
  // Seed an empty dedup manifest — its presence is the watcher's signal to
  // compute SHAs and consult the manifest gate at all. Mirrors what init does
  // for archetype profiles via intake/manifest.mjs:saveManifest.
  fs.writeFileSync(
    path.join(dir, '.cx', 'intake', 'manifest.json'),
    JSON.stringify({ version: 1, files: {} }, null, 2),
    'utf8',
  );
  return dir;
}

function dropInboxFile(projectDir, name, content) {
  const filePath = path.join(projectDir, '.cx', 'inbox', name);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function shasInManifest(projectDir) {
  const manifest = loadManifest(projectDir);
  return new Set(Object.keys(manifest?.files || {}));
}

test('manifest records the SHA when intake-packet creation succeeds', async () => {
  const project = makeProject();
  dropInboxFile(project, 'success.md', '# Hello\n\nA dropped note.\n');

  const watcher = new InboxWatcher({
    rootDir: project,
    cwd: project,
    env: { ...process.env, HOME: project },
    prepareIntakeFn: async () => ({ id: 'pkt_test_success' }),
  });
  const result = await watcher.poll();

  assert.equal(result.errors?.length ?? 0, 0, `unexpected errors: ${JSON.stringify(result.errors)}`);
  const recorded = shasInManifest(project);
  assert.ok(recorded.size > 0, 'expected at least one SHA recorded on successful packet creation');
});

test('manifest does NOT record the SHA when intake-packet creation throws', async () => {
  const project = makeProject();
  dropInboxFile(project, 'failure-throw.md', '# Hello\n\nAnother dropped note.\n');

  const watcher = new InboxWatcher({
    rootDir: project,
    cwd: project,
    env: { ...process.env, HOME: project, CONSTRUCT_DEBUG_INTAKE: '1' },
    prepareIntakeFn: async () => { throw new Error('simulated DB failure'); },
  });
  const result = await watcher.poll();

  assert.equal(result.errors?.length ?? 0, 0, 'intake failure must not propagate as a watcher error');
  const recorded = shasInManifest(project);
  assert.equal(recorded.size, 0, 'manifest must NOT record the SHA when intake creation failed');
});

test('manifest does NOT record the SHA when intake returns null id', async () => {
  const project = makeProject();
  dropInboxFile(project, 'failure-null.md', '# Hello\n\nYet another note.\n');

  const watcher = new InboxWatcher({
    rootDir: project,
    cwd: project,
    env: { ...process.env, HOME: project },
    prepareIntakeFn: async () => ({ id: null }),
  });
  const result = await watcher.poll();

  assert.equal(result.errors?.length ?? 0, 0, 'silent null-id must not propagate as a watcher error');
  const recorded = shasInManifest(project);
  assert.equal(recorded.size, 0, 'manifest must NOT record the SHA when intake returned no id');
});
