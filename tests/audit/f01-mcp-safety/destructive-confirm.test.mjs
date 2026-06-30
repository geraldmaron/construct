/**
 * tests/audit/f01-mcp-safety/destructive-confirm.red.mjs — F01 [R11] self-authorizing-destruction proof.
 *
 * Regression guard for CX-AUDIT-MCP-SAFETY-004. storageReset and deleteIngestedArtifactsTool
 * gate destruction on `confirm: true` plus a one-time out-of-band approval token verified
 * server-side. A bare `confirm: true` — which a model error, a prompt injection, or a
 * replayed argument blob can mint — is rejected, because the model cannot supply a valid
 * token through its own argument channel.
 *
 * `tokenRejected()` is the predicate: an error result naming an approval/token requirement.
 * Each test asserts an argument object carrying only `confirm: true` performs no deletion.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { storageReset, deleteIngestedArtifactsTool } from '../../../lib/mcp/tools/storage.mjs';

function tokenRejected(result) {
  if (!result || typeof result.error !== 'string') return false;
  return /token|approval|out-of-band|authoriz|not permitted/i.test(result.error);
}

function makeProjectWithArtifacts() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f01-destroy-'));
  const internalDir = path.join(cwd, '.cx', 'knowledge', 'internal');
  fs.mkdirSync(internalDir, { recursive: true });
  fs.writeFileSync(path.join(internalDir, 'doc-a.md'), '# A\n');
  fs.writeFileSync(path.join(internalDir, 'doc-b.md'), '# B\n');
  return { cwd, internalDir };
}

test('[R11] storage_reset must not execute on confirm=true alone (needs out-of-band token)', async (t) => {
  const { cwd, internalDir } = makeProjectWithArtifacts();
  const lancedb = path.join(cwd, '.cx', 'lancedb');
  fs.mkdirSync(lancedb, { recursive: true });
  fs.writeFileSync(path.join(lancedb, 'index.bin'), 'x');
  t.after(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });

  const result = await storageReset({ cwd, confirm: true, reset_ingested: true });

  assert.ok(
    tokenRejected(result),
    `storage_reset self-authorized on confirm=true (no out-of-band token). result: ${JSON.stringify(result)}`,
  );
  assert.ok(
    fs.existsSync(path.join(internalDir, 'doc-a.md')),
    'storage_reset deleted ingested artifacts with only a model-supplied confirm=true',
  );
});

test('[R11] delete_ingested_artifacts must not execute on confirm=true alone (needs out-of-band token)', async (t) => {
  const { cwd, internalDir } = makeProjectWithArtifacts();
  t.after(() => { try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {} });

  const result = await deleteIngestedArtifactsTool({ cwd, confirm: true });

  assert.ok(
    tokenRejected(result),
    `delete_ingested_artifacts self-authorized on confirm=true (no out-of-band token). result: ${JSON.stringify(result)}`,
  );
  assert.ok(
    fs.existsSync(path.join(internalDir, 'doc-a.md')),
    'delete_ingested_artifacts wiped artifacts with only a model-supplied confirm=true',
  );
});
