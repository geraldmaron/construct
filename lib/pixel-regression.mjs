/**
 * lib/pixel-regression.mjs — true pixel-level regression, gated to full-certification.
 *
 * Compares two PNGs by decoding them to raw pixels and counting pixels whose channels differ
 * beyond a tolerance — not by comparing compressed file bytes, which are meaningless across
 * encoders (PNG is DEFLATE-compressed, so two pixel-identical images can differ byte-for-byte).
 * Decoding uses node:zlib only, honoring the zero-npm-core constraint; 8-bit
 * non-interlaced PNGs in the grayscale/RGB/GA/RGBA color types are supported and anything else
 * returns a typed `unsupported-encoding` rather than a false pass.
 *
 * Fixture-regeneration policy: a golden is updated only through regenerateGolden (single writer),
 * never edited in place. Pixel regression runs only at the full-certification gate level so its
 * decode-and-compare cost (O(pixels), a few milliseconds per image) never burdens cheaper gates.
 */

import fs from 'node:fs';
import zlib from 'node:zlib';

export const PIXEL_REGRESSION_LEVEL = 'full-certification';

const CHANNELS_BY_COLOR_TYPE = Object.freeze({ 0: 1, 2: 3, 4: 2, 6: 4 });

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Walk the PNG chunk stream for IHDR geometry and the concatenated IDAT payload, then inflate and
// reverse the per-scanline filter to recover raw pixels. CRCs are skipped; only the decode matters.

function decodePng(buffer) {
  if (buffer.length < 8 || buffer[0] !== 0x89 || buffer[1] !== 0x50) return { error: 'invalid-png' };
  let pos = 8;
  let header = null;
  const idat = [];
  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const dataStart = pos + 8;
    if (type === 'IHDR') {
      header = {
        width: buffer.readUInt32BE(dataStart),
        height: buffer.readUInt32BE(dataStart + 4),
        bitDepth: buffer[dataStart + 8],
        colorType: buffer[dataStart + 9],
        interlace: buffer[dataStart + 12],
      };
    } else if (type === 'IDAT') {
      idat.push(buffer.subarray(dataStart, dataStart + length));
    } else if (type === 'IEND') {
      break;
    }
    pos = dataStart + length + 4;
  }
  if (!header) return { error: 'invalid-png' };
  const channels = CHANNELS_BY_COLOR_TYPE[header.colorType];
  if (header.bitDepth !== 8 || header.interlace !== 0 || !channels) return { error: 'unsupported-encoding' };

  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return { error: 'invalid-png' };
  }

  const { width, height } = header;
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) return { error: 'invalid-png' };

  const pixels = Buffer.alloc(height * stride);
  let prior = Buffer.alloc(stride);
  let rpos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rpos];
    rpos += 1;
    const recon = pixels.subarray(y * stride, y * stride + stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? recon[x - channels] : 0;
      const up = prior[x];
      const upLeft = x >= channels ? prior[x - channels] : 0;
      let value = raw[rpos + x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      recon[x] = value & 0xff;
    }
    rpos += stride;
    prior = recon;
  }
  return { width, height, channels, pixels };
}

export function comparePng(pathA, pathB, { tolerance = 0 } = {}) {
  let bufferA;
  let bufferB;
  try {
    bufferA = fs.readFileSync(pathA);
  } catch {
    return { ok: false, reason: 'missing-image', identical: false, diffPixels: null, diffRatio: null };
  }
  try {
    bufferB = fs.readFileSync(pathB);
  } catch {
    return { ok: false, reason: 'missing-image', identical: false, diffPixels: null, diffRatio: null };
  }

  if (bufferA.equals(bufferB)) {
    return { ok: true, reason: 'identical', identical: true, diffPixels: 0, diffRatio: 0 };
  }

  const a = decodePng(bufferA);
  const b = decodePng(bufferB);
  if (a.error || b.error) {
    return { ok: false, reason: a.error || b.error, identical: false, diffPixels: null, diffRatio: null };
  }
  if (a.width !== b.width || a.height !== b.height) {
    return { ok: false, reason: 'dimension-mismatch', identical: false, diffPixels: null, diffRatio: null, dimsA: { width: a.width, height: a.height }, dimsB: { width: b.width, height: b.height } };
  }
  if (a.channels !== b.channels) {
    return { ok: false, reason: 'channel-mismatch', identical: false, diffPixels: null, diffRatio: null };
  }

  const total = a.width * a.height;
  const threshold = Math.round(tolerance * 255);
  let diffPixels = 0;
  for (let p = 0; p < total; p += 1) {
    let maxChannelDelta = 0;
    for (let k = 0; k < a.channels; k += 1) {
      const delta = Math.abs(a.pixels[p * a.channels + k] - b.pixels[p * a.channels + k]);
      if (delta > maxChannelDelta) maxChannelDelta = delta;
    }
    if (maxChannelDelta > threshold) diffPixels += 1;
  }

  const diffRatio = total ? diffPixels / total : 0;
  const ok = diffPixels === 0;
  return {
    ok,
    reason: ok ? 'identical-pixels' : 'pixel-drift',
    identical: false,
    width: a.width,
    height: a.height,
    totalPixels: total,
    diffPixels,
    diffRatio: Math.round(diffRatio * 1e6) / 1e6,
  };
}

export function pixelRegressionGate({ level, currentPath, goldenPath, tolerance = 0 }) {
  if (level !== PIXEL_REGRESSION_LEVEL) {
    return { skipped: true, reason: 'pixel regression runs only at full-certification', ok: true };
  }
  return { ...comparePng(goldenPath, currentPath, { tolerance }), skipped: false };
}

// The single sanctioned writer of a golden: copy the freshly-rendered image over it. No code path
// edits a golden in place, so regeneration stays deterministic and reviewable as one file swap.

export function regenerateGolden({ currentPath, goldenPath }) {
  try {
    fs.copyFileSync(currentPath, goldenPath);
    return { ok: true, goldenPath };
  } catch (err) {
    return { ok: false, reason: `regeneration failed: ${err.message}` };
  }
}
