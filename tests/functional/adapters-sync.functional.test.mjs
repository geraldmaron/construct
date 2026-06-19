/**
 * adapters-sync.functional.test.mjs — npm run adapters / tool-repo bootstrap.
 */
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveAdapterHosts, syncProjectAdapters } from '../../lib/adapters-sync.mjs';
import { isConstructPackageRepo } from '../../lib/host-disposition.mjs';

test('resolveAdapterHosts forceAll returns all project hosts', () => {
  const hosts = resolveAdapterHosts({ forceAll: true });
  assert.ok(hosts.includes('claude'));
  assert.ok(hosts.includes('cursor'));
  assert.ok(hosts.includes('vscode'));
});

test('tool repo is detected as construct package', () => {
  assert.equal(isConstructPackageRepo(process.cwd()), true);
});

test('syncProjectAdapters stages launcher in tmp project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-adapt-'));
  try {
    mkdirSync(join(dir, '.cx'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo-app' }));
    const result = syncProjectAdapters({
      projectRoot: dir,
      packageRoot: process.cwd(),
      hosts: ['claude'],
      log: () => {},
    });
    assert.equal(result.staged, true);
    assert.ok(existsSync(join(dir, '.construct', 'run.mjs')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
