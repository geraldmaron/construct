/**
 * tests/contracts/gate-cli-list.test.mjs — the enforcement inventory surface
 * (`construct contract list`, construct-33nds).
 *
 * The inventory is what an operator trusts when deciding which rungs need
 * staffing, so its failure mode matters more than its formatting: a contract
 * whose level cannot resolve must appear as an invalid row and drive a nonzero
 * exit, never be quietly dropped from a list that then reads as complete.
 *
 * rootDir points at a fixture tree so these assertions pin the surface rather
 * than the project's current policy choices.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runContractGateCli } from '../../lib/contracts/gate-cli.mjs';

function fixtureRoot(contracts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-contract-list-'));
  const dir = path.join(root, 'registry', 'contracts');
  fs.mkdirSync(dir, { recursive: true });
  for (const contract of contracts) {
    fs.writeFileSync(path.join(dir, `${contract.id}.json`), JSON.stringify(contract));
  }
  return root;
}

function runList(args, rootDir) {
  const out = [];
  const err = [];
  const code = runContractGateCli(['list', ...args], {
    projectRoot: rootDir,
    rootDir,
    println: (line) => out.push(line),
    errorln: (line) => err.push(line),
  });
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}

const hard = {
  id: 'c-hard',
  producer: 'architect',
  consumer: 'security',
  trigger: { artifactType: 'compliance-memo', riskFlags: ['compliance'] },
  enforcementLevel: 'hard',
  approvalWorkerProfiles: ['security'],
};

const soft = {
  id: 'c-soft',
  trigger: { riskFlags: ['privacy'] },
  enforcementLevel: 'soft',
  approvalWorkerProfiles: ['security'],
};

const advisory = { id: 'c-advisory', trigger: { riskFlags: ['licensing'] } };

test('the inventory lists every contract, strongest rung first', () => {
  const root = fixtureRoot([advisory, soft, hard]);
  try {
    const result = runList([], root);
    assert.equal(result.code, 0);
    const order = ['c-hard', 'c-soft', 'c-advisory'].map((id) => result.stdout.indexOf(id));
    assert.ok(order.every((index) => index >= 0), `all contracts should be listed: ${result.stdout}`);
    assert.deepEqual([...order].sort((a, b) => a - b), order, `hard should precede soft precede advisory: ${result.stdout}`);
    assert.match(result.stdout, /3 contract\(s\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the inventory names who can clear each enforcing rung', () => {
  const root = fixtureRoot([soft, hard]);
  try {
    const result = runList([], root);
    assert.match(result.stdout, /c-hard[\s\S]*clears by: sign-off from security/);
    assert.match(result.stdout, /c-soft[\s\S]*clears by: sign-off from security, or a recorded override/);
    assert.match(result.stdout, /c-hard[\s\S]*handoff:\s+architect → security/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('--enforcing drops advisory rows — the set that needs approvers staffed', () => {
  const root = fixtureRoot([advisory, soft, hard]);
  try {
    const result = runList(['--enforcing'], root);
    assert.equal(result.code, 0);
    assert.ok(result.stdout.includes('c-hard') && result.stdout.includes('c-soft'));
    assert.equal(result.stdout.includes('c-advisory'), false, `advisory should be filtered out: ${result.stdout}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a contract whose level cannot resolve is an invalid row and a nonzero exit', () => {
  const root = fixtureRoot([hard, { id: 'c-bad', trigger: { riskFlags: ['compliance'] }, enforcementLevel: 'blocking' }]);
  try {
    const result = runList([], root);
    assert.equal(result.code, 1, 'a broken rung must not exit 0 — a scripted check would read it as healthy');
    assert.match(result.stdout, /\[invalid\] c-bad/);
    assert.match(result.stderr, /unknown enforcementLevel 'blocking'/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a broken rung survives the --enforcing filter rather than being hidden by it', () => {
  const root = fixtureRoot([advisory, { id: 'c-bad', trigger: { riskFlags: ['compliance'] }, enforcementLevel: 'blocking' }]);
  try {
    const result = runList(['--enforcing'], root);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /\[invalid\] c-bad/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('--json carries the rungs and the resolution errors', () => {
  const root = fixtureRoot([hard, { id: 'c-bad', trigger: { riskFlags: ['compliance'] }, enforcementLevel: 'blocking' }]);
  try {
    const result = runList(['--json'], root);
    assert.equal(result.code, 1);
    const payload = JSON.parse(result.stdout);
    const hardRow = payload.contracts.find((row) => row.contractId === 'c-hard');
    assert.equal(hardRow.level, 'hard');
    assert.deepEqual(hardRow.approvalWorkerProfiles, ['security']);
    assert.equal(payload.errors.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unreadable contract set fails the inventory rather than reporting none', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-contract-list-broken-'));
  try {
    fs.mkdirSync(path.join(root, 'registry'), { recursive: true });
    fs.writeFileSync(path.join(root, 'registry', 'contracts'), 'not a directory');
    const result = runList([], root);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Contract set unreadable/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
