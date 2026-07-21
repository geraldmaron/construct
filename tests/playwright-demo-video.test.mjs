/**
 * tests/playwright-demo-video.test.mjs — Playwright demo artifact selection helpers.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  finalizeDemoVideo,
  readArtifactManifest,
  selectPrimaryVideoArtifact,
} from '../lib/playwright-demo.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('selectPrimaryVideoArtifact prefers manifest path over newer stray files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-demo-'));
  try {
    const realVideo = path.join(dir, 'real.webm');
    const strayVideo = path.join(dir, 'stray.webm');
    fs.writeFileSync(realVideo, 'real');
    fs.writeFileSync(strayVideo, 'stray');
    const past = Date.now() - 5000;
    fs.utimesSync(realVideo, past / 1000, past / 1000);

    const manifest = {
      recordingMode: 'video',
      artifacts: [{
        name: 'video',
        path: realVideo,
        contentType: 'video/webm',
        mode: 'video',
      }],
    };

    assert.equal(selectPrimaryVideoArtifact(manifest, { recordingMode: 'video' }), realVideo);
    assert.notEqual(selectPrimaryVideoArtifact(manifest, { recordingMode: 'video' }), strayVideo);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('selectPrimaryVideoArtifact honors screencast mode', () => {
  const screencast = '/tmp/demo-screencast.webm';
  const video = '/tmp/demo-video.webm';
  const manifest = {
    recordingMode: 'screencast',
    artifacts: [
      { name: 'video', path: video, mode: 'video' },
      { name: 'screencast', path: screencast, mode: 'screencast' },
    ],
  };
  assert.equal(selectPrimaryVideoArtifact(manifest, { recordingMode: 'screencast' }), screencast);
});

test('readArtifactManifest reads reporter output from disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-demo-'));
  try {
    const manifestPath = path.join(dir, 'manifest.json');
    const payload = { recordingMode: 'video', artifacts: [{ path: '/tmp/a.webm', mode: 'video' }] };
    fs.writeFileSync(manifestPath, JSON.stringify(payload));
    assert.deepEqual(readArtifactManifest(manifestPath), payload);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('playwright-demo.mjs never invokes npx', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/playwright-demo.mjs'), 'utf8');
  assert.match(src, /resolvePlaywrightCli/);
  assert.doesNotMatch(src, /spawnSync\(\s*['"]npx['"]/);
  assert.doesNotMatch(src, /\bnpx\b/);
});

test('runPlaywrightDemoTests uses the local @playwright/test CLI via node', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/playwright-demo.mjs'), 'utf8');
  assert.match(src, /spawnSync\(process\.execPath, args/);
  assert.match(src, /resolvePlaywrightCli/);
});

test('finalizeDemoVideo copies mp4 when format matches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-demo-'));
  try {
    const src = path.join(dir, 'src.mp4');
    const dest = path.join(dir, 'out.mp4');
    fs.writeFileSync(src, 'video');
    const result = finalizeDemoVideo({ sourcePath: src, outputPath: dest, format: 'mp4' });
    assert.equal(result.ok, true);
    assert.ok(fs.existsSync(dest));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
