/**
 * tests/embed-inbox.test.mjs — InboxWatcher unit tests.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InboxWatcher, resolveInboxDirs } from '../lib/embed/inbox.mjs';

function makeTmpDir() {
  const dir = join(tmpdir(), `construct-inbox-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('resolveInboxDirs', () => {
  it('always includes <rootDir>/.cx/inbox/', () => {
    const root = makeTmpDir();
    try {
      const dirs = resolveInboxDirs(root, {});
      assert.ok(dirs.some((d) => d.endsWith('.cx/inbox') || d.endsWith('.cx\\inbox')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('creates .cx/inbox/ if it does not exist', () => {
    const root = makeTmpDir();
    try {
      resolveInboxDirs(root, {});
      assert.ok(existsSync(join(root, '.cx', 'inbox')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('includes extra dirs from CX_INBOX_DIRS', () => {
    const root = makeTmpDir();
    const extra = makeTmpDir();
    try {
      const dirs = resolveInboxDirs(root, { CX_INBOX_DIRS: extra });
      assert.ok(dirs.includes(extra));
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(extra, { recursive: true, force: true });
    }
  });

  it('includes docs/intake when it exists', () => {
    const root = makeTmpDir();
    try {
      mkdirSync(join(root, 'docs', 'intake'), { recursive: true });
      const dirs = resolveInboxDirs(root, {});
      assert.ok(dirs.some((d) => d.endsWith('docs/intake') || d.endsWith('docs\\intake')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores non-existent paths in CX_INBOX_DIRS', () => {
    const root = makeTmpDir();
    try {
      const dirs = resolveInboxDirs(root, { CX_INBOX_DIRS: '/does/not/exist' });
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
      const watcher = new InboxWatcher({ rootDir: root, env: {}, cwd: root });
      const result = await watcher.poll();
      assert.equal(result.processed.length, 0);
      assert.equal(result.errors.length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ingests a plain text file dropped into .cx/inbox/', async () => {
    const root = makeTmpDir();
    try {
      const inboxDir = join(root, '.cx', 'inbox');
      mkdirSync(inboxDir, { recursive: true });
      writeFileSync(join(inboxDir, 'spec.md'), '# Test spec\n\nThis is a test specification for the inbox watcher.');

      const watcher = new InboxWatcher({ rootDir: root, env: {}, cwd: root });
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
      const inboxDir = join(root, '.cx', 'inbox');
      mkdirSync(inboxDir, { recursive: true });
      writeFileSync(join(inboxDir, 'notes.txt'), 'Meeting notes: decided to use Postgres for session store.');

      const watcher = new InboxWatcher({ rootDir: root, env: {}, cwd: root });
      const first = await watcher.poll();
      const second = await watcher.poll();

      assert.equal(first.processed.length, 1);
      assert.equal(second.processed.length, 0);
      assert.equal(second.skipped, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ingests files from CX_INBOX_DIRS extra paths', async () => {
    const root = makeTmpDir();
    const extra = makeTmpDir();
    try {
      writeFileSync(join(extra, 'adr-001.md'), '# ADR-001\n\nDecision: use event sourcing for audit log.');

      const watcher = new InboxWatcher({ rootDir: root, env: { CX_INBOX_DIRS: extra }, cwd: root });
      const result = await watcher.poll();

      assert.equal(result.processed.length, 1);
      assert.ok(result.processed[0].path.endsWith('adr-001.md'));
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(extra, { recursive: true, force: true });
    }
  });

  it('ingests files recursively from docs/intake subdirectories', async () => {
    const root = makeTmpDir();
    try {
      const meetingDir = join(root, 'docs', 'intake', 'meeting-notes');
      mkdirSync(meetingDir, { recursive: true });
      writeFileSync(join(meetingDir, 'retro.md'), '# Retro\n\nWe agreed to simplify intake UX.');

      const watcher = new InboxWatcher({ rootDir: root, env: {}, cwd: root });
      const result = await watcher.poll();

      assert.equal(result.processed.length, 1);
      assert.ok(result.processed[0].path.endsWith('retro.md'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('promotes intake docs into matching docs lanes when the lane exists', async () => {
    const root = makeTmpDir();
    try {
      const intakeDir = join(root, 'docs', 'intake');
      const meetingsDir = join(root, 'docs', 'meetings');
      mkdirSync(intakeDir, { recursive: true });
      mkdirSync(meetingsDir, { recursive: true });
      writeFileSync(join(intakeDir, 'weekly-sync.md'), '# Weekly sync\n\nMeeting notes\n\nAttendees: team\n\nAction items: simplify UX.');

      const watcher = new InboxWatcher({ rootDir: root, env: {}, cwd: root });
      const result = await watcher.poll();

      assert.equal(result.processed.length, 1);
      assert.ok(result.processed[0].docsPath);
      assert.ok(result.processed[0].docsPath.endsWith('.md'));
      assert.ok(result.processed[0].docsPath.includes(join('docs', 'meetings')));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('dirs() returns all configured watch directories', () => {
    const root = makeTmpDir();
    try {
      const watcher = new InboxWatcher({ rootDir: root, env: {} });
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
      const inboxDir = join(root, '.cx', 'inbox');
      mkdirSync(inboxDir, { recursive: true });
      writeFileSync(join(inboxDir, '.hidden.txt'), 'hidden');
      writeFileSync(join(inboxDir, 'data.bin'), Buffer.from([0x00, 0x01, 0x02]));
      writeFileSync(join(inboxDir, 'valid.md'), '# Visible doc');

      const watcher = new InboxWatcher({ rootDir: root, env: {}, cwd: root });
      const result = await watcher.poll();

      // Only valid.md should be processed (.hidden.txt skipped, .bin unsupported)
      assert.equal(result.processed.length, 1);
      assert.ok(result.processed[0].path.endsWith('valid.md'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
