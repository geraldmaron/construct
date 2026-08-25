/**
 * tests/cli/completions.test.ts — shell completion scripts generation.
 *
 * Tests that `construct completions --shell=bash|zsh` emits scripts that:
 * - Cover every verb from the VERBS array (no drift)
 * - Handle missing/invalid --shell values correctly
 * - Produce valid shell syntax
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, VERBS, completions } from '../../src/cli/index.ts';
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

test('completions --shell=bash emits a valid bash completion script', async () => {
  const result = await capture(['completions', '--shell=bash']);
  assert.strictEqual(result.code, 0, 'should exit with 0');
  assert.match(result.out, /bash/, 'should mention bash in output');
  assert.match(result.out, /_construct_completions/, 'should define completion function');
  assert.strictEqual(result.err, '', 'should have no stderr');
});

test('completions --shell=zsh emits a valid zsh completion script', async () => {
  const result = await capture(['completions', '--shell=zsh']);
  assert.strictEqual(result.code, 0, 'should exit with 0');
  assert.match(result.out, /#compdef construct/, 'should have zsh compdef directive');
  assert.match(result.out, /_construct_completions/, 'should define completion function');
  assert.strictEqual(result.err, '', 'should have no stderr');
});

test('bash completion script contains all verbs from VERBS array', async () => {
  const result = await capture(['completions', '--shell=bash']);
  const verbs = VERBS.filter((v) => v !== 'help'); // help is special-cased

  for (const verb of verbs) {
    assert.match(
      result.out,
      new RegExp(verb),
      `bash script should contain verb "${verb}" (derived from VERBS array)`,
    );
  }
});

test('zsh completion script contains all verbs from VERBS array', async () => {
  const result = await capture(['completions', '--shell=zsh']);
  const verbs = VERBS.filter((v) => v !== 'help'); // help is special-cased

  for (const verb of verbs) {
    assert.match(
      result.out,
      new RegExp(verb),
      `zsh script should contain verb "${verb}" (derived from VERBS array)`,
    );
  }
});

test('completions with missing --shell flag returns error', async () => {
  const result = await capture(['completions']);
  assert.strictEqual(result.code, 2, 'should exit with 2 (usage error)');
  assert.match(result.err, /usage:/, 'should show usage');
  assert.match(result.err, /--shell=/, 'should mention --shell flag');
});

test('completions with unknown --shell value returns error', async () => {
  const result = await capture(['completions', '--shell=fish']);
  assert.strictEqual(result.code, 2, 'should exit with 2 (usage error)');
  assert.match(result.err, /unknown shell/, 'should mention unknown shell');
  assert.match(result.err, /bash or zsh/, 'should list expected values');
});

test('completions is registered in VERBS array', () => {
  assert.ok(VERBS.includes('completions'), 'completions should be in VERBS array');
});

test('completions verb is discoverable via help', async () => {
  // The USAGE line is built from VERBS, so if completions is in VERBS,
  // it will appear in the help output when an unknown command is given.
  const result = await capture(['nonexistent']);
  assert.match(
    result.out,
    /completions/,
    'help output should include completions verb (derived from VERBS)',
  );
});

test('completions --help shows usage', async () => {
  const result = await capture(['completions', '--help']);
  assert.strictEqual(result.code, 0, 'should exit with 0');
  assert.match(result.err, /usage/, 'should show usage');
  assert.match(result.err, /--shell/, 'should mention --shell option');
});

test('bash script syntax is bash-compatible', async () => {
  const result = await capture(['completions', '--shell=bash']);
  // Basic bash syntax checks
  assert.match(result.out, /complete -o/, 'should have bash complete directive');
  assert.match(result.out, /compgen/, 'should use compgen');
});

test('zsh script syntax is zsh-compatible', async () => {
  const result = await capture(['completions', '--shell=zsh']);
  // Basic zsh syntax checks
  assert.match(result.out, /#compdef/, 'should have compdef directive');
  assert.match(result.out, /_values/, 'should use _values for completion');
});
