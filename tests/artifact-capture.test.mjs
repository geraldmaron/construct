/**
 * tests/artifact-capture.test.mjs — tests for lib/artifact-capture.mjs session artifact extraction.
 *
 * Exercises captureSessionArtifacts end-to-end against a temp-dir fixture:
 * session-summary observation generation, capped decision extraction, and
 * file-group entity creation from changed-file patterns. Run via `npm test`.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { captureSessionArtifacts } from '../lib/artifact-capture.mjs';
import { listObservations, getObservation } from '../lib/observation-store.mjs';
import { listEntities } from '../lib/entity-store.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('artifact-capture', () => {
  describe('captureSessionArtifacts', () => {
    it('creates a session-summary observation from session', () => {
      const session = {
        id: 'test-session',
        project: 'myapp',
        summary: 'Implemented JWT authentication with refresh tokens',
        decisions: ['Use httpOnly cookies for refresh tokens', 'JWT expiry set to 15 minutes'],
        filesChanged: [
          { path: 'lib/auth/jwt.mjs', reason: 'new module' },
          { path: 'lib/auth/refresh.mjs', reason: 'new module' },
          { path: 'tests/auth.test.mjs', reason: 'tests' },
        ],
        openQuestions: [],
      };

      const ids = captureSessionArtifacts(tmpDir, session);
      assert.ok(ids.length >= 1, 'should create at least one observation');

      const obs = listObservations(tmpDir);
      const sessionSummary = obs.find((o) => o.category === 'session-summary');
      assert.ok(sessionSummary, 'should have a session-summary observation');
      assert.ok(sessionSummary.summary.includes('JWT'));
    });

    it('creates decision observations', () => {
      const session = {
        id: 'test-session',
        project: 'myapp',
        summary: 'Auth work',
        decisions: ['Use httpOnly cookies', 'JWT expiry 15 min'],
        filesChanged: [],
      };

      const ids = captureSessionArtifacts(tmpDir, session);
      const obs = listObservations(tmpDir);
      const decisions = obs.filter((o) => o.category === 'decision');
      assert.equal(decisions.length, 2);
    });

    it('creates file-group entities from file patterns', () => {
      const session = {
        id: 'test-session',
        project: 'myapp',
        summary: 'Refactored storage layer',
        decisions: [],
        filesChanged: [
          { path: 'lib/storage/sql.mjs', reason: 'refactored' },
          { path: 'lib/storage/vector.mjs', reason: 'refactored' },
          { path: 'lib/storage/sync.mjs', reason: 'refactored' },
          { path: 'tests/storage.test.mjs', reason: 'tests' },
        ],
      };

      captureSessionArtifacts(tmpDir, session);
      const entities = listEntities(tmpDir);
      const storageEntity = entities.find((e) => e.name === 'lib/storage');
      assert.ok(storageEntity, 'should create lib/storage entity');
      assert.equal(storageEntity.type, 'file-group');
    });

    it('returns empty for null session', () => {
      const ids = captureSessionArtifacts(tmpDir, null);
      assert.deepEqual(ids, []);
    });

    it('returns empty for session without summary', () => {
      const ids = captureSessionArtifacts(tmpDir, { id: 'x', decisions: [], filesChanged: [] });
      assert.deepEqual(ids, []);
    });

    it('caps decision observations at MAX_DECISION_OBS', () => {
      const session = {
        id: 'test',
        project: 'p',
        summary: 'Many decisions',
        decisions: Array.from({ length: 10 }, (_, i) => `Decision ${i}`),
        filesChanged: [],
      };

      const ids = captureSessionArtifacts(tmpDir, session);
      const obs = listObservations(tmpDir);
      const decisions = obs.filter((o) => o.category === 'decision');
      assert.ok(decisions.length <= 5, 'should cap at 5 decision observations');
    });

    it('tags observations with project name', () => {
      const session = {
        id: 'test',
        project: 'construct',
        summary: 'Test project tagging',
        decisions: [],
        filesChanged: [],
      };

      captureSessionArtifacts(tmpDir, session);
      const obs = listObservations(tmpDir);
      assert.ok(obs[0].project === 'construct');
    });

    it('includes session source reference', () => {
      const session = {
        id: 'sess-abc',
        project: 'p',
        summary: 'Source test',
        decisions: [],
        filesChanged: [],
      };

      const ids = captureSessionArtifacts(tmpDir, session);
      const obs = getObservation(tmpDir, ids[0]);
      assert.deepEqual(obs.source, { session: 'sess-abc' });
    });
  });
});
