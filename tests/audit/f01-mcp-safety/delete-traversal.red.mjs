/**
 * tests/audit/f01-mcp-safety/delete-traversal.red.mjs — F01 [R11]+[R10] destructive path-traversal proof.
 *
 * RED fixture (must FAIL against current code). deleteIngestedArtifacts joins each
 * model-supplied `files` entry onto the ingested dir with `path.join(internalDir, f)`
 * and deletes the result, with no containment check. A `files` entry like
 * `../../OUTSIDE.txt` therefore escapes `.cx/knowledge/internal` and deletes an
 * arbitrary file on disk — a destructive variant of the scanFile read-traversal,
 * compounding the confirm=true self-authorization in storage.mjs.
 *
 * Contract (CX-AUDIT-MCP-SAFETY-003/-004): file targets must be contained to the
 * ingested-artifact root after symlink resolution; an escaping entry must be refused,
 * not deleted. The test asserts an out-of-root file survives the call — it passes once
 * containment is enforced.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { deleteIngestedArtifacts } from '../../../lib/storage/admin.mjs';

test('[R11] deleteIngestedArtifacts must not delete files outside the ingested root via ../ in files[]', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f01-deltrav-'));
  const internalDir = path.join(root, '.cx', 'knowledge', 'internal');
  fs.mkdirSync(internalDir, { recursive: true });

  const outside = path.join(root, 'OUTSIDE_DO_NOT_DELETE.txt');
  fs.writeFileSync(outside, 'important external file\n');
  t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

  // Relative escape from .cx/knowledge/internal back up to <root>/OUTSIDE...
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
