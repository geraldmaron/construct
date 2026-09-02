/**
 * tests/cli/spine.test.ts — the command line proves the product contract:
 * init creates the exact layout and one database, status and doctor read one
 * state universe, config is explained, sources are declared and read, reset
 * removes only what it named, and every failure leads with the problem.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../src/cli/index.ts';
import { capture, inProject, sandbox } from './support.ts';

test('init creates the exact layout, one database, the ignore rule, and plants the operational skill', async () => {
  const box = sandbox();
  try {
    const dry = await capture(() => run(['init', '--dry-run'], box.ctx));
    assert.equal(dry.code, 0);
    assert.match(dry.out, /Nothing was written/);
    assert.equal(existsSync(join(box.cwd, '.construct')), false);

    const skillsDir = join(box.home, 'skills');
    const { code, out } = await capture(() => run(['init', `--skills-dir=${skillsDir}`], box.ctx));
    assert.equal(code, 0, out);
    assert.match(out, /Initialized Construct project "demo"/);
    assert.deepEqual(readdirSync(join(box.cwd, '.construct')).sort(), ['constitution.json', 'project.json', 'registry.lock.json', 'sources.json', 'state']);
    assert.deepEqual(readdirSync(join(box.cwd, '.construct', 'state')), ['construct.sqlite']);
    assert.match(readFileSync(join(box.cwd, '.gitignore'), 'utf8'), /\.construct\/state\//);
    assert.ok(existsSync(join(skillsDir, 'construct', 'SKILL.md')));
    assert.match(out, /still to answer \(3\)/);
    assert.match(out, /proposal\(s\), each with its source/);
    assert.equal(existsSync(join(box.home, '.data')), false, 'no per-user data directory is created');
    const lock = JSON.parse(readFileSync(join(box.cwd, '.construct', 'registry.lock.json'), 'utf8'));
    assert.equal(Object.keys(lock.skills).length, 8);
    assert.match(lock.skills.intake.digest, /^sha256:/);

    // Idempotent, and answers can come later.
    const again = await capture(() => run(['init', '--scale=team', '--outcome=launch', '--constraint=keep the API', `--skills-dir=${skillsDir}`, '--json'], box.ctx));
    assert.equal(again.code, 0);
    const record = JSON.parse(again.out);
    assert.equal(record.profile.onboardingState, 'confirmed');
    assert.deepEqual(record.created, { projectFile: false, constitution: false, sources: false, lock: false, state: false });
    const constitution = JSON.parse(readFileSync(join(box.cwd, '.construct', 'constitution.json'), 'utf8'));
    assert.equal(constitution.scale, 'team');
    assert.deepEqual(constitution.constraints, ['keep the API']);
  } finally {
    box.cleanup();
  }
});

test('init refuses a bad scale before writing, and an earlier-alpha file with the reset instruction', async () => {
  const box = sandbox();
  try {
    const bad = await capture(() => run(['init', '--scale=huge'], box.ctx));
    assert.equal(bad.code, 2);
    assert.match(bad.err, /--scale must be one of/);
    mkdirSync(join(box.cwd, '.construct'));
    writeFileSync(join(box.cwd, '.construct', 'settings.json'), 'not json', 'utf8');
    const legacy = await capture(() => run(['init'], box.ctx));
    assert.equal(legacy.code, 1);
    assert.match(legacy.err, /earlier Construct alpha/);
    assert.match(legacy.err, /settings\.json/);
    assert.match(legacy.err, /construct reset/);
    assert.doesNotMatch(legacy.err, /    at /);
  } finally {
    box.cleanup();
  }
});

test('status and doctor read the one state universe; doctor is never healthy without a project', async () => {
  const box = sandbox();
  try {
    const noProject = await capture(() => run(['status'], box.ctx));
    assert.equal(noProject.code, 1);
    assert.match(noProject.err, /No Construct project here/);
    const sick = await capture(() => run(['doctor'], box.ctx));
    assert.equal(sick.code, 1);
    assert.match(sick.out, /FAIL project/);
    assert.match(sick.out, /doctor: 1 check\(s\) failed/);
  } finally {
    box.cleanup();
  }
  await inProject(async (ctx, box) => {
    const status = await capture(() => run(['status'], ctx));
    assert.equal(status.code, 0);
    assert.match(status.out, /setup: confirmed/);
    assert.match(status.out, /work: nothing in flight/);
    assert.match(status.out, /decisions: none waiting on you/);
    const json = await capture(() => run(['status', '--json'], ctx));
    const record = JSON.parse(json.out);
    assert.equal(record.onboarding.state, 'confirmed');
    assert.equal(record.runs.active, 0);
    assert.equal(record.registry.skills, 8);
    assert.equal(record.registry.workflows, 2);
    assert.deepEqual(record.registry.skew, []);
    const doctor = await capture(() => run(['doctor', '--json'], ctx));
    assert.equal(doctor.code, 0, doctor.out);
    const checks = JSON.parse(doctor.out);
    assert.equal(checks.healthy, true);
    assert.ok(checks.checks.some((c: { name: string }) => c.name === 'state'));
    assert.match(checks.checks.find((c: { name: string }) => c.name === 'registry').detail, /10\/10 current/);
    // Break the state file: doctor fails and says why, status leads with the problem.
    writeFileSync(join(box.cwd, '.construct', 'state', 'construct.sqlite'), 'garbage', 'utf8');
    const broken = await capture(() => run(['doctor'], ctx));
    assert.equal(broken.code, 1);
    assert.match(broken.out, /FAIL state/);
    const statusBroken = await capture(() => run(['status'], ctx));
    assert.equal(statusBroken.code, 1);
    assert.match(statusBroken.err, /^construct status: /);
    assert.doesNotMatch(statusBroken.err, /    at /);
  });
});

test('config is explained tier by tier, set into the right file, and refused where it may not go', async () => {
  await inProject(async (ctx, box) => {
    const list = await capture(() => run(['config', 'list'], ctx));
    assert.equal(list.code, 0);
    assert.match(list.out, /locale\s+"en-US"\s+\(built-in default\)/);
    const set = await capture(() => run(['config', 'set', 'review.cadence', 'weekly'], ctx));
    assert.equal(set.code, 0, set.err);
    const project = JSON.parse(readFileSync(join(box.cwd, '.construct', 'project.json'), 'utf8'));
    assert.equal(project.behavior['review.cadence'], 'weekly');
    const explain = await capture(() => run(['config', 'explain', 'review.cadence'], ctx));
    assert.match(explain.out, /review\.cadence: "weekly" from project config/);
    assert.match(explain.out, /built-in default\s+"monthly"/);
    const user = await capture(() => run(['config', 'set', 'color', 'never'], ctx));
    assert.equal(user.code, 0, user.err);
    assert.ok(existsSync(join(box.home, '.config', 'construct', 'config.json')));
    const wrongScope = await capture(() => run(['config', 'set', 'color', 'never', '--scope=project'], ctx));
    assert.equal(wrongScope.code, 1);
    assert.match(wrongScope.err, /cannot be set by project config/);
    const badValue = await capture(() => run(['config', 'set', 'review.cadence', 'hourly'], ctx));
    assert.equal(badValue.code, 1);
    assert.match(badValue.err, /must be one of weekly \| monthly/);
    const unknown = await capture(() => run(['config', 'get', 'nope'], ctx));
    assert.equal(unknown.code, 2);
    const unset = await capture(() => run(['config', 'unset', 'review.cadence'], ctx));
    assert.equal(unset.code, 0);
    const get = await capture(() => run(['config', 'get', 'review.cadence'], ctx));
    assert.equal(get.out.trim(), 'monthly');
    const env = await capture(() => run(['config', 'get', 'locale'], { ...ctx, env: { ...ctx.env, CONSTRUCT_LOCALE: 'fr-FR' } }));
    assert.equal(env.out.trim(), 'fr-FR');
    const flag = await capture(() => run(['config', 'get', 'locale', '--locale=de-DE'], ctx));
    assert.equal(flag.code, 2, 'config get takes no --locale flag of its own; flags are for commands that act');
    const validate = await capture(() => run(['config', 'validate'], ctx));
    assert.equal(validate.code, 0);
    const path = await capture(() => run(['config', 'path', '--json'], ctx));
    assert.equal(JSON.parse(path.out).project, join(box.cwd, '.construct', 'project.json'));
  });
});

test('project show and validate read the committed files; refresh proposes and confirms nothing', async () => {
  await inProject(async (ctx, box) => {
    const show = await capture(() => run(['project', 'show'], ctx));
    assert.equal(show.code, 0);
    assert.match(show.out, /demo \(proj-/);
    assert.match(show.out, /scale: solo; primary outcome: ship it/);
    assert.match(show.out, /complete;/);
    const validate = await capture(() => run(['project', 'validate'], ctx));
    assert.equal(validate.code, 0);
    writeFileSync(join(box.cwd, 'AGENTS.md'), '# Rules\n\nNever commit secrets.\n', 'utf8');
    const refresh = await capture(() => run(['project', 'refresh', '--json'], ctx));
    assert.equal(refresh.code, 0, refresh.err);
    assert.ok(JSON.parse(refresh.out).newProposals >= 1);
    const constitution = JSON.parse(readFileSync(join(box.cwd, '.construct', 'constitution.json'), 'utf8'));
    assert.deepEqual(constitution.constraints, ['never break the API'], 'a refreshed proposal is not confirmed into the file');
    writeFileSync(join(box.cwd, '.construct', 'sources.json'), '{"format":"construct-sources","formatVersion":2,"sources":[{"id":"x","kind":"jira","purpose":"p","authorityLevel":"informative","sensitivity":"internal","token":"abc"}]}', 'utf8');
    const invalid = await capture(() => run(['project', 'validate'], ctx));
    assert.equal(invalid.code, 1);
    assert.match(invalid.out, /cannot grant consent, carry secrets/);
  });
});

test('sources are declared into the committed file, read by digest, related, and retired', async () => {
  await inProject(async (ctx, box) => {
    const ground = join(box.cwd, 'docs');
    mkdirSync(ground);
    writeFileSync(join(ground, 'design.md'), '# Design\n', 'utf8');
    const add = await capture(() => run(['source', 'add', 'design', '--kind=directory', '--purpose=design docs', `--locator=${ground}`, '--authority=authoritative', '--authoritative-for=requirement', '--not-authoritative-for=capacity', '--freshness-hours=24'], ctx));
    assert.equal(add.code, 0, add.err);
    const declared = JSON.parse(readFileSync(join(box.cwd, '.construct', 'sources.json'), 'utf8'));
    assert.equal(declared.sources[0].id, 'design');
    assert.deepEqual(declared.sources[0].notAuthoritativeFor, ['capacity']);
    const dup = await capture(() => run(['source', 'add', 'design', '--kind=directory', '--purpose=again', `--locator=${ground}`], ctx));
    assert.equal(dup.code, 1);
    assert.match(dup.err, /already declared/);
    const badLocator = await capture(() => run(['source', 'add', 'tracker', '--kind=jira', '--purpose=tickets', '--locator=proj-1'], ctx));
    assert.equal(badLocator.code, 2);
    assert.match(badLocator.err, /project key/);

    const first = await capture(() => run(['source', 'refresh', 'design'], ctx));
    assert.equal(first.code, 0, first.err);
    assert.match(first.out, /design: changed/);
    const second = await capture(() => run(['source', 'refresh', 'design'], ctx));
    assert.match(second.out, /design: unchanged/);
    writeFileSync(join(ground, 'more.md'), '# More\n', 'utf8');
    const third = await capture(() => run(['source', 'refresh', 'design', '--json'], ctx));
    assert.equal(JSON.parse(third.out).outcome, 'changed');

    const local = await capture(() => run(['source', 'add', 'tracker', '--kind=jira', '--purpose=tickets', '--locator=PROJ', '--local'], ctx));
    assert.equal(local.code, 0, local.err);
    assert.equal(JSON.parse(readFileSync(join(box.cwd, '.construct', 'sources.json'), 'utf8')).sources.length, 1, 'a local source stays out of the committed file');
    const unreachable = await capture(() => run(['source', 'refresh', 'tracker'], ctx));
    assert.equal(unreachable.code, 1);
    assert.match(unreachable.out, /unreachable \(nothing in this session can read a jira source/);

    const relate = await capture(() => run(['source', 'relate', 'design', 'governs', 'tracker'], ctx));
    assert.equal(relate.code, 0, relate.err);
    assert.match(relate.out, /design governs tracker/);
    const badRelate = await capture(() => run(['source', 'relate', 'design', 'owns', 'tracker'], ctx));
    assert.equal(badRelate.code, 2);

    const show = await capture(() => run(['source', 'show', 'design'], ctx));
    assert.match(show.out, /settles requirement; must not settle capacity/);
    assert.match(show.out, /reachability: reachable; freshness: fresh/);
    const list = await capture(() => run(['source', 'list'], ctx));
    assert.match(list.out, /^design\s+directory\s+declared\s+reachable\s+fresh/m);
    assert.match(list.out, /^tracker\s+jira\s+local\s+unreachable\s+never_read/m);

    const retire = await capture(() => run(['source', 'retire', 'design'], ctx));
    assert.equal(retire.code, 0);
    assert.equal(JSON.parse(readFileSync(join(box.cwd, '.construct', 'sources.json'), 'utf8')).sources.length, 0);
    const gone = await capture(() => run(['source', 'show', 'design'], ctx));
    assert.equal(gone.code, 1);
  });
});

test('skills list, show, install, verify, and remove use the shipped bytes', async () => {
  await inProject(async (ctx, box) => {
    const dir = join(box.home, 'skills');
    const list = await capture(() => run(['skill', 'list'], ctx));
    assert.equal(list.code, 0);
    assert.match(list.out, /^construct\s/m);
    assert.match(list.out, /^investigative-research\s/m);
    const show = await capture(() => run(['skill', 'show', 'intake', '--json'], ctx));
    assert.ok(JSON.parse(show.out).files.includes('SKILL.md'));
    const install = await capture(() => run(['skill', 'install', 'intake', `--dir=${dir}`], ctx));
    assert.equal(install.code, 0);
    assert.match(install.out, /intake: planted/);
    const kept = await capture(() => run(['skill', 'install', 'intake', `--dir=${dir}`], ctx));
    assert.match(kept.out, /intake: kept/);
    writeFileSync(join(dir, 'intake', 'SKILL.md'), 'edited', 'utf8');
    const refused = await capture(() => run(['skill', 'install', 'intake', `--dir=${dir}`], ctx));
    assert.equal(refused.code, 1);
    assert.match(refused.out, /refused/);
    const forced = await capture(() => run(['skill', 'install', 'intake', `--dir=${dir}`, '--force'], ctx));
    assert.equal(forced.code, 0);
    const verify = await capture(() => run(['skill', 'verify', `--dir=${dir}`], ctx));
    assert.match(verify.out, /^intake: current/m);
    assert.match(verify.out, /^construct: current/m);
    assert.match(verify.out, /^adversarial-review: absent/m);
    const noHost = await capture(() => run(['skill', 'install', 'intake'], ctx));
    assert.equal(noHost.code, 2);
    assert.match(noHost.err, /no host detected/);
    const preview = await capture(() => run(['skill', 'remove', 'intake', `--dir=${dir}`], ctx));
    assert.match(preview.out, /Nothing was removed/);
    const removed = await capture(() => run(['skill', 'remove', 'intake', `--dir=${dir}`, '--confirm'], ctx));
    assert.equal(removed.code, 0);
    assert.equal(existsSync(join(dir, 'intake')), false);
    const missing = await capture(() => run(['skill', 'show', 'nope'], ctx));
    assert.equal(missing.code, 1);
  });
});

test('reset previews the exact targets, removes only them on --confirm, and recreates state', async () => {
  await inProject(async (ctx, box) => {
    writeFileSync(join(box.cwd, '.construct', 'settings.json'), '{}', 'utf8');
    const preview = await capture(() => run(['reset'], ctx));
    assert.equal(preview.code, 0);
    assert.match(preview.out, /settings\.json/);
    assert.match(preview.out, /construct\.sqlite/);
    assert.match(preview.out, /Nothing was removed/);
    assert.ok(existsSync(join(box.cwd, '.construct', 'settings.json')));
    const projectBefore = readFileSync(join(box.cwd, '.construct', 'project.json'), 'utf8');
    const confirmed = await capture(() => run(['reset', '--confirm'], ctx));
    assert.equal(confirmed.code, 0, confirmed.err);
    assert.equal(existsSync(join(box.cwd, '.construct', 'settings.json')), false);
    assert.ok(existsSync(join(box.cwd, '.construct', 'state', 'construct.sqlite')));
    assert.equal(readFileSync(join(box.cwd, '.construct', 'project.json'), 'utf8'), projectBefore, 'the committed project file is untouched');
    const status = await capture(() => run(['status', '--json'], ctx));
    assert.equal(JSON.parse(status.out).onboarding.state, 'incomplete');
    const full = await capture(() => run(['reset', '--confirm', '--include-project-files', '--keep-state', '--json'], ctx));
    assert.equal(full.code, 0);
    assert.equal(existsSync(join(box.cwd, '.construct', 'project.json')), false);
  });
});

test('an unreadable state directory is a failure sentence, not a stack trace', async () => {
  if (process.getuid?.() === 0) return;
  await inProject(async (ctx, box) => {
    const db = join(box.cwd, '.construct', 'state', 'construct.sqlite');
    chmodSync(db, 0o000);
    try {
      const { code, err } = await capture(() => run(['status'], ctx));
      assert.equal(code, 1);
      assert.match(err, /cannot open the state database/);
      assert.doesNotMatch(err, /    at /);
      assert.doesNotMatch(err, /node:sqlite/);
    } finally {
      chmodSync(db, 0o600);
    }
  });
});
