/**
 * tests/audit/f01-mcp-safety/malicious-ref.red.mjs — F01 [R9] shell-injection proof for summarizeDiff.
 *
 * Regression guard for CX-AUDIT-MCP-SAFETY-002 (promoted from a red fixture). The
 * earlier summarizeDiff interpolated a model-controlled base_ref into
 * `git diff --stat ${baseRef}` through execSync with a shell, so a base_ref carrying
 * shell metacharacters executed arbitrary commands. The fix runs git via execFile with
 * allowlisted argv. This drives a command-substitution payload through summarizeDiff and
 * asserts no sentinel file is written, i.e. the shell never evaluates the ref.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import test from 'node:test';

import { summarizeDiff } from '../../../lib/mcp/tools/project.mjs';
import { rmTmpDir } from '../../helpers/cleanup.mjs';

// A throwaway git repo so the git-diff codepath is reached normally; the payload's
// effect (the sentinel file) is what proves command execution, independent of diff
// output.

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f01-ref-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t.t && git config user.name t', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  execSync('git add -A && git commit -q -m first', { cwd: dir });
  return dir;
}

test('[R9] summarizeDiff must not let a model-controlled base_ref reach a shell', (t) => {
  const repo = makeRepo();
  const sentinel = path.join(repo, 'PWNED_BY_BASE_REF');
  t.after(() => { rmTmpDir(repo); });

  // Command-substitution payload. If base_ref is interpolated into a shell
  // command, `$(...)` runs and creates the sentinel; a safe argv-based
  // implementation passes this whole string to git as a single (invalid) ref.
  const payload = `HEAD$(touch ${JSON.stringify(sentinel).slice(1, -1)})`;

  summarizeDiff({ base_ref: payload, cwd: repo });

  assert.equal(
    fs.existsSync(sentinel),
    false,
    'shell injection executed: base_ref reached a shell and created the sentinel file',
  );
});
