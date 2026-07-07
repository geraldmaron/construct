/**
 * tests/functional/demo-recording-loader.functional.test.mjs — recording validation in tmpdir.
 *
 * @capability demo.terminal-fallback
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadDemoRecordingValidated } from '../../lib/demo-recording.mjs';
import { detectPlaywrightDemo } from '../../lib/playwright-demo.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

test('project recording manifest validates and resolves spec path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-rec-fn-'));
  try {
    const specRel = '.cx/demos/specs/tour.spec.ts';
    const specPath = path.join(dir, specRel);
    fs.mkdirSync(path.dirname(specPath), { recursive: true });
    fs.writeFileSync(specPath, 'export {};\n', 'utf8');

    const recDir = path.join(dir, '.cx', 'demos', 'recordings');
    fs.mkdirSync(recDir, { recursive: true });
    fs.writeFileSync(path.join(recDir, 'tour.json'), JSON.stringify({
      name: 'tour',
      engine: 'playwright',
      workspace: '.',
      spec: specRel,
      baseUrl: 'http://127.0.0.1:3456',
      skipWebServer: true,
      output: { format: 'mp4', path: '.cx/demos/tour.mp4' },
    }, null, 2), 'utf8');

    const validated = loadDemoRecordingValidated('tour', { cwd: dir, repoRoot: dir });
    assert.equal(validated.ok, true);
    assert.equal(validated.recording.spec, specRel);
    assert.equal(validated.recording.skipWebServer, true);

    const detection = detectPlaywrightDemo({ workspace: '.', repoRoot: dir, cwd: dir });
    assert.equal(detection.present, false);
    assert.ok(detection.missing.some((m) => m.includes('playwright.config')));
  } finally {
    rmTmpDir(dir);
  }
});
