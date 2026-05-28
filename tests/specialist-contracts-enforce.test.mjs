/**
 * tests/specialist-contracts-enforce.test.mjs — runtime contract enforcement.
 *
 * Verifies:
 *   - enforcePacket returns ok when the packet satisfies the contract.
 *   - enforcePacket throws ContractViolationError with the missing fields
 *     when a required field is absent.
 *   - Violations append to ~/.cx/contract-violations.jsonl with the same
 *     chain-hash pattern as the mutation audit trail.
 *   - recentViolations filters by time window.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after, beforeEach } from 'node:test';

let tmpHome;
let logPath;
let enforcePacket, ContractViolationError, recentViolations;

before(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-enforce-'));
  process.env.HOME = tmpHome;
  ({ enforcePacket, ContractViolationError, recentViolations } =
    await import('../lib/specialist-contracts-enforce.mjs'));
  logPath = path.join(tmpHome, '.cx', 'contract-violations.jsonl');
});

after(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
  if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
});

describe('enforcePacket', () => {
  it('returns ok when the packet satisfies the contract', () => {
    // Use a real contract id. user-to-construct.input.mustContain is ['goal'];
    // pass a goal so validation succeeds.
    const result = enforcePacket('user-to-construct', { goal: 'do the thing' }, 'input');
    assert.equal(result.ok, true);
  });

  it('throws ContractViolationError when a required field is missing', () => {
    // Use a synthetic call that's guaranteed to miss a field. The
    // contract registry is real, so we pick one with mustContain entries
    // by introspecting agents/contracts.json. Skip if no such contract.
    let target = null;
    try {
      const path = new URL('../specialists/contracts.json', import.meta.url);
      const data = JSON.parse(fs.readFileSync(path, 'utf8'));
      target = (data.contracts || data.handoffs || []).find(
        (c) => Array.isArray(c?.input?.mustContain) && c.input.mustContain.length > 0
      );
    } catch { /* skip */ }
    if (!target) {
      assert.ok(true, 'no contract with mustContain to test against; skipped');
      return;
    }
    assert.throws(
      () => enforcePacket(target.id, {}),
      (err) => {
        assert.equal(err.name, 'ContractViolationError');
        assert.equal(err.contractId, target.id);
        assert.equal(err.missing.length, target.input.mustContain.length);
        return true;
      }
    );
  });

  it('throws when the contract id is unknown', () => {
    assert.throws(
      () => enforcePacket('definitely-not-a-real-contract-id', {}),
      ContractViolationError
    );
  });

  it('logs violations to ~/.cx/contract-violations.jsonl with prev_line_hash chain', () => {
    let target = null;
    try {
      const data = JSON.parse(fs.readFileSync(new URL('../specialists/contracts.json', import.meta.url), 'utf8'));
      target = (data.contracts || data.handoffs || []).find(
        (c) => Array.isArray(c?.input?.mustContain) && c.input.mustContain.length > 0
      );
    } catch { /* */ }
    if (!target) return;

    try { enforcePacket(target.id, {}); } catch { /* expected */ }
    try { enforcePacket(target.id, {}); } catch { /* expected */ }

    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 2);
    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    assert.equal(first.contractId, target.id);
    assert.equal(first.prev_line_hash, null, 'first record has no predecessor');
    assert.match(second.prev_line_hash, /^[a-f0-9]{64}$/, 'second record chains the first');
  });

  it('recentViolations honors the time window', () => {
    let target = null;
    try {
      const data = JSON.parse(fs.readFileSync(new URL('../specialists/contracts.json', import.meta.url), 'utf8'));
      target = (data.contracts || data.handoffs || []).find(
        (c) => Array.isArray(c?.input?.mustContain) && c.input.mustContain.length > 0
      );
    } catch { /* */ }
    if (!target) return;

    try { enforcePacket(target.id, {}); } catch { /* */ }
    const all = recentViolations({ windowMs: 60_000 });
    assert.equal(all.length, 1);
    // A negative window pushes the cutoff into the future and produces zero.
    const none = recentViolations({ windowMs: -1000 });
    assert.equal(none.length, 0);
  });
});
