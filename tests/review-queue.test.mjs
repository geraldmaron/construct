/**
 * tests/review-queue.test.mjs — `.cx/review-queue/` storage contract.
 *
 * Pins the durable handoff between the embed daemon (which writes pending
 * entries) and the agent in the user's editor (which processes them).
 * Drift in the on-disk JSON shape would silently break the
 * session-start hook's notification + the `construct review done` flow.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import {
  enqueueReview,
  listPending,
  countPending,
  markProcessed,
  readEntry,
  pendingDir,
  processedDir,
} from '../lib/review/queue.mjs';

let projectRoot;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-review-queue-'));
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function sampleEntry(overrides = {}) {
  return {
    intake: { sourcePath: '/tmp/example.pdf', outputPath: '/tmp/example.md', characters: 1234, knowledgeSubdir: 'reference' },
    suggestion: { lane: 'rfcs', source: 'docs-routing.suggestDocsLaneForFile' },
    related: [{ path: 'docs/rfcs/0007-x.md', title: 'Existing RFC', score: 0.78, summary: '...' }],
    excerpt: 'pretend extracted content',
    query: 'example pdf relevant context',
    ...overrides,
  };
}

describe('enqueueReview', () => {
  it('writes a JSON file under pending/ with status=pending and a slug from the source basename', () => {
    const { id, filePath } = enqueueReview(projectRoot, sampleEntry());
    assert.ok(fs.existsSync(filePath), 'pending entry exists');
    assert.match(id, /-example$/, 'slug derived from basename');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(data.status, 'pending');
    assert.ok(data.createdAt, 'timestamps the entry');
    assert.equal(data.intake.sourcePath, '/tmp/example.pdf');
    assert.equal(data.suggestion.lane, 'rfcs');
    assert.equal(data.related.length, 1);
  });

  it('rejects malformed entries early (no silent loss)', () => {
    assert.throws(() => enqueueReview(projectRoot, {}), /sourcePath is required/);
    assert.throws(() => enqueueReview(null, sampleEntry()), /rootDir is required/);
  });
});

describe('listPending + countPending', () => {
  it('returns empty for a fresh project', () => {
    assert.deepEqual(listPending(projectRoot), []);
    assert.equal(countPending(projectRoot), 0);
  });

  it('returns entries in createdAt order (stable display)', async () => {
    enqueueReview(projectRoot, sampleEntry({ intake: { sourcePath: '/tmp/aaa.md', outputPath: '/x', characters: 1 } }));
    await new Promise((r) => setTimeout(r, 5));
    enqueueReview(projectRoot, sampleEntry({ intake: { sourcePath: '/tmp/zzz.md', outputPath: '/x', characters: 1 } }));
    const pending = listPending(projectRoot);
    assert.equal(pending.length, 2);
    assert.ok(pending[0].createdAt <= pending[1].createdAt, 'sorted oldest-first');
    assert.equal(countPending(projectRoot), 2);
  });
});

describe('markProcessed', () => {
  it('moves the entry from pending/ to processed/ with status=processed + metadata', () => {
    const { id } = enqueueReview(projectRoot, sampleEntry());
    const beforePending = fs.existsSync(path.join(pendingDir(projectRoot), `${id}.json`));
    assert.equal(beforePending, true);

    markProcessed(projectRoot, id, { processedBy: 'claude-code-session', notes: 'merged into docs/rfcs/0007-x.md' });

    const afterPending = fs.existsSync(path.join(pendingDir(projectRoot), `${id}.json`));
    assert.equal(afterPending, false, 'removed from pending');
    const afterProcessed = fs.existsSync(path.join(processedDir(projectRoot), `${id}.json`));
    assert.equal(afterProcessed, true, 'moved to processed');

    const entry = readEntry(projectRoot, id);
    assert.equal(entry.status, 'processed');
    assert.equal(entry.processedBy, 'claude-code-session');
    assert.equal(entry.notes, 'merged into docs/rfcs/0007-x.md');
    assert.ok(entry.processedAt);
  });

  it('errors clearly on an unknown id (no silent no-op)', () => {
    assert.throws(() => markProcessed(projectRoot, 'nonexistent', {}), /no pending entry/);
  });
});

describe('readEntry', () => {
  it('finds entries in either pending/ or processed/', () => {
    const { id: pendingId } = enqueueReview(projectRoot, sampleEntry());
    const pendingHit = readEntry(projectRoot, pendingId);
    assert.equal(pendingHit.status, 'pending');

    markProcessed(projectRoot, pendingId, { processedBy: 'test' });
    const processedHit = readEntry(projectRoot, pendingId);
    assert.equal(processedHit.status, 'processed');
  });

  it('returns null for unknown ids', () => {
    assert.equal(readEntry(projectRoot, 'nope'), null);
  });
});
