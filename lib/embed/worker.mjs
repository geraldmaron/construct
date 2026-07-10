#!/usr/bin/env node
/**
 * lib/embed/worker.mjs — Long-running embed daemon worker.
 *
 * Spawned detached by `construct embed start`. Runs until SIGTERM.
 * Reads --config <path> from argv, or auto-discovers sources from config.env.
 */

import os from 'node:os';
import path from 'node:path';
import { prepareConstructEnv } from '../runtime-env.mjs';
import { enableSecretAuditTrail } from '../providers/secret-audit-wiring.mjs';
import { CONFIG_DIR_NAME } from '../config-dir.mjs';
import { EmbedDaemon } from './daemon.mjs';

function parseArgv(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) return argv[i + 1];
  }
  return null;
}

// Snapshot ticks resolve provider credentials in the daemon's own process; wiring
// the sink here records those op reads on the same trail as the CLI entrypoint.
enableSecretAuditTrail();

const configPath = parseArgv(process.argv.slice(2));
const env = prepareConstructEnv();

// If no config file, build an auto-discovered config inline and inject it
let daemonOpts = { env };
if (configPath) {
  daemonOpts.configPath = configPath;
} else {
  const { ProviderRegistry } = await import('./providers/registry.mjs');
  const { EMPTY_CONFIG } = await import('./config.mjs');
  const { resolveAutoEmbedSources } = await import('./auto-sources.mjs');
  const registry = await ProviderRegistry.fromEnv(env);
  const sources = resolveAutoEmbedSources({ cwd: process.cwd(), env, registry });
  daemonOpts.registry = registry;
  daemonOpts.config = {
    ...EMPTY_CONFIG,
    sources,
    // Default snapshot sink so operators always have a current markdown copy on disk.
    outputs: [{ type: 'markdown', path: `${CONFIG_DIR_NAME}/snapshot.md` }],
  };
}

const daemon = new EmbedDaemon(daemonOpts);

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
