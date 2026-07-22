/**
 * tests/adapters-lean-bootstrap.test.mjs — lean postinstall/init host selection
 * (construct-w4hly). Fresh projects get Claude only; already-marked hosts are
 * preserved; CONSTRUCT_SYNC_HOSTS opts in without PATH detection.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  resolveLeanBootstrapHosts,
  resolvePostinstallHosts,
  HOST_ID_MAP,
} from '../lib/adapters-sync.mjs';
import { rmTmpDir } from './helpers/cleanup.mjs';

test('resolveLeanBootstrapHosts defaults to claude only on an empty project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-lean-empty-'));
  try {
    assert.deepEqual(resolveLeanBootstrapHosts(dir), ['claude']);
  } finally {
    rmTmpDir(dir);
  }
});

test('resolveLeanBootstrapHosts unions --with extras without inventing PATH hosts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-lean-extra-'));
  try {
    assert.deepEqual(
      resolveLeanBootstrapHosts(dir, { extra: ['codex', 'cursor'] }),
      ['claude', 'codex', 'cursor'],
    );
  } finally {
    rmTmpDir(dir);
  }
});

test('resolveLeanBootstrapHosts preserves hosts that already have Construct markers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-lean-marked-'));
  try {
    mkdirSync(join(dir, '.codex', 'agents'), { recursive: true });
    writeFileSync(join(dir, '.codex', 'agents', 'construct.toml'), '# fixture\n');
    mkdirSync(join(dir, '.cursor'), { recursive: true });
    writeFileSync(join(dir, '.cursor', 'mcp.json'), '{}\n');
    assert.deepEqual(resolveLeanBootstrapHosts(dir), ['claude', 'codex', 'cursor']);
  } finally {
    rmTmpDir(dir);
  }
});

test('resolvePostinstallHosts honors CONSTRUCT_SYNC_HOSTS=all', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-lean-env-all-'));
  try {
    const hosts = resolvePostinstallHosts(dir, { env: { CONSTRUCT_SYNC_HOSTS: 'all' } });
    assert.deepEqual([...hosts].sort(), [...new Set(Object.values(HOST_ID_MAP))].sort());
  } finally {
    rmTmpDir(dir);
  }
});

test('resolvePostinstallHosts honors CONSTRUCT_SYNC_HOSTS list and keeps markers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cx-lean-env-list-'));
  try {
    mkdirSync(join(dir, '.opencode'), { recursive: true });
    writeFileSync(join(dir, '.opencode', 'opencode.json'), '{}\n');
    const hosts = resolvePostinstallHosts(dir, { env: { CONSTRUCT_SYNC_HOSTS: 'vscode' } });
    assert.deepEqual(hosts, ['claude', 'opencode', 'vscode']);
  } finally {
    rmTmpDir(dir);
  }
});
