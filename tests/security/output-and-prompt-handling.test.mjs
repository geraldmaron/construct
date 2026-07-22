/**
 * tests/security/output-and-prompt-handling.test.mjs — LMCP-N8 gap closure
 * (construct-9oi4.14.9).
 *
 * @owasp LLM05, LLM07
 * @secures architecture-review, data-structure, memo-draft, prd-draft, proposal-review, risk-review, structure-notes, transcript-process, triage
 *
 * The 9 executable Procedures named above had zero inbound `secures` edges
 * (`construct graph missing-tests --security`). Each runs through the same
 * embedded Procedure invocation contract, so the same two guarantees apply:
 * a credential present in the process environment never reaches the returned
 * Assignment plan (LLM05 — improper output handling), and a selected Worker
 * Profile's bound reasoning framework body never reaches it either — only
 * structured step metadata (id/move/question/emits/cites) does (LLM07 —
 * system prompt leakage). Both are asserted per Procedure in an isolated
 * process, proposal-only (zero durable writes).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test, { after } from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROCEDURE_INVOKE_MODULE = path.resolve(__dirname, '..', '..', 'lib', 'embedded-contract', 'procedure-invoke.mjs');

const TARGET_PROCEDURES = [
  'architecture-review', 'data-structure', 'memo-draft', 'prd-draft',
  'proposal-review', 'risk-review', 'structure-notes', 'transcript-process', 'triage',
];

const CREDENTIAL_CANARY = 'cred-canary-n8-output-handling-0001';

// A phrase opening the body prose of the reasoning frameworks bound to the
// product-manager and architect Worker Profiles. It is never part of the
// structured steps returned in a Procedure's Assignment plan.

const FRAMEWORK_BODY_MARKER = 'Run these four moves';

const tmpDirs = [];
function fresh(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    rmTmpDir(dir);
  }
});

for (const procedureId of TARGET_PROCEDURES) {
  test(`${procedureId}: no credential leak and no framework-body leak in a proposal-only invocation`, () => {
    const cwd = fresh(`cx-n8-${procedureId}-`);
    const home = fresh('cx-n8-home-');
    const invocation = `
      import { invokeProcedure } from ${JSON.stringify(pathToFileURL(PROCEDURE_INVOKE_MODULE).href)};
      const result = await invokeProcedure({
        procedureId: ${JSON.stringify(procedureId)},
        approvalMode: 'proposal-only',
        hostModel: 'anthropic/claude-sonnet-4-6',
        input: 'draft content for a security coverage check',
      }, { env: process.env, cwd: process.cwd() });
      process.stdout.write(JSON.stringify(result));
    `;
    const res = spawnSync('node', ['--input-type=module', '--eval', invocation], {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, HOME: home, CONSTRUCT_ROLES: 'off', ANTHROPIC_API_KEY: CREDENTIAL_CANARY },
    });

    assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert.equal(res.stdout.includes(CREDENTIAL_CANARY), false, `${procedureId}: a credential in the environment must never leak into Procedure output`);
    assert.equal(res.stdout.includes(FRAMEWORK_BODY_MARKER), false, `${procedureId}: a Worker Profile's bound framework body must never leak into Procedure output — only structured step metadata may`);

    const result = JSON.parse(res.stdout);
    assert.equal(result.status, 'proposed', `${procedureId}: proposal-only must not perform a durable write`);
    assert.deepEqual(result.durableWritesPerformed, []);
  });
}
