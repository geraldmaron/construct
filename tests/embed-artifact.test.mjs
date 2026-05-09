/**
 * tests/embed-artifact.test.mjs — Unit tests for lib/embed/artifact.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateArtifact, listArtifacts, recommendArtifacts } from '../lib/embed/artifact.mjs';

let tmpDir;

before(() => { tmpDir = mkdtempSync(join(tmpdir(), 'construct-artifact-test-')); });
after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('generateArtifact', () => {
  it('throws on unknown type', () => {
    assert.throws(
      () => generateArtifact({ type: 'memo', title: 'X', rootDir: tmpDir }),
      /Unknown artifact type/
    );
  });

  it('throws on missing title', () => {
    assert.throws(
      () => generateArtifact({ type: 'prd', title: '', rootDir: tmpDir }),
      /title is required/
    );
  });

  it('generates a PRD with correct filename and front-matter', () => {
    const result = generateArtifact({ type: 'prd', title: 'My Feature Plan', rootDir: tmpDir });
    assert.equal(result.number, 1);
    assert.ok(result.relativePath.startsWith('docs/prd/'));
    assert.ok(result.relativePath.endsWith('my-feature-plan.md'));
    assert.ok(existsSync(result.path));
    const content = readFileSync(result.path, 'utf8');
    assert.ok(content.includes('# PRD-0001: My Feature Plan'));
    assert.ok(content.includes('cx_doc_id:'));
    assert.ok(content.includes('generator: construct/artifact'));
  });

  it('generates an ADR with correct heading and status', () => {
    const result = generateArtifact({
      type: 'adr',
      title: 'Use Postgres',
      rootDir: tmpDir,
      fields: { status: 'Accepted', context: 'We need a database.' },
    });
    assert.equal(result.number, 1);
    const content = readFileSync(result.path, 'utf8');
    assert.ok(content.includes('# ADR-0001: Use Postgres'));
    assert.ok(content.includes('## Status\n\nAccepted'));
    assert.ok(content.includes('We need a database.'));
  });

  it('generates an RFC with correct heading', () => {
    const result = generateArtifact({
      type: 'rfc',
      title: 'New Auth Flow',
      rootDir: tmpDir,
      fields: { summary: 'Redesign authentication.' },
    });
    assert.equal(result.number, 1);
    const content = readFileSync(result.path, 'utf8');
    assert.ok(content.includes('# RFC-0001: New Auth Flow'));
    assert.ok(content.includes('Redesign authentication.'));
  });

  it('auto-increments sequence numbers', () => {
    const r1 = generateArtifact({ type: 'rfc', title: 'First RFC', rootDir: tmpDir });
    const r2 = generateArtifact({ type: 'rfc', title: 'Second RFC', rootDir: tmpDir });
    assert.equal(r2.number, r1.number + 1);
  });

  it('dry-run does not write file', () => {
    const result = generateArtifact({ type: 'prd', title: 'Dry Run PRD', rootDir: tmpDir, dryRun: true });
    assert.ok(!existsSync(result.path));
    assert.ok(result.content.includes('Dry Run PRD'));
  });

  it('slugifies titles with special characters', () => {
    const result = generateArtifact({ type: 'adr', title: 'Use S3 (not GCS)', rootDir: tmpDir });
    assert.ok(result.relativePath.includes('use-s3-not-gcs'));
  });
});

describe('listArtifacts', () => {
  it('returns empty array when no artifacts exist', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'construct-artifact-empty-'));
    try {
      const artifacts = listArtifacts({ rootDir: emptyDir });
      assert.deepEqual(artifacts, []);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('lists all artifacts across types', () => {
    const artifacts = listArtifacts({ rootDir: tmpDir });
    const types = [...new Set(artifacts.map(a => a.type))].sort();
    assert.ok(types.includes('prd'));
    assert.ok(types.includes('adr'));
    assert.ok(types.includes('rfc'));
  });

  it('filters by type', () => {
    const prds = listArtifacts({ type: 'prd', rootDir: tmpDir });
    assert.ok(prds.every(a => a.type === 'prd'));
    assert.ok(prds.length >= 1);
  });

  it('extracts title and status from file content', () => {
    const artifacts = listArtifacts({ type: 'prd', rootDir: tmpDir });
    const first = artifacts[0];
    assert.ok(first.title.length > 0);
    assert.ok(first.status.length > 0);
  });

  it('returns number as integer', () => {
    const artifacts = listArtifacts({ rootDir: tmpDir });
    for (const a of artifacts) {
      assert.equal(typeof a.number, 'number');
    }
  });
});

describe('recommendArtifacts', () => {
  it('recommends PRD when none exists', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'construct-artifact-rec-'));
    try {
      const recs = recommendArtifacts({}, { rootDir: emptyDir });
      assert.ok(recs.some(r => r.type === 'prd'));
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('does not recommend PRD when one exists', () => {
    // tmpDir already has a PRD from earlier tests
    const recs = recommendArtifacts({}, { rootDir: tmpDir });
    assert.ok(!recs.some(r => r.type === 'prd'));
  });

  it('recommends error ADR when snapshot has errors', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'construct-artifact-rec2-'));
    try {
      const snapshot = { summary: [{ status: 'error', provider: 'git' }], providers: ['git'] };
      const recs = recommendArtifacts(snapshot, { rootDir: emptyDir });
      assert.ok(recs.some(r => r.type === 'adr' && /error|resilience/i.test(r.title)));
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('recommends RFC when 3+ providers configured', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'construct-artifact-rec3-'));
    try {
      const snapshot = { providers: ['git', 'github', 'jira'], summary: [] };
      const recs = recommendArtifacts(snapshot, { rootDir: emptyDir });
      assert.ok(recs.some(r => r.type === 'rfc'));
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('returns empty array when nothing to recommend', () => {
    // tmpDir has PRD, no errors, < 3 providers
    const recs = recommendArtifacts({ providers: ['git'], summary: [] }, { rootDir: tmpDir });
    assert.equal(recs.length, 0);
  });
});
