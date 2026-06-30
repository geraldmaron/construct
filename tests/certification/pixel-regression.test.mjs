/**
 * pixel-regression.test.mjs — Guards true pixel-level comparison (cuxq.10.2).
 *
 * Fixtures are real 8-bit PNGs encoded with node:zlib so the test exercises the decoder, not a
 * stub. The load-bearing case is two images with identical pixels but different compression: a
 * byte comparison calls that drift, a pixel comparison correctly calls it a match. The gate is
 * asserted to run only at full-certification, and golden regeneration to converge a later compare.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { comparePng, pixelRegressionGate, regenerateGolden, PIXEL_REGRESSION_LEVEL } from '../../lib/pixel-regression.mjs';

const COLOR_TYPE = { 1: 0, 2: 4, 3: 2, 4: 6 };

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
}

function encodePng(width, height, fill, { channels = 3, level = 9 } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = COLOR_TYPE[channels];
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const px = fill(x, y);
      for (let k = 0; k < channels; k += 1) raw[y * (stride + 1) + 1 + x * channels + k] = px[k];
    }
  }
  const idat = zlib.deflateSync(raw, { level });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function withTmp(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixreg-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SOLID = () => [10, 20, 30];

test('byte-identical PNGs are identical', () => {
  withTmp((dir) => {
    const png = encodePng(8, 8, SOLID);
    const a = path.join(dir, 'a.png');
    const b = path.join(dir, 'b.png');
    fs.writeFileSync(a, png);
    fs.writeFileSync(b, png);
    const result = comparePng(a, b);
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'identical');
  });
});

test('same pixels, different compression — a byte diff would call this drift; pixels say match', () => {
  withTmp((dir) => {
    const a = path.join(dir, 'a.png');
    const b = path.join(dir, 'b.png');
    fs.writeFileSync(a, encodePng(8, 8, SOLID, { level: 0 }));
    fs.writeFileSync(b, encodePng(8, 8, SOLID, { level: 9 }));
    assert.ok(!fs.readFileSync(a).equals(fs.readFileSync(b)), 'fixtures must differ in bytes to be meaningful');
    const result = comparePng(a, b);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.reason, 'identical-pixels');
    assert.equal(result.diffPixels, 0);
  });
});

test('a single changed pixel is real drift', () => {
  withTmp((dir) => {
    const a = path.join(dir, 'a.png');
    const b = path.join(dir, 'b.png');
    fs.writeFileSync(a, encodePng(8, 8, SOLID));
    fs.writeFileSync(b, encodePng(8, 8, (x, y) => (x === 0 && y === 0 ? [200, 0, 0] : [10, 20, 30])));
    const result = comparePng(a, b);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'pixel-drift');
    assert.equal(result.diffPixels, 1);
    assert.ok(result.diffRatio > 0);
  });
});

test('a sub-tolerance channel delta is not counted as drift', () => {
  withTmp((dir) => {
    const a = path.join(dir, 'a.png');
    const b = path.join(dir, 'b.png');
    fs.writeFileSync(a, encodePng(8, 8, SOLID));
    fs.writeFileSync(b, encodePng(8, 8, () => [12, 22, 32]));
    assert.equal(comparePng(a, b).ok, false, 'zero tolerance must flag a 2/255 delta');
    assert.equal(comparePng(a, b, { tolerance: 0.05 }).ok, true, 'a 5% tolerance must absorb it');
  });
});

test('different dimensions are a dimension-mismatch', () => {
  withTmp((dir) => {
    const a = path.join(dir, 'a.png');
    const b = path.join(dir, 'b.png');
    fs.writeFileSync(a, encodePng(8, 8, SOLID));
    fs.writeFileSync(b, encodePng(16, 8, SOLID));
    assert.equal(comparePng(a, b).reason, 'dimension-mismatch');
  });
});

test('a missing image returns a typed reason, never a false pass', () => {
  withTmp((dir) => {
    const a = path.join(dir, 'a.png');
    fs.writeFileSync(a, encodePng(4, 4, SOLID));
    assert.equal(comparePng(a, path.join(dir, 'nope.png')).reason, 'missing-image');
  });
});

test('a non-PNG file is invalid-png, not a crash', () => {
  withTmp((dir) => {
    const a = path.join(dir, 'a.png');
    const b = path.join(dir, 'b.txt');
    fs.writeFileSync(a, encodePng(4, 4, SOLID));
    fs.writeFileSync(b, 'not a png at all');
    assert.equal(comparePng(a, b).reason, 'invalid-png');
  });
});

test('the gate runs only at full-certification and skips elsewhere as a pass', () => {
  withTmp((dir) => {
    const golden = path.join(dir, 'golden.png');
    const current = path.join(dir, 'current.png');
    fs.writeFileSync(golden, encodePng(8, 8, SOLID));
    fs.writeFileSync(current, encodePng(8, 8, SOLID));
    for (const level of ['fast', 'standard', 'render-smoke']) {
      const r = pixelRegressionGate({ level, goldenPath: golden, currentPath: current });
      assert.equal(r.skipped, true);
      assert.equal(r.ok, true);
    }
    const run = pixelRegressionGate({ level: PIXEL_REGRESSION_LEVEL, goldenPath: golden, currentPath: current });
    assert.equal(run.skipped, false);
    assert.equal(run.ok, true);
  });
});

test('regenerateGolden converges a drifting compare back to a match', () => {
  withTmp((dir) => {
    const golden = path.join(dir, 'golden.png');
    const current = path.join(dir, 'current.png');
    fs.writeFileSync(golden, encodePng(8, 8, SOLID));
    fs.writeFileSync(current, encodePng(8, 8, () => [99, 99, 99]));
    assert.equal(comparePng(golden, current).ok, false);
    regenerateGolden({ currentPath: current, goldenPath: golden });
    assert.equal(comparePng(golden, current).ok, true);
  });
});
