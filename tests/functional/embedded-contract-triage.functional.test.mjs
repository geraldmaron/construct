/**
 * tests/functional/embedded-contract-triage.functional.test.mjs
 *
 * Drives `construct intake classify --json` and `construct graph recommend --json`
 * against the real binary in an isolated tmpdir. The load-bearing assertion is
 * that classification performs NO durable write — nothing lands under
 * .cx/intake/pending — so the planning surface is safe to call on any input.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');

const tmpDirs = [];
function freshCwd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-ecl-triage-'));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function classify(subcmd, args, cwd) {
  const res = spawnSync('node', [BIN, ...subcmd, '--json', ...args], { cwd, encoding: 'utf8', timeout: 30_000 });
  assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

test('intake classify returns a plan and writes nothing to the queue', () => {
  const cwd = freshCwd();
  const env = classify(['intake', 'classify'], ['--text', 'Bug: throws an error with a stack trace, failing test in production'], cwd);
  assert.equal(env.surface, 'cli');
  assert.match(env.contractVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(env.data.classification.intakeType, 'bug');
  assert.equal(env.data.primaryOwner, 'debugger');
  assert.equal(env.data.canExecute, true);
  assert.equal(env.data.confidenceKind, 'classification');

  assert.equal(fs.existsSync(path.join(cwd, '.cx', 'intake', 'pending')), false, 'no pending queue entry may be written');
});

test('graph recommend is an alias for the same planning contract', () => {
  const cwd = freshCwd();
  const env = classify(['graph', 'recommend'], ['--text', 'Bug: throws an error, stack trace, failing in production'], cwd);
  assert.equal(env.surface, 'cli');
  assert.equal(env.data.classification.intakeType, 'bug');
});

test('classify reads the artifact from stdin', () => {
  const cwd = freshCwd();
  const res = spawnSync('node', [BIN, 'intake', 'classify', '--json'], {
    cwd, encoding: 'utf8', timeout: 30_000,
    input: 'Bug: throws an error with a stack trace, failing test in production',
  });
  assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
  const env = JSON.parse(res.stdout);
  assert.equal(env.data.classification.intakeType, 'bug');
});

test('classify --file extracts the artifact through the pipeline', () => {
  const cwd = freshCwd();
  const file = path.join(cwd, 'bug.txt');
  fs.writeFileSync(file, 'Bug report: the app throws an error with a stack trace, failing test in production');
  const env = classify(['intake', 'classify'], ['--file', file], cwd);
  assert.equal(env.data.classification.intakeType, 'bug');
  assert.equal(env.data.ingestion.extractionMethod, 'utf8');
});

test('classify --file on a transcript uses the transcript extractor', () => {
  const cwd = freshCwd();
  const file = path.join(cwd, 'standup.vtt');
  fs.writeFileSync(file, 'WEBVTT\n\n00:00.000 --> 00:02.000\nWe need a PRD with acceptance criteria for the new feature.\n');
  const env = classify(['intake', 'classify'], ['--file', file], cwd);
  assert.equal(env.data.ingestion.extractionMethod, 'transcript');
});
