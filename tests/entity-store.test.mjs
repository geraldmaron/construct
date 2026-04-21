import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createEntity,
  addObservationToEntity,
  addRelatedEntity,
  searchEntities,
  getEntity,
  listEntities,
  countEntities,
} from '../lib/entity-store.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('entity-store', () => {
  describe('createEntity', () => {
    it('creates an entity with all fields', () => {
      const entity = createEntity(tmpDir, {
        name: 'Auth Module',
        type: 'component',
        summary: 'Handles JWT authentication and refresh tokens',
        project: 'myapp',
        observationIds: ['obs-1', 'obs-2'],
      });

      assert.equal(entity.name, 'auth module');
      assert.equal(entity.type, 'component');
      assert.ok(entity.summary.includes('JWT'));
      assert.equal(entity.project, 'myapp');
      assert.deepEqual(entity.observations, ['obs-1', 'obs-2']);
      assert.ok(entity.lastSeen);
      assert.ok(entity.createdAt);
    });

    it('normalizes name to lowercase', () => {
      const entity = createEntity(tmpDir, { name: 'MyService' });
      assert.equal(entity.name, 'myservice');
    });

    it('updates existing entity by name', () => {
      createEntity(tmpDir, { name: 'svc', type: 'service', summary: 'v1' });
      const updated = createEntity(tmpDir, { name: 'svc', type: 'api', summary: 'v2' });
      assert.equal(updated.type, 'api');
      assert.equal(updated.summary, 'v2');

      const list = listEntities(tmpDir);
      assert.equal(list.length, 1);
    });

    it('merges observation IDs on update', () => {
      createEntity(tmpDir, { name: 'svc', observationIds: ['obs-1'] });
      const updated = createEntity(tmpDir, { name: 'svc', observationIds: ['obs-2'] });
      assert.ok(updated.observations.includes('obs-1'));
      assert.ok(updated.observations.includes('obs-2'));
    });

    it('defaults invalid type to concept', () => {
      const entity = createEntity(tmpDir, { name: 'thing', type: 'invalid' });
      assert.equal(entity.type, 'concept');
    });

    it('returns null for empty name', () => {
      const result = createEntity(tmpDir, { name: '' });
      assert.equal(result, null);
    });
  });

  describe('addObservationToEntity', () => {
    it('links an observation to an entity', () => {
      createEntity(tmpDir, { name: 'svc' });
      const result = addObservationToEntity(tmpDir, 'svc', 'obs-123');
      assert.ok(result.observations.includes('obs-123'));
    });

    it('deduplicates observation IDs', () => {
      createEntity(tmpDir, { name: 'svc', observationIds: ['obs-1'] });
      addObservationToEntity(tmpDir, 'svc', 'obs-1');
      const entity = getEntity(tmpDir, 'svc');
      assert.equal(entity.observations.filter((id) => id === 'obs-1').length, 1);
    });

    it('returns null for missing entity', () => {
      const result = addObservationToEntity(tmpDir, 'nonexistent', 'obs-1');
      assert.equal(result, null);
    });
  });

  describe('addRelatedEntity', () => {
    it('links two entities bidirectionally', () => {
      createEntity(tmpDir, { name: 'auth' });
      createEntity(tmpDir, { name: 'user' });
      addRelatedEntity(tmpDir, 'auth', 'user');

      const auth = getEntity(tmpDir, 'auth');
      const user = getEntity(tmpDir, 'user');
      assert.ok(auth.relatedEntities.includes('user'));
      assert.ok(user.relatedEntities.includes('auth'));
    });

    it('ignores self-relations', () => {
      createEntity(tmpDir, { name: 'svc' });
      const result = addRelatedEntity(tmpDir, 'svc', 'svc');
      assert.equal(result, null);
    });
  });

  describe('searchEntities', () => {
    it('searches by name', () => {
      createEntity(tmpDir, { name: 'auth-module', summary: 'JWT auth' });
      createEntity(tmpDir, { name: 'user-service', summary: 'User CRUD' });

      const results = searchEntities(tmpDir, 'auth');
      assert.equal(results.length, 1);
      assert.equal(results[0].name, 'auth-module');
    });

    it('searches by summary', () => {
      createEntity(tmpDir, { name: 'svc', summary: 'handles JWT authentication' });
      const results = searchEntities(tmpDir, 'jwt');
      assert.equal(results.length, 1);
    });

    it('filters by type', () => {
      createEntity(tmpDir, { name: 'a', type: 'component' });
      createEntity(tmpDir, { name: 'b', type: 'service' });
      const results = searchEntities(tmpDir, 'a', { type: 'component' });
      assert.ok(results.every((r) => r.type === 'component'));
    });

    it('returns empty for no query', () => {
      createEntity(tmpDir, { name: 'test' });
      assert.equal(searchEntities(tmpDir, '').length, 0);
    });
  });

  describe('getEntity', () => {
    it('returns entity by name (case insensitive)', () => {
      createEntity(tmpDir, { name: 'MyService', summary: 'test' });
      const entity = getEntity(tmpDir, 'MYSERVICE');
      assert.equal(entity.name, 'myservice');
      assert.equal(entity.summary, 'test');
    });

    it('returns null for missing entity', () => {
      assert.equal(getEntity(tmpDir, 'nonexistent'), null);
    });
  });

  describe('listEntities', () => {
    it('lists all entities', () => {
      createEntity(tmpDir, { name: 'a' });
      createEntity(tmpDir, { name: 'b' });
      assert.equal(listEntities(tmpDir).length, 2);
    });

    it('filters by type', () => {
      createEntity(tmpDir, { name: 'a', type: 'component' });
      createEntity(tmpDir, { name: 'b', type: 'service' });
      assert.equal(listEntities(tmpDir, { type: 'service' }).length, 1);
    });

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) createEntity(tmpDir, { name: `e-${i}` });
      assert.equal(listEntities(tmpDir, { limit: 3 }).length, 3);
    });
  });

  describe('countEntities', () => {
    it('counts entities', () => {
      createEntity(tmpDir, { name: 'a' });
      createEntity(tmpDir, { name: 'b' });
      assert.equal(countEntities(tmpDir), 2);
    });
  });
});
