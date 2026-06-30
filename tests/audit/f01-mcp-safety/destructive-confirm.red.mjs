/**
 * tests/audit/f01-mcp-safety/destructive-confirm.red.mjs — F01 [R11] self-authorizing-destruction proof.
 *
 * RED fixtures (must FAIL against current code). storageReset and
 * deleteIngestedArtifactsTool gate destruction on `confirm: true` carried inside the
 * same model-callable JSON argument object. A model error, a prompt injection, or a
 * replayed argument blob therefore self-authorizes irreversible deletion — there is no
 * out-of-band approval token the model cannot mint.
 *
 * Contract these encode (CX-AUDIT-MCP-SAFETY-004): destructive tools must require an
 * out-of-band approval token (issued outside the model's argument channel and verified
 * server-side); a bare `confirm: true` must be rejected. Each test asserts that an
 * argument object containing only `confirm: true` does NOT perform deletion — it passes
 * once a missing/invalid token blocks the operation.
 *
 * `tokenRejected()` is the post-fix predicate: an error result naming an approval/token
 * requirement. Today both tools return a success/`status` payload instead, so the
 * assertions fail — proving the vector.
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
