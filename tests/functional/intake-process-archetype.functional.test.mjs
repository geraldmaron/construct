/**
 * tests/functional/intake-process-archetype.functional.test.mjs
 *
 * Two layers of coverage for Piece C's runtime path:
 *
 *   1. CLI surface (`construct intake process`): exit code, daemon-conflict
 *      refusal contract, --dry-run output, --force override. Spawn-based.
 *   2. InboxWatcher contract: SHA-256 manifest dedup of identical content,
 *      attribution stamping on packets. In-process — no `construct init`
 *      spawn, no background daemon — so the dedup assertions are not racing
 *      with the dashboard's own InboxWatcher. The production code path the
 *      CLI invokes is `new InboxWatcher({...}).poll()`; both layers are
 *      exercised independently.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO_ROOT, 'bin', 'construct');

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'intake-process-archetype-'));
  spawnSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'process-test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'Process Test'], { cwd: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function runConstruct(cwd, args, extraEnv = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
      BOOTSTRAP_CHECKED: '1',
      CONSTRUCT_AGENT_ID: 'test-agent',
      ...extraEnv,
    },
  });
}

function writeFakePollLock(projectRoot, pid, actor = 'fake-daemon') {
  const dir = join(projectRoot, '.cx', 'runtime');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'inbox-poll.lock'),
    JSON.stringify({
      pid,
      actor,
      command: 'fake',
      startedAt: new Date().toISOString(),
      timeoutAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }),
    'utf8',
  );
}

function pendingPackets(projectRoot) {
  const dir = join(projectRoot, '.cx', 'intake', 'pending');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

test('intake process --dry-run lists candidate inboxes without ingesting', () => {
  const p = makeProject();
  try {
    const init = runConstruct(p.dir, ['init', '--yes', '--profile=rnd']);
    assert.equal(init.status, 0, `init failed: ${init.stderr}`);

    writeFileSync(join(p.dir, 'inbox', 'sample.md'), '# Sample\n\nbody\n', 'utf8');

    const result = runConstruct(p.dir, ['intake', 'process', '--dry-run']);
    assert.equal(result.status, 0, `process --dry-run failed: ${result.stderr}`);
    assert.match(result.stdout, /Would scan:/);
    assert.match(result.stdout, /inbox/);
    assert.match(result.stdout, /dry-run/);

    assert.equal(pendingPackets(p.dir).length, 0, 'dry-run must not enqueue packets');
  } finally {
    p.cleanup();
  }
});

test('intake process fails fast with exit 2 when the poll lock is held by a live pid', () => {
  const p = makeProject();
  try {
    mkdirSync(join(p.dir, 'inbox'), { recursive: true });
    mkdirSync(join(p.dir, '.cx', 'intake'), { recursive: true });
    writeFileSync(join(p.dir, '.cx', 'intake', 'manifest.json'), `${JSON.stringify({ version: 1, files: {} })}\n`, 'utf8');
    writeFileSync(join(p.dir, '.cx', 'intake-config.json'), `${JSON.stringify({ parentDirs: [], maxDepth: 4, includeArchetypeInbox: true })}\n`, 'utf8');
    writeFileSync(join(p.dir, 'inbox', 'sample.md'), '# Sample\n', 'utf8');

    writeFakePollLock(p.dir, process.pid, 'fake-daemon');

    const refused = runConstruct(p.dir, ['intake', 'process']);
    assert.equal(refused.status, 2, `expected exit 2, got ${refused.status}: ${refused.stderr}`);
    assert.match(refused.stderr, /Another intake poll/);
    assert.match(refused.stderr, /fake-daemon/);
    assert.match(refused.stderr, new RegExp(String(process.pid)));
    assert.match(refused.stderr, /--wait/);
  } finally {
    p.cleanup();
  }
});

test('intake process --wait acquires the lock once it is released', () => {
  const p = makeProject();
  try {
    mkdirSync(join(p.dir, 'inbox'), { recursive: true });
    mkdirSync(join(p.dir, '.cx', 'intake'), { recursive: true });
    writeFileSync(join(p.dir, '.cx', 'intake', 'manifest.json'), `${JSON.stringify({ version: 1, files: {} })}\n`, 'utf8');
    writeFileSync(join(p.dir, '.cx', 'intake-config.json'), `${JSON.stringify({ parentDirs: [], maxDepth: 4, includeProjectInbox: false, includeArchetypeInbox: true })}\n`, 'utf8');
    writeFileSync(join(p.dir, 'inbox', 'sample.md'), '# Sample\n\nbody\n', 'utf8');

    writeFakePollLock(p.dir, process.pid, 'fake-daemon');

    // Detached releaser fires while the spawnSync below blocks. A
    // separate process avoids the parent-blocked deadlock that a
    // same-process timer would cause.

    const lockPath = join(p.dir, '.cx', 'runtime', 'inbox-poll.lock');
    const releaser = spawn(process.execPath, ['-e', `setTimeout(() => { try { require('fs').rmSync(${JSON.stringify(lockPath)}, { force: true }); } catch {} }, 400)`], {
      detached: true,
      stdio: 'ignore',
    });
    releaser.unref();

    const waited = runConstruct(p.dir, ['intake', 'process', '--wait=10']);
    assert.equal(waited.status, 0, `expected exit 0 after --wait, got ${waited.status}: ${waited.stderr}`);
    assert.match(waited.stdout, /Processed: /);
  } finally {
    p.cleanup();
  }
});

test('intake process clears a stale poll lock whose pid is gone, then runs', () => {
  const p = makeProject();
  try {
    mkdirSync(join(p.dir, 'inbox'), { recursive: true });
    mkdirSync(join(p.dir, '.cx', 'intake'), { recursive: true });
    writeFileSync(join(p.dir, '.cx', 'intake', 'manifest.json'), `${JSON.stringify({ version: 1, files: {} })}\n`, 'utf8');
    writeFileSync(join(p.dir, '.cx', 'intake-config.json'), `${JSON.stringify({ parentDirs: [], maxDepth: 4, includeProjectInbox: false, includeArchetypeInbox: true })}\n`, 'utf8');
    writeFileSync(join(p.dir, 'inbox', 'sample.md'), '# Sample\n\nbody\n', 'utf8');

    writeFakePollLock(p.dir, 999999, 'dead-pid');

    const result = runConstruct(p.dir, ['intake', 'process']);
    assert.equal(result.status, 0, `expected exit 0 after stale-lock clear, got ${result.status}: ${result.stderr}`);
    assert.match(result.stdout, /Processed: /);
  } finally {
    p.cleanup();
  }
});

test('intake process --dry-run is unaffected by the poll lock', () => {
  const p = makeProject();
  try {
    mkdirSync(join(p.dir, 'inbox'), { recursive: true });
    mkdirSync(join(p.dir, '.cx', 'intake'), { recursive: true });
    writeFileSync(join(p.dir, '.cx', 'intake-config.json'), `${JSON.stringify({ parentDirs: [], maxDepth: 4, includeArchetypeInbox: true })}\n`, 'utf8');

    writeFakePollLock(p.dir, process.pid);

    const dry = runConstruct(p.dir, ['intake', 'process', '--dry-run']);
    assert.equal(dry.status, 0, `expected exit 0 under --dry-run, got ${dry.status}: ${dry.stderr}`);
    assert.match(dry.stdout, /Would scan:/);
  } finally {
    p.cleanup();
  }
});

// In-process InboxWatcher exercises (no `construct init` spawn): the
// archetype is materialized by writing the inbox layout and an empty
// manifest directly. Avoids the background-daemon race that the full
// `construct intake process` test would inherit from init starting
// services. Both code paths share the same InboxWatcher.poll() under the
// hood — so these assertions cover the runtime contract end-to-end.

async function withArchetypeProject(fn) {
  const p = makeProject();
  try {
    mkdirSync(join(p.dir, 'inbox'), { recursive: true });
    writeFileSync(join(p.dir, 'inbox', '.gitignore'), '*\n!.gitignore\n', 'utf8');
    mkdirSync(join(p.dir, '.cx', 'intake'), { recursive: true });
    writeFileSync(
      join(p.dir, '.cx', 'intake', 'manifest.json'),
      `${JSON.stringify({ version: 1, files: {} }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(p.dir, '.cx', 'intake-config.json'),
      `${JSON.stringify({ parentDirs: [], maxDepth: 4, includeProjectInbox: false, includeDocsIntake: false, includeArchetypeInbox: true }, null, 2)}\n`,
      'utf8',
    );
    process.env.CONSTRUCT_AGENT_ID = 'test-agent';
    await fn(p);
  } finally {
    p.cleanup();
    delete process.env.CONSTRUCT_AGENT_ID;
  }
}

test('InboxWatcher.poll records the SHA-256 + attribution on a fresh ingest', async () => {
  await withArchetypeProject(async (p) => {
    writeFileSync(join(p.dir, 'inbox', 'notes.md'), '# Interview\n\nBody.\n', 'utf8');
    const { InboxWatcher } = await import('../../lib/embed/inbox.mjs');
    const watcher = new InboxWatcher({ rootDir: p.dir, env: process.env, cwd: p.dir });
    const result = await watcher.poll();
    assert.equal(result.processed.length, 1, `expected 1 processed: ${JSON.stringify(result)}`);

    const manifest = JSON.parse(readFileSync(join(p.dir, '.cx', 'intake', 'manifest.json'), 'utf8'));
    const entries = Object.values(manifest.files);
    assert.equal(entries.length, 1);
    assert.match(entries[0].sourcePath, /inbox\/notes\.md/);
    assert.equal(entries[0].createdBy, 'Process Test <process-test@example.com>');
    assert.equal(entries[0].createdByAgent, 'test-agent');
  });
});

test('InboxWatcher.poll refuses to reprocess identical content under a new path', async () => {
  await withArchetypeProject(async (p) => {
    const body = '# Interview\n\nBody.\n';
    writeFileSync(join(p.dir, 'inbox', 'first.md'), body, 'utf8');
    const { InboxWatcher } = await import('../../lib/embed/inbox.mjs');
    const watcher = new InboxWatcher({ rootDir: p.dir, env: process.env, cwd: p.dir });
    const first = await watcher.poll();
    assert.equal(first.processed.length, 1);

    writeFileSync(join(p.dir, 'inbox', 'second.md'), body, 'utf8');
    const second = await watcher.poll();
    assert.equal(second.processed.length, 0, 'identical content must dedup via the manifest');
    assert.ok(second.skipped >= 1, 'second poll must report at least one skip');

    const manifest = JSON.parse(readFileSync(join(p.dir, '.cx', 'intake', 'manifest.json'), 'utf8'));
    assert.equal(Object.keys(manifest.files).length, 1, 'manifest must hold exactly one entry');
  });
});

test('intake packets carry attribution when the archetype manifest is present', async () => {
  await withArchetypeProject(async (p) => {
    writeFileSync(join(p.dir, 'inbox', 'attrib.md'), '# Provenance\n\nbody\n', 'utf8');
    const { InboxWatcher } = await import('../../lib/embed/inbox.mjs');
    const watcher = new InboxWatcher({ rootDir: p.dir, env: process.env, cwd: p.dir });
    await watcher.poll();

    const packets = pendingPackets(p.dir);
    assert.equal(packets.length, 1);
    const packet = packets[0];
    assert.equal(packet.createdBy, 'Process Test <process-test@example.com>');
    assert.equal(packet.createdByAgent, 'test-agent');
    assert.ok(typeof packet.createdAt === 'string' && packet.createdAt.length > 0);
  });
});

test('two parallel InboxWatcher.poll calls serialize through the lock — no double-ingest', async () => {
  await withArchetypeProject(async (p) => {
    writeFileSync(join(p.dir, 'inbox', 'race.md'), '# Race\n\nbody\n', 'utf8');
    const { InboxWatcher } = await import('../../lib/embed/inbox.mjs');
    const watcherA = new InboxWatcher({ rootDir: p.dir, env: process.env, cwd: p.dir });
    const watcherB = new InboxWatcher({ rootDir: p.dir, env: process.env, cwd: p.dir });

    // Both pollers start concurrently. One acquires the lock and ingests;
    // the other waits, then sees the state file already updated and skips.
    // Without the lock the two could both decide "unprocessed" and write
    // two packets for the same source.
    const [a, b] = await Promise.all([
      watcherA.poll({ waitMs: 30_000 }),
      watcherB.poll({ waitMs: 30_000 }),
    ]);

    const total = a.processed.length + b.processed.length;
    assert.equal(total, 1, `exactly one watcher must own the ingest; got A=${a.processed.length} B=${b.processed.length}`);

    const packets = pendingPackets(p.dir);
    assert.equal(packets.length, 1, 'lock must prevent duplicate packets for one source');

    const manifest = JSON.parse(readFileSync(join(p.dir, '.cx', 'intake', 'manifest.json'), 'utf8'));
    assert.equal(Object.keys(manifest.files).length, 1, 'manifest must hold exactly one entry');
  });
});
