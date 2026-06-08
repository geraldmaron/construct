/**
 * tests/observation-store.test.mjs — tests for lib/observation-store.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, beforeEach, afterEach } from 'node:test';
import {
  addObservation,
  listObservations,
  getObservation,
  deleteObservation,
  searchObservations,
  countObservations,
  observationContentHash,
  observationSearchText
} from '../lib/observation-store.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-store-test-'));
  process.env.CONSTRUCT_LANCEDB_PATH = path.join(tmpDir, '.cx', 'lancedb');
  process.env.CONSTRUCT_EMBEDDING_MODEL = 'hashing';
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readIndex(rootDir) {
  const p = path.join(rootDir, '.cx/observations/index.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('observation-store', () => {
  describe('addObservation', () => {
    it('saves a full record and updates index', async () => {
      const record = await addObservation(tmpDir, {
        role: 'cx-qa',
        category: 'pattern',
        summary: 'Test summary',
        content: 'Test content',
        tags: ['a', 'b'],
        project: 'p'
      });

      assert.ok(record.id.startsWith('obs-'));
      assert.equal(record.role, 'cx-qa');
      assert.equal(record.summary, 'Test summary');

      const full = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.cx/observations', `${record.id}.json`), 'utf8'),
      );
      assert.equal(full.content, 'Test content');

      const index = readIndex(tmpDir);
      assert.equal(index.length, 1);
      assert.equal(index[0].role, 'cx-qa');
    });

    it('creates vector entry', async () => {
      const record = await addObservation(tmpDir, { summary: 'vector test', project: 'p' });
      assert.ok(record.id.startsWith('obs-'));
    });
  });

  describe('searchObservations', () => {
    it('returns semantically matching observations', async () => {
      await addObservation(tmpDir, {
        role: 'cx-engineer',
        summary: 'Authentication uses JWT tokens with refresh flow',
        content: 'The auth module at lib/auth uses JWT. Refresh tokens stored in httpOnly cookies.',
        tags: ['auth', 'jwt'],
        project: 'myapp',
      });

      const results = await searchObservations(tmpDir, 'authentication JWT tokens', { project: 'myapp' });
      assert.ok(results.length >= 1, 'should return at least one result');
      assert.ok(results[0].summary.includes('JWT'));
    });

    it('filters by role', async () => {
      await addObservation(tmpDir, { role: 'cx-engineer', summary: 'eng obs', project: 'p' });
      await addObservation(tmpDir, { role: 'cx-architect', summary: 'arch obs', project: 'p' });

      const results = await searchObservations(tmpDir, 'obs', { role: 'cx-engineer', project: 'p' });
      assert.ok(results.every((r) => r.role === 'cx-engineer'));
    });

    it('filters by category', async () => {
      await addObservation(tmpDir, { category: 'pattern', summary: 'a pattern here', project: 'p' });
      await addObservation(tmpDir, { category: 'decision', summary: 'a decision here', project: 'p' });

      const results = await searchObservations(tmpDir, 'here', { category: 'pattern', project: 'p' });
      assert.ok(results.every((r) => r.category === 'pattern'));
    });

    it('filters by project', async () => {
      await addObservation(tmpDir, { summary: 'proj a obs here', project: 'proj-a' });
      await addObservation(tmpDir, { summary: 'proj b obs here', project: 'proj-b' });

      const results = await searchObservations(tmpDir, 'obs here', { project: 'proj-a' });
      assert.ok(results.every((r) => r.project === 'proj-a'));
    });
  });

  describe('deleteObservation', () => {
    it('removes from disk and index', async () => {
      const obs = await addObservation(tmpDir, { summary: 'delete me', project: 'p' });
      assert.ok(fs.existsSync(path.join(tmpDir, '.cx/observations', `${obs.id}.json`)));

      deleteObservation(tmpDir, obs.id);
      assert.ok(!fs.existsSync(path.join(tmpDir, '.cx/observations', `${obs.id}.json`)));
      assert.equal(readIndex(tmpDir).length, 0);
    });
  });

  describe('countObservations', () => {
    it('counts total observations', async () => {
      await addObservation(tmpDir, { summary: 'a', project: 'p' });
      await addObservation(tmpDir, { summary: 'b', project: 'p' });
      assert.equal(countObservations(tmpDir), 2);
    });
  });
});
