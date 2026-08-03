/**
 * tests/cli/spine.test.ts — the spine through its real surface.
 *
 * These drive `main()` the way a user does, not the kernel functions
 * underneath, because the wiring is what has historically broken: a kernel that
 * works and a CLI that never reaches it looks identical to a passing unit suite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/cli/index.ts';

/** Run the CLI against a throwaway data dir, capturing stdout. */
function run(argv: string[]): { code: number; out: string } {
  const root = mkdtempSync(join(tmpdir(), 'construct-cli-'));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  const written: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (chunk: string) => {
    written.push(String(chunk));
    return true;
  };
  try {
    return { code: main(argv), out: written.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realWrite;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * The commands share a data dir only within a single run() call, so a
 * multi-command scenario runs them together against one temp HOME.
 */
function runAll(sequence: string[][]): { code: number; out: string } {
  const root = mkdtempSync(join(tmpdir(), 'construct-cli-'));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  const written: string[] = [];
  const realWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (chunk: string) => {
    written.push(String(chunk));
    return true;
  };
  let code = 0;
  try {
    for (const argv of sequence) code = main(argv);
    return { code, out: written.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realWrite;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

test('construct outcome infers domains the user never named', () => {
  const { code, out } = run(['outcome', 'launch a paid beta to EU users next month']);
  assert.equal(code, 0);
  for (const domain of ['privacy', 'commerce-tax', 'program-sequencing', 'product-scoping']) {
    assert.match(out, new RegExp(domain));
  }
});

test('the inference shows its evidence and never overstates it', () => {
  const { out } = run(['outcome', 'launch a paid beta to EU users next month']);
  assert.match(out, /signals: /);
  assert.match(out, /next month/);
  assert.ok(!out.includes('next week'), 'a partial match must not be cited as a signal');
});

test('an outcome implicating nothing says so rather than going quiet', () => {
  const { code, out } = run(['outcome', 'xyzzy plugh frobnicate']);
  assert.equal(code, 0);
  assert.match(out, /no domains implicated/);
  assert.match(out, /recorded, not silently dropped/);
});

test('an outcome writes a work log the user can read back', () => {
  const { out } = runAll([['outcome', 'launch a paid beta to EU users next month'], ['log']]);
  assert.match(out, /outcome-received/);
  assert.match(out, /domain-implicated/);
  assert.match(out, /append-only/);
});

test('the inbox is empty rather than fabricated when nothing needs the user', () => {
  const { code, out } = run(['inbox']);
  assert.equal(code, 0);
  assert.match(out, /empty/);
});

test('deciding a decision that does not exist fails rather than pretending', () => {
  const { code } = run(['decide', 'nope', 'ship it']);
  assert.equal(code, 1);
});

test('outcome with no text is a usage error, not an empty run', () => {
  assert.equal(run(['outcome']).code, 2);
  assert.equal(run(['decide', 'only-an-id']).code, 2);
});

test('help lists the spine commands', () => {
  const { out } = run(['help']);
  for (const command of ['outcome', 'log', 'inbox', 'decide']) {
    assert.match(out, new RegExp(command));
  }
});
