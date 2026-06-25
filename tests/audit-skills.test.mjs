/**
 * audit-skills.test.mjs — agent/profile ↔ skill ownership (bead construct-ksfa).
 *
 * A role skill is owned when its base is a specialist OR a role named in any
 * profile, not only when a registry `skills:` binding names it. Counting only
 * registry bindings over-reported orphans (it missed profile roles and conditional
 * flavors). Uses a tmp rootDir fixture so the test is deterministic.
 */
import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditSkills } from '../lib/audit-skills.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cx-auditskills-'));
  const w = (rel, body) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), body); };
  // One specialist (engineer) declares its own base skill; operator is a profile
  // role only (no specialist). ghost is neither.
  w('specialists/unified-registry.json', JSON.stringify({
    specialists: [{ name: 'cx-engineer', skills: ['roles/engineer'] }],
  }));
  w('profiles/operations.json', JSON.stringify({
    id: 'operations',
    departments: [{ id: 'intake', roles: ['operator', 'product-lead'] }],
  }));
  for (const s of ['roles/engineer', 'roles/engineer.ai', 'roles/operator', 'roles/operator.sre', 'roles/ghost.x', 'docs/loose']) {
    w(`skills/${s}.md`, '---\nname: x\n---\nbody');
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('role skills are owned via specialist base or profile role, not only registry binding', () => {
  const { root, cleanup } = fixture();
  try {
    const r = auditSkills({ rootDir: root, silent: true });
    // engineer.* owned by the engineer specialist; operator.* owned by the profile
    // role; only the unowned-base role skill and the loose docs skill are orphans.
    assert.deepEqual(r.orphanSkills.sort(), ['docs/loose', 'roles/ghost.x']);
    assert.equal(r.pass, true);
    assert.equal(r.missingSkillFiles.length, 0);
  } finally { cleanup(); }
});

test('the real corpus no longer false-flags profile roles or conditional flavors', () => {
  // Regression guard for construct-ksfa: roles/operator (operations profile) and
  // roles/<specialist>.<flavor> must not appear as orphans.
  const r = auditSkills({ silent: true });
  for (const owned of ['roles/operator', 'roles/operator.sre', 'roles/qa.web-ui', 'roles/security.appsec']) {
    assert.ok(!r.orphanSkills.includes(owned), `${owned} must be owned, not an orphan`);
  }
});
