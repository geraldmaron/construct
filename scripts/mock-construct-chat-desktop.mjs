#!/usr/bin/env node
/**
 * scripts/mock-construct-chat-desktop.mjs — test double for construct-chat desktop binary.
 *
 * Writes the --url argument to a marker file and exits (or waits when
 * CONSTRUCT_CHAT_DESKTOP_PERSIST=1).
 */

import fs from 'node:fs';
import path from 'node:path';

const urlIndex = process.argv.indexOf('--url');
const url = urlIndex >= 0 ? process.argv[urlIndex + 1] : null;
const marker = process.env.CONSTRUCT_CHAT_DESKTOP_MARKER;

if (marker && url) {
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, url, 'utf8');
}

if (process.env.CONSTRUCT_CHAT_DESKTOP_PERSIST !== '1') {
  process.exit(0);
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

setInterval(() => {}, 60_000);
