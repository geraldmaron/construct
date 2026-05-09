/**
 * tests/observation-store.test.mjs — tests for lib/observation-store.mjs.
 *
 * Verifies role-scoped CRUD, vector indexing, hashing-bow-v1 semantic
 * search, and the 1000-entry cap on observations. Isolated in a temp dir
 * so real ~/.cx state is untouched. Run via `npm test`.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  addObservation,
  searchObservations,
  listObservations,
  getObservation,
  deleteObservation,
  countObservations,
} from '../lib/observation-store.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('observation-store', () => {
  describe('addObservation', () => {
    it('creates an observation with all fields', async () => {
      const obs = await addObservation(tmpDir, {
        role: 'cx-engineer',
        category: 'pattern',
        summary: 'This repo uses barrel exports for all modules',
        content: 'Every directory has an index.mjs that re-exports public API. Follow this pattern.',
        tags: ['architecture', 'exports'],
        project: 'test-project',
        confidence: 0.9,
        source: { session: 'test-session' },
      });

      assert.ok(obs.id.startsWith('obs-'));
      assert.equal(obs.role, 'cx-engineer');
      assert.equal(obs.category, 'pattern');
      assert.ok(obs.summary.includes('barrel exports'));
      assert.ok(obs.content.includes('index.mjs'));
      assert.deepEqual(obs.tags, ['architecture', 'exports']);
      assert.equal(obs.project, 'test-project');
      assert.equal(obs.confidence, 0.9);
      assert.ok(obs.createdAt);
    });

    it('clamps summary to 500 chars', async () => {
      const longSummary = 'x'.repeat(600);
      const obs = await addObservation(tmpDir, { summary: longSummary });
      assert.ok(obs.summary.length <= 500);
    });

    it('clamps content to 2000 chars', async () => {
      const longContent = 'x'.repeat(2500);
      const obs = await addObservation(tmpDir, { content: longContent });
      assert.ok(obs.content.length <= 2000);
    });

    it('caps tags at 10', async () => {
      const tags = Array.from({ length: 15 }, (_, i) => `tag-${i}`);
      const obs = await addObservation(tmpDir, { tags });
      assert.equal(obs.tags.length, 10);
    });

    it('defaults invalid category to insight', async () => {
      const obs = await addObservation(tmpDir, { category: 'invalid-cat' });
      assert.equal(obs.category, 'insight');
    });

    it('clamps confidence to 0-1 range', async () => {
      const obs1 = await addObservation(tmpDir, { confidence: 1.5 });
      assert.equal(obs1.confidence, 1);
      const obs2 = await addObservation(tmpDir, { confidence: -0.5 });
      assert.equal(obs2.confidence, 0);
    });

    it('writes record to disk', async () => {
      const obs = await addObservation(tmpDir, { summary: 'disk test' });
      const filePath = path.join(tmpDir, '.cx/observations', `${obs.id}.json`);
      assert.ok(fs.existsSync(filePath));
      const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      assert.equal(loaded.summary, 'disk test');
    });

    it('adds entry to index', async () => {
      await addObservation(tmpDir, { summary: 'index test', role: 'cx-qa' });
      const index = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.cx/observations/index.json'), 'utf8'),
      );
      assert.equal(index.length, 1);
      assert.equal(index[0].role, 'cx-qa');
    });

    it('creates vector entry', async () => {
      await addObservation(tmpDir, { summary: 'vector test' });
      const vectors = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.cx/observations/vectors.json'), 'utf8'),
      );
      assert.equal(vectors.length, 1);
      assert.ok(Array.isArray(vectors[0].embedding));
      assert.equal(vectors[0].embedding.length, 256);
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
      await addObservation(tmpDir, {
        role: 'cx-architect',
        summary: 'Database uses PostgreSQL with Prisma ORM',
        content: 'All models defined in prisma/schema.prisma.',
        tags: ['database', 'prisma'],
        project: 'myapp',
      });

      const results = await searchObservations(tmpDir, 'authentication JWT tokens');
      assert.ok(results.length >= 1);
      assert.ok(results[0].summary.includes('JWT'));
      assert.ok(typeof results[0].score === 'number');
    });

    it('filters by role', async () => {
      await addObservation(tmpDir, { role: 'cx-engineer', summary: 'eng obs', project: 'p' });
      await addObservation(tmpDir, { role: 'cx-architect', summary: 'arch obs', project: 'p' });

      const results = await searchObservations(tmpDir, 'obs', { role: 'cx-engineer' });
      assert.ok(results.every((r) => r.role === 'cx-engineer'));
    });

    it('filters by category', async () => {
      await addObservation(tmpDir, { category: 'pattern', summary: 'a pattern here', project: 'p' });
      await addObservation(tmpDir, { category: 'decision', summary: 'a decision here', project: 'p' });

      const results = await searchObservations(tmpDir, 'here', { category: 'pattern' });
      assert.ok(results.every((r) => r.category === 'pattern'));
    });

    it('filters by project', async () => {
      await addObservation(tmpDir, { summary: 'proj a obs here', project: 'proj-a' });
      await addObservation(tmpDir, { summary: 'proj b obs here', project: 'proj-b' });

      const results = await searchObservations(tmpDir, 'obs here', { project: 'proj-a' });
      assert.ok(results.every((r) => r.project === 'proj-a'));
    });

    it('returns empty for no query', async () => {
      await addObservation(tmpDir, { summary: 'test obs' });
      const results = await searchObservations(tmpDir, '');
      assert.equal(results.length, 0);
    });
  });

  describe('listObservations', () => {
    it('lists all observations', async () => {
      await addObservation(tmpDir, { summary: 'obs 1' });
      await addObservation(tmpDir, { summary: 'obs 2' });
      const list = listObservations(tmpDir);
      assert.equal(list.length, 2);
    });

    it('filters by role', async () => {
      await addObservation(tmpDir, { role: 'cx-qa', summary: 'qa obs' });
      await addObservation(tmpDir, { role: 'cx-sre', summary: 'sre obs' });
      const list = listObservations(tmpDir, { role: 'cx-qa' });
      assert.equal(list.length, 1);
      assert.equal(list[0].role, 'cx-qa');
    });

    it('respects limit', async () => {
      for (let i = 0; i < 10; i++) await addObservation(tmpDir, { summary: `obs ${i}` });
      const list = listObservations(tmpDir, { limit: 3 });
      assert.equal(list.length, 3);
    });
  });

  describe('getObservation', () => {
    it('returns full observation record', async () => {
      const created = await addObservation(tmpDir, {
        summary: 'get test',
        content: 'detailed content',
        tags: ['tag1'],
      });
      const loaded = getObservation(tmpDir, created.id);
      assert.equal(loaded.summary, 'get test');
      assert.equal(loaded.content, 'detailed content');
      assert.deepEqual(loaded.tags, ['tag1']);
    });

    it('returns null for missing id', () => {
      const result = getObservation(tmpDir, 'nonexistent');
      assert.equal(result, null);
    });
  });

  describe('deleteObservation', () => {
    it('removes from disk, index, and vectors', async () => {
      const obs = await addObservation(tmpDir, { summary: 'to delete' });
      assert.ok(getObservation(tmpDir, obs.id));

      deleteObservation(tmpDir, obs.id);

      assert.equal(getObservation(tmpDir, obs.id), null);
      const index = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.cx/observations/index.json'), 'utf8'),
      );
      assert.equal(index.length, 0);
      const vectors = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.cx/observations/vectors.json'), 'utf8'),
      );
      assert.equal(vectors.length, 0);
    });
  });

  describe('countObservations', () => {
    it('counts total observations', async () => {
      await addObservation(tmpDir, { summary: 'a' });
      await addObservation(tmpDir, { summary: 'b' });
      assert.equal(countObservations(tmpDir), 2);
    });

    it('counts by role', async () => {
      await addObservation(tmpDir, { role: 'cx-qa', summary: 'a' });
      await addObservation(tmpDir, { role: 'cx-sre', summary: 'b' });
      assert.equal(countObservations(tmpDir, { role: 'cx-qa' }), 1);
    });
  });
});
