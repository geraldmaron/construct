/**
 * tests/cli/nouns.test.ts — workflow, run, inbox, staff, and skill update on
 * the command line, in prose and JSON, with stable exit codes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../src/cli/index.ts';
import { capture, inProject } from './support.ts';
import { openStateStore } from '../../src/kernel/state/open.ts';
import { raiseDecision } from '../../src/kernel/state/decisions.ts';
import { getProfile } from '../../src/kernel/state/profile.ts';
import { projectDbPath } from '../../src/kernel/project/layout.ts';

test('workflow list, show, resolve, validate, and run (dry and real) from the command line', async () => {
  await inProject(async (ctx, box) => {
    const list = await capture(() => run(['workflow', 'list'], ctx));
    assert.equal(list.code, 0, list.err);
    assert.match(list.out, /^design-conformance\s+2\.0\.1\s+builtin\s+manage/m);
    assert.match(list.out, /^remember\s+1\.0\.0\s+builtin\s+remember/m);
    const show = await capture(() => run(['workflow', 'show', 'design-conformance'], ctx));
    assert.match(show.out, /steps:/);
    assert.match(show.out, /gather\s+observe\s+context-mapping/);
    const missing = await capture(() => run(['workflow', 'show', 'nope'], ctx));
    assert.equal(missing.code, 1);
    const validate = await capture(() => run(['workflow', 'validate'], ctx));
    assert.equal(validate.code, 0);
    assert.match(validate.out, /17 skill\(s\) and 22 workflow\(s\) validate/);

    const resolve = await capture(() => run(['workflow', 'resolve', 'design-conformance', '--input=target=src'], ctx));
    assert.equal(resolve.code, 0, resolve.out + resolve.err);
    assert.match(resolve.out, /can run: 4 step\(s\)/);
    const unresolved = await capture(() => run(['workflow', 'resolve', 'design-conformance'], ctx));
    assert.equal(unresolved.code, 1);
    assert.match(unresolved.out, /missing_step_input: input "target" is required/);
    const badInput = await capture(() => run(['workflow', 'run', 'design-conformance', '--input=target'], ctx));
    assert.equal(badInput.code, 2);

    const dry = await capture(() => run(['workflow', 'run', 'design-conformance', '--input=target=src', '--dry-run'], ctx));
    assert.equal(dry.code, 0);
    assert.match(dry.out, /Nothing was started/);
    const listBefore = await capture(() => run(['run', 'list', '--json'], ctx));
    assert.deepEqual(JSON.parse(listBefore.out), []);

    const started = await capture(() => run(['workflow', 'run', 'design-conformance', '--input=target=src', '--json'], ctx));
    assert.equal(started.code, 0, started.err);
    const record = JSON.parse(started.out) as { run: { id: string; state: string }; created: boolean };
    assert.equal(record.run.state, 'ready');
    const again = await capture(() => run(['workflow', 'run', 'design-conformance', '--input=target=src'], ctx));
    assert.match(again.out, /already running: run /);

    const runs = await capture(() => run(['run', 'list'], ctx));
    assert.match(runs.out, new RegExp(`^${record.run.id}\\s+design-conformance@2\\.0\\.1\\s+ready\\s+manual`, 'm'));
    const filtered = await capture(() => run(['run', 'list', '--state=succeeded', '--json'], ctx));
    assert.deepEqual(JSON.parse(filtered.out), []);
    const badState = await capture(() => run(['run', 'list', '--state=done'], ctx));
    assert.equal(badState.code, 2);
    const showRun = await capture(() => run(['run', 'show', record.run.id], ctx));
    assert.match(showRun.out, /step gather: ready/);
    assert.match(showRun.out, /step deterministic: pending/);
    const cancel = await capture(() => run(['run', 'cancel', record.run.id, '--reason=changed my mind'], ctx));
    assert.match(cancel.out, /cancelled/);
    const resumed = await capture(() => run(['run', 'resume', record.run.id, '--json'], ctx));
    assert.equal(JSON.parse(resumed.out).state, 'cancelled');
    void box;
  });
});

test('workflow run says when a corrected start replaced a blocked run and when a reused run was started with other values', async () => {
  await inProject(async (ctx) => {
    const wrong = await capture(() => run(['workflow', 'run', 'research-brief', '--input=question=Why did churn rise?', '--input=dateRange=Q3'], ctx));
    assert.equal(wrong.code, 1);
    assert.match(wrong.out, /^started: run (\S+) \(blocked\)/m);
    assert.match(wrong.out, /or run this again with the input corrected; it says when it replaces this run\./);
    const blockedId = /^started: run (\S+) \(blocked\)/m.exec(wrong.out)![1]!;
    const retried = await capture(() => run(['workflow', 'run', 'research-brief', '--input=question=Why did churn rise?', '--input=dateRange=Q3'], ctx));
    assert.equal(retried.code, 1);
    assert.match(retried.out, new RegExp(`^checked again: run ${blockedId} \\(blocked\\)$`, 'm'), 'the same start checks the blocked run again; it is not called running');
    const fixed = await capture(() => run(['workflow', 'run', 'research-brief', '--input=question=Why did churn rise?', '--input=scope=enterprise'], ctx));
    assert.equal(fixed.code, 0, fixed.out + fixed.err);
    assert.match(fixed.out, new RegExp(`^superseded blocked run ${blockedId}$`, 'm'));
    const reused = await capture(() => run(['workflow', 'run', 'research-brief', '--input=question=Why did churn rise?', '--input=scope=self-serve', '--json'], ctx));
    const record = JSON.parse(reused.out) as { created: boolean; differs: string[]; superseded: string | null };
    assert.equal(record.created, false);
    assert.deepEqual(record.differs, ['scope']);
    assert.equal(record.superseded, null);
    const prose = await capture(() => run(['workflow', 'run', 'research-brief', '--input=question=Why did churn rise?', '--input=scope=self-serve'], ctx));
    assert.match(prose.out, /^note: run \S+ already covers this work but was started with a different scope; carry on with it, or cancel it and start again to use the new values$/m);
  });
});

test('a standing trigger is scheduled, listed, fired idempotently, disabled, and given a recipe', async () => {
  await inProject(async (ctx, box) => {
    mkdirSync(join(box.cwd, 'docs'));
    writeFileSync(join(box.cwd, 'docs', 'a.md'), 'a', 'utf8');
    const bad = await capture(() => run(['workflow', 'schedule', 'design-conformance', '--cron=0 9 * * 1', '--max-tier=draft', '--input=target=docs'], ctx));
    assert.equal(bad.code, 1);
    assert.match(bad.err, /permission boundary \(draft\) is below/);
    const noClock = await capture(() => run(['workflow', 'schedule', 'design-conformance'], ctx));
    assert.equal(noClock.code, 2);
    const scheduled = await capture(() => run(['workflow', 'schedule', 'design-conformance', '--cron=0 9 1 * *', '--timezone=Europe/Berlin', '--max-tier=project_write', '--input=target=docs', '--trigger-id=monthly', '--json'], ctx));
    assert.equal(scheduled.code, 0, scheduled.err);
    assert.equal(JSON.parse(scheduled.out).nextDueAt, '2026-10-01T07:00:00.000Z');
    const triggers = await capture(() => run(['workflow', 'triggers'], ctx));
    assert.match(triggers.out, /^monthly\s+design-conformance\s+schedule\s+enabled\s+0 9 1 \* \* Europe\/Berlin/m);
    const fired = await capture(() => run(['workflow', 'fire', 'monthly', '--key=tick-1', '--json'], ctx));
    assert.equal(fired.code, 0, fired.err);
    const first = JSON.parse(fired.out) as { outcome: string; runId: string };
    assert.equal(first.outcome, 'started');
    const dup = await capture(() => run(['workflow', 'fire', 'monthly', '--key=tick-1'], ctx));
    assert.match(dup.out, /^deduplicated run /);
    const overlap = await capture(() => run(['workflow', 'fire', 'monthly', '--key=tick-2'], ctx));
    assert.match(overlap.out, /^skipped_overlap/);
    const dry = await capture(() => run(['workflow', 'fire', 'monthly', '--key=tick-3', '--dry-run'], ctx));
    assert.match(dry.out, /^dry_run/);
    const disabled = await capture(() => run(['workflow', 'disable', 'monthly'], ctx));
    assert.match(disabled.out, /is disabled/);
    const off = await capture(() => run(['workflow', 'fire', 'monthly', '--key=tick-4'], ctx));
    assert.match(off.out, /^disabled/);
    const recipe = await capture(() => run(['workflow', 'recipe', 'monthly'], ctx));
    assert.match(recipe.out, /construct workflow fire monthly --key/);
    const ci = await capture(() => run(['workflow', 'recipe', 'monthly', '--clock=github-actions'], ctx));
    assert.match(ci.out, /schedule:/);
    const enabled = await capture(() => run(['workflow', 'enable', 'monthly', '--json'], ctx));
    assert.equal(JSON.parse(enabled.out).enabled, true);
  });
});

test('the inbox lists what waits on the person and records their answer', async () => {
  await inProject(async (ctx, box) => {
    // Flags answered the three questions; discovery proposals still wait.
    const afterFlags = await capture(() => run(['inbox', 'list', '--json'], ctx));
    const waiting = JSON.parse(afterFlags.out) as { id: string; kind: string; text?: string }[];
    assert.ok(waiting.every((d) => d.kind === 'proposal'), 'no setup questions remain after flags');
    assert.ok(waiting.length > 0, 'proposed statements are reachable');
    const first = waiting[0]!;
    const shown = await capture(() => run(['inbox', 'show', first.id], ctx));
    assert.match(shown.out, /options: confirm \| retire/);
    const accepted = await capture(() => run(['inbox', 'resolve', first.id, 'confirm'], ctx));
    assert.equal(accepted.code, 0, accepted.err);
    // Reset the state and init without answers so the three onboarding questions are open.
    await capture(() => run(['reset', '--confirm'], ctx));
    await capture(() => run(['init', `--skills-dir=${join(box.home, 'skills')}`], ctx));
    const list = await capture(() => run(['inbox', 'list', '--json'], ctx));
    const open = JSON.parse(list.out) as { id: string; kind: string; question: string; options?: string[] }[];
    const questions = open.filter((d) => d.kind === 'inbox_item');
    assert.equal(questions.length, 3, 'the three setup questions wait, even when proposals are also listed');
    const scale = questions.find((d) => Array.isArray(d.options) && d.options.includes('solo'))!;
    const show = await capture(() => run(['inbox', 'show', scale.id], ctx));
    assert.match(show.out, /options: solo \| side_project/);
    assert.match(show.out, /your primary product \(just you\)/);
    const scaleNow = (): string | null => {
      const store = openStateStore(projectDbPath(box.cwd));
      try {
        return getProfile(store)?.scale ?? null;
      } finally {
        store.close();
      }
    };
    const wrong = await capture(() => run(['inbox', 'resolve', scale.id, 'enormous'], ctx));
    assert.equal(wrong.code, 1);
    assert.match(wrong.err, /is not one of them/);
    // This command is not the person at a terminal of theirs, so it cannot make the project a side project.
    const light = await capture(() => run(['inbox', 'resolve', scale.id, 'side project'], ctx));
    assert.equal(light.code, 1);
    assert.match(light.err, /needs your own answer, and this command is not running in a terminal of yours/);
    assert.equal(scaleNow(), null);
    const resolved = await capture(() => run(['inbox', 'resolve', scale.id, 'primary product'], ctx));
    assert.equal(resolved.code, 0, resolved.err);
    assert.match(resolved.out, /recorded: /);
    assert.equal(scaleNow(), 'solo', 'the question\'s own words land in the profile');
    const after = await capture(() => run(['inbox', 'list', '--json'], ctx));
    assert.equal((JSON.parse(after.out) as { kind: string }[]).filter((d) => d.kind === 'inbox_item').length, 2);
    const missing = await capture(() => run(['inbox', 'show', 'nope'], ctx));
    assert.equal(missing.code, 1);
  });
});

test('inbox show prints the whole question a person-only prompt had to cut, and inbox list and run show its first line', async () => {
  await inProject(async (ctx, box) => {
    const started = await capture(() => run(['workflow', 'run', 'design-conformance', '--input=target=src', '--json'], ctx));
    assert.equal(started.code, 0, started.err);
    const runId = (JSON.parse(started.out) as { run: { id: string } }).run.id;
    const store = openStateStore(projectDbPath(box.cwd));
    try {
      raiseDecision(store, {
        id: 'decision-cut',
        kind: 'approval',
        question: 'Move deliverable d-1 (outcome) from validated to accepted?\n(more: construct inbox show decision-cut)',
        runId,
        options: ['approve', 'decline'],
        subject: { promote: { deliverableId: 'd-1', to: 'accepted', reason: null, requestedBy: 'relayed via claude-code' }, brief: 'Move deliverable d-1 (outcome) from validated to accepted?\nHighest sensitivity cited: confidential.' },
        at: '2026-09-02T12:00:00.000Z',
      });
    } finally {
      store.close();
    }
    const shown = await capture(() => run(['inbox', 'show', 'decision-cut'], ctx));
    assert.equal(shown.code, 0, shown.err);
    assert.match(shown.out, /^decision-cut \(approval, open\): Move deliverable d-1 \(outcome\) from validated to accepted\?\nHighest sensitivity cited: confidential\.\n/);
    assert.doesNotMatch(shown.out, /\(more: construct inbox show/, 'the whole text is shown, not the pointer to it');
    assert.match(shown.out, /about: \{"promote":\{"deliverableId":"d-1"/);
    assert.doesNotMatch(shown.out, /"brief"/, 'the whole text is not printed twice');
    const listed = await capture(() => run(['inbox', 'list'], ctx));
    assert.equal(listed.code, 0, listed.err);
    assert.match(listed.out, new RegExp(`^decision-cut {2}approval {2}Move deliverable d-1 \\(outcome\\) from validated to accepted\\? {2}\\[approve \\| decline\\] {2}run ${runId}\n`, 'm'), listed.out);
    assert.doesNotMatch(listed.out, /\(more: construct inbox show/, 'the list shows each question\u2019s first line only');
    const shownRun = await capture(() => run(['run', 'show', runId], ctx));
    assert.equal(shownRun.code, 0, shownRun.err);
    assert.match(shownRun.out, /^ {2}waiting on you: Move deliverable d-1 \(outcome\) from validated to accepted\? \[approve \| decline\] \(decision decision-cut\)$/m, shownRun.out);
    assert.doesNotMatch(shownRun.out, /\(more: construct inbox show/, 'a run shows each question\u2019s first line only');
  });
});

test('staff members are added, updated, paused, and retired', async () => {
  await inProject(async (ctx) => {
    const none = await capture(() => run(['staff', 'list'], ctx));
    assert.match(none.out, /no staff members/);
    const incomplete = await capture(() => run(['staff', 'add', 'reviewer', '--name=Rev'], ctx));
    assert.equal(incomplete.code, 2);
    const added = await capture(() => run(['staff', 'add', 'reviewer', '--name=Rev', '--title=Design reviewer', '--mission=keep principles honest', '--capability=review', '--skill=adversarial-review', '--json'], ctx));
    assert.equal(added.code, 0, added.err);
    assert.deepEqual(JSON.parse(added.out).capabilities, ['review']);
    const dup = await capture(() => run(['staff', 'add', 'reviewer', '--name=Rev', '--title=x', '--mission=y'], ctx));
    assert.equal(dup.code, 1);
    const updated = await capture(() => run(['staff', 'update', 'reviewer', '--capability=review', '--capability=drift', '--json'], ctx));
    assert.deepEqual(JSON.parse(updated.out).capabilities, ['drift', 'review']);
    assert.deepEqual(JSON.parse(updated.out).skillIds, []);
    const paused = await capture(() => run(['staff', 'pause', 'reviewer'], ctx));
    assert.match(paused.out, /is paused/);
    const resumed = await capture(() => run(['staff', 'pause', 'reviewer', '--resume'], ctx));
    assert.match(resumed.out, /is active/);
    const list = await capture(() => run(['staff', 'list'], ctx));
    assert.match(list.out, /^reviewer\s+active\s+Rev, Design reviewer/m);
    const retired = await capture(() => run(['staff', 'retire', 'reviewer', '--json'], ctx));
    assert.equal(JSON.parse(retired.out).status, 'retired');
    const missing = await capture(() => run(['staff', 'show', 'nobody'], ctx));
    assert.equal(missing.code, 1);
  });
});

test('skill update reconciles the lock and leaves a changed project bundle alone until confirmed', async () => {
  await inProject(async (ctx, box) => {
    const current = await capture(() => run(['skill', 'update', '--dry-run'], ctx));
    assert.equal(current.code, 0, current.err);
    assert.match(current.out, /would update: nothing/);
    assert.match(current.out, /39\/39 current/);
    // A project-authored skill appears: unlocked, then locked.
    const dir = join(box.cwd, '.construct', 'skills', 'house-style');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: house-style\ndescription: our style\nlicense: Apache-2.0\nmetadata:\n  version: 0.1.0\n---\n\n# House style\n', 'utf8');
    writeFileSync(join(dir, 'construct.skill.json'), JSON.stringify({ format: 'construct-skill', formatVersion: 1, id: 'house-style', title: 'House style', version: '0.1.0', category: 'method', owner: 'us', activation: ['when writing'], standDown: ['otherwise'], interactionClasses: ['manage'], capabilities: [], actionTiers: ['draft'] }), 'utf8');
    const locked = await capture(() => run(['skill', 'update'], ctx));
    assert.match(locked.out, /updated: skill:house-style/);
    const lock = JSON.parse(readFileSync(join(box.cwd, '.construct', 'registry.lock.json'), 'utf8'));
    assert.equal(lock.skills['house-style'].origin, 'project');
    // The project edits it without a version bump: diverged, and not re-locked until named.
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: house-style\ndescription: our style\nlicense: Apache-2.0\nmetadata:\n  version: 0.1.0\n---\n\n# House style (edited)\n', 'utf8');
    const status = await capture(() => run(['status'], ctx));
    assert.match(status.out, /house-style diverged/);
    const held = await capture(() => run(['skill', 'update'], ctx));
    assert.match(held.out, /left alone until confirmed: skill:house-style/);
    const confirmed = await capture(() => run(['skill', 'update', '--confirm=house-style'], ctx));
    assert.match(confirmed.out, /updated: skill:house-style/);
    const doctor = await capture(() => run(['doctor', '--json'], ctx));
    assert.match((JSON.parse(doctor.out).checks as { name: string; detail: string }[]).find((c) => c.name === 'registry')!.detail, /40\/40 current/);
  });
});
