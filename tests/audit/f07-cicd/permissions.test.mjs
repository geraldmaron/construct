/**
 * tests/audit/f07-cicd/permissions.red.mjs — F07/R25/R29 least-privilege GITHUB_TOKEN proof.
 *
 * RED fixtures (must FAIL against the current .github/workflows/*.yml). Several
 * workflows declare no top-level `permissions:` block, so each job inherits the
 * repository's default GITHUB_TOKEN scope. When that default is read/write the
 * token handed to every step — including third-party actions run via mutable
 * tags (see action-pin.red.mjs) — can push commits, open PRs, and write
 * packages. GitHub's hardening guidance is to declare an explicit least-
 * privilege top-level `permissions:` and elevate per-job only where needed.
 *
 * Contract these encode (CX-AUDIT-CI-002): (1) every workflow declares a
 * top-level `permissions:` block so it never relies on the repo default; and
 * (2) any broad `contents: write` is scoped to a specific job rather than set
 * workflow-wide. The first assertion lists workflows with no top-level block;
 * the second flags top-level `contents: write` that should be per-job.
 *
 * Reads the real workflow YAML read-only and line-scans by indentation — a
 * top-level key sits at column 0, a job-level `permissions:` is indented. No
 * YAML library, no network, no mutation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = join(HERE, '..', '..', '..', '.github', 'workflows');

function workflowFiles() {
  return readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
}

// A top-level key is unindented (column 0). `permissions:` at column 0 is the
// workflow-wide block; the same key indented belongs to a job.
function hasTopLevelPermissions(text) {
  return text.split('\n').some((line) => /^permissions:\s*$/.test(line) || /^permissions:\s*\{/.test(line));
}

// `contents: write` reachable without a job-scope indent ahead of it. The scan
// flags a `permissions:` block that begins at column 0 (workflow-wide) and
// grants contents: write — the broad case the audit wants pushed down per-job.
function hasTopLevelContentsWrite(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^permissions:\s*$/.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) {
      if (/^\s+contents:\s*write\b/.test(lines[j])) return true;
    }
  }
  return false;
}

test('every workflow declares a top-level least-privilege permissions block', () => {
  const offenders = workflowFiles().filter(
    (f) => !hasTopLevelPermissions(readFileSync(join(WORKFLOWS_DIR, f), 'utf8')),
  );
  assert.deepEqual(
    offenders,
    [],
    `workflows with no top-level permissions: block (inherit repo default token scope):\n${offenders.join('\n')}`,
  );
});

test('no workflow grants contents: write at the workflow-wide level', () => {
  const offenders = workflowFiles().filter(
    (f) => hasTopLevelContentsWrite(readFileSync(join(WORKFLOWS_DIR, f), 'utf8')),
  );
  assert.deepEqual(
    offenders,
    [],
    `workflows granting broad workflow-wide contents: write (should be per-job):\n${offenders.join('\n')}`,
  );
});
