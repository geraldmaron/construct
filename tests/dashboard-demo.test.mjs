/**
 * tests/dashboard-demo.test.mjs — dashboard demo video finalize helpers.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  collectVideoFiles,
  newestVideo,
  finalizeDemoVideo,
} from '../lib/dashboard-demo.mjs';

test('newestVideo picks latest mtime', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-demo-'));
  try {
    const a = path.join(dir, 'a.webm');
    const b = path.join(dir, 'b.webm');
    fs.writeFileSync(a, 'a');
    fs.writeFileSync(b, 'b');
    const past = Date.now() - 5000;
    fs.utimesSync(a, past / 1000, past / 1000);
    assert.equal(newestVideo(collectVideoFiles([dir])), b);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
