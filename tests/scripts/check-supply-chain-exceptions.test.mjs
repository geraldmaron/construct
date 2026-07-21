/**
 * tests/scripts/check-supply-chain-exceptions.test.mjs — expiring exception gate
 * for construct-tsyfe.10.1.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
const __hygieneTmpDirs = [];
test.after(() => {
  for (const dir of __hygieneTmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

import { evaluateSupplyChainExceptions } from '../../scripts/check-supply-chain-exceptions.mjs';

function writeExceptions(dir, exceptions) {
  const filePath = join(dir, 'exceptions.json');
  writeFileSync(filePath, JSON.stringify({ version: 1, exceptions }, null, 2));
  return filePath;
}

test('expired fixture entry fails and names the entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supply-chain-exc-'));
  __hygieneTmpDirs.push(dir);
  const filePath = writeExceptions(dir, [
    {
      id: 'GHSA-fixture-expired',
      reason: 'fixture only',
      expires: '2020-01-01',
    },
  ]);
  const result = evaluateSupplyChainExceptions({
    now: new Date('2026-07-20T12:00:00Z'),
    filePath,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('GHSA-fixture-expired')));
  assert.ok(result.errors.some((e) => e.includes('expired on 2020-01-01')));
});

test('active fixture entry within its window passes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'supply-chain-exc-'));
  __hygieneTmpDirs.push(dir);
  const filePath = writeExceptions(dir, [
    {
      id: 'GHSA-fixture-active',
      reason: 'fixture only',
      expires: '2099-12-31',
    },
  ]);
  const result = evaluateSupplyChainExceptions({
    now: new Date('2026-07-20T12:00:00Z'),
    filePath,
  });
  assert.equal(result.ok, true);
  assert.equal(result.active.length, 1);
  assert.equal(result.expired.length, 0);
});

test('real exceptions registry has zero expired entries', () => {
  const result = evaluateSupplyChainExceptions({ now: new Date('2026-07-20T12:00:00Z') });
  assert.equal(result.ok, true, result.errors.join('\n'));
});
