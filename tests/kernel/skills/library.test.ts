/**
 * tests/kernel/skills/library.test.ts — the judgments the skills library makes
 * about a host's skills directory, made against data rather than a disk: what
 * the frontmatter says, whether a copy is the same bytes, and what a folder
 * permits removal to do.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  foreignFolders,
  planSkillRemoval,
  sameSkillBytes,
  selectSkills,
  skillDescription,
  skillStatuses,
  skillVersion,
  type InstalledFolder,
  type SkillSource,
} from '../../../src/kernel/skills/library.ts';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

function source(name: string, version: string, body = 'body'): SkillSource {
  const text = `---\nname: ${name}\ndescription: does a thing\nlicense: Apache-2.0\nmetadata:\n  version: ${version}\n---\n\n${body}\n`;
  return { name, description: 'does a thing', version, bytes: bytes(text) };
}

test('a description reads the same whether it is inline, continued, or folded', () => {
  const inline = '---\nname: a\ndescription: one sentence here.\n---\n';
  const continued = '---\nname: a\ndescription: one sentence\n  here.\nlicense: X\n---\n';
  const folded = '---\nname: a\ndescription: >-\n  one sentence\n  here.\nlicense: X\n---\n';
  assert.equal(skillDescription(bytes(inline)), 'one sentence here.');
  assert.equal(skillDescription(bytes(continued)), 'one sentence here.');
  assert.equal(skillDescription(bytes(folded)), 'one sentence here.');
  assert.equal(skillDescription(bytes('no frontmatter at all\n')), '');
});

test('the version is read wherever the frontmatter carries it, quotes and all', () => {
  assert.equal(skillVersion(bytes('---\nmetadata:\n  version: 1.2.3\n---\n')), '1.2.3');
  assert.equal(skillVersion(bytes("---\nmetadata:\n  version: '1.2.3-rc.1'\n---\n")), '1.2.3-rc.1');
  assert.equal(skillVersion(bytes('---\nname: a\n---\n')), null);
  // A version below the frontmatter is prose, not metadata.
  assert.equal(skillVersion(bytes('---\nname: a\n---\n\nversion: 9.9.9\n')), null);
});

test('sameness is byte equality, not length and not text similarity', () => {
  assert.equal(sameSkillBytes(bytes('abc'), bytes('abc')), true);
  assert.equal(sameSkillBytes(bytes('abc'), bytes('abd')), false);
  assert.equal(sameSkillBytes(bytes('abc'), bytes('abc\n')), false);
});

test('status comes from the installed bytes, and names absence rather than omitting it', () => {
  const sources = [source('one', '1.0.0'), source('two', '2.0.0'), source('three', '3.0.0')];
  const installed: InstalledFolder[] = [
    { name: 'one', skill: sources[0].bytes, extras: [] },
    { name: 'two', skill: bytes('---\nmetadata:\n  version: 0.9.0\n---\nedited\n'), extras: [] },
  ];
  const statuses = skillStatuses(sources, installed);
  assert.deepEqual(
    statuses.map((status) => [status.name, status.state, status.version]),
    [
      ['one', 'current', '1.0.0'],
      ['two', 'diverged', '0.9.0'],
      ['three', 'absent', null],
    ],
  );
});

test('a folder with no skill file counts as nothing installed, not as diverged', () => {
  const sources = [source('one', '1.0.0')];
  const statuses = skillStatuses(sources, [{ name: 'one', skill: null, extras: ['README.md'] }]);
  assert.equal(statuses[0].state, 'absent');
});

test('folders this checkout does not ship are named, never counted as ours', () => {
  const sources = [source('one', '1.0.0')];
  const folders: InstalledFolder[] = [
    { name: 'one', skill: sources[0].bytes, extras: [] },
    { name: 'somebody-elses', skill: bytes('---\nname: somebody-elses\n---\n'), extras: [] },
    { name: 'construct-analyst', skill: bytes('---\nname: construct-analyst\n---\n'), extras: [] },
  ];
  assert.deepEqual(foreignFolders(sources, folders), ['construct-analyst', 'somebody-elses']);
});

test('selecting by name keeps the order asked for, and reports what matched nothing once', () => {
  const sources = [source('one', '1.0.0'), source('two', '2.0.0')];
  const { selected, unknown } = selectSkills(sources, ['two', 'nope', 'two', 'nope', 'one']);
  assert.deepEqual(
    selected.map((skill) => skill.name),
    ['two', 'one'],
  );
  assert.deepEqual(unknown, ['nope']);
});

test('removal takes a folder holding only the installed file, whatever version it is', () => {
  const skill = source('one', '1.0.0');
  assert.equal(planSkillRemoval(skill, { name: 'one', skill: skill.bytes, extras: [] }).outcome, 'remove');
  const older = { name: 'one', skill: bytes('---\nmetadata:\n  version: 0.1.0\n---\n'), extras: [] };
  const stale = planSkillRemoval(skill, older);
  assert.equal(stale.outcome, 'remove');
  assert.match(stale.why, /differs/);
});

test('removal keeps a folder holding anything an install did not write, and says which', () => {
  const skill = source('one', '1.0.0');
  const withNotes = planSkillRemoval(skill, {
    name: 'one',
    skill: skill.bytes,
    extras: ['NOTES.md', 'scripts'],
  });
  assert.equal(withNotes.outcome, 'keep');
  assert.match(withNotes.why, /NOTES\.md, scripts/);

  const noSkill = planSkillRemoval(skill, { name: 'one', skill: null, extras: ['README.md'] });
  assert.equal(noSkill.outcome, 'keep');

  assert.equal(planSkillRemoval(skill, undefined).outcome, 'absent');
});
