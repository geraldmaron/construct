/**
 * tests/sync/skill-frontmatter.test.mjs — Unit coverage for the helpers
 * sync-worker-profiles uses to emit Anthropic Agent Skills SKILL.md files.
 *
 * After the YAML-frontmatter migration:
 *   - buildSkillFrontmatter reads `name` and `description` from source YAML.
 *   - Names are kebab-case (spec-compliant `^[a-z0-9][a-z0-9-]*$`).
 *   - Descriptions cap at 1024 chars (Anthropic spec).
 *   - HTML-comment extraction is a fallback for any unmigrated file.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSkillFrontmatter,
  extractSkillDescription,
  readSkillFrontmatter,
  stripLeadingFrontmatter,
} from '../../lib/sync/skill-frontmatter.mjs';

test('readSkillFrontmatter parses YAML frontmatter into an object', () => {
  const content = '---\nname: foo-bar\ndescription: "Use when needed"\nrole: engineer\n---\n# Body';
  const fm = readSkillFrontmatter(content);
  assert.equal(fm.name, 'foo-bar');
  assert.equal(fm.description, 'Use when needed');
  assert.equal(fm.role, 'engineer');
});

test('readSkillFrontmatter returns null on missing or malformed frontmatter', () => {
  assert.equal(readSkillFrontmatter('# Just body'), null);
  assert.equal(readSkillFrontmatter(''), null);
  assert.equal(readSkillFrontmatter(null), null);
  assert.equal(readSkillFrontmatter('---\nbad: "unclosed\n---'), null);
});

test('extractSkillDescription prefers YAML description over HTML-comment fallback', () => {
  const content = '---\nname: cat-x\ndescription: "From YAML. Use when X."\n---\n<!--\nskills/cat/x.md (X) From HTML. Use when X-alt.\n-->\n# X';
  assert.equal(extractSkillDescription(content), 'From YAML. Use when X.');
});

test('extractSkillDescription falls back to HTML comment when YAML missing', () => {
  const content = '<!--\nskills/devops/ci-cd.md (CI/CD) Use this skill when designing CI/CD pipelines.\n-->\n# CI/CD';
  assert.equal(extractSkillDescription(content), 'Use this skill when designing CI/CD pipelines.');
});

test('extractSkillDescription falls back to first body paragraph when no YAML and no HTML comment', () => {
  const content = '# Bare Skill\n\nThis is the description sentence. Then a second one.\n\n## Sub-section that should not be picked.';
  assert.equal(extractSkillDescription(content), 'This is the description sentence.');
});

test('extractSkillDescription returns null when there is no extractable prose', () => {
  assert.equal(extractSkillDescription('# Heading only'), null);
  assert.equal(extractSkillDescription(''), null);
  assert.equal(extractSkillDescription(null), null);
});

test('buildSkillFrontmatter emits kebab-case name from source YAML', () => {
  const content = '---\nname: operating-oncall-rotation\ndescription: "Use when designing an on-call schedule."\n---\n# Body';
  const fm = buildSkillFrontmatter('operating/oncall-rotation', content);
  assert.match(fm, /^---\n/);
  assert.match(fm, /\nname: operating-oncall-rotation\n/);
  assert.match(fm, /\ndescription:.*Use when designing an on-call schedule\.\s*\n/);
  assert.match(fm, /---\n$/);
});

test('buildSkillFrontmatter strips construct-internal role keys from shipped output', () => {
  const content = '---\nname: roles-engineer\ndescription: "Use when an engineer is acting."\nrole: engineer\napplies_to: [engineer]\nversion: 2\nprofiles: [rnd]\ncap: 1\n---\n# Engineer';
  const fm = buildSkillFrontmatter('perspectives/engineer', content);
  assert.match(fm, /\nname: roles-engineer\n/);
  assert.match(fm, /\ndescription:/);
  assert.doesNotMatch(fm, /\nrole:/);
  assert.doesNotMatch(fm, /applies_to/);
  assert.doesNotMatch(fm, /version:/);
  assert.doesNotMatch(fm, /profiles:/);
  assert.doesNotMatch(fm, /cap:/);
});

test('buildSkillFrontmatter falls back to deriving kebab name from path when source has no YAML', () => {
  const content = '<!--\nskills/legacy/old-skill.md (Legacy) Use when working with legacy.\n-->\n# Legacy';
  const fm = buildSkillFrontmatter('legacy/old-skill', content);
  assert.match(fm, /\nname: legacy-old-skill\n/);
});

test('buildSkillFrontmatter caps description at 1024 chars (Anthropic spec)', () => {
  const longProse = 'Use when ' + 'x'.repeat(1100);
  const content = `---\nname: x-y\ndescription: "${longProse}"\n---\n# Y`;
  const fm = buildSkillFrontmatter('x/y', content);
  const descMatch = fm.match(/description: (?:"([^"]+)"|(.+))/);
  assert.ok(descMatch, `regex did not match: ${fm}`);
  const desc = descMatch[1] ?? descMatch[2];
  assert.ok(desc.length <= 1024, `description was ${desc.length} chars`);
});

test('buildSkillFrontmatter replaces inline double quotes with single quotes', () => {
  const content = '---\nname: x-y\ndescription: \'Use when "X happens" and "Y too".\'\n---\n# Y';
  const fm = buildSkillFrontmatter('x/y', content);
  assert.doesNotMatch(fm, /"X happens"/);
});

test('buildSkillFrontmatter falls back to a synthetic description when nothing is extractable', () => {
  const fm = buildSkillFrontmatter('weird/skill', '');
  assert.match(fm, /\nname: weird-skill\n/);
  assert.match(fm, /\ndescription:.*Construct skill: weird-skill/);
});

test('stripLeadingFrontmatter removes a leading --- block; leaves body alone otherwise', () => {
  const withFm = '---\nname: foo\n---\n\nbody here\n';
  const stripped = stripLeadingFrontmatter(withFm);
  assert.doesNotMatch(stripped, /^---/, 'leading frontmatter must be gone');
  assert.match(stripped, /body here\n$/);

  const noFm = '# Just a heading\n\nbody\n';
  assert.equal(stripLeadingFrontmatter(noFm), noFm);

  const thematicBreak = '# Heading\n\nIntro.\n\n---\n\nMore body.\n';
  assert.equal(stripLeadingFrontmatter(thematicBreak), thematicBreak, 'must not eat mid-document --- thematic breaks');
});

test('regression: emitted SKILL.md never has double frontmatter even when source already starts with ---', () => {
  const source = '---\nname: pre-existing\ndescription: "Use when X"\n---\n\n# Body\n\nUse when something.\n';
  const fm = buildSkillFrontmatter('cat/pre-existing', source);
  const stripped = stripLeadingFrontmatter(source);
  const combined = `${fm}\n${stripped}`;
  const frontmatterBlocks = combined.match(/^---$/gm) || [];
  assert.equal(frontmatterBlocks.length, 2, 'exactly one frontmatter block (one open + one close)');
});
