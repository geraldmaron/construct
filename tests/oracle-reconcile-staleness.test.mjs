/**
 * tests/oracle-reconcile-staleness.test.mjs — contract violation SLA window logic.
 *
 * Tests planContractViolationSupersede staleness boundaries (violations fresh vs
 * stale relative to the 24-hour window), contract-violation counting, and supersede
 * decision logic.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { planContractViolationSupersede } from '../lib/oracle/reconcile.mjs';
import { logViolation, markContractViolationsSuperseded } from '../lib/contracts/violation-log.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function freshProjectDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-reconcile-'));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, '.cx'), { recursive: true });
  return dir;
}

function injectViolation(projectDir, contractId, direction, age) {
  const ts = new Date(Date.now() - age).toISOString();
  const logFile = path.join(projectDir, '.cx', 'contract-violations.jsonl');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const record = {
    ts,
    sequence: 1,
    agent: 'test',
    contractId,
    direction,
    missing: [],
    packet_keys: null,
    prev_line_hash: null,
  };
  fs.appendFileSync(logFile, JSON.stringify(record) + '\n');
}

describe('planContractViolationSupersede SLA window (24h)', () => {
  it('returns no supersede when no violations exist', () => {
    const projectDir = freshProjectDir();
    const plan = planContractViolationSupersede(projectDir);
    assert.equal(plan.shouldSupersede, false);
    assert.equal(plan.recentCount, 0);
  });

  it('returns no supersede when violations are non-probe contract failures', () => {
    const projectDir = freshProjectDir();
    const logFile = path.join(projectDir, '.cx', 'contract-violations.jsonl');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const record = {
      ts: new Date().toISOString(),
      sequence: 1,
      agent: 'test',
      contractId: 'some-contract',
      direction: 'output',
      missing: ['field1'],
      packet_keys: null,
      prev_line_hash: null,
      verdict: 'CONTRACT_VIOLATION',
    };
    fs.writeFileSync(logFile, JSON.stringify(record) + '\n');
    const plan = planContractViolationSupersede(projectDir);
    assert.equal(plan.shouldSupersede, false);
    assert.equal(plan.recentCount, 1);
  });

  it('detects violations exactly at SLA boundary (24 hours)', () => {
    const projectDir = freshProjectDir();
    const boundaryMs = 24 * 60 * 60 * 1000;
    const logFile = path.join(projectDir, '.cx', 'contract-violations.jsonl');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });

    // Pin one clock for both the fixture and the check: the boundary
    // comparison is exact (ts === now - windowMs), so letting the code under
    // test take its own Date.now() makes this assertion a race against
    // elapsed wall time rather than a test of the boundary rule.

    const now = Date.now();
    const ts = new Date(now - boundaryMs).toISOString();
    const record = {
      ts,
      sequence: 1,
      agent: 'test',
      contractId: 'oracle-input',
      direction: 'input',
      missing: [],
      packet_keys: null,
      prev_line_hash: null,
    };
    fs.writeFileSync(logFile, JSON.stringify(record) + '\n');
    const plan = planContractViolationSupersede(projectDir, { now });
    assert.equal(plan.recentCount, 1, 'should count violations exactly at boundary');
  });

  it('excludes violations older than SLA window (24 hours + 1ms)', () => {
    const projectDir = freshProjectDir();
    const boundaryMs = 24 * 60 * 60 * 1000;
    const logFile = path.join(projectDir, '.cx', 'contract-violations.jsonl');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });

    const ts = new Date(Date.now() - boundaryMs - 1).toISOString();
    const record = {
      ts,
      sequence: 1,
      agent: 'test',
      contractId: 'oracle-input',
      direction: 'input',
      missing: [],
      packet_keys: null,
      prev_line_hash: null,
    };
    fs.writeFileSync(logFile, JSON.stringify(record) + '\n');
    const plan = planContractViolationSupersede(projectDir);
    assert.equal(plan.recentCount, 0, 'should exclude violations older than window');
    assert.equal(plan.shouldSupersede, false);
  });

  it('includes violations fresher than SLA window (24 hours - 1ms)', () => {
    const projectDir = freshProjectDir();
    const boundaryMs = 24 * 60 * 60 * 1000;
    const logFile = path.join(projectDir, '.cx', 'contract-violations.jsonl');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });

    const ts = new Date(Date.now() - boundaryMs + 1).toISOString();
    const record = {
      ts,
      sequence: 1,
      agent: 'test',
      contractId: 'oracle-input',
      direction: 'input',
      missing: [],
      packet_keys: null,
      prev_line_hash: null,
    };
    fs.writeFileSync(logFile, JSON.stringify(record) + '\n');
    const plan = planContractViolationSupersede(projectDir);
    assert.equal(plan.recentCount, 1, 'should include violations fresher than window');
  });

  it('counts multiple recent violations', () => {
    const projectDir = freshProjectDir();
    const logFile = path.join(projectDir, '.cx', 'contract-violations.jsonl');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });

    for (let i = 0; i < 3; i++) {
      const record = {
        ts: new Date(Date.now() - (10 * 60 * 1000 * i)).toISOString(),
        sequence: i + 1,
        agent: 'test',
        contractId: `contract-${i}`,
        direction: 'input',
        missing: [],
        packet_keys: null,
        prev_line_hash: null,
      };
      fs.appendFileSync(logFile, JSON.stringify(record) + '\n');
    }
    const plan = planContractViolationSupersede(projectDir);
    assert.equal(plan.recentCount, 3);
  });

  it('respects existing supersede marker: violations before marker are ignored', () => {
    const projectDir = freshProjectDir();
    const logFile = path.join(projectDir, '.cx', 'contract-violations.jsonl');
    fs.mkdirSync(path.dirname(logFile), { recursive: true });

    const beforeMarker = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const afterMarker = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

    const beforeRecord = {
      ts: beforeMarker,
      sequence: 1,
      agent: 'test',
      contractId: 'oracle-input',
      direction: 'input',
      missing: [],
      packet_keys: null,
      prev_line_hash: null,
    };
    const afterRecord = {
      ts: afterMarker,
      sequence: 2,
      agent: 'test',
      contractId: 'oracle-input',
      direction: 'input',
      missing: [],
      packet_keys: null,
      prev_line_hash: null,
    };
    fs.writeFileSync(logFile, JSON.stringify(beforeRecord) + '\n' + JSON.stringify(afterRecord) + '\n');

    const markerTime = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();
    const markerFile = path.join(projectDir, '.cx', 'contract-violations-superseded.json');
    fs.writeFileSync(markerFile, JSON.stringify({ supersededBefore: markerTime }) + '\n');

    const plan = planContractViolationSupersede(projectDir);
    assert.equal(plan.recentCount, 1, 'should count only violations after marker');
  });
});
