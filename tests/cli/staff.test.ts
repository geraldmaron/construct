/**
 * tests/cli/staff.test.ts — the surface on the staffing gate.
 *
 * A run that meets a concern the catalog cannot carry records it and carries on,
 * which is correct: routing must not widen itself as a side effect of one
 * outcome. What this covers is the other half, which did not exist — the record
 * sat in the work log and staffing it meant writing code.
 *
 * The properties held here are the ones that keep this a surface and not a
 * second gate. A refusal reaches the person in the gate's own words. An admitted
 * profile staffs nothing; it becomes a decision whose default is NOT STAFFED. And
 * a profile too thin to evaluate is refused rather than crashing the verb,
 * because a hand-drafted profile with a list left out is the ordinary case.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/cli/index.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { appendWorkLog } from '../../src/kernel/store/worklog.ts';
import { openDecisions } from '../../src/kernel/store/decisions.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';

const AT = '2026-08-13T00:00:00.000Z';

interface Session {
  /** The tmp root this session's store and files live under. */
  readonly root: string;
  /** Run the CLI, returning its exit code. Output accumulates on the session. */
  readonly cli: (argv: string[]) => Promise<number>;
  readonly out: () => string;
  readonly err: () => string;
}

/**
 * Every case runs against a store rooted in a tmpdir, never the real one: this
 * verb reads whatever the machine happens to have recorded, and a test that read
 * it would pass or fail for reasons that are not about the code.
 */
async function session(body: (s: Session) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'construct-staff-'));
  const previous = { data: process.env.XDG_DATA_HOME, cache: process.env.XDG_CACHE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  (process.stderr as { write: unknown }).write = (c: string) => (err.push(String(c)), true);
  try {
    await body({
      root,
      cli: (argv) => main(argv),
      out: () => out.join(''),
      err: () => err.join(''),
    });
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.cache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous.cache;
    rmSync(root, { recursive: true, force: true });
  }
}

/** A run that met a concern the catalog could not carry, as the run records it. */
function seedUnmet(): void {
  appendWorkLog(openStore(storePath(resolvePaths())), {
    run: 'run-unmet',
    role: 'construct',
    action: 'concern-unmet',
    detail: {
      outcome: 'Decide whether the archival appraisal policy needs its own reviewer',
      proposed: 'archival-appraisal',
      why: 'deciding what is kept forever is a distinct professional judgement',
      reason: 'not-in-catalog',
    },
    at: AT,
  });
}

const PROFILE = {
  proposed: 'archival-appraisal',
  concern: 'what is kept permanently and what is destroyed, and on whose authority',
  rebuttals: [
    { domain: 'privacy', whyNot: 'privacy asks whether data may be held at all, not what is worth keeping' },
  ],
  standards: [{ name: 'ISO 15489-1', publisher: 'ISO' }],
  slots: [{ name: 'appraisal-decision', expects: 'what is kept, what is destroyed, and why', required: true }],
};

function profileAt(root: string, name: string, body: unknown): string {
  const file = join(root, name);
  writeFileSync(file, JSON.stringify(body));
  return file;
}

test('a recorded unmet concern is reachable from the surface, with the reason it was refused', async () => {
  await session(async (s) => {
    seedUnmet();
    assert.equal(await s.cli(['staff', 'list', '--run=run-unmet']), 0);

    assert.match(s.out(), /archival-appraisal/);
    assert.match(s.out(), /not-in-catalog/);
    assert.match(s.out(), /distinct professional judgement/);
    // The surface says what to do next, or the record is still a dead end.
    assert.match(s.out(), /construct staff propose/);
  });
});

test('a run that carried every concern it named says so rather than printing nothing', async () => {
  await session(async (s) => {
    assert.equal(await s.cli(['staff', 'list', '--run=run-quiet']), 0);
    assert.match(s.out(), /no unmet concerns recorded for run-quiet/);
  });
});

test('an admitted profile staffs nothing: it becomes a decision defaulting to NOT STAFFED', async () => {
  await session(async (s) => {
    seedUnmet();
    const file = profileAt(s.root, 'profile.json', PROFILE);

    assert.equal(await s.cli(['staff', 'propose', '--run=run-unmet', `--file=${file}`]), 0);
    assert.match(s.out(), /admitted to the gate as "archival-appraisal" \(grounded\)/);
    assert.match(s.out(), /This staffs nothing yet/);
    assert.match(s.out(), /construct inbox/);
    assert.match(s.out(), /inbox decide staffing:run-unmet:archival-appraisal/);

    const raised = openDecisions(openStore(storePath(resolvePaths()))).find(
      (d) => d.id === 'staffing:run-unmet:archival-appraisal',
    );
    assert.ok(raised, 'the profile should be waiting on a person, not applied');
    assert.equal(raised?.positions.length, 2, 'a one-sided question is a report, not a decision');
  });
});

test('the same profile proposed twice does not raise a second decision', async () => {
  await session(async (s) => {
    seedUnmet();
    const file = profileAt(s.root, 'profile.json', PROFILE);

    assert.equal(await s.cli(['staff', 'propose', '--run=run-unmet', `--file=${file}`]), 0);
    assert.equal(await s.cli(['staff', 'propose', '--run=run-unmet', `--file=${file}`]), 1);
    assert.match(s.err(), /already waiting on a decision/);
  });
});

/**
 * The refusal is the gate's, printed as the gate worded it. A surface that
 * summarized it would be a second place where the reason for a no is decided.
 */
test("a refusal reaches the person in the gate's own words, with its kind", async () => {
  await session(async (s) => {
    const file = profileAt(s.root, 'covered.json', { ...PROFILE, proposed: 'privacy' });

    assert.equal(await s.cli(['staff', 'propose', '--run=run-unmet', `--file=${file}`]), 1);
    assert.match(s.err(), /refused \(already-covered\)/);
    assert.match(s.err(), /the catalog already carries "privacy"/);
    assert.match(s.err(), /the domain that already carries it: privacy/);
  });
});

test('a profile with a list left out is refused, not a stack trace', async () => {
  await session(async (s) => {
    const file = profileAt(s.root, 'thin.json', {
      proposed: 'archival-appraisal',
      concern: 'what is kept permanently',
    });

    assert.equal(await s.cli(['staff', 'propose', '--run=run-unmet', `--file=${file}`]), 1);
    assert.match(s.err(), /refused \(malformed\)/);
  });
});

test('a file that is not a profile is reported as unreadable rather than crashing', async () => {
  await session(async (s) => {
    assert.equal(await s.cli(['staff', 'propose', '--run=r', '--file=/nonexistent/profile.json']), 1);
    assert.match(s.err(), /cannot read a profile from/);
  });
});

test('the verb refuses to guess what you meant', async () => {
  await session(async (s) => {
    assert.equal(await s.cli(['staff']), 2);
    assert.match(s.out(), /usage: construct staff list/);
    assert.match(s.out(), /construct staff create/);
    assert.match(s.out(), /construct staff propose/);
  });
});
