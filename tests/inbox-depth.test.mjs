/**
 * tests/inbox-depth.test.mjs — verify the inbox watcher respects
 * the configured maxDepth and runs without a Postgres backend.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach, after } from 'node:test';

import { InboxWatcher } from '../lib/embed/inbox.mjs';
import { saveIntakeConfig } from '../lib/intake/intake-config.mjs';

// InboxWatcher.poll() resolves its state file through the machine-scoped
// state root (ADR-0066), which reads CX_HOME_OVERRIDE from real process.env
// directly — the `env` constructor option below is a plain options bag, not
// process.env, so it never isolates that write. Pin it for the whole file so
// polling never writes into the real developer machine's ~/.construct/projects/.

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-inbox-depth-home-'));
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;
after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

let projectRoot;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-inbox-depth-'));
  fs.mkdirSync(path.join(projectRoot, '.construct'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function writeDoc(p, body) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

describe('InboxWatcher maxDepth', () => {
  it('depth=0 ingests only files in the parent dir', async () => {
    const extra = path.join(projectRoot, 'extra');
    writeDoc(path.join(extra, 'top.md'), '# Top level\n\nVisible at depth=0.');
    writeDoc(path.join(extra, 'sub', 'nested.md'), '# Nested\n\nNot visible at depth=0.');

    saveIntakeConfig(projectRoot, { parentDirs: [extra], maxDepth: 0 });

    const watcher = new InboxWatcher({ rootDir: projectRoot, env: { CONSTRUCT_EMBEDDING_MODEL: 'hashing' }, cwd: projectRoot });
    const result = await watcher.poll();
    const paths = result.processed.map((p) => p.path);
    assert.equal(paths.length, 1);
    assert.ok(paths[0].endsWith('top.md'));
  });

  it('depth=1 walks into immediate subdirs but not further', async () => {
    const extra = path.join(projectRoot, 'extra');
    writeDoc(path.join(extra, 'top.md'), '# Top\n\nAt depth 0.');
    writeDoc(path.join(extra, 'sub', 'one.md'), '# One\n\nAt depth 1.');
    writeDoc(path.join(extra, 'sub', 'deep', 'two.md'), '# Two\n\nAt depth 2.');

    saveIntakeConfig(projectRoot, { parentDirs: [extra], maxDepth: 1 });

    const watcher = new InboxWatcher({ rootDir: projectRoot, env: { CONSTRUCT_EMBEDDING_MODEL: 'hashing' }, cwd: projectRoot });
    const result = await watcher.poll();
    const paths = result.processed.map((p) => p.path).sort();
    assert.equal(paths.length, 2);
    assert.ok(paths.some((p) => p.endsWith('top.md')));
    assert.ok(paths.some((p) => p.endsWith('one.md')));
    assert.ok(!paths.some((p) => p.endsWith('two.md')));
  });

  it('runs cleanly with no DATABASE_URL configured', async () => {
    const extra = path.join(projectRoot, 'extra');
    writeDoc(path.join(extra, 'note.md'), '# Offline\n\nIntake should work without Postgres.');

    saveIntakeConfig(projectRoot, { parentDirs: [extra], maxDepth: 1 });

    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.CONSTRUCT_DATABASE_URL;

    const watcher = new InboxWatcher({ rootDir: projectRoot, env, cwd: projectRoot });
    const result = await watcher.poll();
    assert.equal(result.errors.length, 0);
    assert.equal(result.processed.length, 1);
  });
});
