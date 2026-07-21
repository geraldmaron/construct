/**
 * audit-skills.test.mjs — Worker Profile ↔ skill ownership audit.
 *
 * A perspective skill is owned when its base is a Worker Profile or is named by
 * a Worker Profile's skill emphasis. The fixture assembles the complete canonical
 * registry boundary so retired specialist, team, and role catalogs cannot return.
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

  for (const catalog of ['workspace-presets', 'worker-profiles', 'procedures', 'policies']) {
    mkdirSync(join(root, 'registry', catalog), { recursive: true });
  }
  w('registry/workspace-presets/test.json', JSON.stringify({
    id: 'test',
    displayName: 'Test',
    skills: [],
    procedures: [],
  }));
  w('registry/worker-profiles/engineer.json', JSON.stringify({
    id: 'engineer',
    displayName: 'Engineer',
    skillEmphasis: ['perspectives/engineer'],
  }));
  w('registry/worker-profiles/operations.json', JSON.stringify({
    id: 'operations',
    displayName: 'Operations',
    skillEmphasis: ['perspectives/operations'],
  }));
  w('registry/capabilities.json', JSON.stringify({ schemaVersion: 1, capabilities: [] }));
  for (const s of ['perspectives/engineer', 'perspectives/engineer.ai', 'perspectives/operations', 'perspectives/operations.sre', 'perspectives/ghost.x', 'docs/loose']) {
    w(`skills/${s}.md`, '---\nname: x\n---\nbody');
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('perspective skills are owned through canonical Worker Profile skill emphasis', () => {
  const { root, cleanup } = fixture();
  try {
    const r = auditSkills({ rootDir: root, silent: true });
    assert.deepEqual(r.orphanSkills.sort(), ['docs/loose', 'perspectives/ghost.x']);
    assert.equal(r.pass, true);
    assert.equal(r.missingSkillFiles.length, 0);
  } finally { cleanup(); }
});

test('the real corpus does not false-flag Worker Profile perspective flavors', () => {
  const r = auditSkills({ silent: true });
  for (const owned of ['perspectives/operations', 'perspectives/qa.web-ui', 'perspectives/security.appsec']) {
    assert.ok(!r.orphanSkills.includes(owned), `${owned} must be owned, not an orphan`);
  }
});
