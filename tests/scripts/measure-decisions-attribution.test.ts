/**
 * A figure stated per tier must be able to say which tier produced each answer.
 *
 * The instrument already refuses to record a run more than one model served —
 * but a refusal that discards the answers turns a separable run into a lost
 * one, and the refusal itself was the only thing standing between a mixed run
 * and figures quoted per tier. Both properties are exercised here against a
 * stub that speaks ollama's wire shape, so the gate costs nothing and is
 * deterministic: the thing under test is bookkeeping, and a real model would
 * only make it slower and flakier to check. The live run this replaced took 35
 * minutes and failed on transport before it reached the record.
 *
 * What the stub controls is the one field that matters: which model each
 * response says answered it. Requesting a model and being served it is the
 * usual case and not a guaranteed one, which is exactly why the record reports
 * what answered rather than what was asked for.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPT = resolve(import.meta.dirname, '../../scripts/measure-decisions.mjs');

interface Recorded {
  readonly modelsRan: readonly string[];
  readonly perOutcome: Record<
    string,
    readonly { readonly outcome: string; readonly servedBy: readonly string[] }[]
  >;
}

/**
 * A stub speaking ollama's /api/generate shape. `modelFor` decides which model
 * each successive response claims answered it, which is how a single-tier run
 * and a two-tier one are told apart without either being real.
 */
async function stubOllama(modelFor: (call: number) => string): Promise<{
  readonly origin: string;
  close: () => Promise<void>;
}> {
  let calls = 0;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const model = modelFor(calls);
      calls += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      // A well-formed reply naming one real domain. It has to parse, because a
      // consultation that fails trips a different refusal — the fallback one —
      // and the run never reaches the tier check at all.
      res.end(
        JSON.stringify({
          model,
          response: JSON.stringify({
            domains: [{ domain: 'privacy', why: 'the stub names one domain so the reply parses' }],
          }),
        }),
      );
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('stub did not bind a port');
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

async function runSection10(origin: string, recordTo: string): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      SCRIPT,
      '--namer',
      '--section',
      '10',
      '--namer-host',
      'ollama',
      '--namer-model',
      'stub-requested',
      '--namer-arm',
      'attribution-under-test',
      '--namer-record',
      recordTo,
    ],
    { env: { ...process.env, OLLAMA_HOST: origin }, maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout;
}

test('every consultation in a recorded arm names the model that served it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'construct-attribution-'));
  const stub = await stubOllama(() => 'stub-served');
  try {
    const recordTo = join(dir, 'arm.json');
    const stdout = await runSection10(stub.origin, recordTo);
    assert.match(stdout, /recorded arm "attribution-under-test"/);

    const record = JSON.parse(readFileSync(recordTo, 'utf8')) as Recorded;
    assert.deepEqual(record.modelsRan, ['stub-served'], 'what answered, not what was requested');

    const rows = Object.values(record.perOutcome).flat();
    assert.ok(rows.length > 0, 'the record has per-outcome rows to attribute');
    for (const row of rows) {
      assert.deepEqual(
        row.servedBy,
        ['stub-served'],
        `attribution missing for ${row.outcome.slice(0, 40)}`,
      );
    }
  } finally {
    await stub.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a two-tier run is refused as an arm and kept as evidence, separable by model', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'construct-attribution-'));
  // Alternating, so neither tier is a rounding error and both appear in the
  // per-outcome rows rather than only in the run-level set.
  const stub = await stubOllama((call) => (call % 2 === 0 ? 'stub-tier-a' : 'stub-tier-b'));
  try {
    const recordTo = join(dir, 'arm.json');
    const stdout = await runSection10(stub.origin, recordTo);

    assert.match(stdout, /NOT RECORDED: 2 tiers served this run/);
    assert.ok(!existsSync(recordTo), 'the arm file is left untouched, not annotated');
    // The counts are the run's own account of the split, printed where the
    // refusal is read rather than only inside the file.
    assert.match(stdout, /stub-tier-a: \d+ of \d+ consultations/);
    assert.match(stdout, /stub-tier-b: \d+ of \d+ consultations/);

    const forensic = `${recordTo}.mixed.json`;
    assert.ok(existsSync(forensic), 'the answers survive the refusal');
    const kept = JSON.parse(readFileSync(forensic, 'utf8')) as Recorded & { notAnArm: string };
    assert.match(kept.notAnArm, /not a per-tier measurement/, 'it says what it is not');
    assert.deepEqual([...kept.modelsRan].sort(), ['stub-tier-a', 'stub-tier-b']);

    // The point of keeping it: the run can be split by the model that served
    // each consultation, which a run-level set alone could never do.
    const rows = Object.values(kept.perOutcome).flat();
    const byTier = new Map<string, number>();
    for (const row of rows) {
      assert.equal(row.servedBy.length, 1, 'one consultation, one model');
      byTier.set(row.servedBy[0]!, (byTier.get(row.servedBy[0]!) ?? 0) + 1);
    }
    assert.equal(byTier.size, 2, 'both tiers are recoverable from the rows');
    for (const [, count] of byTier) assert.ok(count > 0);
  } finally {
    await stub.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recording an arm on the claude host without a pinned model is refused before it is paid for', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'construct-attribution-'));
  try {
    const recordTo = join(dir, 'arm.json');
    const result = await execFileAsync(
      process.execPath,
      [SCRIPT, '--namer', '--section', '10', '--namer-host', 'claude', '--namer-record', recordTo],
      { maxBuffer: 32 * 1024 * 1024 },
    ).then(
      (ok) => ({ code: 0, stdout: ok.stdout }),
      (err: { code?: number; stdout?: string }) => ({ code: err.code ?? 1, stdout: err.stdout ?? '' }),
    );

    assert.equal(result.code, 1, 'a refusal exits non-zero');
    assert.match(result.stdout, /NOT RUN: --namer-record on the claude host needs --namer-model/);
    assert.ok(!existsSync(recordTo), 'nothing is written');
    // Before, not after: the whole point is that no consultation was paid for.
    assert.ok(
      !/namer consultations: [1-9]/.test(result.stdout),
      'the refusal must precede the consultations, not follow them',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('omitting --namer-host reaches the claude refusal, not a silent ollama default', async () => {
  // CLAUDE.md's sourcing rule: development model calls come from Claude Code
  // or Cursor, never a local server, unless a caller names one explicitly.
  // Before that rule, an omitted --namer-host fell back to 'ollama' here, so
  // this exact invocation would have dialled localhost:11434 instead of
  // hitting this refusal. No stub is wired up for ollama in this test — if
  // the default ever regresses back to a local host, this either hangs on a
  // real network call or fails with an ollama connection error, not with the
  // claude-host message asserted below.
  const dir = mkdtempSync(join(tmpdir(), 'construct-attribution-'));
  try {
    const recordTo = join(dir, 'arm.json');
    const result = await execFileAsync(
      process.execPath,
      [SCRIPT, '--namer', '--section', '10', '--namer-record', recordTo],
      { maxBuffer: 32 * 1024 * 1024 },
    ).then(
      (ok) => ({ code: 0, stdout: ok.stdout }),
      (err: { code?: number; stdout?: string }) => ({ code: err.code ?? 1, stdout: err.stdout ?? '' }),
    );

    assert.equal(result.code, 1, 'a refusal exits non-zero');
    assert.match(result.stdout, /NOT RUN: --namer-record on the claude host needs --namer-model/);
    assert.ok(!existsSync(recordTo), 'nothing is written');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
