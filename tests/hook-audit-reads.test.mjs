/**
 * tests/hook-audit-reads.test.mjs — opt-in read-audit hook tests.
 *
 * Verifies:
 *   - The hook is a no-op when CONSTRUCT_AUDIT_READS is unset.
 *   - When enabled, each Read appends a JSONL record with target, bytes,
 *     and content_hash.
 *   - The prev_line_hash chain is populated on the second and later entries.
 *   - Non-Read tool inputs do not produce records even when the env is set.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, before, after, beforeEach } from 'node:test';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');
const HOOK = path.join(ROOT, 'lib', 'hooks', 'audit-reads.mjs');

let tmpHome;
let auditFile;
let target;

before(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-audit-reads-'));
  auditFile = path.join(tmpHome, '.cx', 'audit-reads.jsonl');
  target = path.join(tmpHome, 'sample.txt');
  fs.writeFileSync(target, 'hello world');
});

after(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
  if (fs.existsSync(auditFile)) fs.unlinkSync(auditFile);
});

function runHook(input, { auditReads = '1' } = {}) {
  return spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    input: JSON.stringify(input),
    env: {
      ...process.env,
      HOME: tmpHome,
      CONSTRUCT_AUDIT_READS: auditReads,
    },
    timeout: 5000,
  });
}

describe('audit-reads hook', () => {
  it('is a no-op when CONSTRUCT_AUDIT_READS is unset', () => {
    runHook({ tool_name: 'Read', tool_input: { file_path: target } }, { auditReads: '' });
    assert.equal(fs.existsSync(auditFile), false, 'must not create audit file when disabled');
  });

  it('appends a record when enabled', () => {
    runHook({ tool_name: 'Read', tool_input: { file_path: target } });
    assert.equal(fs.existsSync(auditFile), true);
    const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1);
    const rec = JSON.parse(lines[0]);
    assert.equal(rec.tool, 'Read');
    assert.equal(rec.target, target);
    assert.equal(rec.bytes, 11);
    assert.match(rec.content_hash, /^[a-f0-9]{32}$/);
    assert.equal(rec.prev_line_hash, null);
  });

  it('chains prev_line_hash on subsequent entries', () => {
    runHook({ tool_name: 'Read', tool_input: { file_path: target } });
    runHook({ tool_name: 'Read', tool_input: { file_path: target } });
    const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    const second = JSON.parse(lines[1]);
    assert.match(second.prev_line_hash, /^[a-f0-9]{64}$/, 'second record must chain a sha256 of the first');
  });

  it('ignores non-Read tool inputs', () => {
    runHook({ tool_name: 'Edit', tool_input: { file_path: target } });
    assert.equal(fs.existsSync(auditFile), false);
  });
});
