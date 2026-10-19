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
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { OPERATIONAL_SKILL, plantSkill, readShippedSkill, skillState, type ShippedSkill } from '../../../src/kernel/skills/bundle.ts';
import { run } from '../../../src/cli/index.ts';
import { capture, inProject } from '../../cli/support.ts';

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
    ['an earlier version with no source line', withVersion(skill, '0.0.1').replace(/^\s*source:.*\n/m, '')],
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
    install(dir, skill.name, withVersion(skill, '0.0.1'));
    const upgraded = await capture(() => run(['init', `--skills-dir=${dir}`], ctx));
    assert.equal(upgraded.code, 0, upgraded.err);
    assert.match(upgraded.out, /operational skill: planted .*upgraded: 0\.0\.1 is an earlier release/);
    assert.equal(skillState(skill, dir).state, 'current');

    install(dir, skill.name, new TextDecoder().decode(skill.files[0]!.bytes).replace('# Construct in this session', '# Mine now'));
    const refused = await capture(() => run(['init', `--skills-dir=${dir}`], ctx));
    assert.match(refused.out, /operational skill: refused/);
    assert.match(
      refused.out,
      new RegExp(`\`construct skill install construct --force --dir=${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\` replaces it`),
    );
    assert.doesNotMatch(refused.out, /pass --force/);
    const replaced = await capture(() => run(['skill', 'install', 'construct', '--force', `--dir=${dir}`], ctx));
    assert.equal(replaced.code, 0, replaced.err);
    assert.equal(skillState(skill, dir).state, 'current');
  });
});

test('doctor gives the operational skill’s next step: init to connect the host, init for an earlier release, install --force for a changed copy', async () => {
  await inProject(async (ctx, box) => {
    const inClaude = { ...ctx, env: { ...ctx.env, CLAUDECODE: '1' } };
    const skill = operational();
    const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Not wired: no project skill to check, and the advice connects the host.
    const unwired = await capture(() => run(['doctor'], inClaude));
    assert.match(
      unwired.out,
      /FAIL host-wiring: no host wired, so no agent session can reach Construct; .*`construct init --client=<host>` wires one/,
    );
    assert.match(
      unwired.out,
      /ok {3}host: inside claude \(CLAUDECODE\); claude-code is not wired in this project, so a session here cannot reach Construct; `construct init --client=claude-code` wires it/,
    );
    assert.doesNotMatch(unwired.out, /operational-skill/);

    const wired = await capture(() => run(['init', '--client=claude-code'], ctx));
    assert.equal(wired.code, 0, wired.err);
    const dir = join(box.cwd, '.claude', 'skills');
    assert.match(
      (await capture(() => run(['doctor'], inClaude))).out,
      /ok {3}operational-skill: current in .*\.claude\/skills \(read by claude-code\)/,
    );

    install(dir, skill.name, withVersion(skill, '0.0.1'));
    const outdated = await capture(() => run(['doctor'], inClaude));
    assert.match(outdated.out, /FAIL operational-skill: outdated .*`construct init --client=claude-code` plants/);

    install(
      dir,
      skill.name,
      withVersion(skill, '0.0.1')
        .replace('# Construct in this session', '# Mine now')
        .replace(/^\s*source:.*\n/m, ''),
    );
    const diverged = await capture(() => run(['doctor'], inClaude));
    assert.match(
      diverged.out,
      new RegExp(`FAIL operational-skill: diverged .*\`construct skill install construct --force --dir=${escaped(dir)}\` replaces it`),
    );

    const fixed = await capture(() => run(['skill', 'install', 'construct', `--dir=${dir}`, '--force'], inClaude));
    assert.equal(fixed.code, 0, fixed.err);
    assert.match((await capture(() => run(['doctor'], inClaude))).out, /ok {3}operational-skill: current/);
  });
});

test('doctor fails health for a stale personal copy of the operational skill, names the fix, and leaves method skills to the tool that owns them', async () => {
  await inProject(async (ctx, box) => {
    const inClaude = { ...ctx, env: { ...ctx.env, CLAUDECODE: '1' } };
    assert.equal((await capture(() => run(['init', '--client=claude-code'], ctx))).code, 0);
    const personal = join(box.home, '.claude', 'skills');
    install(personal, OPERATIONAL_SKILL, withVersion(operational(), '0.0.1'));
    const doctor = await capture(() => run(['doctor'], inClaude));
    assert.equal(doctor.code, 1, 'a stale copy that loads in every repository is a failure, not a note');
    assert.match(
      doctor.out,
      /FAIL personal-skills: 1 stale personal copy\(ies\) of the construct skill, each loading in every repository: .*\.claude\/skills\/construct is an older release; `construct skill remove construct --client=claude --confirm`/,
    );
    // A personal method-skill copy that differs belongs to another tool (ai-workflow-config, say), not to this release.
    mkdirSync(join(personal, 'intake'), { recursive: true });
    writeFileSync(join(personal, 'intake', 'SKILL.md'), '---\nname: intake\ndescription: a personal copy\n---\n\nBody.\n');
    assert.doesNotMatch((await capture(() => run(['doctor'], inClaude))).out, /intake is/);
    const removed = await capture(() => run(['skill', 'remove', 'construct', '--client=claude', '--confirm'], inClaude));
    assert.equal(removed.code, 0, removed.err);
    assert.doesNotMatch((await capture(() => run(['doctor'], inClaude))).out, /personal-skills/);
  });
});

test('no shipped skill carries evals', () => {
  assert.ok(!operational().files.some((f) => f.relativePath.startsWith('evals/')));
});
