/**
 * tests/audit/f01-mcp-safety/delete-traversal.red.mjs — F01 [R11]+[R10] destructive path-traversal proof.
 *
 * Regression guard for CX-AUDIT-MCP-SAFETY-003. deleteIngestedArtifacts resolves each
 * model-supplied `files` entry against the ingested-artifact root via resolveWithinRoot,
 * so an entry like `../../../OUTSIDE.txt` that escapes `.construct/knowledge/internal` is refused
 * before any deletion rather than removing an arbitrary file on disk — the destructive
 * twin of the scanFile read-traversal, alongside the confirm=true self-authorization.
 *
 * The test asserts an out-of-root file survives a model-supplied `files[]` traversal entry:
 * the call either throws on the escape or leaves the file untouched.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { deleteIngestedArtifacts } from '../../../lib/storage/admin.mjs';

test('[R11] deleteIngestedArtifacts must not delete files outside the ingested root via ../ in files[]', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f01-deltrav-'));
  const internalDir = path.join(root, '.construct', 'knowledge', 'internal');
  fs.mkdirSync(internalDir, { recursive: true });

  const outside = path.join(root, 'OUTSIDE_DO_NOT_DELETE.txt');
  fs.writeFileSync(outside, 'important external file\n');
  t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

  // Relative escape from .construct/knowledge/internal back up to <root>/OUTSIDE...
  const escape = path.join('..', '..', '..', 'OUTSIDE_DO_NOT_DELETE.txt');

  let threw = false;
  try {
    await deleteIngestedArtifacts(root, { files: [escape], confirm: true });
  } catch {
    threw = true;
  }

  assert.ok(
    fs.existsSync(outside) || threw,
    'deleteIngestedArtifacts followed a ../ traversal and deleted a file outside the ingested root',
  );
  assert.ok(
    fs.existsSync(outside),
    'out-of-root file was destroyed by a model-supplied files[] traversal entry',
  );
});
