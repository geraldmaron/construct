/**
 * tests/cli/named-staff.test.ts — the user who already knows what to ask for.
 *
 * Routing exists for the user who does not know which concerns their outcome
 * touches. This surface is for the one who does: naming the domains skips the
 * keyword map and the namer entirely. What it must NOT skip is the catalog —
 * a named domain is validated exactly as a model's proposal is, because a role
 * invented at the point of use is a role nobody defined, staffed anyway.
 *
 * The other assertion here is about the record: a user's own choice is not an
 * inference, and neither the run's report nor the work log may present it as
 * one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, parseOutcomeArgs } from '../../src/cli/index.ts';
import { sterile } from '../harness/sterile.ts';
import { openStore } from '../../src/kernel/store/open.ts';
import { readWorkLog } from '../../src/kernel/store/worklog.ts';
import { listTasks } from '../../src/kernel/store/tasks.ts';
import { startRunSelected } from '../../src/kernel/run/outcome.ts';

const AT = '2026-08-05T00:00:00.000Z';

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function run(argv: string[]): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-named-'));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
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
  try {
    const code = await main(argv);
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

test('naming the staff dispatches without consulting any namer, and says so', async () => {
  const result = await run([
    'outcome',
    '--domains=privacy,security',
    'Move the analytics warehouse to a new region',
  ]);
  assert.equal(result.code, 0);
  assert.match(result.out, /privacy/);
  assert.match(result.out, /security/);
  assert.match(result.out, /reason: named by the user/);
  assert.match(result.out, /You named these; nothing was inferred/);
  assert.match(result.out, /queued 2 task\(s\)/);
});

test('a domain nobody defined is an error that lists the catalog, never a role invented on the spot', async () => {
  const result = await run(['outcome', '--domains=vibes', 'Ship the thing']);
  assert.equal(result.code, 2);
  assert.match(result.err, /unknown domain "vibes"/);
  assert.match(result.err, /the catalog is: /);
  assert.match(result.err, /privacy/);
});

test('naming the staff and naming a host together is a usage error, not a silent charge', () => {
  assert.throws(
    () => parseOutcomeArgs(['--domains=privacy', '--host=claude', 'x']),
    /no model is consulted/,
  );
  assert.throws(() => parseOutcomeArgs(['--domains=', 'x']), /at least one domain/);
});

test('the record shows a user choice as a user choice: provenance user, evidence not a keyword', () => {
  const fixture = sterile();
  const store = openStore(join(fixture.paths.dataDir, 'construct.db'));
  try {
    const started = startRunSelected(store, {
      runId: 'run-named',
      outcome: 'Rework the billing emails',
      at: AT,
      // A repeat is the user saying it twice, not two engagements.
      domains: ['privacy', 'privacy'],
    });

    assert.equal(started.inferredBy, 'user');
    assert.deepEqual(started.implicated.map((i) => i.domain), ['privacy']);
    assert.equal(started.implicated[0].score, 0);
    assert.deepEqual(started.implicated[0].signals, ['named by the user']);
    assert.equal(started.tasks.length, 1);

    const log = readWorkLog(store, 'run-named');
    const implicated = log.find((e) => e.action === 'domain-implicated');
    assert.ok(implicated);
    assert.equal((implicated.detail as { inferredBy: string }).inferredBy, 'user');
    // No model was consulted, so nothing may claim one was.
    assert.equal(log.some((e) => e.action === 'implication-named'), false);
    assert.equal(log.some((e) => e.action === 'namer-failed'), false);
    assert.equal(listTasks(store, 'run-named').length, 1);

    assert.throws(
      () =>
        startRunSelected(store, {
          runId: 'run-bad',
          outcome: 'x',
          at: AT,
          domains: ['not-a-domain'],
        }),
      /unknown domain "not-a-domain"/,
    );
  } finally {
    store.close();
    fixture.cleanup();
  }
});
