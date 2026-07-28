/**
 * tests/functional/contract-enforcement.functional.test.mjs — the contract
 * enforcement ladder driven through the real binary in an isolated tmpdir
 * (construct-uizpv.5).
 *
 * Covers the three paths the ladder exists to provide: a hard contract blocks
 * release until its declared approver signs off, a soft contract clears via a
 * recorded override, and the override leaves an audit-trail entry. State root
 * and HOME are pinned so no assertion depends on — or mutates — real host
 * config.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = path.join(REPO, 'bin', 'construct');

const HARD_CONTRACT = 'legal-compliance-to-release-manager';
const SOFT_CONTRACT = 'architect-to-legal-compliance';

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-contract-gate-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-contract-home-'));
  return { dir, home };
}

function run(args, { dir, home }) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      CONSTRUCT_HOME_OVERRIDE: home,
      NODE_ENV: 'test',
    },
  });
}

function writeMemo(dir, name, riskFlags) {
  const file = path.join(dir, name);
  fs.writeFileSync(
    file,
    `---\ncx_risk_flags: ${riskFlags}\n---\n\n# Compliance Memo\n\n## Regulatory Citations\n\nunknown\n\n## Remediation Plan\n\nresidual risk accepted\n`,
  );
  return file;
}

test('a hard contract blocks release until its declared approver signs off', () => {
  const ws = makeWorkspace();
  try {
    const file = writeMemo(ws.dir, 'memo.md', 'compliance');

    const blocked = run(['contract', 'status', file, '--type=compliance-memo', '--json'], ws);
    assert.equal(blocked.status, 1, `expected a blocked gate, got: ${blocked.stdout}${blocked.stderr}`);
    const before = JSON.parse(blocked.stdout);
    const hardBlock = before.contractGate.blocked.find((entry) => entry.contractId === HARD_CONTRACT);
    assert.ok(hardBlock, `expected ${HARD_CONTRACT} to block: ${JSON.stringify(before.contractGate)}`);
    assert.equal(hardBlock.level, 'hard');
    assert.match(hardBlock.reason, /pending sign-off from: security/);

    const override = run(['contract', 'override', HARD_CONTRACT, '--reason=shipping anyway'], ws);
    assert.equal(override.status, 1, 'a hard rung must refuse an override rather than no-op');
    assert.match(override.stderr, /cannot be overridden/);

    const signOff = run(['contract', 'sign-off', HARD_CONTRACT, '--as=security', `--artifact=${file}`], ws);
    assert.equal(signOff.status, 0, `sign-off failed: ${signOff.stderr}`);

    const after = run(['contract', 'status', file, '--type=compliance-memo', '--json'], ws);
    const cleared = JSON.parse(after.stdout);
    assert.equal(
      cleared.contractGate.blocked.some((entry) => entry.contractId === HARD_CONTRACT),
      false,
      `${HARD_CONTRACT} should be cleared after sign-off: ${JSON.stringify(cleared.contractGate)}`,
    );
    const evaluated = cleared.contractGate.evaluated.find((entry) => entry.contractId === HARD_CONTRACT);
    assert.equal(evaluated.clearedBy, 'sign-off');
  } finally {
    rmTmpDir(ws.dir);
    rmTmpDir(ws.home);
  }
});

test('a non-approver cannot sign off a contract', () => {
  const ws = makeWorkspace();
  try {
    const result = run(['contract', 'sign-off', HARD_CONTRACT, '--as=product-manager'], ws);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /is not an approver/);
  } finally {
    rmTmpDir(ws.dir);
    rmTmpDir(ws.home);
  }
});

test('a soft contract clears via a recorded override and writes an audit entry', () => {
  const ws = makeWorkspace();
  try {
    const file = writeMemo(ws.dir, 'design.md', 'privacy');

    const before = run(['contract', 'status', file, '--type=design-doc', '--json'], ws);
    const blocked = JSON.parse(before.stdout);
    const softBlock = blocked.contractGate.blocked.find((entry) => entry.contractId === SOFT_CONTRACT);
    assert.ok(softBlock, `expected ${SOFT_CONTRACT} to block: ${JSON.stringify(blocked.contractGate)}`);
    assert.equal(softBlock.level, 'soft');

    const override = run(
      ['contract', 'override', SOFT_CONTRACT, '--reason=accepted residual risk', `--artifact=${file}`, '--actor=gerald'],
      ws,
    );
    assert.equal(override.status, 0, `override failed: ${override.stderr}`);

    const after = run(['contract', 'status', file, '--type=design-doc', '--json'], ws);
    const cleared = JSON.parse(after.stdout);
    assert.equal(
      cleared.contractGate.blocked.some((entry) => entry.contractId === SOFT_CONTRACT),
      false,
      'soft contract should clear after an override',
    );
    const recorded = cleared.contractGate.overridden.find((entry) => entry.contractId === SOFT_CONTRACT);
    assert.equal(recorded.reason, 'accepted residual risk');

    const auditFile = path.join(ws.home, '.local', 'state', 'construct', 'audit-trail.jsonl');
    assert.ok(fs.existsSync(auditFile), 'an override must leave an audit-trail entry');
    const entries = fs.readFileSync(auditFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const auditEntry = entries.find((entry) => entry.event === 'contract.override' && entry.contract_id === SOFT_CONTRACT);
    assert.ok(auditEntry, `expected a contract.override audit record: ${JSON.stringify(entries)}`);
    assert.equal(auditEntry.reason, 'accepted residual risk');
    assert.equal(auditEntry.actor, 'gerald');
  } finally {
    rmTmpDir(ws.dir);
    rmTmpDir(ws.home);
  }
});

test('an artifact declaring no risk flags engages no contracts', () => {
  const ws = makeWorkspace();
  try {
    const file = path.join(ws.dir, 'plain.md');
    fs.writeFileSync(file, '# Plain doc\n\nNo frontmatter risk flags.\n');
    const result = run(['contract', 'status', file, '--type=design-doc'], ws);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /no contracts engaged/i);
  } finally {
    rmTmpDir(ws.dir);
    rmTmpDir(ws.home);
  }
});
