/**
 * tests/validators-skills.test.mjs — skill structure validator tests.
 *
 * After the YAML-frontmatter migration the validator enforces:
 *   Hard errors:
 *     - missing/unparseable frontmatter
 *     - name missing, malformed, oversized, or containing reserved tokens
 *     - description missing, oversized, with XML, or lacking a "use when" clause
 *     - missing H1 title, oversized title, duplicate paths, duplicate names
 *   Soft warnings:
 *     - body opener missing or not a "Use when ..." trigger
 *     - body opener over 240 chars
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

function skillFile({ name, description, role, applies_to, title = 'Cost Optimization', opener = 'Use this skill when reducing cloud spend.' }) {
  const fm = [`name: ${name}`, `description: "${description}"`];
  if (role) fm.push(`role: ${role}`);
  if (applies_to) fm.push(`applies_to: [${applies_to.join(', ')}]`);
  return `---\n${fm.join('\n')}\n---\n# ${title}\n\n${opener}\n\n## Body\n- detail\n`;
}

const VALID_NAME = 'devops-cost';
const VALID_DESCRIPTION = 'Patterns for reducing cloud spend. Use when reviewing infrastructure cost or budget overruns.';

describe('validateSkills', () => {
  it('accepts a well-formed skill', () => {
    writeSkill(tmpRoot, 'devops/cost.md', skillFile({ name: VALID_NAME, description: VALID_DESCRIPTION }));
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, true, JSON.stringify(r.errors));
    assert.equal(r.skills.length, 1);
    assert.equal(r.skills[0].name, VALID_NAME);
  });

  it('rejects a file missing frontmatter entirely', () => {
    writeSkill(tmpRoot, 'devops/cost.md', '# Cost\n\nUse this skill when committing.\n');
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /missing YAML frontmatter/.test(e)));
  });

  it('rejects a frontmatter block with bad YAML', () => {
    writeSkill(tmpRoot, 'devops/cost.md', '---\nname: x\ndescription: "unclosed\n---\n# T\n\nUse when.\n');
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /YAML parse error/.test(e)));
  });

  it('rejects name with dots (old format)', () => {
    writeSkill(tmpRoot, 'devops/cost.md', skillFile({ name: 'devops.cost', description: VALID_DESCRIPTION }));
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /name "devops\.cost" must match/.test(e)));
  });

  it('rejects name over 64 chars', () => {
    const longName = 'a-' + 'x'.repeat(70);
    writeSkill(tmpRoot, 'devops/cost.md', skillFile({ name: longName, description: VALID_DESCRIPTION }));
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /exceeds 64 chars/.test(e)));
  });

  it('rejects name containing reserved tokens (anthropic/claude)', () => {
    writeSkill(tmpRoot, 'a.md', skillFile({ name: 'anthropic-helper', description: VALID_DESCRIPTION }));
    writeSkill(tmpRoot, 'b.md', skillFile({ name: 'claude-tool', description: VALID_DESCRIPTION }));
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, false);
    assert.equal(r.errors.filter((e) => /reserved token/.test(e)).length, 2);
  });

  it('rejects description over 1024 chars', () => {
    const big = 'Use when ' + 'x'.repeat(1100);
    writeSkill(tmpRoot, 'devops/cost.md', skillFile({ name: VALID_NAME, description: big }));
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /description \d+ > 1024 chars/.test(e)));
  });

  it('rejects description containing XML/HTML tags', () => {
    writeSkill(tmpRoot, 'devops/cost.md', skillFile({ name: VALID_NAME, description: 'Use when <strong>handling</strong> incidents.' }));
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /contains XML\/HTML/.test(e)));
  });

  it('rejects description without a "use when" trigger clause', () => {
    writeSkill(tmpRoot, 'devops/cost.md', skillFile({ name: VALID_NAME, description: 'Patterns and heuristics for cost.' }));
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /missing "use when" trigger/.test(e)));
  });

  it('rejects duplicate frontmatter.name across files', () => {
    writeSkill(tmpRoot, 'a.md', skillFile({ name: 'shared-name', description: VALID_DESCRIPTION }));
    writeSkill(tmpRoot, 'b.md', skillFile({ name: 'shared-name', description: VALID_DESCRIPTION }));
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /duplicate frontmatter\.name "shared-name"/.test(e)));
  });

  it('rejects a skill missing its H1 title', () => {
    const raw = `---\nname: ${VALID_NAME}\ndescription: "${VALID_DESCRIPTION}"\n---\nNo title.\n\nUse when ...\n`;
    writeSkill(tmpRoot, 'devops/cost.md', raw);
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /missing H1 title/.test(e)));
  });

  it('warns (does not reject) when body opener is not a recognised trigger', () => {
    const raw = `---\nname: ${VALID_NAME}\ndescription: "${VALID_DESCRIPTION}"\n---\n# Cost\n\nThis is a cost skill.\n`;
    writeSkill(tmpRoot, 'devops/cost.md', raw);
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, true, JSON.stringify(r.errors));
    assert.ok(r.warnings.some((w) => /should start with/.test(w)));
  });

  it('warns when body opener exceeds 240 chars', () => {
    const big = 'Use this skill when ' + 'x'.repeat(300);
    const raw = `---\nname: ${VALID_NAME}\ndescription: "${VALID_DESCRIPTION}"\n---\n# Cost\n\n${big}\n`;
    writeSkill(tmpRoot, 'devops/cost.md', raw);
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, true);
    assert.ok(r.warnings.some((w) => /body opener exceeds 240 chars/.test(w)));
  });

  it('accepts broader trigger forms in body opener (Use when:, Use this when, Use for)', () => {
    writeSkill(tmpRoot, 'a.md', skillFile({ name: 'a-skill', description: VALID_DESCRIPTION, opener: 'Use when: planning.' }));
    writeSkill(tmpRoot, 'b.md', skillFile({ name: 'b-skill', description: VALID_DESCRIPTION, opener: 'Use this when committing.' }));
    writeSkill(tmpRoot, 'c.md', skillFile({ name: 'c-skill', description: VALID_DESCRIPTION, opener: 'Use for incident response.' }));
    const r = validateSkills(tmpRoot);
    assert.equal(r.valid, true, JSON.stringify(r.errors));
    assert.equal(r.warnings.filter((w) => /should start with/.test(w)).length, 0, JSON.stringify(r.warnings));
  });

  it('flags duplicate relative paths across roots', () => {
    writeSkill(tmpRoot, 'devops/git.md', skillFile({ name: 'devops-git', description: VALID_DESCRIPTION, title: 'Git' }));
    writeSkill(altRoot, 'devops/git.md', skillFile({ name: 'devops-git-alt', description: VALID_DESCRIPTION, title: 'Git' }));
    const r = validateSkills([tmpRoot, altRoot]);
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /duplicate skill path 'devops\/git\.md'/.test(e)));
  });

  it('skips routing.md so the catalog file does not need a skill structure', () => {
    writeSkill(tmpRoot, 'routing.md', 'arbitrary content');
    writeSkill(tmpRoot, 'devops/git.md', skillFile({ name: 'devops-git', description: VALID_DESCRIPTION, title: 'Git' }));
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
