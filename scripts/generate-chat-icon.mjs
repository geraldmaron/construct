/**
 * scripts/generate-chat-icon.mjs — generate the Construct Chat desktop icon set.
 *
 * Renders the Construct diamond mark (light glyph on the deep-navy chat surface)
 * into RGBA PNGs at the sizes tauri::generate_context! and bundling expect, under
 * apps/chat/desktop/src-tauri/icons/. Dependency-free: a minimal PNG encoder over
 * Node's zlib keeps the icon reproducible from source rather than a committed blob.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ICON_DIR = path.resolve(HERE, '..', 'apps', 'chat', 'desktop', 'src-tauri', 'icons');

const BG = [0x0e, 0x15, 0x25, 0xff];
const FG = [0xe8, 0xea, 0xed, 0xff];

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// A diamond is a square rotated 45°: a pixel sits inside when its Manhattan
// distance from center, normalized by the half-extent, is within 1.

function renderRGBA(size) {
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const half = size * 0.34;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const norm = (Math.abs(x - cx) + Math.abs(y - cy)) / half;
      const color = norm <= 1 ? FG : BG;
      const offset = (y * size + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
    }
  }
  return pixels;
}

function encodePNG(size) {
  const rgba = renderRGBA(size);
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const TARGETS = [
  ['icon.png', 1024],
  ['32x32.png', 32],
  ['128x128.png', 128],
  ['128x128@2x.png', 256],
];

fs.mkdirSync(ICON_DIR, { recursive: true });
for (const [name, size] of TARGETS) {
  fs.writeFileSync(path.join(ICON_DIR, name), encodePNG(size));
  process.stdout.write(`wrote ${path.join(ICON_DIR, name)} (${size}x${size})\n`);
}
