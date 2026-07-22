/**
 * tests/demo-annotations.test.mjs — demo chapter sidecars and accessibility descriptions (construct-tsyfe.5.6).
 */

import test from 'node:test';
const __hygieneTmpDirs = [];
test.after(() => {
  for (const dir of __hygieneTmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  assembleAccessibilityDescription,
  buildDemoChapterSidecar,
  writeDemoAnnotationSidecar,
} from '../lib/demo-annotations.mjs';

test('annotated steps produce a chapter sidecar with matching step count', () => {
  const script = {
    name: 'profile-doctor-health',
    title: 'Profile and health',
    steps: [
      { title: 'Workspace Presets', annotation: 'List presets', command: 'node bin/construct workspace-preset list' },
      { title: 'Consistency', chapterTitle: 'Consistency checks', command: 'node bin/construct doctor consistency' },
    ],
  };
  const sidecar = buildDemoChapterSidecar(script, {
    demoName: 'profile-doctor-health',
    engine: 'vhs',
    artifactPath: '.construct/demos/profile-doctor-health.mp4',
  });
  assert.equal(sidecar.chapterCount, 2);
  assert.equal(sidecar.chapters[0].chapterTitle, 'Workspace Presets');
  assert.ok(sidecar.accessibilityDescription.includes('Workspace Presets'));
});

test('demos without titled steps report no description available', () => {
  const description = assembleAccessibilityDescription({ steps: [{ command: 'true' }] });
  assert.equal(description, 'no description available');
});

test('writeDemoAnnotationSidecar writes durable JSON next to the artifact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-annotations-'));
  __hygieneTmpDirs.push(dir);
  const artifactPath = path.join(dir, 'demo.mp4');
  fs.writeFileSync(artifactPath, 'fake');
  const sidecar = buildDemoChapterSidecar({
    name: 'demo',
    steps: [{ title: 'One', prompt: 'Do one thing' }],
  }, { demoName: 'demo', engine: 'vhs', artifactPath });
  const written = writeDemoAnnotationSidecar(artifactPath, sidecar);
  assert.equal(written.ok, true);
  assert.ok(fs.existsSync(written.sidecarPath));
  const parsed = JSON.parse(fs.readFileSync(written.sidecarPath, 'utf8'));
  assert.equal(parsed.chapterCount, 1);
});
