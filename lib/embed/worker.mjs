#!/usr/bin/env node
/**
 * lib/embed/worker.mjs — Long-running embed daemon worker.
 *
 * Spawned detached by `construct embed start`. Runs until SIGTERM.
 * Reads --config <path> from argv.
 */

import path from 'node:path';
import { loadEmbedConfig } from './config.mjs';
import { EmbedDaemon } from './daemon.mjs';

function parseArgv(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) return argv[i + 1];
  }
  return path.join(process.cwd(), 'embed.yaml');
}

const configPath = parseArgv(process.argv.slice(2));

const daemon = new EmbedDaemon({ configPath });

process.on('SIGTERM', () => {
  daemon.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  daemon.stop();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  process.stderr.write(`[embed/worker] uncaughtException: ${err.message}\n${err.stack}\n`);
});

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[embed/worker] unhandledRejection: ${reason}\n`);
});

await daemon.start();
