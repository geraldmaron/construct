/**
 * tests/embed-inbox.test.mjs — InboxWatcher unit tests.
 *
 * Single-zone model (ADR-0045 §C): the only drop zone is the project-root
 * `inbox/`, always watched. There is no `.construct/inbox/` or `docs/intake/` zone.
 * The `inbox/.staging/` assembly dir and dotfiles are never consumed, so a
 * half-written drop stays invisible until it lands at a top-level name.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InboxWatcher, resolveInboxDirs } from '../lib/embed/inbox.mjs';

// InboxWatcher.poll() resolves its state file through the machine-scoped
// state root (ADR-0066), which reads CONSTRUCT_HOME_OVERRIDE from real process.env
// directly — the `env` constructor option above is a plain options bag, not
// process.env, so it never isolates that write. Pin it for the whole file so
// polling never writes into the real developer machine's ~/.construct/projects/.

const homeOverride = join(tmpdir(), `construct-inbox-home-${Date.now()}-${Math.random().toString(36).slice(2)}`);
mkdirSync(homeOverride, { recursive: true });
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;
after(() => {
  try { rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

function makeTmpDir() {
  const dir = join(tmpdir(), `construct-inbox-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('resolveInboxDirs', () => {
  it('always includes the canonical project-root inbox/', () => {
    const root = makeTmpDir();
    try {
      const dirs = resolveInboxDirs(root, {});
      assert.ok(dirs.some((d) => d.endsWith(`${root}/inbox`) || d.endsWith('inbox')));
      assert.ok(dirs.some((d) => d === join(root, 'inbox')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('creates inbox/ and inbox/.staging/ if they do not exist', () => {
    const root = makeTmpDir();
    try {
      resolveInboxDirs(root, {});
      assert.ok(existsSync(join(root, 'inbox')), 'inbox/ created');
      assert.ok(existsSync(join(root, 'inbox', '.staging')), 'inbox/.staging/ created');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never watches .construct/inbox/ even when it holds entries (zone removed)', () => {
    const root = makeTmpDir();
    try {
      mkdirSync(join(root, '.construct', 'inbox'), { recursive: true });
      writeFileSync(join(root, '.construct', 'inbox', 'stranded.md'), '# stranded drop');
      const dirs = resolveInboxDirs(root, {});
      assert.ok(!dirs.some((d) => d.endsWith(join('.construct', 'inbox'))), '.construct/inbox/ is not a zone');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does NOT watch docs/intake/ even when it exists (zone removed)', () => {
    const root = makeTmpDir();
    try {
      mkdirSync(join(root, 'docs', 'intake'), { recursive: true });
      const dirs = resolveInboxDirs(root, {});
      assert.ok(!dirs.some((d) => d.endsWith(join('docs', 'intake'))), 'docsIntake zone is gone');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('includes extra dirs from CONSTRUCT_INBOX_DIRS', () => {
    const root = makeTmpDir();
    const extra = makeTmpDir();
    try {
      const dirs = resolveInboxDirs(root, { CONSTRUCT_INBOX_DIRS: extra });
      assert.ok(dirs.includes(extra));
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(extra, { recursive: true, force: true });
    }
  });

  it('ignores non-existent paths in CONSTRUCT_INBOX_DIRS', () => {
    const root = makeTmpDir();
    try {
      const dirs = resolveInboxDirs(root, { CONSTRUCT_INBOX_DIRS: '/does/not/exist' });
      assert.ok(!dirs.includes('/does/not/exist'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('InboxWatcher', () => {
  it('returns empty processed list when inbox is empty', async () => {
    const root = makeTmpDir();
    try {
      const watcher = new InboxWatcher({ rootDir: root, env: { CONSTRUCT_EMBEDDING_MODEL: 'hashing' }, cwd: root });
      const result = await watcher.poll();
      assert.equal(result.processed.length, 0);
      assert.equal(result.errors.length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ingests a plain text file dropped into inbox/', async () => {
    const root = makeTmpDir();
    try {
      const inboxDir = join(root, 'inbox');
      mkdirSync(inboxDir, { recursive: true });
      writeFileSync(join(inboxDir, 'spec.md'), '# Test spec\n\nThis is a test specification for the inbox watcher.');

      const watcher = new InboxWatcher({ rootDir: root, env: { CONSTRUCT_EMBEDDING_MODEL: 'hashing' }, cwd: root });
      const result = await watcher.poll();

      assert.equal(result.processed.length, 1);
      assert.ok(result.processed[0].path.endsWith('spec.md'));
      assert.ok(result.processed[0].characters > 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not re-process the same file on second poll', async () => {
    const root = makeTmpDir();
    try {
      const inboxDir = join(root, 'inbox');
      mkdirSync(inboxDir, { recursive: true });
      writeFileSync(join(inboxDir, 'notes.txt'), 'Meeting notes: decided to use Postgres for session store.');

      const watcher = new InboxWatcher({ rootDir: root, env: { CONSTRUCT_EMBEDDING_MODEL: 'hashing' }, cwd: root });
      const first = await watcher.poll();
      const second = await watcher.poll();

      assert.equal(first.processed.length, 1);
      assert.equal(second.processed.length, 0);
      assert.equal(second.skipped, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ingests files from CONSTRUCT_INBOX_DIRS extra paths', async () => {
    const root = makeTmpDir();
    const extra = makeTmpDir();
    try {
      writeFileSync(join(extra, 'adr-001.md'), '# ADR-001\n\nDecision: use event sourcing for audit log.');

      const watcher = new InboxWatcher({ rootDir: root, env: { CONSTRUCT_INBOX_DIRS: extra }, cwd: root });
      const result = await watcher.poll();

      assert.equal(result.processed.length, 1);
      assert.ok(result.processed[0].path.endsWith('adr-001.md'));
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(extra, { recursive: true, force: true });
    }
  });

  it('ingests files recursively from inbox/ subdirectories', async () => {
    const root = makeTmpDir();
    try {
      const meetingDir = join(root, 'inbox', 'meeting-notes');
      mkdirSync(meetingDir, { recursive: true });
      writeFileSync(join(meetingDir, 'retro.md'), '# Retro\n\nWe agreed to simplify intake UX.');

      const watcher = new InboxWatcher({ rootDir: root, env: { CONSTRUCT_EMBEDDING_MODEL: 'hashing' }, cwd: root });
      const result = await watcher.poll();

      assert.equal(result.processed.length, 1);
      assert.ok(result.processed[0].path.endsWith('retro.md'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('promotes ingested files into matching docs lanes when the lane exists', async () => {
    const root = makeTmpDir();
    try {
      const inboxDir = join(root, 'inbox');
      const meetingsDir = join(root, 'docs', 'meetings');
      mkdirSync(inboxDir, { recursive: true });
      mkdirSync(meetingsDir, { recursive: true });
      writeFileSync(join(inboxDir, 'weekly-sync.md'), '# Weekly sync\n\nMeeting notes\n\nAttendees: team\n\nAction items: simplify UX.');

      const watcher = new InboxWatcher({ rootDir: root, env: { CONSTRUCT_EMBEDDING_MODEL: 'hashing' }, cwd: root });
      const result = await watcher.poll();

      assert.equal(result.processed.length, 1);
      assert.ok(result.processed[0].docsPath);
      assert.ok(result.processed[0].docsPath.includes(join('docs', 'meetings')));

      // A markdown source keeps its name; it must not gain a second extension
      // (construct-niny: weekly-sync.md promotes to weekly-sync.md, never .md.md).
      assert.match(result.processed[0].docsPath, /weekly-sync\.md$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('never consumes files staged under inbox/.staging/', async () => {
    const root = makeTmpDir();
    try {
      const stagingDir = join(root, 'inbox', '.staging');
      mkdirSync(stagingDir, { recursive: true });
      writeFileSync(join(stagingDir, 'half-written.md'), '# mid-write, not yet renamed');

      const watcher = new InboxWatcher({ rootDir: root, env: { CONSTRUCT_EMBEDDING_MODEL: 'hashing' }, cwd: root });
      const result = await watcher.poll();

      assert.equal(result.processed.length, 0, 'staged file must not be ingested');
      assert.equal(result.errors.length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('dirs() returns all configured watch directories', () => {
    const root = makeTmpDir();
    try {
      const watcher = new InboxWatcher({ rootDir: root, env: { CONSTRUCT_EMBEDDING_MODEL: 'hashing' } });
      const dirs = watcher.dirs();
      assert.ok(Array.isArray(dirs));
      assert.ok(dirs.length >= 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips hidden files and unsupported extensions', async () => {
    const root = makeTmpDir();
    try {
      const inboxDir = join(root, 'inbox');
      mkdirSync(inboxDir, { recursive: true });
      writeFileSync(join(inboxDir, '.hidden.txt'), 'hidden');
      writeFileSync(join(inboxDir, 'data.bin'), Buffer.from([0x00, 0x01, 0x02]));
      writeFileSync(join(inboxDir, 'valid.md'), '# Visible doc');

      const watcher = new InboxWatcher({ rootDir: root, env: { CONSTRUCT_EMBEDDING_MODEL: 'hashing' }, cwd: root });
      const result = await watcher.poll();

      // Only valid.md should be processed (.hidden.txt skipped, .bin unsupported)
      assert.equal(result.processed.length, 1);
      assert.ok(result.processed[0].path.endsWith('valid.md'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
