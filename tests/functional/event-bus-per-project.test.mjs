/**
 * tests/functional/event-bus-per-project.test.mjs — per-project event isolation.
 *
 * Asserts events.jsonl resolves to <project>/.construct/ when cwd sits inside a
 * Construct project, and falls back to ~/.construct/ only outside one. Without
 * project-scoping, fingerprints from project A suppress real events in
 * project B because the bus dedups by sha1(type|project|summary).
 *
 * Closes.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as bus from '../../lib/roles/event-bus.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

let savedCwd;
let savedEnv;

beforeEach(() => {
  savedCwd = process.cwd();
  savedEnv = process.env.CONSTRUCT_ROLES_ROOT;
  delete process.env.CONSTRUCT_ROLES_ROOT;
});

afterEach(() => {
  process.chdir(savedCwd);
  if (savedEnv !== undefined) process.env.CONSTRUCT_ROLES_ROOT = savedEnv;
  else delete process.env.CONSTRUCT_ROLES_ROOT;
});

test('event bus writes to <project>/.construct/events.jsonl when cwd is inside a Construct project', async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'cx-project-'));
  mkdirSync(join(projectRoot, '.construct'), { recursive: true });
  try {
    const { _resetCache } = await import('../../lib/project-root.mjs');
    _resetCache();
    process.chdir(projectRoot);

    const entry = bus.emit('test.event', { summary: 'isolated to project' });
    const projectEvents = join(projectRoot, '.construct', 'events.jsonl');
    assert.ok(existsSync(projectEvents), 'expected events.jsonl inside project .construct/');
    const written = readFileSync(projectEvents, 'utf8').trim().split('\n');
    const parsed = JSON.parse(written[written.length - 1]);
    assert.equal(parsed.type, 'test.event');
    assert.equal(parsed.fingerprint, entry.fingerprint);
  } finally {
    rmTmpDir(projectRoot);
  }
});

test('event bus respects CONSTRUCT_ROLES_ROOT override for tests', async () => {
  const overrideRoot = mkdtempSync(join(tmpdir(), 'cx-override-'));
  try {
    process.env.CONSTRUCT_ROLES_ROOT = overrideRoot;
    bus.emit('override.event', { summary: 'goes to override root' });
    const overridePath = join(overrideRoot, 'events.jsonl');
    assert.ok(existsSync(overridePath), 'expected events.jsonl at override root');
  } finally {
    rmTmpDir(overrideRoot);
  }
});

test('two projects emit isolated fingerprints — no cross-project suppression', async () => {
  const projA = mkdtempSync(join(tmpdir(), 'cx-projA-'));
  const projB = mkdtempSync(join(tmpdir(), 'cx-projB-'));
  mkdirSync(join(projA, '.construct'), { recursive: true });
  mkdirSync(join(projB, '.construct'), { recursive: true });
  try {
    const { _resetCache } = await import('../../lib/project-root.mjs');

    process.chdir(projA);
    _resetCache();
    bus.emit('test.signal', { summary: 'same summary text' });

    process.chdir(projB);
    _resetCache();
    bus.emit('test.signal', { summary: 'same summary text' });

    const aEvents = readFileSync(join(projA, '.construct', 'events.jsonl'), 'utf8').trim().split('\n');
    const bEvents = readFileSync(join(projB, '.construct', 'events.jsonl'), 'utf8').trim().split('\n');
    assert.equal(aEvents.length, 1, 'project A should have exactly one event');
    assert.equal(bEvents.length, 1, 'project B should have exactly one event');
    assert.ok(!existsSync(join(projA, '.construct', 'events.jsonl')) === false);
  } finally {
    rmTmpDir(projA);
    rmTmpDir(projB);
  }
});
