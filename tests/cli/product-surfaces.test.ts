/**
 * tests/cli/product-surfaces.test.ts — StaffMember, Routine, v1 inbox, headless work.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { init } from '../../src/cli/init.ts';
import { staff } from '../../src/cli/staff.ts';
import { routine } from '../../src/cli/routine.ts';
import { inbox } from '../../src/cli/show.ts';
import { work } from '../../src/cli/work.ts';
import { waive, revoke } from '../../src/cli/controls.ts';
import { consent, trust } from '../../src/cli/settings.ts';
import { verdict } from '../../src/cli/verdict.ts';
import { createDecisionService } from '../../src/kernel/services/decision.ts';
import { openStateStore } from '../../src/kernel/state/open.ts';
import { projectDbPath } from '../../src/kernel/project/layout.ts';
import { getDeliverableByTask, listActivity } from '../../src/kernel/state/deliverables.ts';
import { getTask } from '../../src/kernel/state/tasks.ts';

async function capture(fn: () => number | Promise<number>): Promise<{
  code: number;
  out: string;
  err: string;
}> {
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (chunk: string) => {
    out.push(String(chunk));
    return true;
  };
  (process.stderr as { write: unknown }).write = (chunk: string) => {
    err.push(String(chunk));
    return true;
  };
  let code: number;
  try {
    code = await fn();
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
  }
  return { code, out: out.join(''), err: err.join('') };
}

test('staff + routine + inbox on an init’d project', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'construct-product-'));
  try {
    assert.equal((await capture(() => init([], cwd, {}))).code, 0);

    const created = await capture(() =>
      staff(
        [
          'create',
          '--name=Sec',
          '--title=Security',
          '--mission=Own auth review',
          '--id=staff-sec',
        ],
        cwd,
      ),
    );
    assert.equal(created.code, 0);
    assert.match(created.out, /staff staff-sec created/);
    assert.match(created.out, /not an executor/);

    const listed = await capture(() => staff(['list'], cwd));
    assert.equal(listed.code, 0);
    assert.match(listed.out, /staff-sec/);

    const routineCreate = await capture(() =>
      routine(
        [
          'create',
          '--id=r-auth',
          '--output=weekly auth posture note',
          '--pin=claude',
          '--skill=adversarial-review',
        ],
        cwd,
      ),
    );
    assert.equal(routineCreate.code, 0);

    const ran = await capture(() => routine(['run', '--id=r-auth'], cwd));
    assert.equal(ran.code, 0);
    assert.match(ran.out, /started run/);
    assert.match(ran.out, /pin=claude/);

    const store = openStateStore(projectDbPath(cwd));
    try {
      createDecisionService(store).raise({
        id: 'dec-1',
        kind: 'requires_action_approval',
        question: 'Publish the note?',
        at: '2026-08-31T20:00:00.000Z',
      });
    } finally {
      store.close();
    }

    const inboxList = await capture(() => inbox([], cwd));
    assert.equal(inboxList.code, 0);
    assert.match(inboxList.out, /dec-1/);
    assert.match(inboxList.out, /requires_action_approval/);

    const decided = await capture(() => inbox(['decide', 'dec-1', 'ship it'], cwd));
    assert.equal(decided.code, 0);
    assert.match(decided.out, /resolved dec-1/);

    const empty = await capture(() => inbox([], cwd));
    assert.equal(empty.code, 0);
    assert.match(empty.out, /empty/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('headless work claim/submit and judgment kinds on v1', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'construct-work-v1-'));
  try {
    assert.equal((await capture(() => init([], cwd, {}))).code, 0);

    const routineCreate = await capture(() =>
      routine(
        [
          'create',
          '--id=r1',
          '--output=note',
          '--pin=claude',
          '--skill=adversarial-review',
        ],
        cwd,
      ),
    );
    assert.equal(routineCreate.code, 0);
    assert.equal((await capture(() => routine(['run', '--id=r1'], cwd))).code, 0);

    const noPin = await capture(() => work(['claim'], undefined, undefined, process.env, cwd));
    assert.equal(noPin.code, 2);
    assert.match(noPin.err, /--pin/);

    const claimed = await capture(() =>
      work(['claim', '--pin=claude'], undefined, undefined, process.env, cwd),
    );
    assert.equal(claimed.code, 0);
    assert.match(claimed.out, /claimed /);
    const taskMatch = /claimed (\S+)/.exec(claimed.out);
    const tokenMatch = /token (\d+)/.exec(claimed.out);
    assert.ok(taskMatch && tokenMatch);
    const taskId = taskMatch[1];
    const token = tokenMatch[1];

    const submitted = await capture(() =>
      work(
        [
          'submit',
          '--pin=claude',
          `--task=${taskId}`,
          `--token=${token}`,
          '--deliverable={"ok":true}',
        ],
        undefined,
        undefined,
        process.env,
        cwd,
      ),
    );
    assert.equal(submitted.code, 0, submitted.err);
    assert.match(submitted.out, /trust=draft/);

    const status = await capture(() =>
      work(['status'], undefined, undefined, process.env, cwd),
    );
    assert.equal(status.code, 0);
    assert.match(status.out, /done=1/);

    const waived = await capture(() =>
      waive([`--task=${taskId}`, '--challenge=c1', '--reason=accepted risk'], cwd),
    );
    assert.equal(waived.code, 0, waived.err);
    assert.match(waived.out, /requires_waiver/);

    const store = openStateStore(projectDbPath(cwd));
    try {
      assert.ok(listActivity(store).some((e) => e.kind === 'control.waived'));

      const consented = await capture(() => consent(['--set=on'], cwd));
      assert.equal(consented.code, 0, consented.err);
      assert.match(consented.out, /requires_consent/);
      assert.ok(listActivity(store).some((e) => e.kind === 'consent.set'));

      const trusted = await capture(() => trust(['--ratify', `--task=${taskId}`], cwd));
      assert.equal(trusted.code, 0, trusted.err);
      assert.match(trusted.out, /requires_trust/);
      assert.equal(getDeliverableByTask(store, taskId)?.trustState, 'accepted');

      assert.equal((await capture(() => routine(['run', '--id=r1'], cwd))).code, 0);
      const claimed2 = await capture(() =>
        work(['claim', '--pin=claude'], undefined, undefined, process.env, cwd),
      );
      assert.equal(claimed2.code, 0);
      const task2 = /claimed (\S+)/.exec(claimed2.out)?.[1];
      assert.ok(task2);

      const revoked = await capture(() =>
        revoke([`--task=${task2}`, '--reason=runaway'], cwd),
      );
      assert.equal(revoked.code, 0, revoked.err);
      assert.equal(getTask(store, task2)?.state, 'failed');

      assert.equal((await capture(() => routine(['run', '--id=r1'], cwd))).code, 0);
      const claimed3 = await capture(() =>
        work(['claim', '--pin=claude'], undefined, undefined, process.env, cwd),
      );
      const task3 = /claimed (\S+)/.exec(claimed3.out)?.[1];
      const token3 = /token (\d+)/.exec(claimed3.out)?.[1];
      assert.ok(task3 && token3);
      assert.equal(
        (
          await capture(() =>
            work(
              [
                'submit',
                '--pin=claude',
                `--task=${task3}`,
                `--token=${token3}`,
                '--deliverable={"v":1}',
              ],
              undefined,
              undefined,
              process.env,
              cwd,
            ),
          )
        ).code,
        0,
      );

      const verd = await capture(() => verdict([`--task=${task3}`, '--dismiss'], cwd));
      assert.equal(verd.code, 0, verd.err);
      assert.equal(getDeliverableByTask(store, task3)?.trustState, 'challenged');
    } finally {
      store.close();
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
