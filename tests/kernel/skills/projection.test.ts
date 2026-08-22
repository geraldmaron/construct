/**
 * tests/kernel/skills/projection.test.ts — the generated pack is conformant,
 * reproducible, and removable without collateral damage.
 *
 * The Agent Skills rules are replicated here rather than imported: the checks
 * that govern the authored skills read files out of the repository, and a
 * generated pack is never in the repository. Replicating them is the only way
 * a generated file gets held to the same rules the shipped ones are, and the
 * one that matters most is the frontmatter — a vendor field or an oversized
 * description is refused at upload, which is a failure nobody sees until the
 * pack is somewhere else.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LENSES } from '../../../src/kernel/plan/lenses.ts';
import { allPlaybooks } from '../../../src/kernel/plan/playbooks.ts';
import { LENS_STANDARDS } from '../../../src/kernel/plan/standards.ts';
import {
  generatedSkillVersion,
  isGeneratedSkill,
  planSkillsUninstall,
  projectSkillsPack,
  skillPackSkew,
  SKILL_FILENAME,
  skillDirectoryName,
} from '../../../src/kernel/skills/projection.ts';

const VERSION = '9.9.9-test.1';

const input = {
  lenses: LENSES,
  playbooks: allPlaybooks(),
  standards: LENS_STANDARDS,
  version: VERSION,
};

/** The six fields the Agent Skills format defines; anything else travels nowhere. */
const ALLOWED_FIELDS = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
]);
const NAME_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BEAD = /construct-(?!mcp)[a-z0-9]{3,4}(?:\.\d+)?(?![a-z0-9_-])/;
const REPO_PATH = /(?:^|[\s`>("'])(?:src|tests|scripts|fixtures)\//;
const ABSOLUTE_PATH = /(?:^|[\s`>("'])\/(?:home|Users|tmp|etc|var|opt)\//;
const MAX_LINES = 500;
const MAX_DESCRIPTION = 1024;

/** Every way the format can be broken, as a list a failure message can print. */
function specViolations(directory: string, text: string): string[] {
  const bad: string[] = [];
  const lines = text.split('\n');
  if (lines.length > MAX_LINES) bad.push(`${String(lines.length)} lines exceeds ${String(MAX_LINES)}`);

  const isFence = (line: string | undefined): boolean => line?.trim() === '---';
  if (!isFence(lines[0])) {
    bad.push('no opening frontmatter fence');
    return bad;
  }
  const close = lines.findIndex((line, i) => i > 0 && isFence(line));
  if (close === -1) {
    bad.push('frontmatter never closes');
    return bad;
  }
  const front = lines.slice(1, close);
  const body = lines.slice(close + 1);

  const fields = new Map<string, string>();
  for (const line of front) {
    const key = /^([A-Za-z][A-Za-z0-9-]*):/.exec(line);
    if (key) fields.set(key[1], line.slice(key[0].length).trim());
  }
  for (const key of fields.keys()) {
    if (!ALLOWED_FIELDS.has(key)) bad.push(`frontmatter field "${key}" is not one of the six`);
  }

  const name = fields.get('name') ?? '';
  if (!name) bad.push('name is required');
  else if (name !== directory) bad.push(`name "${name}" must equal its directory "${directory}"`);
  else if (!NAME_SHAPE.test(name) || name.length > 64) bad.push(`name "${name}" is malformed`);

  const descStart = front.findIndex((line) => /^description:/.test(line));
  if (descStart === -1) {
    bad.push('description is required');
  } else {
    let description = front[descStart].replace(/^description:\s*[|>]?-?\s*/, '');
    for (let i = descStart + 1; i < front.length && /^\s/.test(front[i]); i += 1) {
      description += ` ${front[i].trim()}`;
    }
    description = description.trim();
    if (!description) bad.push('description is empty');
    else if (description.length > MAX_DESCRIPTION) {
      bad.push(`description is ${String(description.length)} chars`);
    }
  }

  body.forEach((line, i) => {
    const at = close + 2 + i;
    if (BEAD.test(line)) bad.push(`line ${String(at)}: tracker id`);
    if (REPO_PATH.test(line)) bad.push(`line ${String(at)}: path into the generating repository`);
    if (ABSOLUTE_PATH.test(line)) bad.push(`line ${String(at)}: absolute path`);
  });
  return bad;
}

test('one skill folder per lens, each conformant and stamped', () => {
  const files = projectSkillsPack(input);
  assert.equal(files.length, LENSES.length);
  assert.deepEqual(
    files.map((f) => f.directory),
    LENSES.map((l) => skillDirectoryName(l.lens)).sort(),
  );

  for (const file of files) {
    assert.equal(file.path, `${file.directory}/${SKILL_FILENAME}`);
    assert.deepEqual(
      specViolations(file.directory, file.content),
      [],
      `${file.path} does not satisfy the Agent Skills rules`,
    );
    // The stamps are the whole uninstall story: a folder that cannot say what
    // made it is a folder nobody can safely remove.
    assert.ok(
      /^\s+generator:\s*construct$/m.test(file.content),
      `${file.path} carries no generation marker`,
    );
    assert.ok(
      new RegExp(`^\\s+version: ${VERSION.replace(/[.\\+]/g, '\\$&')}$`, 'm').test(file.content),
      `${file.path} carries no source version`,
    );
    assert.equal(isGeneratedSkill(file.content), true);
    assert.equal(generatedSkillVersion(file.content), VERSION);
  }
});

test('every lens question, slot, and escalation reaches its skill file', () => {
  const files = new Map(projectSkillsPack(input).map((f) => [f.directory, f.content]));
  const flat = (text: string): string => text.replace(/\s+/g, ' ');
  for (const lens of LENSES) {
    const content = flat(files.get(skillDirectoryName(lens.lens)) ?? '');
    for (const question of lens.questions) {
      assert.ok(content.includes(flat(question)), `${lens.lens}: question missing`);
    }
    for (const step of lens.escalation) {
      assert.ok(content.includes(flat(step)), `${lens.lens}: escalation missing`);
    }
    for (const domain of lens.domains) {
      assert.ok(content.includes(`### ${domain} — `), `${lens.lens}: no deliverable for ${domain}`);
    }
  }
});

test('the same inputs produce the same bytes', () => {
  const first = projectSkillsPack(input);
  const second = projectSkillsPack(input);
  assert.deepEqual(second, first);
  // A version stamp that did not change the bytes would be a stamp that is not
  // really in the file.
  const restamped = projectSkillsPack({ ...input, version: '0.0.0' });
  assert.notDeepEqual(restamped, first);
  assert.equal(generatedSkillVersion(restamped[0].content), '0.0.0');
});

test('a version needing quotes still leaves readable frontmatter', () => {
  const odd = projectSkillsPack({ ...input, version: '3.0.0: from a branch' });
  assert.ok(odd[0].content.includes("  version: '3.0.0: from a branch'"));
  assert.equal(generatedSkillVersion(odd[0].content), '3.0.0: from a branch');
  assert.deepEqual(specViolations(odd[0].directory, odd[0].content), []);
});

test('removal takes the marked folders and nothing else', () => {
  const generated = projectSkillsPack(input);
  const handAuthored = '---\nname: my-own-skill\ndescription: mine alone\n---\n\n# Mine\n';
  const verdicts = planSkillsUninstall([
    { directory: 'my-own-skill', skill: handAuthored },
    { directory: 'not-a-skill', skill: null },
    ...generated.map((f) => ({ directory: f.directory, skill: f.content })),
  ]);

  const removed = verdicts.filter((v) => v.removed).map((v) => v.directory);
  assert.deepEqual(removed, generated.map((f) => f.directory));
  const kept = verdicts.filter((v) => !v.removed);
  assert.deepEqual(kept.map((v) => v.directory), ['my-own-skill', 'not-a-skill']);
  assert.match(kept[0].why, /no generation marker/);
  assert.match(kept[1].why, /no SKILL\.md/);
  for (const verdict of verdicts.filter((v) => v.removed)) {
    assert.equal(verdict.why, `generated by construct ${VERSION}`);
  }
});

test('a marker outside the frontmatter does not make a folder removable', () => {
  // The body of a hand-authored skill may well quote the marker — describing
  // one is not being one, and removal must not turn prose into permission.
  const quoting = [
    '---',
    'name: about-generated-packs',
    'description: notes on what a generated pack looks like',
    '---',
    '',
    'A generated file carries:',
    '',
    '    generator: construct',
    '',
  ].join('\n');
  const verdicts = planSkillsUninstall([{ directory: 'about-generated-packs', skill: quoting }]);
  assert.equal(verdicts[0].removed, false);
  assert.equal(isGeneratedSkill(quoting), false);
});

test('skew names each stamped version that differs from installed, once', () => {
  const stamped = (version: string) =>
    ['---', 'name: x', 'description: d', 'metadata:', '  generator: construct', `  version: '${version}'`, '---', ''].join(
      '\n',
    );
  const folders = [
    { directory: 'a', skill: stamped('1.0.0') },
    { directory: 'b', skill: stamped('1.0.0') }, // same stale version twice — one entry, not two
    { directory: 'c', skill: stamped('2.0.0') }, // matches installed — silent
    { directory: 'd', skill: null }, // not a skill folder at all — silent
    {
      directory: 'e',
      skill: ['---', 'name: e', 'description: hand-authored', '---', ''].join('\n'),
    }, // no marker — silent
  ];
  assert.deepEqual(skillPackSkew(folders, '2.0.0'), ['1.0.0']);
});

test('a pack that matches the installed version everywhere has no skew', () => {
  const stamped = ['---', 'name: x', 'description: d', 'metadata:', '  generator: construct', "  version: '3.1.4'", '---', ''].join(
    '\n',
  );
  assert.deepEqual(skillPackSkew([{ directory: 'a', skill: stamped }], '3.1.4'), []);
});

test("a lens's ceiling reaches its description whole, refusal included", () => {
  // A ceiling states what the lens will not do, and that refusal is routinely
  // its second sentence. The description is the only text a host model reads
  // before deciding to invoke a skill, so a ceiling that arrives truncated
  // means the catalog holds a prohibition the selection surface never shows.
  // The security lens is the case that matters: it says it reviews
  // defensively, then says it does not write exploits or help evade
  // detection, and only the first half used to survive.
  const pack = projectSkillsPack(input);
  const withCeiling = LENSES.filter((lens) => lens.ceiling);
  assert.ok(withCeiling.length > 0, 'no lens declares a ceiling');

  for (const lens of withCeiling) {
    const ceiling = lens.ceiling;
    if (ceiling === undefined) continue;
    const file = pack.find((f) => f.directory === skillDirectoryName(lens.lens));
    assert.ok(file, `no generated file for ${lens.lens}`);
    // Frontmatter folds long descriptions across lines, so compare on the
    // unfolded text rather than on the file's own line breaks.
    const unfolded = file.content.replace(/\s+/g, ' ');
    assert.ok(
      unfolded.includes(ceiling.replace(/\s+/g, ' ')),
      `${lens.lens}: its ceiling does not survive into the description`,
    );
  }
});

test('the security lens never advertises itself without its refusal', () => {
  const pack = projectSkillsPack(input);
  const file = pack.find((f) => f.directory === skillDirectoryName('security'));
  assert.ok(file);
  const unfolded = file.content.replace(/\s+/g, ' ');
  assert.match(unfolded, /does not write exploits/);
  assert.match(unfolded, /help evade detection/);
});
