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
    it('creates an observation with all fields', () => {
      const obs = addObservation(tmpDir, {
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

    it('clamps summary to 500 chars', () => {
      const longSummary = 'x'.repeat(600);
      const obs = addObservation(tmpDir, { summary: longSummary });
      assert.ok(obs.summary.length <= 500);
    });

    it('clamps content to 2000 chars', () => {
      const longContent = 'x'.repeat(2500);
      const obs = addObservation(tmpDir, { content: longContent });
      assert.ok(obs.content.length <= 2000);
    });

    it('caps tags at 10', () => {
      const tags = Array.from({ length: 15 }, (_, i) => `tag-${i}`);
      const obs = addObservation(tmpDir, { tags });
      assert.equal(obs.tags.length, 10);
    });

    it('defaults invalid category to insight', () => {
      const obs = addObservation(tmpDir, { category: 'invalid-cat' });
      assert.equal(obs.category, 'insight');
    });

    it('clamps confidence to 0-1 range', () => {
      const obs1 = addObservation(tmpDir, { confidence: 1.5 });
      assert.equal(obs1.confidence, 1);
      const obs2 = addObservation(tmpDir, { confidence: -0.5 });
      assert.equal(obs2.confidence, 0);
    });

    it('writes record to disk', () => {
      const obs = addObservation(tmpDir, { summary: 'disk test' });
      const filePath = path.join(tmpDir, '.cx/observations', `${obs.id}.json`);
      assert.ok(fs.existsSync(filePath));
      const loaded = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      assert.equal(loaded.summary, 'disk test');
    });

    it('adds entry to index', () => {
      addObservation(tmpDir, { summary: 'index test', role: 'cx-qa' });
      const index = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.cx/observations/index.json'), 'utf8'),
      );
      assert.equal(index.length, 1);
      assert.equal(index[0].role, 'cx-qa');
    });

    it('creates vector entry', () => {
      addObservation(tmpDir, { summary: 'vector test' });
      const vectors = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.cx/observations/vectors.json'), 'utf8'),
      );
      assert.equal(vectors.length, 1);
      assert.ok(Array.isArray(vectors[0].embedding));
      assert.equal(vectors[0].embedding.length, 256);
    });
  });

  describe('searchObservations', () => {
    it('returns semantically matching observations', () => {
      addObservation(tmpDir, {
        role: 'cx-engineer',
        summary: 'Authentication uses JWT tokens with refresh flow',
        content: 'The auth module at lib/auth uses JWT. Refresh tokens stored in httpOnly cookies.',
        tags: ['auth', 'jwt'],
        project: 'myapp',
      });
      addObservation(tmpDir, {
        role: 'cx-architect',
        summary: 'Database uses PostgreSQL with Prisma ORM',
        content: 'All models defined in prisma/schema.prisma.',
        tags: ['database', 'prisma'],
        project: 'myapp',
      });

      const results = searchObservations(tmpDir, 'authentication JWT tokens');
      assert.ok(results.length >= 1);
      assert.ok(results[0].summary.includes('JWT'));
      assert.ok(typeof results[0].score === 'number');
    });

    it('filters by role', () => {
      addObservation(tmpDir, { role: 'cx-engineer', summary: 'eng obs', project: 'p' });
      addObservation(tmpDir, { role: 'cx-architect', summary: 'arch obs', project: 'p' });

      const results = searchObservations(tmpDir, 'obs', { role: 'cx-engineer' });
      assert.ok(results.every((r) => r.role === 'cx-engineer'));
    });

    it('filters by category', () => {
      addObservation(tmpDir, { category: 'pattern', summary: 'a pattern here', project: 'p' });
      addObservation(tmpDir, { category: 'decision', summary: 'a decision here', project: 'p' });

      const results = searchObservations(tmpDir, 'here', { category: 'pattern' });
      assert.ok(results.every((r) => r.category === 'pattern'));
    });

    it('filters by project', () => {
      addObservation(tmpDir, { summary: 'proj a obs here', project: 'proj-a' });
      addObservation(tmpDir, { summary: 'proj b obs here', project: 'proj-b' });

      const results = searchObservations(tmpDir, 'obs here', { project: 'proj-a' });
      assert.ok(results.every((r) => r.project === 'proj-a'));
    });

    it('returns empty for no query', () => {
      addObservation(tmpDir, { summary: 'test obs' });
      const results = searchObservations(tmpDir, '');
      assert.equal(results.length, 0);
    });
  });

  describe('listObservations', () => {
    it('lists all observations', () => {
      addObservation(tmpDir, { summary: 'obs 1' });
      addObservation(tmpDir, { summary: 'obs 2' });
      const list = listObservations(tmpDir);
      assert.equal(list.length, 2);
    });

    it('filters by role', () => {
      addObservation(tmpDir, { role: 'cx-qa', summary: 'qa obs' });
      addObservation(tmpDir, { role: 'cx-sre', summary: 'sre obs' });
      const list = listObservations(tmpDir, { role: 'cx-qa' });
      assert.equal(list.length, 1);
      assert.equal(list[0].role, 'cx-qa');
    });

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) addObservation(tmpDir, { summary: `obs ${i}` });
      const list = listObservations(tmpDir, { limit: 3 });
      assert.equal(list.length, 3);
    });
  });

  describe('getObservation', () => {
    it('returns full observation record', () => {
      const created = addObservation(tmpDir, {
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
    it('removes from disk, index, and vectors', () => {
      const obs = addObservation(tmpDir, { summary: 'to delete' });
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
    it('counts total observations', () => {
      addObservation(tmpDir, { summary: 'a' });
      addObservation(tmpDir, { summary: 'b' });
      assert.equal(countObservations(tmpDir), 2);
    });

    it('counts by role', () => {
      addObservation(tmpDir, { role: 'cx-qa', summary: 'a' });
      addObservation(tmpDir, { role: 'cx-sre', summary: 'b' });
      assert.equal(countObservations(tmpDir, { role: 'cx-qa' }), 1);
    });
  });
});
