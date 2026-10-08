/**
 * tests/kernel/skills/plant.test.ts — an installed copy that is this
 * package's own earlier release of a skill is outdated, and planting it again
 * replaces it without --force. A copy someone changed, or one at the shipped
 * version or later, or from anyone else, is diverged and needs --force. Init
 * and doctor name a command that exists for each case.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { OPERATIONAL_SKILL, plantSkill, readShippedSkill, skillState, type ShippedSkill } from '../../../src/kernel/skills/bundle.ts';
import { run } from '../../../src/cli/index.ts';
import { capture, inProject } from '../../cli/support.ts';

const RELEASED_2_2_0 = readFileSync(new URL('./fixtures/construct-2.2.0-SKILL.md', import.meta.url));
/** The operational SKILL.md exactly as published 3.0.0-alpha.25 planted it: version 2.2.0, no source line. */
const RELEASED_ALPHA_25 = readFileSync(new URL('./fixtures/construct-2.2.0-alpha.25-SKILL.md', import.meta.url));
const ALPHA_25_DIGEST = '51b336e795a413bd520553358004c15e271609d1f1b462fe49cf30d5530dd610';

function operational(): ShippedSkill {
  return readShippedSkill(OPERATIONAL_SKILL)!;
}

function install(dir: string, name: string, bytes: Uint8Array | string): void {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, 'SKILL.md'), bytes);
}

/** A shipped SKILL.md with its version line set to `version`. */
function withVersion(skill: ShippedSkill, version: string): string {
  return new TextDecoder().decode(skill.files[0]!.bytes).replace(/^(\s+version:\s*)\S+$/m, `$1${version}`);
}

test('the operational skill exactly as an earlier release shipped it, with no source line, is outdated and replaced without --force', () => {
  const fx = sterile();
  try {
    const skill = operational();
    install(fx.root, skill.name, RELEASED_2_2_0);
    assert.equal(skillState(skill, fx.root).state, 'outdated');
    const planted = plantSkill(skill, fx.root);
    assert.equal(planted.outcome, 'planted');
    assert.match(planted.why, /2\.2\.0 is an earlier release/);
    assert.equal(skillState(skill, fx.root).state, 'current');
  } finally {
    fx.cleanup();
  }
});

test('the operational skill exactly as alpha.25 planted it is an earlier release, and plantSkill and init replace it without --force', async () => {
  assert.equal(createHash('sha256').update(RELEASED_ALPHA_25).digest('hex'), ALPHA_25_DIGEST);
  const skill = operational();
  const fx = sterile();
  try {
    install(fx.root, skill.name, RELEASED_ALPHA_25);
    const before = skillState(skill, fx.root);
    assert.equal(before.state, 'outdated', before.why);
    const planted = plantSkill(skill, fx.root);
    assert.equal(planted.outcome, 'planted');
    assert.equal(planted.found, 'outdated');
    assert.match(planted.why, /upgraded: 2\.2\.0 is an earlier release/);
    assert.equal(skillState(skill, fx.root).state, 'current');
  } finally {
    fx.cleanup();
  }
  await inProject(async (ctx, box) => {
    const dir = join(box.home, 'skills');
    install(dir, skill.name, RELEASED_ALPHA_25);
    const upgraded = await capture(() => run(['init', `--skills-dir=${dir}`], ctx));
    assert.equal(upgraded.code, 0, upgraded.err);
    assert.match(upgraded.out, /operational skill: planted .*upgraded: 2\.2\.0 is an earlier release/);
    assert.equal(skillState(skill, dir).state, 'current');
  });
});

test('the alpha.25 copy with one byte changed is someone’s edits: diverged, and left alone without --force', () => {
  const skill = operational();
  const edited = Uint8Array.from(RELEASED_ALPHA_25);
  const at = Buffer.from(edited).indexOf('# Construct in this session') + 2;
  assert.ok(at > 1, 'the fixture carries the heading the edit lands in');
  edited[at] = 'c'.charCodeAt(0);
  assert.equal(edited.byteLength, RELEASED_ALPHA_25.byteLength);
  assert.notEqual(createHash('sha256').update(edited).digest('hex'), ALPHA_25_DIGEST);
  const fx = sterile();
  try {
    install(fx.root, skill.name, edited);
    assert.equal(skillState(skill, fx.root).state, 'diverged');
    const refused = plantSkill(skill, fx.root);
    assert.equal(refused.outcome, 'refused');
    assert.equal(refused.found, 'diverged');
    assert.deepEqual(new Uint8Array(readFileSync(join(fx.root, skill.name, 'SKILL.md'))), edited, 'left as it was');
  } finally {
    fx.cleanup();
  }
});

test('an earlier release that carries this package’s source line is outdated and replaced without --force', () => {
  const fx = sterile();
  try {
    const skill = readShippedSkill('decision-framing')!;
    install(fx.root, skill.name, withVersion(skill, '0.0.1'));
    assert.equal(skillState(skill, fx.root).state, 'outdated');
    assert.equal(plantSkill(skill, fx.root).outcome, 'planted');
    assert.equal(skillState(skill, fx.root).state, 'current');
  } finally {
    fx.cleanup();
  }
});

test('a copy someone changed, one at or past the shipped version, or one from anyone else is diverged and needs --force', () => {
  const skill = operational();
  const shipped = new TextDecoder().decode(skill.files[0]!.bytes);
  const cases: Array<[string, string]> = [
    ['an edited earlier release with no source line', new TextDecoder().decode(RELEASED_2_2_0).replace('# Construct in this session', '# Construct, the way I like it')],
    ['an edit at the shipped version', shipped.replace('# Construct in this session', '# Construct, the way I like it')],
    ['a later version', withVersion(skill, '9.0.0')],
    ['another skill’s name', withVersion(skill, '1.0.0').replace(/^name: construct$/m, 'name: someone-else')],
    ['another source', withVersion(skill, '1.0.0').replace('source: geraldmaron/construct', 'source: someone/else')],
  ];
  for (const [what, text] of cases) {
    const fx = sterile();
    try {
      install(fx.root, skill.name, text);
      assert.equal(skillState(skill, fx.root).state, 'diverged', what);
      const refused = plantSkill(skill, fx.root);
      assert.equal(refused.outcome, 'refused', what);
      assert.equal(refused.found, 'diverged', what);
      assert.doesNotMatch(refused.why, /--force/, `${what}: the caller names the flag it accepts`);
      assert.equal(readFileSync(join(fx.root, skill.name, 'SKILL.md'), 'utf8'), text, `${what}: left as it was`);
      assert.equal(plantSkill(skill, fx.root, { force: true }).outcome, 'planted', what);
    } finally {
      fx.cleanup();
    }
  }
});

test('init replaces an earlier release of the operational skill, and for a changed copy names a command that exists', async () => {
  await inProject(async (ctx, box) => {
    const dir = join(box.home, 'skills');
    const skill = operational();
    install(dir, skill.name, RELEASED_2_2_0);
    const upgraded = await capture(() => run(['init', `--skills-dir=${dir}`], ctx));
    assert.equal(upgraded.code, 0, upgraded.err);
    assert.match(upgraded.out, /operational skill: planted .*upgraded: 2\.2\.0 is an earlier release/);
    assert.equal(skillState(skill, dir).state, 'current');

    install(dir, skill.name, new TextDecoder().decode(skill.files[0]!.bytes).replace('# Construct in this session', '# Mine now'));
    const refused = await capture(() => run(['init', `--skills-dir=${dir}`], ctx));
    assert.match(refused.out, /operational skill: refused/);
    assert.match(refused.out, new RegExp(`\`construct skill install construct --force --dir=${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\` replaces it`));
    assert.doesNotMatch(refused.out, /pass --force/);
    const replaced = await capture(() => run(['skill', 'install', 'construct', '--force', `--dir=${dir}`], ctx));
    assert.equal(replaced.code, 0, replaced.err);
    assert.equal(skillState(skill, dir).state, 'current');
  });
});

test('doctor gives the operational skill’s next step: install for an earlier release, install --force for a changed copy', async () => {
  await inProject(async (ctx, box) => {
    const inClaude = { ...ctx, env: { ...ctx.env, CLAUDECODE: '1' } };
    const dir = join(box.home, '.claude', 'skills');
    const skill = operational();

    install(dir, skill.name, RELEASED_2_2_0);
    const outdated = await capture(() => run(['doctor'], inClaude));
    assert.match(outdated.out, /FAIL operational-skill: outdated .*run `construct skill install construct --client=claude` to plant/);

    install(dir, skill.name, new TextDecoder().decode(RELEASED_2_2_0).replace('# Construct in this session', '# Mine now'));
    const diverged = await capture(() => run(['doctor'], inClaude));
    assert.match(diverged.out, /FAIL operational-skill: diverged .*`construct skill install construct --client=claude --force` replaces it/);

    const fixed = await capture(() => run(['skill', 'install', 'construct', '--client=claude', '--force'], inClaude));
    assert.equal(fixed.code, 0, fixed.err);
    assert.match((await capture(() => run(['doctor'], inClaude))).out, /ok {3}operational-skill: current/);
  });
});
