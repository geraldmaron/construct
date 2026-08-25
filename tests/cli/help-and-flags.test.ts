/**
 * tests/cli/help-and-flags.test.ts — the two failures a scattered flag parser
 * left: a verb with no --help, and an unknown flag silently swallowed.
 *
 * A universal --help is answered before any verb acts, so it records nothing —
 * the reason `outcome --help` must not file `--help` as an outcome into an
 * append-only log. An unknown flag on a verb that takes no free text fails
 * closed rather than running something other than what was typed. And
 * `construct help` is a task-grouped surface with the spine named up front,
 * not a flat wall of verbs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main, VERBS } from '../../src/cli/index.ts';
import { sterileHome } from '../harness/sterile.ts';

sterileHome();

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function capture(argv: string[]): Promise<Capture> {
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
  let code = 0;
  try {
    code = await main(argv);
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
  }
}

/** How many work-log entries the store holds, read back through the CLI. */
async function logEntryCount(): Promise<number> {
  const { out } = await capture(['log', '--json']);
  return (JSON.parse(out) as { entries: unknown[] }).entries.length;
}

test('outcome --help prints usage and records no run', async () => {
  const before = await logEntryCount();
  const result = await capture(['outcome', '--help']);
  assert.strictEqual(result.code, 0, 'help exits 0');
  assert.match(result.out, /usage: construct outcome/, 'prints the outcome usage');
  assert.doesNotMatch(result.out, /^run /m, 'no run is echoed');
  const after = await logEntryCount();
  assert.strictEqual(after, before, '--help writes nothing to the append-only log');
});

test('--help and -h work on several verbs, exiting 0 with output', async () => {
  for (const verb of ['work', 'show', 'plan', 'source', 'decide', 'settings', 'ask', 'notes']) {
    const long = await capture([verb, '--help']);
    assert.strictEqual(long.code, 0, `${verb} --help exits 0`);
    assert.ok(long.out.length > 0, `${verb} --help prints something`);
    const short = await capture([verb, '-h']);
    assert.strictEqual(short.code, 0, `${verb} -h exits 0`);
    assert.ok(short.out.length > 0, `${verb} -h prints something`);
  }
});

test('settings --help does not re-run the settings command', async () => {
  const result = await capture(['settings', '--help']);
  assert.strictEqual(result.code, 0);
  assert.match(result.out, /construct settings —/, 'answers with help, not the settings table');
  assert.doesNotMatch(result.out, /\(built-in\)|\(global file\)|\(default\)/, 'no resolved settings rows');
});

test('an unknown flag on a verb that takes no free text exits non-zero', async () => {
  for (const argv of [
    ['log', '--invalid-flag'],
    ['show', '--bogus'],
    ['plan', 'run-x', '--nope'],
    ['work', '--drt-run'],
  ]) {
    const result = await capture(argv);
    assert.notStrictEqual(result.code, 0, `${argv.join(' ')} fails closed`);
    assert.match(result.err, /unknown flag/, `${argv.join(' ')} says what was wrong`);
  }
});

test('a free-text verb refuses a leading unknown flag but keeps its words', async () => {
  const bad = await capture(['outcome', '--bogus', 'ship', 'the', 'thing']);
  assert.strictEqual(bad.code, 2, 'a leading unknown flag is refused');
  assert.match(bad.err, /unknown flag --bogus/);

  // Plain words are the outcome, not flags: this records a run rather than
  // refusing, which is the whole point of a free-text verb.
  const ok = await capture(['outcome', 'ship the thing']);
  assert.notStrictEqual(ok.code, 2, 'arbitrary words are accepted');
  assert.doesNotMatch(ok.err, /unknown flag/);
});

test('construct help is task-grouped with a start-here spine', async () => {
  const result = await capture(['help']);
  assert.strictEqual(result.code, 0);
  assert.match(result.out, /Start here: outcome → work → show → inbox → verdict/, 'names the spine');
  for (const group of ['Starting work', 'Running it', 'Reading back', 'Outward changes and decisions']) {
    assert.ok(result.out.includes(group), `groups by "${group}"`);
  }
});

test('every verb in the VERBS table appears grouped with a gloss', async () => {
  const { out } = await capture(['help']);
  for (const verb of VERBS) {
    // Indented verb, padded, then a non-empty gloss — grouping and description
    // both, so a verb added to the table and to no group is caught here.
    assert.match(out, new RegExp(`\\n  ${verb} +\\S`), `${verb} is listed with a gloss`);
  }
});

test('the top-level help flag spellings all reach the grouped surface', async () => {
  for (const argv of [['help'], ['--help'], ['-h'], []]) {
    const result = await capture(argv);
    assert.strictEqual(result.code, 0, `${argv.join(' ') || '(no args)'} exits 0`);
    assert.match(result.out, /Start here:/, 'shows the grouped help');
  }
});
