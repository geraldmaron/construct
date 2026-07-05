/**
 * tests/security/output-and-prompt-handling.test.mjs — LMCP-N8 gap closure
 * (construct-9oi4.14.9).
 *
 * @owasp LLM05, LLM07
 * @secures architecture-review, data-structure, memo-draft, prd-draft, proposal-review, risk-review, structure-notes, transcript-process, triage
 *
 * The 9 executable workflows named above had zero inbound `secures` edges
 * (`construct graph missing-tests --security`) — lower external-write/
 * untrusted-read risk than the embed presets and research-synthesis/
 * evidence-ingest (already covered), but each still runs through the same
 * `construct workflow invoke` output contract, so the same two guarantees
 * apply: a credential present in the process environment never reaches the
 * returned plan (LLM05 — improper output handling), and a bound reasoning
 * framework's markdown body prose never reaches it either — only the
 * structured frontmatter step metadata (id/move/question/emits/cites) does
 * (LLM07 — system prompt leakage). Both are asserted per workflow, driving
 * the real `construct` binary end-to-end, proposal-only (zero durable writes)
 * so the check exercises exactly the contract every one of these workflows
 * actually runs under.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');

const TARGET_WORKFLOWS = [
  'architecture-review', 'data-structure', 'memo-draft', 'prd-draft',
  'proposal-review', 'risk-review', 'structure-notes', 'transcript-process', 'triage',
];

const CREDENTIAL_CANARY = 'cred-canary-n8-output-handling-0001';

// A phrase that opens the body prose of the two real reasoning frameworks
// (cx-pm-value-tradeoff.md, cx-architect-constraint-option-failure.md) bound
// to product-manager/architect — never part of the frontmatter steps a
// workflow's plan actually returns (id/move/question/emits/cites only).
const FRAMEWORK_BODY_MARKER = 'Run these four moves';

const tmpDirs = [];
function fresh(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
});

for (const workflowType of TARGET_WORKFLOWS) {
  test(`${workflowType}: no credential leak and no framework-body leak in a proposal-only invocation`, () => {
    const cwd = fresh(`cx-n8-${workflowType}-`);
    const home = fresh('cx-n8-home-');
    const res = spawnSync('node', [
      BIN, 'workflow', 'invoke', '--json',
      '--workflow-type', workflowType,
      '--approval-mode', 'proposal-only',
      '--host-model', 'anthropic/claude-sonnet-4-6',
      '--text', 'draft content for a security coverage check',
    ], {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, HOME: home, CONSTRUCT_ROLES: 'off', ANTHROPIC_API_KEY: CREDENTIAL_CANARY },
    });

    assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
    assert.equal(res.stdout.includes(CREDENTIAL_CANARY), false, `${workflowType}: a credential in the environment must never leak into workflow output`);
    assert.equal(res.stdout.includes(FRAMEWORK_BODY_MARKER), false, `${workflowType}: a bound framework's markdown body prose must never leak into workflow output — only structured step metadata may`);

    const env = JSON.parse(res.stdout);
    assert.equal(env.data.status, 'proposed', `${workflowType}: proposal-only must not perform a durable write`);
    assert.deepEqual(env.data.durableWritesPerformed, []);
  });
}
