/**
 * tests/providers/instance-config-concurrency.test.mjs — reload-and-rebase write durability.
 *
 * Guards against last-writer-wins clobber when two configure flows race on the
 * same provider id. writeInstanceConfig reloads disk and rebases leaf deltas
 * from baseConfig so concurrent writers touching different keys merge cleanly;
 * same-key races surface InstanceConfigWriteConflictError.
 *
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmTmpDir } from '../helpers/cleanup.mjs';
import {
  readInstanceConfig,
  writeInstanceConfig,
  rebaseInstanceConfig,
  InstanceConfigWriteConflictError,
} from '../../lib/providers/instance-config.mjs';

function freshRoot() {
  return mkdtempSync(join(tmpdir(), 'construct-instance-config-conc-'));
}

test('rebaseInstanceConfig merges concurrent writers on different keys', () => {
  const base = { jql: 'project = X', maxResults: 20, kind: 'issues' };
  const writerA = { ...base, jql: 'project = Y' };
  const writerB = { ...base, maxResults: 50 };
  const afterA = rebaseInstanceConfig(base, writerA, base);
  const merged = rebaseInstanceConfig(base, writerB, afterA);
  assert.equal(merged.jql, 'project = Y');
  assert.equal(merged.maxResults, 50);
});

test('rebaseInstanceConfig throws when two writers change the same leaf', () => {
  const base = { jql: 'project = X', maxResults: 20 };
  const disk = { jql: 'project = Y', maxResults: 20 };
  const incoming = { jql: 'project = Z', maxResults: 20 };
  assert.throws(
    () => rebaseInstanceConfig(base, incoming, disk),
    InstanceConfigWriteConflictError,
  );
});

test('writeInstanceConfig without baseConfig preserves legacy overwrite behavior on create', () => {
  const root = freshRoot();
  try {
    writeInstanceConfig(root, 'github', { kind: 'issues' });
    writeInstanceConfig(root, 'github', { kind: 'pulls' });
    const record = readInstanceConfig(root, 'github');
    assert.equal(record.config.kind, 'pulls');
  } finally {
    rmTmpDir(root);
  }
});

test('writeInstanceConfig rebases stale reads so different-key races do not drop edits', () => {
  const root = freshRoot();
  try {
    const base = { jql: 'project = X', maxResults: 20, kind: 'issues' };
    writeInstanceConfig(root, 'atlassian-jira', base);

    const staleBase = JSON.parse(JSON.stringify(base));
    writeInstanceConfig(root, 'atlassian-jira', { ...staleBase, jql: 'project = Y' }, { baseConfig: staleBase });
    writeInstanceConfig(root, 'atlassian-jira', { ...staleBase, maxResults: 50 }, { baseConfig: staleBase });

    const finalRecord = readInstanceConfig(root, 'atlassian-jira');
    assert.equal(finalRecord.config.jql, 'project = Y');
    assert.equal(finalRecord.config.maxResults, 50);
  } finally {
    rmTmpDir(root);
  }
});

test('writeInstanceConfig red proof: stale full overwrite would drop a concurrent key change', () => {
  const root = freshRoot();
  try {
    const base = { jql: 'project = X', maxResults: 20 };
    writeInstanceConfig(root, 'atlassian-jira', base);

    const staleBase = JSON.parse(JSON.stringify(base));
    writeInstanceConfig(root, 'atlassian-jira', { ...staleBase, jql: 'project = Y' }, { baseConfig: staleBase });

    const staleWrite = { ...staleBase, maxResults: 50 };
    writeInstanceConfig(root, 'atlassian-jira', staleWrite);
    const lostUpdate = readInstanceConfig(root, 'atlassian-jira');
    assert.notEqual(lostUpdate.config.jql, 'project = Y', 'plain overwrite must drop the concurrent jql edit');
  } finally {
    rmTmpDir(root);
  }
});
