/**
 * tests/logging-rotate.test.mjs — covers lib/logging/rotate.mjs across both
 * consumers' usage patterns:
 *
 * - appendWithRotationSync: synchronous hot path the trace writer uses.
 *   Verifies rotation fires when an append would cross maxBytes, the rotated
 *   segment is named `<base>.<n><ext>`, and segment cap pruning works.
 * - rotateIfOversized: poll-style rotation the embed daemon runs every minute.
 *   Verifies it's a no-op below cap, rotates above cap, gzips on demand, and
 *   prunes oldest segments past maxSegments.
 *
 * No external state; every test uses a per-test tmpdir.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, statSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendWithRotationSync, rotateIfOversized, pruneSegments, appendBounded, LIMITS, __test } from '../lib/logging/rotate.mjs';

function makeTmp() {
  const dir = mkdtempSync(join(tmpdir(), 'cx-rotate-test-'));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('appendWithRotationSync writes when under cap', () => {
  const { dir, cleanup } = makeTmp();
  try {
    const file = join(dir, 'log.jsonl');
    appendWithRotationSync(file, 'one\n', { maxBytes: 1024 });
    appendWithRotationSync(file, 'two\n', { maxBytes: 1024 });
    assert.equal(readFileSync(file, 'utf8'), 'one\ntwo\n');
    assert.equal(readdirSync(dir).length, 1);
  } finally { cleanup(); }
});

test('appendWithRotationSync rotates BEFORE the write that would cross cap', () => {
  const { dir, cleanup } = makeTmp();
  try {
    const file = join(dir, 'log.jsonl');
    const line = 'A'.repeat(80) + '\n';
    appendWithRotationSync(file, line, { maxBytes: 100 });
    appendWithRotationSync(file, line, { maxBytes: 100 });
    appendWithRotationSync(file, line, { maxBytes: 100 });

    const files = readdirSync(dir).sort();
    assert.deepEqual(files.filter((f) => /\.\d+\.jsonl$/.test(f)), ['log.1.jsonl', 'log.2.jsonl']);
    assert.ok(files.includes('log.jsonl'));

    // Each rotated segment must be strictly under cap.

    assert.ok(statSync(join(dir, 'log.1.jsonl')).size < 100);
    assert.ok(statSync(join(dir, 'log.2.jsonl')).size < 100);
  } finally { cleanup(); }
});

test('appendWithRotationSync prunes oldest segments past maxSegments', () => {
  const { dir, cleanup } = makeTmp();
  try {
    const file = join(dir, 'log.jsonl');
    const line = 'A'.repeat(80) + '\n';

    // 5 lines, cap=100, maxSegments=2. After all 5: log.jsonl + log.4.jsonl + log.5.jsonl
    // (rotated to 1, 2, 3, 4 along the way, with prune dropping <=3).

    for (let i = 0; i < 5; i++) appendWithRotationSync(file, line, { maxBytes: 100, maxSegments: 2 });

    const segments = readdirSync(dir).filter((f) => /\.\d+\.jsonl$/.test(f)).sort();
    assert.equal(segments.length, 2);
    assert.deepEqual(segments, ['log.3.jsonl', 'log.4.jsonl']);
  } finally { cleanup(); }
});

test('rotateIfOversized is a no-op when the file is below cap', async () => {
  const { dir, cleanup } = makeTmp();
  try {
    const file = join(dir, 'app.log');
    writeFileSync(file, 'x'.repeat(50));
    const result = await rotateIfOversized(file, { maxBytes: 1000 });
    assert.equal(result, null);
    assert.equal(statSync(file).size, 50);
  } finally { cleanup(); }
});

test('rotateIfOversized rotates over cap and creates a new empty active file', async () => {
  const { dir, cleanup } = makeTmp();
  try {
    const file = join(dir, 'app.log');
    writeFileSync(file, 'x'.repeat(2000));
    const segPath = await rotateIfOversized(file, { maxBytes: 1000 });
    assert.equal(segPath, join(dir, 'app.1.log'));
    assert.equal(existsSync(file), false, 'rotated file must be moved aside (no active file until next write)');
    assert.equal(statSync(segPath).size, 2000);
  } finally { cleanup(); }
});

test('rotateIfOversized with gzip produces .gz segments and deletes the plain rotated file', async () => {
  const { dir, cleanup } = makeTmp();
  try {
    const file = join(dir, 'embed-daemon.log');
    writeFileSync(file, 'A'.repeat(5000));
    const segPath = await rotateIfOversized(file, { maxBytes: 1000, gzip: true });
    assert.equal(segPath, join(dir, 'embed-daemon.1.log.gz'));
    assert.ok(existsSync(segPath));
    assert.equal(existsSync(join(dir, 'embed-daemon.1.log')), false, 'plain segment must be cleaned up after gzip');
    // gzip should compress 5000 bytes of repeated A down considerably.

    assert.ok(statSync(segPath).size < 200);
  } finally { cleanup(); }
});

test('rotateIfOversized prunes old segments past maxSegments', async () => {
  const { dir, cleanup } = makeTmp();
  try {
    const file = join(dir, 'app.log');

    // 4 rotations with maxSegments=2 → last 2 survive (app.3.log, app.4.log).

    for (let i = 0; i < 4; i++) {
      writeFileSync(file, 'x'.repeat(2000));
      await rotateIfOversized(file, { maxBytes: 1000, maxSegments: 2 });
    }

    const segments = readdirSync(dir).filter((f) => /\.\d+\.log$/.test(f)).sort();
    assert.deepEqual(segments, ['app.3.log', 'app.4.log']);
  } finally { cleanup(); }
});

test('appendBounded honors the channel registry and rotates within the limit', () => {
  const { dir, cleanup } = makeTmp();
  try {
    const file = join(dir, 'audit-reads.jsonl');
    const line = 'A'.repeat(80) + '\n';

    // Use a real channel so the registry lookup is exercised. Override the
    // cap to a tiny value via the env var so the test is fast.

    const env = { CONSTRUCT_AUDIT_READS_MAX_MB: '0.0001' };  // 0.0001 MB ≈ 104 bytes
    for (let i = 0; i < 4; i++) appendBounded('audit-reads', file, line, env);

    const segments = readdirSync(dir).filter((f) => /audit-reads\.\d+\.jsonl$/.test(f)).sort();
    assert.ok(segments.length >= 2, `expected ≥2 rotated segments, got ${segments.length}: ${segments.join(', ')}`);
  } finally { cleanup(); }
});

test('appendBounded refuses unregistered channels', () => {
  assert.throws(
    () => appendBounded('totally-made-up-channel', '/tmp/x.log', 'line\n'),
    /unknown channel "totally-made-up-channel"/,
  );
});

test('LIMITS registry has documented caps for every active channel', () => {
  const expected = [
    'trace', 'embed-daemon-log', 'audit-reads', 'skill-calls', 'agent-log',
    'role-pending', 'intent-verifications', 'contract-violations',
    'bash-warn-flags', 'session-cost', 'audit-trail', 'edit-accumulator',
  ];
  for (const name of expected) {
    assert.ok(LIMITS[name], `channel "${name}" must be registered in LIMITS`);
    assert.ok(LIMITS[name].maxBytes > 0, `channel "${name}" must have maxBytes > 0`);
    assert.ok(typeof LIMITS[name].envOverride === 'string', `channel "${name}" must have an env override`);
  }
});

test('audit-trail channel rotates within its registered cap', () => {
  const { dir, cleanup } = makeTmp();
  try {
    const file = join(dir, 'audit-trail.jsonl');
    const override = LIMITS['audit-trail'].envOverride;
    for (let i = 0; i < 30; i++) {
      appendBounded('audit-trail', file, JSON.stringify({ i, x: 'y'.repeat(50_000) }) + '\n', { [override]: '1' });
    }
    const segments = readdirSync(dir).filter((f) => /audit-trail\.\d+\.jsonl(\.gz)?$/.test(f));
    assert.ok(segments.length > 0, 'expected rotation under a 1 MB cap');
  } finally { cleanup(); }
});

test('edit-accumulator channel rotates within its registered cap', () => {
  const { dir, cleanup } = makeTmp();
  try {
    const file = join(dir, 'pending-typecheck.txt');
    const override = LIMITS['edit-accumulator'].envOverride;
    for (let i = 0; i < 30; i++) {
      appendBounded('edit-accumulator', file, 'x'.repeat(50_000) + '\n', { [override]: '1' });
    }
    const segments = readdirSync(dir).filter((f) => /pending-typecheck\.\d+\.txt$/.test(f));
    assert.ok(segments.length > 0, 'expected rotation under a 1 MB cap');
  } finally { cleanup(); }
});

test('resolveCap honors env-var override interpreted as megabytes', () => {
  const def = LIMITS['audit-reads'];
  const cap = __test.resolveCap('audit-reads', { [def.envOverride]: '7' });
  assert.equal(cap, 7 * 1024 * 1024);
});

test('pruneSegments drops oldest first and respects active file', () => {
  const { dir, cleanup } = makeTmp();
  try {
    const file = join(dir, 'svc.log');
    writeFileSync(file, 'active');
    for (let i = 1; i <= 5; i++) writeFileSync(join(dir, `svc.${i}.log`), `seg-${i}`);

    const removed = pruneSegments(file, 3);
    assert.equal(removed.length, 2);
    const surviving = readdirSync(dir).sort();
    assert.deepEqual(surviving, ['svc.3.log', 'svc.4.log', 'svc.5.log', 'svc.log']);
  } finally { cleanup(); }
});
