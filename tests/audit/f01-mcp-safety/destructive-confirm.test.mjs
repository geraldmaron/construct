/**
 * tests/audit/f01-mcp-safety/destructive-confirm.test.mjs — F01 destructive-tool confirmation proofs.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { storageReset, deleteIngestedArtifactsTool } from '../../../lib/mcp/tools/storage.mjs';
import { checkDestructiveGate } from '../../../lib/mcp/destructive-gate.mjs';
import { issueApprovalToken } from '../../../lib/mcp/destructive-approval.mjs';

function confirmRequired(result) {
  if (!result || typeof result.error !== 'string') return false;
  return /confirm\s*!==\s*true|requires confirm=true/i.test(result.error);
}

function makeProjectWithArtifacts() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f01-destroy-'));
  const internalDir = path.join(cwd, '.cx', 'knowledge', 'internal');
  fs.mkdirSync(internalDir, { recursive: true });
  fs.writeFileSync(path.join(internalDir, 'doc-a.md'), '# A\n');
  fs.writeFileSync(path.join(internalDir, 'doc-b.md'), '# B\n');
  return { cwd, internalDir };
}

test('[R11] storage_reset requires confirm=true at tool level', async (t) => {
  const { cwd } = makeProjectWithArtifacts();
  t.after(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });

  const result = await storageReset({ cwd });

  assert.ok(
    confirmRequired(result),
    `storage_reset did not require confirm=true. result: ${JSON.stringify(result)}`,
  );
});

test('[R11] delete_ingested_artifacts requires confirm=true at tool level', async (t) => {
  const { cwd } = makeProjectWithArtifacts();
  t.after(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });

  const result = await deleteIngestedArtifactsTool({ cwd });

  assert.ok(
    confirmRequired(result),
    `delete_ingested_artifacts did not require confirm=true. result: ${JSON.stringify(result)}`,
  );
});

test('[R11] destructive gate rejects storage_reset without out-of-band token', () => {
  const result = checkDestructiveGate('storage_reset', { confirm: true });
  assert.ok(result.gated, 'gate should block destructive tool without token');
  assert.ok(!result.allowed, 'gate should not allow without token');
  assert.ok(result.reason.includes('approval token'), 'reason should mention approval token');
});

test('[R11] destructive gate accepts storage_reset with valid token', (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f01-ledger-'));
  t.after(() => { try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {} });

  const token = issueApprovalToken('storage_reset', { rootDir });
  const result = checkDestructiveGate('storage_reset', { confirm: true, approval_token: token }, { rootDir });
  assert.ok(result.gated, 'gate should intercept destructive tool');
  assert.ok(result.allowed, 'gate should allow with valid token');
});

test('[R11] destructive gate rejects scope_archive without out-of-band token', () => {
  const result = checkDestructiveGate('scope_archive', { id: 'test', reason: 'test archival' });
  assert.ok(result.gated, 'gate should block destructive tool without token');
  assert.ok(!result.allowed, 'gate should not allow without token');
  assert.ok(result.reason.includes('approval token'), 'reason should mention approval token');
});