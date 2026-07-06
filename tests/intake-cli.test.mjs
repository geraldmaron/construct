/**
 * tests/intake-cli.test.mjs — `construct intake` CLI surface contract.
 *
 * Drives the binary directly with a temp project root via CWD so the
 * filesystem queue is real. Pins: list shows triage columns, show
 * renders the triage block + recommended chain, done/skip move the
 * entry to the right subdir, reopen brings a processed or skipped
 * entry back to pending.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import { FilesystemIntakeQueue } from '../lib/intake/queue.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const CONSTRUCT_BIN = path.join(ROOT, 'bin', 'construct');

let projectRoot;
let homeDir;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-intake-cli-'));
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-intake-cli-home-'));
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
  fs.rmSync(homeDir, { recursive: true, force: true });
});

function runCli(args, env = {}) {
  return spawnSync('node', [CONSTRUCT_BIN, 'intake', ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDir, CX_HOME_OVERRIDE: homeDir, ...env },
  });
}

function seedEntry(overrides = {}) {
  const queue = new FilesystemIntakeQueue(projectRoot);
  return queue.enqueue({
    intake: { sourcePath: '/tmp/login-feedback.md', outputPath: '/tmp/login-feedback-extracted.md', characters: 1200, knowledgeSubdir: 'reference' },
    triage: {
      intakeType: 'bug',
      rdStage: 'implementation',
      primaryOwner: 'debugger',
      recommendedChain: ['debugger', 'engineer', 'qa', 'reviewer'],
      recommendedAction: 'diagnose',
      risk: 'medium',
      requiresApproval: false,
      confidence: 0.7,
      rationale: 'Matched 2 keywords for bug: stack trace, regression.',
    },
    suggestion: { lane: 'postmortems', source: 'docs-routing.suggestDocsLaneForFile' },
    related: [{ path: 'docs/postmortems/0003.md', title: 'Prior incident', score: 0.81, summary: '' }],
    excerpt: 'Stack trace on the login redirect when the auth callback fails.',
    query: 'login feedback',
    ...overrides,
  });
}

describe('construct intake list', () => {
  it('prints the empty-queue message on a fresh project', () => {
    const r = runCli(['list']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /No pending signals\./);
  });

  it('shows ID, type, stage, owner, action columns for pending packets', () => {
    seedEntry();
    const r = runCli(['list']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /ID\s+Type\s+Stage\s+Owner\s+Action/);
    assert.match(r.stdout, /bug\s+implementation\s+debugger\s+diagnose/);
  });
});

describe('construct intake show', () => {
  it('renders the full triage block and recommended chain', () => {
    const { id } = seedEntry();
    const r = runCli(['show', id]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Status:\s+pending/);
    assert.match(r.stdout, /intakeType:\s+bug/);
    assert.match(r.stdout, /recommendedChain:\s+debugger → engineer → qa → reviewer/);
    assert.match(r.stdout, /Suggested lane: postmortems/);
    assert.match(r.stdout, /Stack trace on the login redirect/);
  });

  it('exits non-zero on unknown id with a clear error', () => {
    const r = runCli(['show', 'does-not-exist']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /No signal with id/);
  });

  it('requires an id', () => {
    const r = runCli(['show']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Usage: construct intake show/);
  });
});

describe('construct intake done', () => {
  it('moves a pending packet to processed/ with optional notes', () => {
    const { id } = seedEntry();
    const r = runCli(['done', id, '--notes=merged into docs/postmortems/0003.md']);
    assert.equal(r.status, 0, r.stderr);
    const processed = fs.existsSync(path.join(projectRoot, '.cx', 'intake', 'processed', `${id}.json`));
    const pending = fs.existsSync(path.join(projectRoot, '.cx', 'intake', 'pending', `${id}.json`));
    assert.equal(processed, true);
    assert.equal(pending, false);
    const data = JSON.parse(fs.readFileSync(path.join(projectRoot, '.cx', 'intake', 'processed', `${id}.json`), 'utf8'));
    assert.equal(data.status, 'processed');
    assert.equal(data.notes, 'merged into docs/postmortems/0003.md');
  });

  it('exits non-zero on unknown id', () => {
    const r = runCli(['done', 'bogus']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no pending entry/);
  });
});

describe('construct intake skip', () => {
  it('moves a pending packet to skipped/ with an optional reason', () => {
    const { id } = seedEntry();
    const r = runCli(['skip', id, '--reason=duplicate of construct-1234']);
    assert.equal(r.status, 0, r.stderr);
    const skipped = fs.existsSync(path.join(projectRoot, '.cx', 'intake', 'skipped', `${id}.json`));
    assert.equal(skipped, true);
    const data = JSON.parse(fs.readFileSync(path.join(projectRoot, '.cx', 'intake', 'skipped', `${id}.json`), 'utf8'));
    assert.equal(data.status, 'skipped');
    assert.equal(data.reason, 'duplicate of construct-1234');
  });
});

describe('construct intake reopen', () => {
  it('moves a processed packet back to pending and clears completion metadata', () => {
    const { id } = seedEntry();
    runCli(['done', id, '--notes=test']);
    const r = runCli(['reopen', id]);
    assert.equal(r.status, 0, r.stderr);
    const pending = fs.existsSync(path.join(projectRoot, '.cx', 'intake', 'pending', `${id}.json`));
    const processed = fs.existsSync(path.join(projectRoot, '.cx', 'intake', 'processed', `${id}.json`));
    assert.equal(pending, true);
    assert.equal(processed, false);
    const data = JSON.parse(fs.readFileSync(path.join(projectRoot, '.cx', 'intake', 'pending', `${id}.json`), 'utf8'));
    assert.equal(data.status, 'pending');
    assert.equal(data.processedAt, undefined);
    assert.equal(data.notes, undefined);
  });

  it('moves a skipped packet back to pending and clears skip metadata', () => {
    const { id } = seedEntry();
    runCli(['skip', id, '--reason=test']);
    const r = runCli(['reopen', id]);
    assert.equal(r.status, 0, r.stderr);
    const data = JSON.parse(fs.readFileSync(path.join(projectRoot, '.cx', 'intake', 'pending', `${id}.json`), 'utf8'));
    assert.equal(data.status, 'pending');
    assert.equal(data.skippedAt, undefined);
    assert.equal(data.reason, undefined);
  });

  it('exits non-zero when no processed or skipped entry exists', () => {
    const r = runCli(['reopen', 'missing']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no processed or skipped entry/);
  });
});

describe('construct intake (no args)', () => {
  it('prints help', () => {
    const r = runCli([]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Construct intake/);
    assert.match(r.stdout, /list\s+List pending signals/);
  });
});

// intake classify is an embedded-contract verb: an embedder that pipes empty
// input must still receive a parseable, versioned envelope on stdout — not a
// bare exit with no JSON, which an integration cannot interpret.
describe('construct intake classify (embedded contract)', () => {
  it('returns a typed error envelope (not bare exit) on empty input', () => {
    const r = spawnSync('node', [CONSTRUCT_BIN, 'intake', 'classify', '--json'], {
      cwd: projectRoot, encoding: 'utf8', input: '', env: { ...process.env, HOME: homeDir, CX_HOME_OVERRIDE: homeDir },
    });
    assert.notEqual(r.status, 0, 'empty input is still a failure exit');
    let envelope;
    assert.doesNotThrow(() => { envelope = JSON.parse(r.stdout); }, 'stdout must be parseable JSON');
    assert.equal(typeof envelope.contractVersion, 'string', 'carries a contractVersion');
    assert.equal(envelope.data?.error?.code, 'missing_input', 'typed error code');
    assert.ok(Array.isArray(envelope.warnings) && envelope.warnings.length > 0, 'actionable warning present');
  });

  it('classifies real piped input into a contract envelope', () => {
    const r = spawnSync('node', [CONSTRUCT_BIN, 'intake', 'classify', '--json'], {
      cwd: projectRoot, encoding: 'utf8', input: '# Bug: login fails on expired token\nStack trace on refresh.', env: { ...process.env, HOME: homeDir, CX_HOME_OVERRIDE: homeDir },
    });
    assert.equal(r.status, 0, r.stderr);
    const envelope = JSON.parse(r.stdout);
    assert.equal(typeof envelope.contractVersion, 'string');
    assert.ok(envelope.data && !envelope.data.error, 'real input yields a plan, not an error');
  });
});
