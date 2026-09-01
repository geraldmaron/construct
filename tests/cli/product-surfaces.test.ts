/**
 * tests/cli/product-surfaces.test.ts — StaffMember, Routine, and v1 inbox CLI.
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
import { createDecisionService } from '../../src/kernel/services/decision.ts';
import { openStateStore } from '../../src/kernel/state/open.ts';
import { projectDbPath } from '../../src/kernel/project/layout.ts';

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
