/**
 * adapters-sync.functional.test.mjs — npm run adapters / tool-repo bootstrap.
 */
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveAdapterHosts, syncProjectAdapters, HOST_ID_MAP } from '../../lib/adapters-sync.mjs';
import { isConstructPackageRepo } from '../../lib/host-disposition.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

test('resolveAdapterHosts forceAll returns every host in HOST_ID_MAP', () => {
  // A host present in HOST_ID_MAP but missing from forceAll's return value
  // gets its adapter files deleted as "stale" on any contributor machine that
  // doesn't have that host installed (sync-worker-profiles.mjs prunes whatever
  // isn't in the --hosts= selection) — this must stay exhaustive, not a
  // spot-check of a few names, or an incident like the missing 'copilot'
  // entry (which deleted the committed .github/agents/construct.agent.md)
  // can recur silently for any future host.
  const hosts = resolveAdapterHosts({ forceAll: true });
  const expected = [...new Set(Object.values(HOST_ID_MAP))].sort();
  assert.deepEqual([...hosts].sort(), expected);
});

test('tool repo is detected as construct package', () => {
  assert.equal(isConstructPackageRepo(process.cwd()), true);
});

test('syncProjectAdapters stages launcher in tmp project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-adapt-'));
  try {
    mkdirSync(join(dir, '.construct'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo-app' }));
    const result = syncProjectAdapters({
      projectRoot: dir,
      packageRoot: process.cwd(),
      hosts: ['claude'],
      log: () => {},
    });
    assert.equal(result.staged, true);
    assert.ok(existsSync(join(dir, '.construct', 'launcher', 'run.mjs')));
  } finally {
    rmTmpDir(dir);
  }
});
