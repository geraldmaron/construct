/**
 * tests/validators-skills.test.mjs — skill structure validator tests.
 *
 * Verifies that validateSkills accepts well-formed skill files and rejects
 * regressions: missing H1, missing or malformed trigger opener, oversized
 * description, duplicate relative paths across multiple roots, and that
 * the skills/ routing.md catalog file is intentionally excluded.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after, beforeEach } from 'node:test';
import { validateSkills } from '../lib/validators/skills.mjs';

let tmpRoot;
let altRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-skills-validator-'));
  altRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-skills-validator-alt-'));
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(altRoot, { recursive: true, force: true });
});

beforeEach(() => {
  for (const root of [tmpRoot, altRoot]) {
    for (const entry of fs.readdirSync(root)) {
      fs.rmSync(path.join(root, entry), { recursive: true, force: true });
    }
  }
});

function writeSkill(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const WELL_FORMED = `# Cost Optimization

Use this skill when reducing cloud spend.

## Tagging
- enforce mandatory tags
`;

describe('validateSkills', () => {
  it('accepts a well-formed skill', () => {
    writeSkill(tmpRoot, 'devops/cost.md', WELL_FORMED);
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, true, JSON.stringify(r.errors));
    assert.equal(r.skills.length, 1);
    assert.equal(r.skills[0].title, 'Cost Optimization');
  });

  it('rejects a skill missing its H1 title', () => {
    writeSkill(tmpRoot, 'devops/cost.md', 'No title here.\n\nUse this skill when ...\n');
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /missing H1 title/.test(e)));
  });

  it('warns (does not reject) when opener does not start with a recognised trigger', () => {
    writeSkill(tmpRoot, 'devops/cost.md', '# Cost\n\nThis is a cost skill.\n');
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, true);
    assert.ok(r.warnings.some((w) => /should start with/.test(w)));
  });

  it('warns when opener exceeds 240 chars', () => {
    const big = 'Use this skill when ' + 'x'.repeat(300);
    writeSkill(tmpRoot, 'devops/cost.md', `# Cost\n\n${big}\n`);
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, true);
    assert.ok(r.warnings.some((w) => /opener exceeds 240 chars/.test(w)));
  });

  it('accepts the broader "Use when:" / "Use this when" forms', () => {
    writeSkill(tmpRoot, 'a.md', '# A\n\nUse when: planning.\n');
    writeSkill(tmpRoot, 'b.md', '# B\n\nUse this when committing.\n');
    writeSkill(tmpRoot, 'c.md', '# C\n\nUse for incident response.\n');
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, true);
    assert.equal(r.warnings.filter((w) => /should start with/.test(w)).length, 0, JSON.stringify(r.warnings));
  });

  it('flags duplicate relative paths across roots', () => {
    writeSkill(tmpRoot, 'devops/git.md', '# Git\n\nUse this skill when committing.\n');
    writeSkill(altRoot, 'devops/git.md', '# Git\n\nUse this skill when committing.\n');
    const r = validateSkills([tmpRoot, altRoot]);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /duplicate skill path 'devops\/git\.md'/.test(e)));
  });

  it('skips routing.md so the catalog file does not need a skill structure', () => {
    writeSkill(tmpRoot, 'routing.md', 'arbitrary content');
    writeSkill(tmpRoot, 'devops/git.md', '# Git\n\nUse this skill when committing.\n');
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, true, JSON.stringify(r.errors));
    assert.equal(r.skills.length, 1);
  });

  it('returns valid with empty skills when the directory does not exist', () => {
    const ghost = path.join(tmpRoot, 'does-not-exist');
    const r = validateSkills(ghost);
    assert.equal(r.valid, true);
    assert.equal(r.skills.length, 0);
  });
});
