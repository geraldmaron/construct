/**
 * tests/audit/f07-cicd/policy-gate-blocking.red.mjs — F07/R28 advisory-policy-gate proof.
 *
 * RED fixture (must FAIL against the current ci.yml). The `template policy`
 * step in the `lint` job sets `continue-on-error: true`, so a PR whose body
 * violates the template policy still produces a green job. A quality/policy
 * gate that cannot fail the build is documentation, not a gate — the audit
 * requires policy gates to be blocking.
 *
 * Contract this encodes (template-policy): the template-policy
 * step (and any step named like a policy/quality gate) MUST NOT carry
 * `continue-on-error: true`. The assertion locates the `template policy` step in
 * ci.yml and asserts the step is not soft-failed.
 *
 * Reads the real ci.yml read-only and line-scans the step block. The known-good
 * `coverage (report-only …)` step is allowed to be non-blocking (it is an
 * informational report, not a policy gate), so the scan targets named policy
 * steps specifically. No YAML library, no network, no mutation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CI_YML = join(HERE, '..', '..', '..', '.github', 'workflows', 'ci.yml');

// Walk steps as `- name: <label>` blocks; a step ends at the next `- name:` /
// `- uses:` at the same indent. A step "soft-fails" if it sets
// continue-on-error: true anywhere inside its block.
function softFailedPolicySteps(text) {
  const lines = text.split('\n');
  const offenders = [];
  const POLICY = /\b(policy|gate|certif|lint|audit|comment|schema|contract|drift)\b/i;

  for (let i = 0; i < lines.length; i++) {
    const start = lines[i].match(/^(\s*)-\s*name:\s*(.+?)\s*$/);
    if (!start) continue;
    const indent = start[1].length;
    const label = start[2].replace(/['"]/g, '');

    let soft = false;
    let lineNo = i + 1;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].match(/^\s{0,}-\s*(name|uses):/) && (lines[j].match(/^(\s*)/)[1].length <= indent)) break;
      if (/continue-on-error:\s*true\b/.test(lines[j])) { soft = true; lineNo = j + 1; }
    }
    if (soft && POLICY.test(label)) offenders.push(`ci.yml:${lineNo}  step "${label}" is continue-on-error: true`);
  }
  return offenders;
}

test('the template-policy gate in ci.yml must be blocking (no continue-on-error)', () => {
  const text = readFileSync(CI_YML, 'utf8');
  const templatePolicySoftFailed = /name:\s*template policy[\s\S]*?continue-on-error:\s*true/.test(text)
    && text.indexOf('continue-on-error: true', text.indexOf('name: template policy')) - text.indexOf('name: template policy') < 200;
  assert.equal(
    templatePolicySoftFailed,
    false,
    'ci.yml `template policy` step sets continue-on-error: true — a policy gate that cannot fail the build',
  );
});

test('no named policy/quality gate step is soft-failed with continue-on-error: true', () => {
  const offenders = softFailedPolicySteps(readFileSync(CI_YML, 'utf8'));
  assert.deepEqual(
    offenders,
    [],
    `policy/quality gate steps marked non-blocking:\n${offenders.join('\n')}`,
  );
});
