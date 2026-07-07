/**
 * tests/functional/intake-pending-ttl.functional.test.mjs — persisted
 * `.construct/intake/pending/` packets reach the daemon's TTL/dead-letter contract,
 * re-ingesting a live source is idempotent, and the session prelude stops
 * advertising packets once their source has been swept away.
 *
 * The daemon tick reads the inbox path (listInboxFiles/processInboxFile) and
 * must also sweep packets already written to `.construct/intake/pending/`, so
 * orphaned/expired packets do not accumulate forever and re-ingesting the
 * same source refreshes one packet instead of producing a sibling.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sweepPendingPackets, processInboxFile, buildIntakeDaemon } from '../../lib/intake/daemon.mjs';
import { buildIntakePrelude } from '../../lib/intake/session-prelude.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const tmpDirs = [];

after(() => {
  for (const dir of tmpDirs) rmTmpDir(dir);
});

// buildIntakeDaemon() computes its heartbeat path eagerly at construction
// time via resolveStatePath(cwd,'runtime','intake-daemon.heartbeat') —
// machine-scoped state root (ADR-0066), reading CX_HOME_OVERRIDE from real
// process.env directly. Pin it for the whole file so merely building a
// daemon never writes into the real developer machine's
// ~/.construct/projects/.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-r8wr7-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
after(() => {
  try { rmTmpDir(homeOverride); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-r8wr7-'));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, '.construct', 'intake', 'pending'), { recursive: true });
  return dir;
}

function pendingPath(dir, name) {
  return path.join(dir, '.construct', 'intake', 'pending', `${name}.json`);
}

function writePending(dir, name, body) {
  fs.writeFileSync(pendingPath(dir, name), JSON.stringify(body, null, 2));
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

test('sweepPendingPackets dead-letters source-missing and TTL-expired packets, keeps a live one', () => {
  const project = makeProject();
  const liveSource = path.join(project, 'keep.md');
  fs.writeFileSync(liveSource, 'kept content');

  writePending(project, 'orphan', {
    id: 'orphan',
    createdAt: daysAgo(1),
    intake: { sourcePath: path.join(project, 'docs-intake-deleted', 'README.md') },
  });
  writePending(project, 'expired', {
    id: 'expired',
    createdAt: daysAgo(20),
    intake: { sourcePath: liveSource },
  });
  writePending(project, 'valid', {
    id: 'valid',
    createdAt: daysAgo(1),
    intake: { sourcePath: liveSource },
  });

  const swept = sweepPendingPackets(project);
  assert.equal(swept.length, 2);
  assert.deepEqual(swept.map((s) => s.id).sort(), ['expired', 'orphan']);
  assert.equal(swept.find((s) => s.id === 'orphan').reason, 'source-missing');
  assert.equal(swept.find((s) => s.id === 'expired').reason, 'ttl-expired');

  const remaining = fs.readdirSync(path.join(project, '.construct', 'intake', 'pending')).filter((n) => n.endsWith('.json'));
  assert.deepEqual(remaining, ['valid.json']);

  const deadLetterDir = path.join(project, '.construct', 'intake', 'dead-letter');
  const deadLettered = fs.readdirSync(deadLetterDir).filter((n) => n.endsWith('.json')).sort();
  assert.deepEqual(deadLettered, ['expired.json', 'orphan.json']);
  const orphanRecord = JSON.parse(fs.readFileSync(path.join(deadLetterDir, 'orphan.json'), 'utf8'));
  assert.equal(orphanRecord.deadLetterReason, 'source-missing');
  assert.ok(orphanRecord.deadLetteredAt);
});

test('re-ingesting the same source is idempotent — no README.md-N sibling packet', async () => {
  const project = makeProject();
  const sourcePath = path.join(project, 'note.md');
  fs.writeFileSync(sourcePath, 'first version');

  const classify = async () => ({ intakeType: 'insight', rdStage: 'triage', primaryOwner: 'orchestrator', recommendedAction: 'review' });

  const first = await processInboxFile(sourcePath, { cwd: project, classify });
  assert.equal(first.route, 'pending');
  assert.equal(first.refreshed, false);

  // Re-drop the same source path (simulates a re-ingest of an identical file).
  fs.writeFileSync(sourcePath, 'first version');
  const second = await processInboxFile(sourcePath, { cwd: project, classify });
  assert.equal(second.route, 'pending');
  assert.equal(second.packetId, first.packetId, 'second ingest must refresh the same packet id');
  assert.equal(second.refreshed, true);

  const pendingFiles = fs.readdirSync(path.join(project, '.construct', 'intake', 'pending')).filter((n) => n.endsWith('.json'));
  assert.equal(pendingFiles.length, 1, 'exactly one packet must exist per source — no sibling collision');
});

test('daemon tick sweeps pending on every run alongside the inbox scan', async () => {
  const project = makeProject();
  writePending(project, 'stale', {
    id: 'stale',
    createdAt: daysAgo(30),
    intake: { sourcePath: path.join(project, 'gone.md') },
  });

  // A short interval lets the runner idle out (maxIdleTicks default 6) in
  // well under a second instead of waiting on real daemon cadence.
  const daemon = buildIntakeDaemon({ cwd: project, intervalMs: 5 });
  const result = await daemon.run();
  assert.equal(result.reason, 'idle');

  const pendingFiles = fs.readdirSync(path.join(project, '.construct', 'intake', 'pending')).filter((n) => n.endsWith('.json'));
  assert.deepEqual(pendingFiles, []);
  const deadLetterFiles = fs.readdirSync(path.join(project, '.construct', 'intake', 'dead-letter')).filter((n) => n.endsWith('.json'));
  assert.deepEqual(deadLetterFiles, ['stale.json']);
});

test('session prelude stops advertising packets once their source has been swept away', () => {
  const project = makeProject();
  writePending(project, 'orphan', {
    id: 'orphan',
    status: 'pending',
    createdAt: daysAgo(1),
    intake: { sourcePath: path.join(project, 'docs-intake-deleted', 'README.md') },
    triage: { intakeType: 'unknown', rdStage: 'unknown', primaryOwner: 'orchestrator', risk: 'low' },
  });

  const before = buildIntakePrelude({ cwd: project });
  assert.match(before, /## Pending R&D intake \(1\)/);

  sweepPendingPackets(project);

  const after = buildIntakePrelude({ cwd: project });
  assert.equal(after, '');
});
