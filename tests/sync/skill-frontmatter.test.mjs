/**
 * tests/sync/skill-frontmatter.test.mjs — Unit coverage for the helpers
 * sync-specialists uses to emit Anthropic Agent Skills SKILL.md files.
 *
 * Bug context: before this fix, every skill emitted by sync had only
 * Construct's doc-stamp frontmatter (cx_doc_id, body_hash, …) and no
 * Anthropic Skills frontmatter. The loader requires name + description and
 * silently dropped all 141 files. These tests pin down the extractor so
 * regressions in the source skill format don't reintroduce that.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSkillFrontmatter,
  extractSkillDescription,
  stripLeadingFrontmatter,
} from '../../lib/sync/skill-frontmatter.mjs';

test('extractSkillDescription pulls the prose after the optional (Title)', () => {
  const content = `<!--
skills/operating/oncall-rotation.md (On-Call Rotation)
Use when designing an on-call schedule, reviewing runbook quality, or
handling escalation protocols. Covers handoff structure, runbook quality
bar, escalation chains, and on-call health indicators.
-->

# On-Call Rotation

Use when setting up on-call.`;
  const desc = extractSkillDescription(content);
  assert.match(desc, /^Use when designing an on-call schedule/);
  assert.match(desc, /escalation protocols\.$/, 'must stop at first sentence');
});

test('extractSkillDescription handles single-line header (path + Title + prose on one comment block)', () => {
  const content = `<!--
skills/devops/ci-cd.md (CI/CD) Use this skill when designing, debugging, or optimizing CI/CD pipelines.
-->
# CI/CD`;
  const desc = extractSkillDescription(content);
  assert.equal(desc, 'Use this skill when designing, debugging, or optimizing CI/CD pipelines.');
});

test('extractSkillDescription falls back to first non-heading paragraph when no HTML header', () => {
  const content = `# Bare Skill

This is the description sentence. Then a second one.

## Sub-section that should not be picked.`;
  const desc = extractSkillDescription(content);
  assert.equal(desc, 'This is the description sentence.');
});

test('extractSkillDescription returns null when there is no extractable prose', () => {
  assert.equal(extractSkillDescription('# Heading only'), null);
  assert.equal(extractSkillDescription(''), null);
  assert.equal(extractSkillDescription(null), null);
});

test('buildSkillFrontmatter produces valid Anthropic Skills YAML', () => {
  const content = `<!--
skills/operating/oncall-rotation.md (On-Call Rotation)
Use when designing an on-call schedule.
-->
# Body`;
  const fm = buildSkillFrontmatter('operating/oncall-rotation', content);
  assert.match(fm, /^---\n/);
  assert.match(fm, /\nname: operating\.oncall-rotation\n/, 'slashes in name must be flattened to dots');
  assert.match(fm, /\ndescription: "Use when designing an on-call schedule\."\n/);
  assert.match(fm, /\n---\n$/);
});

test('buildSkillFrontmatter caps description at 240 chars and replaces stray quotes', () => {
  const longProse = 'Use when '.padEnd(500, 'x');
  const content = `<!--\nskills/x/y.md (Y) ${longProse}\n-->`;
  const fm = buildSkillFrontmatter('x/y', content);
  const descMatch = fm.match(/description: "([^"]+)"/);
  assert.ok(descMatch);
  assert.ok(descMatch[1].length <= 240, `description was ${descMatch[1].length} chars`);

  const quoted = `<!--\nskills/x/y.md (Y) Use when "X happens" and "Y too".\n-->`;
  const fm2 = buildSkillFrontmatter('x/y', quoted);
  assert.doesNotMatch(fm2, /"X happens"/, 'double quotes inside description must be replaced');
});

test('buildSkillFrontmatter falls back to a synthetic description when nothing is extractable', () => {
  const fm = buildSkillFrontmatter('weird/skill', '');
  assert.match(fm, /\ndescription: "Construct skill: weird\.skill"\n/);
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
  // Some hand-authored skills (Anthropic skill-creator output) may already
  // carry their own frontmatter. The sync path must not stack a second block.
  const source = '---\nname: pre-existing\ndescription: From source\n---\n\n# Body\n\nUse when something.\n';
  const fm = buildSkillFrontmatter('cat/pre-existing', source);
  const stripped = stripLeadingFrontmatter(source);
  const combined = `${fm}\n${stripped}`;
  const frontmatterBlocks = combined.match(/^---$/gm) || [];
  assert.equal(frontmatterBlocks.length, 2, 'exactly one frontmatter block (one open + one close)');
});
