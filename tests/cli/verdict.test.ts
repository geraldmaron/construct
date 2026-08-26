/**
 * tests/cli/verdict.test.ts — the CLI verdict surface through its real
 * surface: confirming, dismissing, and naming a felt
 * absence for the domains a run surfaced, and exporting what accumulates.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/cli/index.ts';
import { sterileAmbientEnv, sterileHome } from '../harness/sterile.ts';

sterileHome();
sterileAmbientEnv();

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

type Step = string[] | ((soFar: string) => string[]);

/**
 * Runs every step against one shared, throwaway data dir — the run id a step
 * needs (e.g. to render a verdict against the run `outcome` just created) is
 * not known ahead of time, so a step may be a function of the output captured
 * so far instead of a fixed argv.
 */
async function runAll(sequence: readonly Step[]): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-verdict-'));
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
  let code = 0;
  try {
    for (const step of sequence) {
      const argv = typeof step === 'function' ? step(out.join('')) : step;
      code = await main(argv);
    }
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

function extractRun(out: string): string {
  const match = /^run (\S+)/m.exec(out);
  assert.ok(match, `no run id in output:\n${out}`);
  return match[1];
}

test('verdict with no flags lists what surfaced and how to record a verdict', async () => {
  const { code, out } = await runAll([
    ['outcome', 'launch a paid beta to EU users next month'],
    (soFar) => ['verdict', `--run=${extractRun(soFar)}`],
  ]);
  assert.equal(code, 0);
  assert.match(out, /surfaced domains/);
  assert.match(out, /--confirm=/);
  assert.match(out, /--dismiss=/);
  assert.match(out, /--missed=/);
});

test('confirm and dismiss only apply to domains the run actually surfaced', async () => {
  const { code, err } = await runAll([
    ['outcome', 'launch a paid beta to EU users next month'],
    (soFar) => ['verdict', `--run=${extractRun(soFar)}`, '--confirm=a-domain-that-never-surfaced'],
  ]);
  assert.equal(code, 2);
  assert.match(err, /did not surface/);
  assert.match(err, /--missed/);
});

test('a felt absence records even though it never surfaced', async () => {
  const { code, out } = await runAll([
    ['outcome', 'launch a paid beta to EU users next month'],
    (soFar) => [
      'verdict',
      `--run=${extractRun(soFar)}`,
      '--missed=an-absent-domain',
      '--source=gerald',
    ],
  ]);
  assert.equal(code, 0);
  assert.match(out, /1 missed/);
});

test('a verdict recorded with confirm and dismiss exports as a fixture-shaped corpus', async () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-verdict-export-'));
  try {
    const exportPath = join(root, 'harvested.json');

    const { code } = await runAll([
      ['outcome', 'launch a paid beta to EU users next month'],
      (soFar) => [
        'verdict',
        `--run=${extractRun(soFar)}`,
        '--confirm=privacy',
        '--dismiss=commerce-tax',
        '--source=gerald',
      ],
      ['corpus', 'export', exportPath],
    ]);
    assert.equal(code, 0);

    const written = JSON.parse(readFileSync(exportPath, 'utf8')) as {
      outcomes: Array<{
        id: string;
        category: string;
        outcome: string;
        expect: string[];
        provenance: { source: string; recordedAt: string; rejected: string[] };
      }>;
      skipped: number;
    };
    assert.equal(written.outcomes.length, 1);
    const outcome = written.outcomes[0];
    assert.equal(outcome.outcome, 'launch a paid beta to EU users next month');
    assert.deepEqual(outcome.expect, ['privacy']);
    assert.deepEqual(outcome.provenance.rejected, ['commerce-tax']);
    assert.equal(outcome.provenance.source, 'gerald');
    assert.ok(outcome.provenance.recordedAt);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('corpus export with no recorded verdicts writes zero outcomes, not an error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-verdict-empty-'));
  try {
    const exportPath = join(root, 'harvested.json');
    const { code, out } = await runAll([['corpus', 'export', exportPath]]);
    assert.equal(code, 0);
    assert.match(out, /wrote 0 outcome/);
    const written = JSON.parse(readFileSync(exportPath, 'utf8')) as { outcomes: unknown[] };
    assert.deepEqual(written.outcomes, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verdict takes --run <id> as well as --run=<id>, the form log and work accept', async () => {
  const result = await runAll([
    ['outcome', 'We want to hire a contractor in Poland'],
    (soFar) => ['verdict', '--run', /run-\d+/.exec(soFar)?.[0] ?? 'missing'],
  ]);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /surfaced domains/);
});

test('verdict with no --run is a usage error', async () => {
  const { code, err } = await runAll([['verdict']]);
  assert.equal(code, 2);
  assert.match(err, /usage: construct verdict/);
});
