/**
 * tests/demo-recording.test.mjs — recording manifest loader and legacy bridge.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  loadDemoRecording,
  loadDemoRecordingValidated,
  listDemoRecordings,
  normalizeArtifactReveal,
  recordingFromDemoScript,
} from '../lib/demo-recording.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('listDemoRecordings includes shipped agentic-platforms-prd', () => {
  const names = listDemoRecordings({ cwd: REPO, repoRoot: REPO });
  assert.ok(names.includes('agentic-platforms-prd'));
});

test('loadDemoRecording loads shipped manifest with artifactReveal', () => {
  const rec = loadDemoRecording('agentic-platforms-prd', { cwd: REPO, repoRoot: REPO });
  assert.ok(rec);
  assert.equal(rec.engine, 'playwright');
  assert.equal(rec.project, 'demo-recording');
  assert.equal(rec.artifactReveal.mode, 'constructPreview');
  assert.equal(rec.artifactReveal.file, 'prd-platform.pdf');
  assert.ok(rec.spec.endsWith('agentic-platforms-prd.spec.ts'));
});

test('recordingFromDemoScript synthesizes legacy dashboard bridge', () => {
  const rec = recordingFromDemoScript('agentic-platforms-prd', { cwd: REPO, repoRoot: REPO });
  assert.ok(rec);
  assert.equal(rec.workspace, 'apps/dashboard');
  assert.equal(rec._legacy, true);
  assert.equal(rec.artifactReveal.file, 'prd-platform.pdf');
});

test('loadDemoRecordingValidated rejects invalid JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-rec-'));
  try {
    const badPath = path.join(dir, '.cx', 'demos', 'recordings', 'broken.json');
    fs.mkdirSync(path.dirname(badPath), { recursive: true });
    fs.writeFileSync(badPath, '{ not json', 'utf8');
    const result = loadDemoRecordingValidated('broken', { cwd: dir, repoRoot: REPO });
    assert.equal(result.ok, false);
    assert.ok(result.errors?.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('normalizeArtifactReveal accepts legacy path field', () => {
  const reveal = normalizeArtifactReveal({ path: 'report.pdf', mode: 'sameOrigin' });
  assert.equal(reveal.file, 'report.pdf');
  assert.equal(reveal.mode, 'sameOrigin');
});
