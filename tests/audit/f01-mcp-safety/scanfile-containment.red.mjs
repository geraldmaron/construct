/**
 * tests/audit/f01-mcp-safety/scanfile-containment.red.mjs — F01 [R10] root-containment proof for scanFile.
 *
 * RED fixtures (must FAIL against current code). scanFile resolves a model-supplied
 * file_path with `resolve(args.file_path)` and reads it with no MCP-root enforcement,
 * so a relative `../` chain, an absolute out-of-root path, a symlink that points
 * outside the project, or a Windows backslash/UNC variant all read arbitrary files.
 *
 * Contract these encode (CX-AUDIT-MCP-SAFETY-003): scanFile must resolve against a
 * declared root, reject any path that escapes it (symlink-safe via realpath), and
 * return a typed refusal — never the file's scan result. Each test passes once scanFile
 * refuses the escape instead of reading it.
 *
 * `refused()` is the post-fix predicate: an error result whose message names a
 * containment/root/outside-project denial. A successful read (no `error`, or an
 * `error` that is merely "cannot read") is treated as NOT refused, so today's
 * behavior fails the assertion.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { scanFile } from '../../../lib/mcp/tools/project.mjs';

// A refusal is an explicit containment denial. A bare "Cannot read file" (ENOENT on
// a Windows-style path under POSIX) is NOT a refusal — it's an accident of the host
// filesystem, not an enforced boundary — so it must not satisfy these tests.

function refused(result) {
  if (!result || typeof result.error !== 'string') return false;
  return /contain|outside|root|escape|traversal|denied|not allowed|forbidden/i.test(result.error);
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f01-scan-'));
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'in-scope.txt'), 'safe\n');
  return { root, projectRoot };
}

test('[R10] scanFile must refuse a ../ traversal that escapes the project root', (t) => {
  const { root, projectRoot } = makeProject();
  const secret = path.join(root, 'OUTSIDE_SECRET.txt');
  fs.writeFileSync(secret, 'OPENAI_API_KEY=sk-' + 'a'.repeat(48) + '\n');
  t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

  const traversal = path.join(projectRoot, '..', 'OUTSIDE_SECRET.txt');
  const result = scanFile({ file_path: traversal, cwd: projectRoot });

  assert.ok(refused(result), `expected containment refusal, got: ${JSON.stringify(result)}`);
});

test('[R10] scanFile must refuse an absolute path outside the project root', (t) => {
  const { root, projectRoot } = makeProject();
  t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

  const result = scanFile({ file_path: '/etc/hosts', cwd: projectRoot });

  assert.ok(refused(result), `expected containment refusal for /etc/hosts, got: ${JSON.stringify(result)}`);
});

test('[R10] scanFile must refuse a symlink inside the project that points outside it', (t) => {
  const { root, projectRoot } = makeProject();
  const outside = path.join(root, 'OUTSIDE_TARGET.txt');
  fs.writeFileSync(outside, 'AWS secret material\n');
  const link = path.join(projectRoot, 'looks-local.txt');
  try {
    fs.symlinkSync(outside, link);
  } catch {
    t.skip('symlink creation not permitted on this host');
    return;
  }
  t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

  const result = scanFile({ file_path: link, cwd: projectRoot });

  assert.ok(refused(result), `expected symlink-escape refusal, got: ${JSON.stringify(result)}`);
});

test('[R10] scanFile must refuse a Windows backslash/UNC traversal variant', (t) => {
  const { root, projectRoot } = makeProject();
  t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });

  // A UNC-style path is unambiguously outside any POSIX project root. A
  // root-aware resolver must classify it as an escape and refuse, rather than
  // letting the outcome depend on whether the host happens to have the file.
  const result = scanFile({ file_path: '\\\\server\\share\\secret.txt', cwd: projectRoot });

  assert.ok(refused(result), `expected refusal for UNC path, got: ${JSON.stringify(result)}`);
});
