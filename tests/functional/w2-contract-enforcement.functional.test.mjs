/**
 * tests/functional/w2-contract-enforcement.functional.test.mjs —
 *
 * Three tiers of contract validation: shape (specialists/contracts.json conforms),
 * cross-file (output.schema paths exist, producer/consumer names resolve),
 * and runtime handoff (artifacts validated against the referenced schema,
 * with warn vs block enforcement modes).
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateContractsFile,
  validateHandoff,
  findContract,
} from '../../lib/contracts/validate.mjs';

function freshRepo() {
  const root = mkdtempSync(join(tmpdir(), 'construct-contracts-'));
  mkdirSync(join(root, '.cx'), { recursive: true });
  mkdirSync(join(root, 'agents'), { recursive: true });
  mkdirSync(join(root, 'lib', 'schemas'), { recursive: true });
  return {
    root,
    cleanup() { try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* ignore */ } },
    writeContracts(obj) {
      writeFileSync(join(root, 'agents', 'contracts.json'), JSON.stringify(obj, null, 2));
    },
    writeRegistry(obj) {
      writeFileSync(join(root, 'agents', 'registry.json'), JSON.stringify(obj, null, 2));
    },
    writeSchema(name, obj) {
      writeFileSync(join(root, 'lib', 'schemas', name), JSON.stringify(obj, null, 2));
    },
    paths: {
      contracts: join(root, 'agents', 'contracts.json'),
      registry: join(root, 'agents', 'registry.json'),
    },
  };
}

test('the shipped specialists/contracts.json validates cleanly against its schema and the real registry', async () => {
  const result = validateContractsFile();
  assert.equal(result.ok, true, `expected ok, got errors: ${(result.errors || []).join('\n  ')}`);
});

test('flags a producer that does not resolve to a registry persona/agent', () => {
  const repo = freshRepo();
  try {
    repo.writeRegistry({ agents: [{ name: 'cx-real' }], personas: [{ name: 'construct' }] });
    repo.writeContracts({
      version: 1,
      terminalStates: ['DONE'],
      severities: { blocking: [], warning: [], info: [] },
      contracts: [{
        id: 'fake-handoff',
        producer: 'cx-imaginary',
        consumer: 'cx-real',
        input: { shape: 'task-packet', mustContain: ['goal'] },
      }],
    });
    const r = validateContractsFile({
      contractsPath: repo.paths.contracts,
      registryPath: repo.paths.registry,
      repoRoot: repo.root,
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /producer 'cx-imaginary'/.test(e)), `expected producer error, got ${r.errors.join('; ')}`);
  } finally { repo.cleanup(); }
});

test('flags an output.schema path that does not exist on disk', () => {
  const repo = freshRepo();
  try {
    repo.writeRegistry({ agents: [{ name: 'cx-architect' }], personas: [{ name: 'construct' }] });
    repo.writeContracts({
      version: 1,
      terminalStates: ['DONE'],
      severities: { blocking: [], warning: [], info: [] },
      contracts: [{
        id: 'missing-schema',
        producer: 'construct',
        consumer: 'cx-architect',
        input: { shape: 'task-packet' },
        output: { schema: 'lib/contract-schemas/never-existed.json', type: 'mystery' },
      }],
    });
    const r = validateContractsFile({
      contractsPath: repo.paths.contracts,
      registryPath: repo.paths.registry,
      repoRoot: repo.root,
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /never-existed\.json/.test(e)));
  } finally { repo.cleanup(); }
});

test('flags duplicate contract ids', () => {
  const repo = freshRepo();
  try {
    repo.writeRegistry({ agents: [{ name: 'cx-architect' }], personas: [{ name: 'construct' }] });
    repo.writeContracts({
      version: 1,
      terminalStates: ['DONE'],
      severities: { blocking: [], warning: [], info: [] },
      contracts: [
        { id: 'dup', producer: 'construct', consumer: 'cx-architect', input: { shape: 'a' } },
        { id: 'dup', producer: 'construct', consumer: 'cx-architect', input: { shape: 'b' } },
      ],
    });
    const r = validateContractsFile({
      contractsPath: repo.paths.contracts,
      registryPath: repo.paths.registry,
      repoRoot: repo.root,
    });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /duplicate id/.test(e)));
  } finally { repo.cleanup(); }
});

test('findContract resolves by producer/consumer pair', () => {
  const contract = findContract({ producer: 'construct', consumer: 'cx-orchestrator' });
  assert.ok(contract, 'expected to find construct→cx-orchestrator contract in shipped contracts');
  assert.equal(contract.id, 'construct-to-orchestrator');
});

test('validateHandoff in block mode returns BLOCKED_CONTRACT when mustContain is missing', () => {
  const repo = freshRepo();
  try {
    const result = validateHandoff({
      producer: 'construct',
      consumer: 'cx-orchestrator',
      artifact: { goal: 'do the thing' },
      enforcement: 'block',
      repoRoot: repo.root,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'BLOCKED_CONTRACT');
    assert.ok(result.errors.length > 0, 'expected at least one error');
    assert.ok(result.errors.some((e) => /intent|workCategory|riskFlags|acceptanceCriteria/.test(e)), `expected a mustContain error, got: ${result.errors.join('; ')}`);
  } finally { repo.cleanup(); }
});

test('validateHandoff in warn mode keeps ok:true but surfaces warnings on violation', () => {
  const repo = freshRepo();
  try {
    const result = validateHandoff({
      producer: 'construct',
      consumer: 'cx-orchestrator',
      artifact: { goal: 'do the thing' },
      enforcement: 'warn',
      repoRoot: repo.root,
    });
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.warnings) && result.warnings.length > 0, 'expected warnings');
  } finally { repo.cleanup(); }
});

test('validateHandoff in block mode passes when the artifact satisfies the contract', () => {
  const repo = freshRepo();
  try {
    const result = validateHandoff({
      producer: 'construct',
      consumer: 'cx-orchestrator',
      artifact: {
        goal: 'do the thing',
        intent: 'orchestrated',
        workCategory: 'feature',
        riskFlags: [],
        acceptanceCriteria: ['ships'],
      },
      enforcement: 'block',
      repoRoot: repo.root,
    });
    assert.equal(result.ok, true);
    assert.ok(result.contract);
  } finally { repo.cleanup(); }
});

test('validateHandoff returns BLOCKED_CONTRACT in block mode when no contract is registered for the pair', () => {
  const repo = freshRepo();
  try {
    const result = validateHandoff({
      producer: 'cx-nobody',
      consumer: 'cx-nowhere',
      artifact: {},
      enforcement: 'block',
      repoRoot: repo.root,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'BLOCKED_CONTRACT');
  } finally { repo.cleanup(); }
});

// construct-rf26.12: output.mustContain / mustContainOneOf / mustMatchEnum were
// declared on many shipped contracts but never actually checked at handoff —
// these pin the new enforcement so a regression is a test failure, not a
// silent no-op.

test('validateHandoff blocks on an output.mustMatchEnum violation (engineer-to-reviewer verdict)', () => {
  const result = validateHandoff({
    producer: 'cx-engineer',
    consumer: 'cx-reviewer',
    artifact: { type: 'review-report', target: 'lib/foo.mjs', verdict: 'LGTM', findings: [] },
    enforcement: 'block',
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /verdict/.test(e) && /LGTM/.test(e)), `expected a verdict enum error, got: ${result.errors.join('; ')}`);
});

test('validateHandoff blocks on an empty findings array with no noIssuesFoundAt (mustContainOneOf, rubber-stamp guard)', () => {
  const result = validateHandoff({
    producer: 'cx-engineer',
    consumer: 'cx-reviewer',
    artifact: { type: 'review-report', target: 'lib/foo.mjs', verdict: 'APPROVED', findings: [] },
    enforcement: 'block',
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /findings\|noIssuesFoundAt/.test(e)), `expected a mustContainOneOf error, got: ${result.errors.join('; ')}`);
});

test('validateHandoff passes engineer-to-reviewer when verdict is valid and findings or noIssuesFoundAt is present', () => {
  const result = validateHandoff({
    producer: 'cx-engineer',
    consumer: 'cx-reviewer',
    artifact: {
      type: 'review-report',
      target: 'lib/foo.mjs',
      verdict: 'APPROVED',
      findings: [],
      noIssuesFoundAt: ['lib/foo.mjs'],
      filesChanged: [{ path: 'lib/foo.mjs', action: 'modified' }],
      verificationChecklist: {
        compilesWithoutErrors: true,
        existingTestsPass: true,
        newBehaviorHasCoverage: true,
        noHardcodedSecrets: true,
        noFileOver800Lines: true,
      },
    },
    enforcement: 'block',
  });
  assert.equal(result.ok, true, result.errors?.join('; '));
});

test('validateHandoff blocks on a missing output.mustContain field (architect-to-platform-engineer rollback)', () => {
  const result = validateHandoff({
    producer: 'cx-architect',
    consumer: 'cx-platform-engineer',
    artifact: { problem: 'p', solution: 's', impact: 'i', migration: 'm' },
    enforcement: 'block',
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /rollback/.test(e)), `expected a missing-output-field error, got: ${result.errors.join('; ')}`);
});

test('validateHandoff blocks on an output.mustMatchEnum violation for a wildcard-producer contract (any-to-debugger)', () => {
  const result = validateHandoff({
    producer: '*',
    consumer: 'cx-debugger',
    artifact: { rootCause: 'race condition', rootCauseConfirmedVia: 'guess', fix: 'add a lock' },
    enforcement: 'block',
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /rootCauseConfirmedVia/.test(e)), `expected a rootCauseConfirmedVia enum error, got: ${result.errors.join('; ')}`);
});

test('validateHandoff recurses into nested schema required fields (implementation.json verificationChecklist)', () => {
  const result = validateHandoff({
    producer: 'cx-architect',
    consumer: 'cx-engineer',
    artifact: {
      type: 'implementation',
      status: 'DONE',
      filesChanged: [{ path: 'lib/foo.mjs', action: 'modified' }],
      verificationChecklist: { compilesWithoutErrors: true },
    },
    enforcement: 'block',
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /verificationChecklist.*existingTestsPass/.test(e)), `expected a nested schema-required error, got: ${result.errors.join('; ')}`);
});

test('workflow_contract_validate MCP tool enriches bare goal before validateHandoff', async () => {
  const { workflowContractValidate } = await import('../../lib/mcp/tools/workflow.mjs');
  const block = await workflowContractValidate({
    producer: 'construct',
    consumer: 'cx-orchestrator',
    artifact: { goal: 'add rate limiting to the API' },
    enforcement: 'block',
  });
  assert.equal(block.ok, true, block.errors?.join('; '));

  const warn = await workflowContractValidate({
    producer: 'construct',
    consumer: 'cx-orchestrator',
    artifact: { goal: 'add rate limiting to the API' },
    enforcement: 'warn',
  });
  assert.equal(warn.ok, true);
  assert.equal(warn.warnings?.length ?? 0, 0);
});
