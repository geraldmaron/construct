/**
 * tests/functional/demo-preview-route.functional.test.mjs — /demo-preview/ gated static serve.
 *
 * @capability demo.terminal-fallback
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveDemoPreviewPath } from '../../lib/server/demo-preview.mjs';
import { withDashboardServer } from './_lib/dashboard-server.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('resolveDemoPreviewPath returns 404 when env unset', () => {
  const result = resolveDemoPreviewPath('/demo-preview/sample.pdf', {});
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test('resolveDemoPreviewPath blocks traversal and unknown extensions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-preview-'));
  try {
    const env = { CONSTRUCT_DEMO_ARTIFACT_DIR: dir };
    fs.writeFileSync(path.join(dir, 'ok.pdf'), '%PDF-1.4');
    assert.equal(resolveDemoPreviewPath('/demo-preview/ok.pdf', env).ok, true);
    assert.equal(resolveDemoPreviewPath('/demo-preview/../secret.pdf', env).status, 403);
    assert.equal(resolveDemoPreviewPath('/demo-preview/missing.pdf', env).status, 404);
    assert.equal(resolveDemoPreviewPath('/demo-preview/evil.exe', env).status, 403);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('/demo-preview/ serves PDF when CONSTRUCT_DEMO_ARTIFACT_DIR is set', async (t) => {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-preview-http-'));
  const pdfPath = path.join(artifactDir, 'prd-platform.pdf');
  fs.writeFileSync(pdfPath, '%PDF-1.4 demo');

  const server = await withDashboardServer(t, {
    extraEnv: { CONSTRUCT_DEMO_ARTIFACT_DIR: artifactDir },
  });
  if (!server) return;

  const res = await server.fetch('/demo-preview/prd-platform.pdf');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/pdf/);
  const body = await res.text();
  assert.match(body, /%PDF/);

  const blocked = await server.fetch('/demo-preview/not-there.pdf');
  assert.equal(blocked.status, 404);

  fs.rmSync(artifactDir, { recursive: true, force: true });
});

test('distribution manifest uses playwright recording for prd-platform', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'examples/distribution/manifest.json'), 'utf8'));
  const prd = manifest.items.find((item) => item.id === 'prd-platform');
  assert.ok(prd);
  assert.equal(prd.recording, 'agentic-platforms-prd');
  assert.equal(prd.demoSurface, 'playwright');
  assert.equal(prd.demoArtifact, 'prd-platform.pdf');
});
