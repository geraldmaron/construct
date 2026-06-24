/**
 * tests/intake-queue.test.mjs — `.cx/intake/` storage contract via FilesystemIntakeQueue.
 *
 * Pins the durable handoff between the embed daemon (which writes pending
 * entries) and the agent in the user's editor (which processes them).
 * Exercises the IntakeQueue interface — enqueue, listPending, count, read,
 * markProcessed, markSkipped, reopen — against the filesystem adapter.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import {
  FilesystemIntakeQueue,
  pendingDir,
  processedDir,
  skippedDir,
} from '../lib/intake/queue.mjs';

let projectRoot;
let queue;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-intake-'));
  queue = new FilesystemIntakeQueue(projectRoot);
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function sampleEntry(overrides = {}) {
  return {
    intake: { sourcePath: '/tmp/example.pdf', outputPath: '/tmp/example.md', characters: 1234, knowledgeSubdir: 'reference' },
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
    suggestion: { lane: 'rfcs', source: 'docs-routing.suggestDocsLaneForFile' },
    related: [{ path: 'templates/docs/rfcs/0007-x.md', title: 'Existing RFC', score: 0.78, summary: '...' }],
    excerpt: 'pretend extracted content',
    query: 'example pdf relevant context',
    ...overrides,
  };
}

describe('FilesystemIntakeQueue.enqueue', () => {
  it('writes a JSON file under pending/ with status=pending and a slug from the source basename', () => {
    const { id, filePath } = queue.enqueue(sampleEntry());
    assert.ok(fs.existsSync(filePath), 'pending entry exists');
    assert.match(id, /-example$/, 'slug derived from basename');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(data.status, 'pending');
    assert.ok(data.createdAt, 'timestamps the entry');
    assert.equal(data.intake.sourcePath, '/tmp/example.pdf');
    assert.equal(data.suggestion.lane, 'rfcs');
    assert.equal(data.related.length, 1);
    assert.equal(data.triage.intakeType, 'bug');
    assert.equal(data.triage.primaryOwner, 'debugger');
  });

  it('rejects malformed entries early (no silent loss)', () => {
    assert.throws(() => queue.enqueue({}), /sourcePath is required/);
    assert.throws(() => new FilesystemIntakeQueue(null), /rootDir is required/);
  });
});

describe('FilesystemIntakeQueue.listPending + count', () => {
  it('returns empty for a fresh project', () => {
    assert.deepEqual(queue.listPending(), []);
    assert.equal(queue.count(), 0);
  });

  it('returns entries in createdAt order (stable display)', async () => {
    queue.enqueue(sampleEntry({ intake: { sourcePath: '/tmp/aaa.md', outputPath: '/x', characters: 1 } }));
    await new Promise((r) => setTimeout(r, 5));
    queue.enqueue(sampleEntry({ intake: { sourcePath: '/tmp/zzz.md', outputPath: '/x', characters: 1 } }));
    const pending = queue.listPending();
    assert.equal(pending.length, 2);
    assert.ok(pending[0].createdAt <= pending[1].createdAt, 'sorted oldest-first');
    assert.equal(queue.count(), 2);
  });
});

describe('FilesystemIntakeQueue.markProcessed', () => {
  it('moves the entry from pending/ to processed/ with status=processed + metadata', () => {
    const { id } = queue.enqueue(sampleEntry());
    queue.markProcessed(id, { processedBy: 'claude-code-session', notes: 'merged into templates/docs/rfcs/0007-x.md' });

    assert.equal(fs.existsSync(path.join(pendingDir(projectRoot), `${id}.json`)), false, 'removed from pending');
    assert.equal(fs.existsSync(path.join(processedDir(projectRoot), `${id}.json`)), true, 'moved to processed');

    const entry = queue.read(id);
    assert.equal(entry.status, 'processed');
    assert.equal(entry.processedBy, 'claude-code-session');
    assert.equal(entry.notes, 'merged into templates/docs/rfcs/0007-x.md');
    assert.ok(entry.processedAt);
  });

  it('errors clearly on an unknown id (no silent no-op)', () => {
    assert.throws(() => queue.markProcessed('nonexistent', {}), /no pending entry/);
  });
});

describe('FilesystemIntakeQueue.markSkipped', () => {
  it('moves the entry from pending/ to skipped/ with status=skipped + reason', () => {
    const { id } = queue.enqueue(sampleEntry());
    queue.markSkipped(id, { skippedBy: 'test', reason: 'duplicate' });
    assert.equal(fs.existsSync(path.join(pendingDir(projectRoot), `${id}.json`)), false);
    assert.equal(fs.existsSync(path.join(skippedDir(projectRoot), `${id}.json`)), true);
    const entry = queue.read(id);
    assert.equal(entry.status, 'skipped');
    assert.equal(entry.skippedBy, 'test');
    assert.equal(entry.reason, 'duplicate');
    assert.ok(entry.skippedAt);
  });

  it('errors clearly on an unknown id', () => {
    assert.throws(() => queue.markSkipped('nonexistent', {}), /no pending entry/);
  });
});

describe('FilesystemIntakeQueue.reopen', () => {
  it('moves a processed entry back to pending and clears completion fields', () => {
    const { id } = queue.enqueue(sampleEntry());
    queue.markProcessed(id, { processedBy: 'test', notes: 'note' });
    const r = queue.reopen(id);
    assert.equal(r.from, 'processed');
    const entry = queue.read(id);
    assert.equal(entry.status, 'pending');
    assert.equal(entry.processedAt, undefined);
    assert.equal(entry.notes, undefined);
  });

  it('moves a skipped entry back to pending and clears skip fields', () => {
    const { id } = queue.enqueue(sampleEntry());
    queue.markSkipped(id, { skippedBy: 'test', reason: 'r' });
    const r = queue.reopen(id);
    assert.equal(r.from, 'skipped');
    const entry = queue.read(id);
    assert.equal(entry.status, 'pending');
    assert.equal(entry.skippedAt, undefined);
    assert.equal(entry.reason, undefined);
  });

  it('throws when there is nothing to reopen', () => {
    assert.throws(() => queue.reopen('nope'), /no processed or skipped entry/);
  });
});

describe('FilesystemIntakeQueue.read', () => {
  it('finds entries in pending/, processed/, or skipped/', () => {
    const { id: pendingId } = queue.enqueue(sampleEntry());
    assert.equal(queue.read(pendingId).status, 'pending');

    queue.markProcessed(pendingId, { processedBy: 'test' });
    assert.equal(queue.read(pendingId).status, 'processed');

    const { id: skipId } = queue.enqueue(sampleEntry({ intake: { sourcePath: '/tmp/skipped.md', outputPath: '/x', characters: 1 } }));
    queue.markSkipped(skipId, { skippedBy: 'test' });
    assert.equal(queue.read(skipId).status, 'skipped');
  });

  it('returns null for unknown ids', () => {
    assert.equal(queue.read('nope'), null);
  });
});
